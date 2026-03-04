/**
 * ContextManagerAdapter - ContextManager → ContextManagerPort
 *
 * 最复杂的 Adapter:
 * - AgentInput → ContextBlock[] 转换 (9 级优先队列)
 * - AssembledPrompt → LLMMessage[] 转换
 * - BudgetStatus → BudgetCheckResult 映射
 * - CompactMessage ↔ LLMMessage 映射
 *
 * @module platform/adapters/context-manager-adapter
 */

import type {
  ContextManagerPort,
  BudgetCheckResult,
  ProcessedOutput,
  CompactResult,
  ContextStats,
} from "../../agent/ports/platform-services.js";
import type {
  AgentConfig,
  AgentInput,
  LLMMessage,
} from "../../agent/types.js";
import type { ToolResult } from "../../platform/tools/types.js";
import type {
  ContextManager,
  ContextBlock,
  CompactMessage,
} from "../context-manager.js";

// ============================================================================
// Priority Constants (CM-3: 9 级优先队列)
// ============================================================================

/** Identity 已由 ContextManager 内部管理（identityContent），不需要 block */
const PRIORITY_USER_MESSAGE = 2 as const;
const PRIORITY_MENTAL_MODEL = 3 as const;
const PRIORITY_SKILL = 3 as const;
const PRIORITY_TODO = 4 as const;
const PRIORITY_MEMORY = 5 as const;
const PRIORITY_HISTORY = 6 as const;

// ============================================================================
// Adapter
// ============================================================================

export class ContextManagerAdapter implements ContextManagerPort {
  private readonly cm: ContextManager;
  private readonly summarizeFn: (text: string) => Promise<string>;

  constructor(
    cm: ContextManager,
    summarizeFn: (text: string) => Promise<string>,
  ) {
    this.cm = cm;
    this.summarizeFn = summarizeFn;
  }

  // --------------------------------------------------------------------------
  // assemblePrompt: AgentInput → ContextBlock[] → AssembledPrompt → LLMMessage[]
  // --------------------------------------------------------------------------

  async assemblePrompt(
    input: AgentInput,
    _config: AgentConfig,
  ): Promise<LLMMessage[]> {
    const blocks = this.buildBlocks(input);
    const assembled = this.cm.assemblePrompt({ blocks });

    return this.assembledToMessages(assembled, input);
  }

  // --------------------------------------------------------------------------
  // checkBudget: estimate tokens → sync state → map result
  // --------------------------------------------------------------------------

  checkBudget(messages: LLMMessage[]): BudgetCheckResult {
    // Sync token usage from messages
    const totalTokens = messages.reduce(
      (sum, m) => sum + this.cm.estimateTokens(m.content),
      0,
    );
    this.cm.updateTokenUsage(totalTokens);

    const status = this.cm.checkBudget();

    return {
      withinBudget: status.used < status.available,
      currentTokens: status.used,
      maxTokens: status.total,
      remainingTokens: Math.max(0, status.available - status.used),
      shouldCompact: status.shouldCompact,
      shouldDegrade: status.shouldDegrade,
    };
  }

  // --------------------------------------------------------------------------
  // processLLMOutput: string → LLMChunk → ProcessedOutput → Port ProcessedOutput
  // --------------------------------------------------------------------------

  processLLMOutput(rawOutput: string): ProcessedOutput {
    // Process as a single chunk then flush
    const mainResult = this.cm.processLLMOutput({ text: rawOutput, done: false });
    const flushResult = this.cm.processLLMOutput({ text: "", done: true });

    // Combine content
    const visibleContent = mainResult.content + flushResult.content;
    const thinkingContent = mainResult.thinking ?? flushResult.thinking;
    const emotionTags = mainResult.emotionTags ?? flushResult.emotionTags;

    return {
      visibleContent,
      truncated: false,
      ...(thinkingContent !== undefined ? { thinkingContent } : {}),
      ...(emotionTags !== undefined
        ? { emotionTags: [...emotionTags] }
        : {}),
    };
  }

  // --------------------------------------------------------------------------
  // processToolResult: ToolResult → ToolResultInput → content string
  // --------------------------------------------------------------------------

  processToolResult(
    result: ToolResult,
    toolName: string,
    _maxLength?: number,
  ): string {
    const content =
      typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output);

    const processed = this.cm.processToolResult({ toolName, content });
    return processed.content;
  }

  // --------------------------------------------------------------------------
  // compact: LLMMessage[] → CompactMessage[] → Platform compact → Port CompactResult
  // --------------------------------------------------------------------------

  async compact(
    messages: LLMMessage[],
    preservedIds?: string[],
  ): Promise<CompactResult> {
    const preservedSet = new Set(preservedIds ?? []);

    // Convert LLMMessage[] → CompactMessage[]
    const compactMessages: CompactMessage[] = messages.map((m, idx) => ({
      role: m.role === "tool" ? "system" : m.role,
      content: m.content,
      // System messages and messages with preserved IDs are pinned
      pinned: m.role === "system" || preservedSet.has(String(idx)),
    }));

    // Estimate tokens before
    const contentBefore = messages.map((m) => m.content).join("\n");
    const tokensBefore = this.cm.estimateTokens(contentBefore);

    // Delegate to Platform ContextManager
    const platformResult = await this.cm.compact({
      messages: compactMessages,
      summarize: this.summarizeFn,
    });

    // Convert preserved CompactMessage[] → LLMMessage[]
    const resultMessages: LLMMessage[] = [];

    // Add summary as system message if present
    if (platformResult.summary.length > 0) {
      resultMessages.push({
        role: "system",
        content: `[对话摘要] ${platformResult.summary}`,
      });
    }

    // Add preserved messages
    for (const pm of platformResult.preserved) {
      resultMessages.push({
        role: pm.role,
        content: pm.content,
      });
    }

    const contentAfter = resultMessages.map((m) => m.content).join("\n");
    const tokensAfter = this.cm.estimateTokens(contentAfter);

    return {
      messages: resultMessages,
      tokensBefore,
      tokensAfter,
      success: true,
      summary: platformResult.summary,
    };
  }

  // --------------------------------------------------------------------------
  // getStats: ContextMetrics → ContextStats
  // --------------------------------------------------------------------------

  getStats(): ContextStats {
    const metrics = this.cm.getMetrics();

    return {
      totalTokens: metrics.tokenUsage.total,
      priorityDistribution: {},
      compactCount: metrics.compactCount,
    };
  }

  // ============================================================================
  // Private: AgentInput → ContextBlock[]
  // ============================================================================

  private buildBlocks(input: AgentInput): ContextBlock[] {
    const blocks: ContextBlock[] = [];

    // User message (priority 2)
    blocks.push({
      priority: PRIORITY_USER_MESSAGE,
      label: "user-message",
      content: input.userMessage,
      pinned: true,
    });

    // Task goal for background mode (priority 2)
    if (input.taskGoal) {
      blocks.push({
        priority: PRIORITY_USER_MESSAGE,
        label: "task-goal",
        content: input.taskGoal,
        pinned: true,
      });
    }

    // Mental model (priority 3)
    blocks.push({
      priority: PRIORITY_MENTAL_MODEL,
      label: "mental-model",
      content: input.mentalModel.formattedText,
    });

    // Activated skills (priority 3)
    for (const skill of input.activatedSkills) {
      const parts: string[] = [`[Skill: ${skill.name}]`];
      if (skill.knowledge) {
        parts.push(skill.knowledge);
      }
      if (skill.examples && skill.examples.length > 0) {
        parts.push(
          "Examples:\n" +
            skill.examples
              .map((e) => `User: ${e.user}\nAssistant: ${e.assistant}`)
              .join("\n---\n"),
        );
      }

      blocks.push({
        priority: PRIORITY_SKILL,
        label: `skill:${skill.id}`,
        content: parts.join("\n"),
      });
    }

    // Todo state (priority 4)
    if (input.todoState) {
      blocks.push({
        priority: PRIORITY_TODO,
        label: "todo",
        content: input.todoState.formattedText,
      });
    }

    // Recalled memories (priority 5)
    if (input.recalledMemories.length > 0) {
      const memoryText = input.recalledMemories
        .map((m) => `[${m.source}] ${m.content}`)
        .join("\n");
      blocks.push({
        priority: PRIORITY_MEMORY,
        label: "memories",
        content: memoryText,
      });
    }

    // Conversation history (priority 6)
    if (input.conversationHistory.length > 0) {
      const historyText = input.conversationHistory
        .map((t) => `${t.role}: ${t.content}`)
        .join("\n");
      blocks.push({
        priority: PRIORITY_HISTORY,
        label: "history",
        content: historyText,
      });
    }

    return blocks;
  }

  // ============================================================================
  // Private: AssembledPrompt → LLMMessage[]
  // ============================================================================

  private assembledToMessages(
    assembled: ReturnType<ContextManager["assemblePrompt"]>,
    input: AgentInput,
  ): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // Collect system-level blocks (everything except user-message and history)
    const systemParts: string[] = [];
    let hasHistory = false;

    for (const block of assembled.included) {
      if (block.label === "user-message") continue;
      if (block.label === "history") {
        hasHistory = true;
        continue;
      }
      systemParts.push(block.content);
    }

    // System message from all system-level context
    if (systemParts.length > 0) {
      messages.push({
        role: "system",
        content: systemParts.join("\n\n"),
      });
    }

    // History as individual messages
    if (hasHistory) {
      for (const turn of input.conversationHistory) {
        messages.push({
          role: turn.role,
          content: turn.content,
        });
      }
    }

    // User message (always last)
    messages.push({
      role: "user",
      content: input.userMessage,
    });

    return messages;
  }
}
