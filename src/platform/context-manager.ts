/**
 * ContextManager - 统一上下文管理
 * 位置: src/platform/context-manager.ts
 *
 * CM-1: Token 预算策略
 * CM-2: 统一 Token 估算
 * CM-3: Prompt 组装（9 级优先队列）
 * CM-4: 工具结果截断
 * CM-5: LLM 输出处理（think/emotion）
 * CM-6: Compact 策略
 * CM-7: 开发追踪 Metrics
 *
 * ContextManager 是 context window 的唯一看门人。
 * Agent Core 和其他 Platform Service 不做任何 token 计算。
 */

// ============ Types ============

export interface ContextBlock {
  readonly priority: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly label: string;
  readonly content: string;
  readonly pinned?: boolean;
}

export interface AssembleInput {
  readonly blocks: readonly ContextBlock[];
}

export interface AssembledPrompt {
  readonly included: readonly ContextBlock[];
  readonly skipped: readonly ContextBlock[];
  readonly tokenUsage: {
    readonly total: number;
    readonly perBlock: ReadonlyMap<string, number>;
  };
}

export interface ToolResultInput {
  readonly toolName: string;
  readonly content: string;
}

export interface ProcessedToolResult {
  readonly content: string;
  readonly truncated: boolean;
  readonly originalLength: number;
}

export interface LLMChunk {
  readonly text: string;
  readonly done: boolean;
}

export interface ProcessedOutput {
  readonly content: string;
  readonly thinking?: string;
  readonly emotionTags?: readonly string[];
}

export interface BudgetStatus {
  readonly total: number;
  readonly identityFixed: number;
  readonly safetyMargin: number;
  readonly available: number;
  readonly used: number;
  readonly shouldCompact: boolean;
  readonly shouldDegrade: boolean;
}

export interface CompactMessage {
  readonly role: "user" | "assistant" | "system";
  readonly content: string;
  readonly pinned: boolean;
}

export interface CompactInput {
  readonly messages: readonly CompactMessage[];
  readonly summarize: (text: string) => Promise<string>;
}

export interface CompactResult {
  readonly preserved: readonly CompactMessage[];
  readonly summary: string;
  readonly removedCount: number;
}

export interface ToolCallRecord {
  readonly name: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly truncated: boolean;
}

export interface ContextMetrics {
  readonly iteration: number;
  readonly toolChain: readonly ToolCallRecord[];
  readonly tokenUsage: {
    readonly total: number;
    readonly identityFixed: number;
    readonly used: number;
    readonly available: number;
  };
  readonly compactCount: number;
}

// ============ Interface ============

export interface ContextManager {
  assemblePrompt(input: AssembleInput): AssembledPrompt;
  processToolResult(result: ToolResultInput): ProcessedToolResult;
  processLLMOutput(chunk: LLMChunk): ProcessedOutput;
  checkBudget(): BudgetStatus;
  compact(input: CompactInput): Promise<CompactResult>;
  estimateTokens(text: string): number;
  getMetrics(): ContextMetrics;
  recordIteration(): void;
  recordToolCall(entry: ToolCallRecord): void;
  updateTokenUsage(used: number): void;
}

// ============ Options ============

export interface ContextManagerOptions {
  readonly totalContextTokens: number;
  readonly identityContent: string;
  readonly safetyMarginTokens: number;
  readonly tokenEstimateDivisor?: number; // default 3
  readonly maxCompacts?: number; // default 2
  readonly toolTruncationThresholds?: {
    readonly default?: number; // 1300 tokens
    readonly shell?: number; // 700 tokens
    readonly file_read?: number; // 2000 tokens
    readonly web_search?: number; // 1000 tokens
  };
}

// ============ Implementation ============

/** LLM 输出解析状态 */
type ParseState = "NORMAL" | "IN_THINK" | "IN_EMOTIONS";

class ContextManagerImpl implements ContextManager {
  private readonly totalContextTokens: number;
  private readonly identityFixed: number;
  private readonly safetyMarginTokens: number;
  private readonly divisor: number;
  private readonly maxCompacts: number;
  private readonly thresholds: {
    readonly default: number;
    readonly shell: number;
    readonly file_read: number;
    readonly web_search: number;
  };

  // Mutable state (per-session)
  private usedTokens = 0;
  private iterationCount = 0;
  private compactCount = 0;
  private toolChain: ToolCallRecord[] = [];

  // LLM output parsing state (CM-5)
  private parseState: ParseState = "NORMAL";
  private thinkBuffer = "";

  constructor(options: ContextManagerOptions) {
    this.totalContextTokens = options.totalContextTokens;
    this.safetyMarginTokens = options.safetyMarginTokens;
    this.divisor = options.tokenEstimateDivisor ?? 3;
    this.maxCompacts = options.maxCompacts ?? 2;

    this.identityFixed = this.estimateTokens(options.identityContent);

    const t = options.toolTruncationThresholds;
    this.thresholds = {
      default: t?.default ?? 1300,
      shell: t?.shell ?? 700,
      file_read: t?.file_read ?? 2000,
      web_search: t?.web_search ?? 1000,
    };
  }

  // ============ CM-2: Token 估算 ============

  estimateTokens(text: string): number {
    if (text.length === 0) return 0;
    return Math.ceil(text.length / this.divisor);
  }

  // ============ CM-1: 预算检查 ============

  checkBudget(): BudgetStatus {
    const available =
      this.totalContextTokens - this.identityFixed - this.safetyMarginTokens;
    return {
      total: this.totalContextTokens,
      identityFixed: this.identityFixed,
      safetyMargin: this.safetyMarginTokens,
      available,
      used: this.usedTokens,
      shouldCompact: this.usedTokens >= available,
      shouldDegrade:
        this.usedTokens >= available &&
        this.compactCount >= this.maxCompacts,
    };
  }

  // ============ CM-3: Prompt 组装 ============

  assemblePrompt(input: AssembleInput): AssembledPrompt {
    const sorted = [...input.blocks].sort((a, b) => a.priority - b.priority);
    const included: ContextBlock[] = [];
    const skipped: ContextBlock[] = [];
    const perBlock = new Map<string, number>();
    let totalTokens = 0;

    const available =
      this.totalContextTokens - this.identityFixed - this.safetyMarginTokens;

    for (const block of sorted) {
      const blockTokens = this.estimateTokens(block.content);

      // Priority 1-4: always include
      if (block.priority <= 4) {
        included.push(block);
        perBlock.set(block.label, blockTokens);
        totalTokens += blockTokens;
        continue;
      }

      // Priority 5-9: include if budget allows
      if (totalTokens + blockTokens <= available) {
        included.push(block);
        perBlock.set(block.label, blockTokens);
        totalTokens += blockTokens;
      } else {
        skipped.push(block);
      }
    }

    return {
      included,
      skipped,
      tokenUsage: { total: totalTokens, perBlock },
    };
  }

  // ============ CM-4: 工具结果截断 ============

  processToolResult(result: ToolResultInput): ProcessedToolResult {
    const threshold = this.getToolThreshold(result.toolName);
    const contentTokens = this.estimateTokens(result.content);

    if (contentTokens <= threshold) {
      return {
        content: result.content,
        truncated: false,
        originalLength: result.content.length,
      };
    }

    const maxChars = threshold * this.divisor;
    const isShell = result.toolName === "shell";

    let truncatedContent: string;
    if (isShell) {
      // 尾部保留（错误信息在末尾）
      truncatedContent = result.content.slice(-maxChars);
    } else {
      // 头部保留
      truncatedContent = result.content.slice(0, maxChars);
    }

    const notice = `\n...(结果已截断，共 ${result.content.length} 字符)`;

    return {
      content: truncatedContent + notice,
      truncated: true,
      originalLength: result.content.length,
    };
  }

  // ============ CM-5: LLM 输出处理 ============

  processLLMOutput(chunk: LLMChunk): ProcessedOutput {
    if (chunk.done) {
      // Flush remaining think buffer
      const flushed = this.thinkBuffer;
      this.parseState = "NORMAL";
      this.thinkBuffer = "";
      return {
        content: "",
        ...(flushed.length > 0 ? { thinking: flushed } : {}),
      };
    }

    let text = chunk.text;
    let content = "";
    let thinking: string | undefined;
    let emotionTags: string[] | undefined;

    // Extract emotions first (always at the end of text)
    const emotionMatch = text.match(/\n?\[emotions:\s*([^\]]+)\]\s*$/);
    if (emotionMatch) {
      text = text.slice(0, text.indexOf(emotionMatch[0]!));
      emotionTags = emotionMatch[1]!.split(",").map((t) => t.trim());
    }

    // Process think tags
    let i = 0;
    while (i < text.length) {
      if (this.parseState === "NORMAL") {
        const thinkStart = text.indexOf("<think>", i);
        if (thinkStart === -1) {
          content += text.slice(i);
          break;
        }
        content += text.slice(i, thinkStart);
        this.parseState = "IN_THINK";
        i = thinkStart + 7; // skip "<think>"
      } else if (this.parseState === "IN_THINK") {
        const thinkEnd = text.indexOf("</think>", i);
        if (thinkEnd === -1) {
          // Think continues in next chunk
          this.thinkBuffer += text.slice(i);
          break;
        }
        this.thinkBuffer += text.slice(i, thinkEnd);
        thinking = this.thinkBuffer;
        this.thinkBuffer = "";
        this.parseState = "NORMAL";
        i = thinkEnd + 8; // skip "</think>"
      }
    }

    return {
      content,
      ...(thinking !== undefined ? { thinking } : {}),
      ...(emotionTags?.length ? { emotionTags } : {}),
    };
  }

  // ============ CM-6: Compact ============

  async compact(input: CompactInput): Promise<CompactResult> {
    const messages = input.messages;
    const preserved: CompactMessage[] = [];
    const toSummarize: CompactMessage[] = [];

    // Collect pinned messages
    const pinnedMessages = messages.filter((m) => m.pinned);

    // Keep last 2 rounds (4 messages: user+assistant * 2)
    const recentCount = Math.min(4, messages.length);
    const recentMessages = messages.slice(-recentCount);

    // Middle history (not pinned, not recent)
    const recentSet = new Set(recentMessages);
    const pinnedSet = new Set(pinnedMessages);

    for (const msg of messages) {
      if (pinnedSet.has(msg)) {
        preserved.push(msg);
      } else if (recentSet.has(msg)) {
        // will add after summary
      } else {
        toSummarize.push(msg);
      }
    }

    // Summarize middle history
    let summary = "";
    if (toSummarize.length > 0) {
      const historyText = toSummarize
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");
      summary = await input.summarize(historyText);
    }

    // Add recent messages
    for (const msg of recentMessages) {
      if (!pinnedSet.has(msg)) {
        preserved.push(msg);
      }
    }

    this.compactCount++;

    return {
      preserved,
      summary,
      removedCount: toSummarize.length,
    };
  }

  // ============ CM-7: Metrics ============

  getMetrics(): ContextMetrics {
    const available =
      this.totalContextTokens - this.identityFixed - this.safetyMarginTokens;
    return {
      iteration: this.iterationCount,
      toolChain: [...this.toolChain],
      tokenUsage: {
        total: this.totalContextTokens,
        identityFixed: this.identityFixed,
        used: this.usedTokens,
        available,
      },
      compactCount: this.compactCount,
    };
  }

  recordIteration(): void {
    this.iterationCount++;
  }

  recordToolCall(entry: ToolCallRecord): void {
    this.toolChain.push(entry);
  }

  updateTokenUsage(used: number): void {
    this.usedTokens = used;
  }

  // ============ Private ============

  private getToolThreshold(toolName: string): number {
    if (toolName === "shell") return this.thresholds.shell;
    if (toolName === "file_read") return this.thresholds.file_read;
    if (toolName === "web_search") return this.thresholds.web_search;
    return this.thresholds.default;
  }
}

// ============ Factory ============

export function createContextManager(
  options: ContextManagerOptions,
): ContextManager {
  return new ContextManagerImpl(options);
}
