/**
 * L1 交互网关
 * 多渠道接入，流式处理
 */

import {
  type GatewayDeps,
  type GatewayConfig,
  type SessionInfo,
  type StreamCallbacks,
  type GatewayStreamResult,
  type IOrchestrator,
  ChannelType,
} from "./types";
import { SessionManager } from "./session-manager";
import { StreamHandler } from "./stream-handler";
import {
  GatewayError,
  InputValidationError,
  SessionAlreadyExistsError,
} from "./errors";

/**
 * 默认会话 TTL (30分钟)
 */
const DEFAULT_SESSION_TTL = 30 * 60 * 1000;

/**
 * 默认最大会话数
 */
const DEFAULT_MAX_SESSIONS = 1000;

/**
 * 默认清理间隔 (5分钟)
 */
const DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * Gateway 状态
 */
export interface GatewayStatus {
  isRunning: boolean;
  sessionCount: number;
}

/**
 * 交互网关
 * 负责多渠道接入和会话管理
 */
export class Gateway {
  private readonly orchestrator: IOrchestrator;
  private readonly config: Required<GatewayConfig>;
  private sessionManager?: SessionManager;
  private streamHandler: StreamHandler;
  private running = false;

  constructor(deps: GatewayDeps, config: GatewayConfig = {}) {
    if (!deps.orchestrator) {
      throw new GatewayError("Orchestrator is required");
    }

    this.orchestrator = deps.orchestrator;
    this.config = {
      sessionTTL: config.sessionTTL ?? DEFAULT_SESSION_TTL,
      maxSessions: config.maxSessions ?? DEFAULT_MAX_SESSIONS,
      cleanupInterval: config.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
    };
    this.streamHandler = new StreamHandler();
  }

  /**
   * 启动网关
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.sessionManager = new SessionManager({
      ttl: this.config.sessionTTL,
      cleanupInterval: this.config.cleanupInterval,
    });

    this.running = true;
  }

  /**
   * 停止网关
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    if (this.sessionManager) {
      this.sessionManager.stopCleanup();
      this.sessionManager.clear();
    }

    this.running = false;
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this.running;
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
    this.ensureRunning();
    this.ensureSessionManager();

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
      metadata,
    });

    // 通知 orchestrator
    this.orchestrator.createSession({
      sessionId,
      userId,
      channelType,
    });

    return session;
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SessionInfo | null {
    this.ensureSessionManager();
    return this.sessionManager!.get(sessionId);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    this.ensureSessionManager();

    const deleted = this.sessionManager!.delete(sessionId);

    if (deleted) {
      this.orchestrator.deleteSession?.(sessionId);
    }

    return deleted;
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
    this.ensureSessionManager();
    return this.sessionManager!.findByUserId(userId);
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    this.ensureSessionManager();
    this.sessionManager!.clear();
  }

  /**
   * 手动触发过期会话清理
   */
  cleanupExpiredSessions(): void {
    this.ensureSessionManager();
    this.sessionManager!.cleanup();
  }

  /**
   * 处理流
   */
  async processStream(
    sessionId: string,
    input: string,
    userId?: string,
    callbacks?: StreamCallbacks,
  ): Promise<GatewayStreamResult> {
    this.ensureRunning();

    // 验证输入
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      throw new InputValidationError("Invalid input: cannot be empty");
    }

    this.ensureSessionManager();

    // 确保会话存在
    if (!this.sessionManager!.has(sessionId)) {
      if (!userId) {
        throw new GatewayError("userId is required for new session");
      }

      await this.createSession(sessionId, userId, ChannelType.CLI);
    }

    // 更新活跃时间
    this.sessionManager!.touch(sessionId);

    // 调用 orchestrator
    const result = await this.orchestrator.processStream({
      sessionId,
      input: trimmedInput,
      userId,
      channelType: this.sessionManager!.get(sessionId)?.channelType,
    });

    // 如果返回字符串，包装为流结果
    if (typeof result === "string") {
      const textStream = this.streamHandler.textStreamFromChunks([result]);
      return this.streamHandler.createStreamResult(textStream, callbacks);
    }

    // 使用 createStreamResult 统一处理，确保返回值一致
    // 这样 callbacks 路径和非 callbacks 路径都会返回完整的 GatewayStreamResult
    return this.streamHandler.createStreamResult(result.textStream, callbacks);
  }

  /**
   * 获取网关状态
   */
  getStatus(): GatewayStatus {
    return {
      isRunning: this.running,
      sessionCount: this.getSessionCount(),
    };
  }

  /**
   * 确保网关已启动
   */
  private ensureRunning(): void {
    if (!this.running) {
      throw new GatewayError("Gateway is not started");
    }
  }

  /**
   * 确保 session manager 存在
   */
  private ensureSessionManager(): void {
    if (!this.sessionManager) {
      throw new GatewayError("Session manager not initialized");
    }
  }
}

// Re-export types
export * from "./types";
export * from "./errors";
export { SessionManager } from "./session-manager";
export { StreamHandler } from "./stream-handler";
export { CLIChannel } from "./channels/cli";
