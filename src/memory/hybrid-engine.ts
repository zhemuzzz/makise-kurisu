/**
 * HybridMemoryEngine - 混合记忆引擎
 * 四层记忆架构的统一入口
 *
 * 层级：
 * - L1 瞬时记忆 (SessionMemory): 当前会话，进程内存
 * - L2 短期记忆 (ShortTermMemory): Mem0，语义检索
 * - L3 长期记忆: 知识图谱 (MVP 后续)
 * - L4 技能记忆: 技能库 (MVP 后续)
 */

import {
  BuildContext,
  ContextBuildOptions,
  HybridMemoryEngineConfig,
  Memory,
  MemoryMetadata,
  MemorySearchResult,
  PersonaEngineLike,
  SessionConfig,
  SessionState,
  MessageRole,
  Mem0Client,
} from "./types";
import { SessionMemory } from "./session-memory";
import { ShortTermMemory } from "./short-term-memory";
import { ContextBuilder } from "./context-builder";
import {
  InvalidSessionIdError,
  SessionNotFoundError,
  ValidationError,
} from "./errors";

/**
 * HybridMemoryEngine 类
 * 提供统一的记忆管理接口
 */
export class HybridMemoryEngine {
  private readonly _sessions: Map<string, SessionMemory>;
  private readonly _shortTermMemories: Map<string, ShortTermMemory>;
  private readonly _sessionConfig: SessionConfig;
  private readonly _contextConfig: ContextBuildOptions;
  // Used by static factory methods via type assertion
  // @ts-expect-error - _personaEngine is used by static factory methods
  private readonly _personaEngine: PersonaEngineLike | null;
  private readonly _contextBuilder: ContextBuilder;
  private readonly _mem0Client: Mem0Client | null;

  constructor(config?: HybridMemoryEngineConfig) {
    this._sessions = new Map();
    this._shortTermMemories = new Map();
    this._sessionConfig = {
      maxMessages: config?.sessionConfig?.maxMessages ?? 100,
      ttl: config?.sessionConfig?.ttl ?? 3600000,
    };
    this._contextConfig = {
      maxTokens: config?.contextConfig?.maxTokens ?? 4096,
      maxMessages: config?.contextConfig?.maxMessages ?? 20,
      includePersonaPrompt: config?.contextConfig?.includePersonaPrompt ?? true,
      includeMemories: config?.contextConfig?.includeMemories ?? true,
    };
    this._personaEngine = null;
    this._contextBuilder = new ContextBuilder(undefined, this._contextConfig);
    this._mem0Client = null;
  }

  /**
   * 创建带 PersonaEngine 的实例
   */
  static withPersona(
    personaEngine: PersonaEngineLike,
    config?: HybridMemoryEngineConfig,
  ): HybridMemoryEngine {
    const engine = new HybridMemoryEngine(config);
    (
      engine as unknown as { _personaEngine: PersonaEngineLike | null }
    )._personaEngine = personaEngine;
    (engine as unknown as { _contextBuilder: ContextBuilder })._contextBuilder =
      new ContextBuilder(personaEngine, engine._contextConfig);
    return engine;
  }

  /**
   * 创建带 Mem0 客户端的实例
   */
  static withMem0(
    mem0Client: Mem0Client,
    config?: HybridMemoryEngineConfig,
  ): HybridMemoryEngine {
    const engine = new HybridMemoryEngine(config);
    (engine as unknown as { _mem0Client: Mem0Client | null })._mem0Client =
      mem0Client;
    return engine;
  }

  /**
   * 创建完整的实例（带 Persona 和 Mem0）
   */
  static create(
    personaEngine: PersonaEngineLike,
    mem0Client: Mem0Client,
    config?: HybridMemoryEngineConfig,
  ): HybridMemoryEngine {
    const engine = new HybridMemoryEngine(config);
    (
      engine as unknown as { _personaEngine: PersonaEngineLike | null }
    )._personaEngine = personaEngine;
    (engine as unknown as { _mem0Client: Mem0Client | null })._mem0Client =
      mem0Client;
    (engine as unknown as { _contextBuilder: ContextBuilder })._contextBuilder =
      new ContextBuilder(personaEngine, engine._contextConfig);
    return engine;
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * 创建新会话（测试兼容别名）
   */
  createSession(sessionId?: string): string {
    const id = sessionId ?? this._generateSessionId();
    this._validateSessionId(id);

    if (this._sessions.has(id)) {
      throw new ValidationError("sessionId", `Session already exists: ${id}`);
    }

    const session = new SessionMemory(id, this._sessionConfig);
    this._sessions.set(id, session);
    return id;
  }

  /**
   * 获取或创建会话
   */
  getSession(sessionId: string): SessionMemory | undefined {
    this._validateSessionId(sessionId);

    const session = this._sessions.get(sessionId);
    if (!session) {
      return undefined;
    }
    return session;
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionId: string): boolean {
    return this._sessions.has(sessionId);
  }

  /**
   * 删除会话
   */
  deleteSession(sessionId: string): boolean {
    this._validateSessionId(sessionId);
    this._shortTermMemories.delete(sessionId);
    return this._sessions.delete(sessionId);
  }

  /**
   * 获取所有会话 ID
   */
  getAllSessionIds(): string[] {
    return Array.from(this._sessions.keys());
  }

  /**
   * 列出所有会话（测试兼容别名）
   */
  listSessions(): string[] {
    return this.getAllSessionIds();
  }

  /**
   * 清理过期会话
   */
  cleanupExpiredSessions(): number {
    let cleaned = 0;
    for (const [sessionId, session] of this._sessions) {
      if (session.isExpired()) {
        this._sessions.delete(sessionId);
        this._shortTermMemories.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * 销毁引擎（清理所有资源）
   */
  destroy(): void {
    this._sessions.clear();
    this._shortTermMemories.clear();
  }

  // ============================================
  // Message Operations
  // ============================================

  /**
   * 添加会话消息（测试兼容别名）
   */
  addMessage(
    sessionId: string,
    message: { role: MessageRole; content: string },
  ): SessionMemory {
    return this.addSessionMessage(sessionId, message.content, message.role);
  }

  /**
   * 添加会话消息
   */
  addSessionMessage(
    sessionId: string,
    content: string,
    role: MessageRole,
  ): SessionMemory {
    this._validateSessionId(sessionId);

    if (!content || typeof content !== "string") {
      throw new ValidationError(
        "content",
        "Content must be a non-empty string",
      );
    }

    const session = this._getSessionOrThrow(sessionId);
    const updatedSession = session.addMessage({ role, content });
    this._sessions.set(sessionId, updatedSession);

    return updatedSession;
  }

  /**
   * 获取会话消息
   */
  getSessionMessages(
    sessionId: string,
  ): ReturnType<SessionMemory["getMessages"]> {
    const session = this._getSessionOrThrow(sessionId);
    return session.getMessages();
  }

  /**
   * 获取消息（测试兼容别名）
   */
  getMessages(sessionId: string): ReturnType<SessionMemory["getMessages"]> {
    return this.getSessionMessages(sessionId);
  }

  /**
   * 获取最近消息
   */
  getRecentMessages(
    sessionId: string,
    count: number = 20,
  ): ReturnType<SessionMemory["getRecentMessages"]> {
    const session = this._getSessionOrThrow(sessionId);
    return session.getRecentMessages(count);
  }

  /**
   * 清空会话消息
   */
  clearSession(sessionId: string): SessionMemory {
    this._validateSessionId(sessionId);
    const session = this._getSessionOrThrow(sessionId);
    const clearedSession = session.clear();
    this._sessions.set(sessionId, clearedSession);
    return clearedSession;
  }

  // ============================================
  // Short-term Memory Operations (Mem0)
  // ============================================

  /**
   * 添加短期记忆
   */
  async addMemory(
    sessionId: string,
    content: string,
    metadata?: Partial<MemoryMetadata>,
  ): Promise<string> {
    this._validateSessionId(sessionId);

    if (!this._mem0Client) {
      throw new ValidationError("mem0Client", "Mem0 client not configured");
    }

    const shortTermMemory = this._getOrCreateShortTermMemory(sessionId);
    return shortTermMemory.addMemory(content, {
      ...metadata,
      sessionId,
    });
  }

  /**
   * 搜索记忆
   */
  async searchMemory(
    sessionId: string,
    query: string,
    limit: number = 10,
  ): Promise<MemorySearchResult[]> {
    this._validateSessionId(sessionId);

    if (!this._mem0Client) {
      return [];
    }

    const shortTermMemory = this._getOrCreateShortTermMemory(sessionId);
    return shortTermMemory.searchMemory(query, limit);
  }

  /**
   * 获取所有记忆
   */
  async getAllMemories(sessionId: string): Promise<Memory[]> {
    this._validateSessionId(sessionId);

    if (!this._mem0Client) {
      return [];
    }

    const shortTermMemory = this._getOrCreateShortTermMemory(sessionId);
    return shortTermMemory.getAllMemories();
  }

  /**
   * 删除记忆
   */
  async deleteMemory(sessionId: string, memoryId: string): Promise<void> {
    this._validateSessionId(sessionId);

    if (!this._mem0Client) {
      return;
    }

    const shortTermMemory = this._getOrCreateShortTermMemory(sessionId);
    return shortTermMemory.deleteMemory(memoryId);
  }

  // ============================================
  // Context Building
  // ============================================

  /**
   * 构建对话上下文
   */
  async buildContext(
    sessionId: string,
    currentMessage: string,
    options?: Partial<ContextBuildOptions>,
  ): Promise<string> {
    this._validateSessionId(sessionId);

    const session = this._getSessionOrThrow(sessionId);
    const shortTermMemory = this._mem0Client
      ? this._getOrCreateShortTermMemory(sessionId)
      : null;

    const result = await this._contextBuilder.build(
      session,
      shortTermMemory,
      currentMessage,
      options,
    );

    return result.fullContext;
  }

  /**
   * 构建简化的上下文（同步）
   */
  buildContextSync(
    sessionId: string,
    currentMessage: string,
    options?: Partial<ContextBuildOptions>,
  ): BuildContext {
    this._validateSessionId(sessionId);

    const session = this._getSessionOrThrow(sessionId);
    return this._contextBuilder.buildSync(session, currentMessage, options);
  }

  // ============================================
  // State & Stats
  // ============================================

  /**
   * 获取引擎状态
   */
  getStats(): {
    sessionCount: number;
    shortTermMemoryCount: number;
    totalMessages: number;
  } {
    let totalMessages = 0;
    for (const session of this._sessions.values()) {
      totalMessages += session.getMessageCount();
    }

    return {
      sessionCount: this._sessions.size,
      shortTermMemoryCount: this._shortTermMemories.size,
      totalMessages,
    };
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId: string): SessionState {
    const session = this._getSessionOrThrow(sessionId);
    return session.getState();
  }

  // ============================================
  // Private Methods
  // ============================================

  private _validateSessionId(sessionId: string): void {
    if (
      !sessionId ||
      typeof sessionId !== "string" ||
      sessionId.trim() === ""
    ) {
      throw new InvalidSessionIdError(sessionId);
    }
  }

  private _getSessionOrThrow(sessionId: string): SessionMemory {
    const session = this._sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  private _getOrCreateShortTermMemory(sessionId: string): ShortTermMemory {
    let stm = this._shortTermMemories.get(sessionId);
    if (!stm && this._mem0Client) {
      stm = new ShortTermMemory({
        mem0Client: this._mem0Client,
        sessionId,
      });
      this._shortTermMemories.set(sessionId, stm);
    }
    return stm!;
  }

  private _generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
