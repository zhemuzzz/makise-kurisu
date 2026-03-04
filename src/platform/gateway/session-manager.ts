/**
 * L1 交互网关 - 会话管理器
 * 管理会话的创建、获取、更新、删除和 TTL 清理
 */

import {
  type SessionInfo,
  type CreateSessionParams,
  createSessionInfo,
  type SessionManagerConfig,
} from "./types";
import { SessionAlreadyExistsError, InputValidationError } from "./errors";

/**
 * 默认会话 TTL (30分钟)
 */
const DEFAULT_TTL = 30 * 60 * 1000;

/**
 * 会话 ID 最大长度
 */
const MAX_SESSION_ID_LENGTH = 256;

/**
 * 默认清理间隔 (5分钟)
 */
const DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * 会话管理器
 * 负责会话的 CRUD 操作和 TTL 清理
 */
export class SessionManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private readonly ttl: number;
  private readonly cleanupInterval: number;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(config: SessionManagerConfig) {
    this.ttl = config.ttl ?? DEFAULT_TTL;
    this.cleanupInterval = config.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
    this.startCleanup();
  }

  /**
   * 创建新会话
   */
  create(params: CreateSessionParams): SessionInfo {
    // 验证参数
    if (!params.sessionId || params.sessionId.trim() === "") {
      throw new InputValidationError("Invalid sessionId: cannot be empty");
    }
    if (params.sessionId.length > MAX_SESSION_ID_LENGTH) {
      throw new InputValidationError(
        `Invalid sessionId: exceeds maximum length of ${MAX_SESSION_ID_LENGTH}`,
      );
    }
    if (!params.userId || params.userId.trim() === "") {
      throw new InputValidationError("Invalid userId: cannot be empty");
    }

    // 检查会话是否已存在
    if (this.sessions.has(params.sessionId)) {
      throw new SessionAlreadyExistsError(params.sessionId);
    }

    // 创建会话
    const session = createSessionInfo(params);
    this.sessions.set(params.sessionId, session);

    return { ...session, metadata: { ...session.metadata } };
  }

  /**
   * 获取会话
   */
  get(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    // 返回深拷贝以保证不可变性
    return {
      ...session,
      metadata: { ...session.metadata },
    };
  }

  /**
   * 更新会话的 lastActiveAt 时间戳
   */
  touch(sessionId: string): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const updated: SessionInfo = {
      ...session,
      lastActiveAt: new Date(),
      metadata: { ...session.metadata },
    };

    this.sessions.set(sessionId, updated);
    return { ...updated, metadata: { ...updated.metadata } };
  }

  /**
   * 删除会话
   */
  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * 检查会话是否存在
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 获取会话数量
   */
  count(): number {
    return this.sessions.size;
  }

  /**
   * 根据用户 ID 查找会话
   */
  findByUserId(userId: string): SessionInfo[] {
    const results: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        results.push({
          ...session,
          metadata: { ...session.metadata },
        });
      }
    }
    return results;
  }

  /**
   * 更新会话元数据
   */
  updateMetadata(
    sessionId: string,
    metadata: Record<string, unknown>,
  ): SessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const updated: SessionInfo = {
      ...session,
      metadata: { ...session.metadata, ...metadata },
    };

    this.sessions.set(sessionId, updated);
    return { ...updated, metadata: { ...updated.metadata } };
  }

  /**
   * 手动触发清理过期会话
   */
  cleanup(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, session] of this.sessions) {
      const age = now - session.lastActiveAt.getTime();
      if (age > this.ttl) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.sessions.delete(id);
    }
  }

  /**
   * 启动自动清理
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
  }

  /**
   * 停止清理定时器
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined as
        | ReturnType<typeof setInterval>
        | undefined;
    }
  }

  /**
   * 清除所有会话
   */
  clear(): void {
    this.sessions.clear();
  }
}
