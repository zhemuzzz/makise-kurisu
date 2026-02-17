/**
 * SessionMemory - 瞬时记忆
 * 会话内的消息存储，进程内存级别
 *
 * 特点：
 * - 不可变数据结构（每次更新返回新实例）
 * - 消息数量限制（默认保留最近 100 条）
 * - 支持按时间范围查询
 */

import {
  Message,
  MessageInput,
  SessionConfig,
  SessionState,
  DEFAULT_SESSION_CONFIG,
  MessageRole,
} from "./types";
import { InvalidSessionIdError, InvalidMessageError } from "./errors";

/**
 * SessionMemory 类
 * 管理单个会话的消息存储
 */
export class SessionMemory {
  private readonly _sessionId: string;
  private readonly _messages: readonly Message[];
  private readonly _config: SessionConfig;
  private readonly _createdAt: number;
  private readonly _updatedAt: number;

  constructor(sessionId: string, config?: Partial<SessionConfig>) {
    // Validate session ID
    if (
      !sessionId ||
      typeof sessionId !== "string" ||
      sessionId.trim() === ""
    ) {
      throw new InvalidSessionIdError(sessionId);
    }

    this._sessionId = sessionId;
    this._messages = Object.freeze([]);
    this._config = { ...DEFAULT_SESSION_CONFIG, ...config };
    this._createdAt = Date.now();
    this._updatedAt = Date.now();
  }

  /**
   * 添加消息到会话
   * 返回新的 SessionMemory 实例（不可变）
   */
  addMessage(input: MessageInput): SessionMemory {
    // Validate message
    if (!input || typeof input !== "object") {
      throw new InvalidMessageError("message must be an object", input);
    }

    if (!input.content || typeof input.content !== "string") {
      throw new InvalidMessageError(
        "content must be a non-empty string",
        input,
      );
    }

    const validRoles: MessageRole[] = ["user", "assistant", "system"];
    if (!input.role || !validRoles.includes(input.role)) {
      throw new InvalidMessageError(
        `role must be one of: ${validRoles.join(", ")}`,
        input,
      );
    }

    const newMessage: Message = {
      role: input.role,
      content: input.content,
      timestamp: input.timestamp ?? Date.now(),
    };

    // Add message and enforce limit
    const newMessages = [...this._messages, newMessage];

    // Trim if exceeds max messages
    const trimmedMessages =
      newMessages.length > this._config.maxMessages
        ? newMessages.slice(-this._config.maxMessages)
        : newMessages;

    return this._cloneWithMessages(trimmedMessages);
  }

  /**
   * 批量添加消息
   */
  addMessages(messages: MessageInput[]): SessionMemory {
    let result = this as SessionMemory;
    for (const msg of messages) {
      result = result.addMessage(msg);
    }
    return result;
  }

  /**
   * 获取所有消息（返回副本以保持不可变性）
   */
  getMessages(): readonly Message[] {
    // Return a copy to maintain immutability expectations in tests
    return [...this._messages];
  }

  /**
   * 获取最近 N 条消息
   */
  getRecentMessages(count: number): readonly Message[] {
    if (count <= 0) return [];
    return this._messages.slice(-count);
  }

  /**
   * 按角色获取消息
   */
  getMessagesByRole(role: MessageRole): readonly Message[] {
    return this._messages.filter((msg) => msg.role === role);
  }

  /**
   * 按时间范围获取消息
   */
  getMessagesByTimeRange(
    startTime: number,
    endTime: number,
  ): readonly Message[] {
    if (startTime > endTime) {
      return [];
    }
    return this._messages.filter(
      (msg) => msg.timestamp >= startTime && msg.timestamp <= endTime,
    );
  }

  /**
   * 清空会话消息
   * 返回新的空 SessionMemory 实例
   */
  clear(): SessionMemory {
    return this._cloneWithMessages([]);
  }

  /**
   * 获取消息数量
   */
  getMessageCount(): number {
    return this._messages.length;
  }

  /**
   * 检查会话是否为空
   */
  isEmpty(): boolean {
    return this._messages.length === 0;
  }

  /**
   * 获取会话状态
   */
  getState(): SessionState {
    return {
      sessionId: this._sessionId,
      messages: this._messages,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      messageCount: this._messages.length,
    };
  }

  /**
   * 检查会话是否过期
   */
  isExpired(): boolean {
    const now = Date.now();
    return now - this._updatedAt > this._config.ttl;
  }

  // ============================================
  // Getters
  // ============================================

  get sessionId(): string {
    return this._sessionId;
  }

  get config(): SessionConfig {
    return { ...this._config };
  }

  get createdAt(): number {
    return this._createdAt;
  }

  get updatedAt(): number {
    return this._updatedAt;
  }

  get lastMessage(): Message | undefined {
    return this._messages[this._messages.length - 1];
  }

  get firstMessage(): Message | undefined {
    return this._messages[0];
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * 创建带有新消息的实例副本
   */
  private _cloneWithMessages(messages: Message[]): SessionMemory {
    const clone = Object.create(Object.getPrototypeOf(this));
    clone._sessionId = this._sessionId;
    clone._messages = Object.freeze([...messages]);
    clone._config = this._config;
    clone._createdAt = this._createdAt;
    clone._updatedAt = Date.now();
    return clone;
  }
}
