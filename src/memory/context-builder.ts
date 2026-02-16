/**
 * ContextBuilder - 上下文构建器
 * 整合人设提示词 + 记忆检索 + 最近对话
 *
 * 特点：
 * - 动态构建上下文
 * - Token 限制下的智能裁剪
 * - 与 PersonaEngine 集成
 */

import {
  BuildContext,
  ContextBuildOptions,
  DEFAULT_CONTEXT_CONFIG,
  Message,
  MemorySearchResult,
  PersonaEngineLike,
} from './types';
import { SessionMemory } from './session-memory';
import { ShortTermMemory } from './short-term-memory';
import { ContextBuildError, ValidationError } from './errors';

/**
 * ContextBuilder 类
 * 负责构建对话上下文
 */
export class ContextBuilder {
  private readonly _personaEngine: PersonaEngineLike | null;
  private readonly _defaultOptions: ContextBuildOptions;

  constructor(personaEngine?: PersonaEngineLike, options?: Partial<ContextBuildOptions>) {
    this._personaEngine = personaEngine ?? null;
    this._defaultOptions = { ...DEFAULT_CONTEXT_CONFIG, ...options };
  }

  /**
   * 构建对话上下文
   */
  async build(
    sessionMemory: SessionMemory,
    shortTermMemory: ShortTermMemory | null,
    currentMessage: string,
    options?: Partial<ContextBuildOptions>
  ): Promise<BuildContext> {
    const opts = { ...this._defaultOptions, ...options };

    // Validate input
    if (!currentMessage || typeof currentMessage !== 'string') {
      throw new ValidationError('currentMessage', 'Current message must be a non-empty string');
    }

    try {
      // 1. Get persona prompt
      const systemPrompt = opts.includePersonaPrompt && this._personaEngine
        ? this._personaEngine.getSystemPrompt()
        : '';

      // 2. Search relevant memories
      let relevantMemories: MemorySearchResult[] = [];
      if (opts.includeMemories && shortTermMemory) {
        relevantMemories = await shortTermMemory.searchMemory(currentMessage, 5);
      }

      // 3. Get recent messages
      const recentMessages = sessionMemory.getRecentMessages(opts.maxMessages);

      // 4. Build full context string
      const fullContext = this._formatContext(
        systemPrompt,
        relevantMemories,
        recentMessages,
        currentMessage
      );

      // 5. Estimate token count (simplified: use character count / 4)
      const tokenCount = this._estimateTokens(fullContext);

      // 6. Truncate if exceeds limit
      const truncatedContext = this._truncateContext(fullContext, opts.maxTokens);
      const finalTokenCount = this._estimateTokens(truncatedContext);

      return {
        systemPrompt,
        relevantMemories,
        recentMessages: [...recentMessages],
        fullContext: truncatedContext,
        tokenCount: finalTokenCount,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ContextBuildError(
        sessionMemory.sessionId,
        (error as Error).message,
        error as Error
      );
    }
  }

  /**
   * 构建简化的上下文（不含异步记忆检索）
   */
  buildSync(
    sessionMemory: SessionMemory,
    currentMessage: string,
    options?: Partial<ContextBuildOptions>
  ): BuildContext {
    const opts = { ...this._defaultOptions, ...options };

    // Validate input
    if (!currentMessage || typeof currentMessage !== 'string') {
      throw new ValidationError('currentMessage', 'Current message must be a non-empty string');
    }

    // 1. Get persona prompt
    const systemPrompt = opts.includePersonaPrompt && this._personaEngine
      ? this._personaEngine.getSystemPrompt()
      : '';

    // 2. Get recent messages
    const recentMessages = sessionMemory.getRecentMessages(opts.maxMessages);

    // 3. Build full context string
    const fullContext = this._formatContext(
      systemPrompt,
      [], // No memories in sync mode
      recentMessages,
      currentMessage
    );

    // 4. Estimate and truncate
    const truncatedContext = this._truncateContext(fullContext, opts.maxTokens);
    const tokenCount = this._estimateTokens(truncatedContext);

    return {
      systemPrompt,
      relevantMemories: [],
      recentMessages: [...recentMessages],
      fullContext: truncatedContext,
      tokenCount,
    };
  }

  /**
   * 格式化上下文字符串
   */
  private _formatContext(
    systemPrompt: string,
    memories: MemorySearchResult[],
    recentMessages: readonly Message[],
    currentMessage: string
  ): string {
    const sections: string[] = [];

    // Add system prompt (persona)
    if (systemPrompt) {
      sections.push(systemPrompt);
    }

    // Add relevant memories
    if (memories.length > 0) {
      sections.push('\n## Relevant Memories');
      sections.push(
        ...memories.map((m, i) => `${i + 1}. ${m.content} (relevance: ${(m.score * 100).toFixed(0)}%)`)
      );
    }

    // Add recent conversation
    if (recentMessages.length > 0) {
      sections.push('\n## Recent Conversation');
      sections.push(
        ...recentMessages.map((msg) => {
          const roleLabel = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
          return `${roleLabel}: ${msg.content}`;
        })
      );
    }

    // Add current message
    sections.push('\n## Current Message');
    sections.push(`User: ${currentMessage}`);

    return sections.join('\n');
  }

  /**
   * 估算 token 数量
   * 简化实现：中文字符约 1.5 tokens，英文单词约 1 token
   */
  private _estimateTokens(text: string): number {
    if (!text) return 0;

    // Count Chinese characters
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    // Count non-Chinese characters (roughly word-like units)
    const nonChineseLength = text.length - chineseChars;

    // Estimate tokens
    return Math.ceil(chineseChars * 1.5 + nonChineseLength / 4);
  }

  /**
   * 裁剪上下文以适应 token 限制
   */
  private _truncateContext(context: string, maxTokens: number): string {
    const currentTokens = this._estimateTokens(context);

    if (currentTokens <= maxTokens) {
      return context;
    }

    // Simple truncation: cut from the beginning of the conversation history
    // Keep system prompt and current message intact
    const lines = context.split('\n');

    // Find key sections
    const currentMessageIdx = lines.findIndex((line) => line.startsWith('## Current Message'));
    const recentConversationIdx = lines.findIndex((line) => line.startsWith('## Recent Conversation'));

    if (currentMessageIdx === -1 || recentConversationIdx === -1) {
      // Fallback: simple character truncation
      const targetChars = maxTokens * 4;
      return context.slice(-targetChars);
    }

    // Build truncated context
    const result: string[] = [];
    let currentTokensCount = 0;

    // Add system prompt and memories (keep these)
    for (let i = 0; i < recentConversationIdx; i++) {
      result.push(lines[i]);
      currentTokensCount += this._estimateTokens(lines[i] + '\n');
    }

    result.push(lines[recentConversationIdx]); // ## Recent Conversation header
    currentTokensCount += this._estimateTokens(lines[recentConversationIdx] + '\n');

    // Add recent conversation lines from the end until we hit the limit
    const conversationLines: string[] = [];
    for (let i = currentMessageIdx - 1; i > recentConversationIdx; i--) {
      const lineTokens = this._estimateTokens(lines[i] + '\n');
      const currentMessageTokens = this._estimateTokens(
        lines.slice(currentMessageIdx).join('\n')
      );

      if (currentTokensCount + lineTokens + currentMessageTokens > maxTokens) {
        break;
      }
      conversationLines.unshift(lines[i]);
      currentTokensCount += lineTokens;
    }

    result.push(...conversationLines);

    // Add current message (always keep)
    result.push(...lines.slice(currentMessageIdx));

    return result.join('\n');
  }
}
