/**
 * Gateway Session Manager
 * 会话生命周期管理
 *
 * KURISU-041: 不再依赖 IOrchestrator，Gateway 自己管理 session
 */

import type {
  SessionInfo,
  ChannelType,
} from "./types.js";
import { SessionManager } from "./session-manager.js";
import { GatewayError } from "./errors.js";

/**
 * 会话管理器配置
 */
export interface SessionManagerConfig {
  sessionTTL: number;
  maxSessions: number;
  cleanupInterval: number;
}

/**
 * 会话管理器
 * 负责会话的创建、获取、删除和清理
 */
export class GatewaySessionManager {
  private sessionManager?: SessionManager;

  constructor(
    private readonly config: SessionManagerConfig,
  ) {}

  /**
   * 初始化会话管理器
   */
  initialize(): void {
    if (this.sessionManager) {
      return;
    }

    this.sessionManager = new SessionManager({
      ttl: this.config.sessionTTL,
      cleanupInterval: this.config.cleanupInterval,
    });
  }

  /**
   * 停止会话管理器
   */
  shutdown(): void {
    if (!this.sessionManager) {
      return;
    }

    this.sessionManager.stopCleanup();
    this.sessionManager.clear();
    // 不能直接赋值 undefined，需要通过条件分支
  }

  /**
   * 获取内部 SessionManager 实例
   */
  getManager(): SessionManager {
    this.ensureInitialized();
    return this.sessionManager!;
  }

  /**
   * 创建会话
   */
  async createSession(
    sessionId: string,
    userId: string,
    channelType: ChannelType,
    metadata?: Record<string, unknown>,
  ): Promise<SessionInfo> {
    this.ensureInitialized();

    // 检查最大会话数
    if (this.sessionManager!.count() >= this.config.maxSessions) {
      throw new GatewayError(
        "Maximum number of sessions reached",
        "MAX_SESSIONS_REACHED",
      );
    }

    const session = this.sessionManager!.create({
      sessionId,
      userId,
      channelType,
      ...(metadata ? { metadata } : {}),
    });

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SessionInfo | null {
    this.ensureInitialized();
    return this.sessionManager!.get(sessionId);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureInitialized();
    return this.sessionManager!.delete(sessionId);
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.sessionManager?.count() ?? 0;
  }

  /**
   * 获取用户的所有会话
   */
  getSessionsByUserId(userId: string): SessionInfo[] {
    this.ensureInitialized();
    return this.sessionManager!.findByUserId(userId);
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    this.ensureInitialized();
    this.sessionManager!.clear();
  }

  /**
   * 手动触发过期会话清理
   */
  cleanupExpiredSessions(): void {
    this.ensureInitialized();
    this.sessionManager!.cleanup();
  }

  /**
   * 确保 session manager 已初始化
   */
  private ensureInitialized(): void {
    if (!this.sessionManager) {
      throw new GatewayError("Session manager not initialized");
    }
  }
}
