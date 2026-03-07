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
  type AgentHandle,
  type ApprovalManagerLike,
  type ToolCall,
  type SessionWorkDirManagerLike,
  type SessionPermissionManagerLike,
  type FilePermissionLevel,
  type TracingServiceLike,
  ChannelType,
} from "./types.js";
import type { MCPWorkDirSync } from "../tools/mcp-workdir-sync.js";
import {
  SessionSettingRegistry,
  createSessionSettingRegistry,
} from "./session-setting-registry.js";
import { createChangeDirHandler } from "./handlers/change-dir-handler.js";
import { createChangePermissionHandler } from "./handlers/change-permission-handler.js";
import { createDeleteConfirmHandler } from "./handlers/delete-confirm-handler.js";
import { StreamHandler } from "./stream-handler.js";
import { GatewayError, InputValidationError } from "./errors.js";
import { GatewayOrchestrator } from "./gateway-orchestrator.js";
import { GatewaySessionManager } from "./gateway-session.js";

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
  private readonly agentHandle: AgentHandle;
  private readonly approvalManager: ApprovalManagerLike | undefined;
  private readonly sessionWorkDirManager: SessionWorkDirManagerLike | undefined;
  private readonly sessionPermissionManager:
    | SessionPermissionManagerLike
    | undefined;
  private readonly mcpWorkDirSync: MCPWorkDirSync | undefined;
  private readonly mcpBridge:
    | { disconnectAll(timeout?: number): Promise<void> }
    | undefined;
  private readonly tracing: TracingServiceLike | undefined;
  private readonly config: Required<GatewayConfig>;
  private readonly streamHandler: StreamHandler;
  private readonly gatewayOrchestrator: GatewayOrchestrator;
  private readonly gatewaySessionManager: GatewaySessionManager;

  // KURISU-024: 会话设置注册表（替代 3 个 recognizer + 3 个 pending Map）
  private readonly settingRegistry: SessionSettingRegistry;

  private running = false;

  constructor(deps: GatewayDeps, config: GatewayConfig = {}) {
    if (!deps.agentHandle) {
      throw new GatewayError("AgentHandle is required");
    }

    this.agentHandle = deps.agentHandle;
    this.approvalManager = deps.approvalManager;
    this.sessionWorkDirManager = deps.sessionWorkDirManager;
    this.sessionPermissionManager = deps.sessionPermissionManager;
    this.mcpWorkDirSync = deps.mcpWorkDirSync;
    this.mcpBridge = deps.mcpBridge;
    this.tracing = deps.tracing;
    this.config = {
      sessionTTL: config.sessionTTL ?? DEFAULT_SESSION_TTL,
      maxSessions: config.maxSessions ?? DEFAULT_MAX_SESSIONS,
      cleanupInterval: config.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
      filePermission: config.filePermission ?? "sandbox",
      allowedPaths: config.allowedPaths ?? [],
    };
    this.streamHandler = new StreamHandler();

    // KURISU-024: 初始化 SessionSettingRegistry 并注册 Handler
    // 注册顺序决定优先级：change_permission > delete_confirm > change_dir
    this.settingRegistry = createSessionSettingRegistry();

    if (this.sessionPermissionManager) {
      this.settingRegistry.register(
        createChangePermissionHandler(
          this.sessionPermissionManager,
          this.config.filePermission as FilePermissionLevel,
        ),
      );
      this.settingRegistry.register(
        createDeleteConfirmHandler(this.sessionPermissionManager),
      );
    }

    if (this.sessionWorkDirManager) {
      this.settingRegistry.register(
        createChangeDirHandler(
          this.sessionWorkDirManager,
          this.config.filePermission as FilePermissionLevel,
          this.config.allowedPaths,
          this.mcpWorkDirSync,
        ),
      );
    }

    // 初始化子模块
    this.gatewayOrchestrator = new GatewayOrchestrator(
      this.agentHandle,
      this.streamHandler,
      this.settingRegistry,
      this.tracing,
    );

    this.gatewaySessionManager = new GatewaySessionManager(
      {
        sessionTTL: this.config.sessionTTL,
        maxSessions: this.config.maxSessions,
        cleanupInterval: this.config.cleanupInterval,
      },
    );
  }

  /**
   * 启动网关
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.gatewaySessionManager.initialize();
    this.running = true;
  }

  /**
   * 停止网关
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.gatewaySessionManager.shutdown();

    // KURISU-029: 优雅退出 — 清理 MCP 连接
    if (this.mcpBridge) {
      await this.mcpBridge.disconnectAll();
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
    return this.gatewaySessionManager.createSession(
      sessionId,
      userId,
      channelType,
      metadata,
    );
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SessionInfo | null {
    return this.gatewaySessionManager.getSession(sessionId);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    return this.gatewaySessionManager.deleteSession(sessionId);
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.gatewaySessionManager.getSessionCount();
  }

  /**
   * 获取用户的所有会话
   */
  getSessionsByUserId(userId: string): SessionInfo[] {
    return this.gatewaySessionManager.getSessionsByUserId(userId);
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    return this.gatewaySessionManager.clearAllSessions();
  }

  /**
   * 手动触发过期会话清理
   */
  cleanupExpiredSessions(): void {
    this.gatewaySessionManager.cleanupExpiredSessions();
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

    // 验证输入（fail fast）
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      throw new InputValidationError("Invalid input: cannot be empty");
    }

    const sessionManager = this.gatewaySessionManager.getManager();

    // 确保会话存在（如果不存在则创建）
    if (!sessionManager.has(sessionId)) {
      if (!userId) {
        throw new GatewayError("userId is required for new session");
      }
      await this.createSession(sessionId, userId, ChannelType.CLI);
    }

    return this.gatewayOrchestrator.processStream(
      sessionManager,
      sessionId,
      input,
      userId,
      callbacks,
    );
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

  // ===========================================
  // 审批管理集成
  // ===========================================

  /**
   * 检查会话是否有待审批的工具调用
   */
  hasPendingApproval(sessionId: string): boolean {
    if (!this.approvalManager) {
      return false;
    }
    return this.approvalManager.hasPendingApproval(sessionId);
  }

  /**
   * 获取会话的待审批状态
   */
  getPendingApproval(
    sessionId: string,
  ): { toolCall: ToolCall; message: string } | null {
    if (!this.approvalManager) {
      return null;
    }
    const approval = this.approvalManager.getApproval(sessionId);
    if (!approval || approval.status !== "pending") {
      return null;
    }
    return {
      toolCall: approval.toolCall,
      message: approval.message,
    };
  }

  /**
   * 检查用户消息是否是审批回复
   * @returns 如果是审批回复，返回处理结果；否则返回 null
   */
  async checkApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<{
    isApprovalReply: boolean;
    result?: "approved" | "rejected" | "timeout";
    toolCall?: ToolCall;
  }> {
    // 没有 approvalManager，不是审批回复
    if (!this.approvalManager) {
      return { isApprovalReply: false };
    }

    // 检查是否有待审批
    if (!this.approvalManager.hasPendingApproval(sessionId)) {
      return { isApprovalReply: false };
    }

    // 获取审批状态
    const approval = this.approvalManager.getApproval(sessionId);
    if (!approval) {
      return { isApprovalReply: false };
    }

    // 处理回复
    const replyResult = this.approvalManager.handleReply(
      sessionId,
      userMessage.trim(),
    );

    // 如果是 invalid 回复，说明用户输入的不是审批指令
    if (replyResult === "invalid") {
      return { isApprovalReply: false };
    }

    // approved, rejected, timeout 都是有效的审批回复
    return {
      isApprovalReply: true,
      result: replyResult,
      toolCall: approval.toolCall,
    };
  }

  /**
   * 执行已批准的工具
   */
  async executeApprovedTool(
    sessionId: string,
    toolCall: ToolCall,
  ): Promise<string> {
    return this.gatewayOrchestrator.executeApprovedTool(sessionId, toolCall);
  }

  // ===========================================
  // KURISU-020: 切换工作目录
  // ===========================================

  /**
   * 检查是否有待审批的目录切换
   * 委托给 ChangeDirHandler (KURISU-024)
   */
  hasPendingChangeDirApproval(sessionId: string): boolean {
    const handler = this.settingRegistry.get("change_dir");
    return handler?.hasPending(sessionId) ?? false;
  }

  /**
   * 处理目录切换审批回复
   * 委托给 ChangeDirHandler (KURISU-024)
   * @returns 如果是审批回复返回处理结果，否则返回 null
   */
  async handleChangeDirApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<{
    isApprovalReply: boolean;
    approved?: boolean;
    message?: string;
  }> {
    const handler = this.settingRegistry.get("change_dir");
    if (!handler) {
      return { isApprovalReply: false };
    }
    return handler.handleApprovalReply(sessionId, userMessage);
  }

  /**
   * 获取会话的工作目录
   */
  getWorkingDir(sessionId: string): string {
    if (!this.sessionWorkDirManager) {
      return process.cwd();
    }
    return this.sessionWorkDirManager.getWorkingDir(sessionId);
  }

  // ===========================================
  // KURISU-021: 权限切换
  // ===========================================

  /**
   * 检查是否有待审批的权限切换
   * 委托给 ChangePermissionHandler (KURISU-024)
   */
  hasPendingPermissionApproval(sessionId: string): boolean {
    const handler = this.settingRegistry.get("change_permission");
    return handler?.hasPending(sessionId) ?? false;
  }

  /**
   * 处理权限切换审批回复
   * 委托给 ChangePermissionHandler (KURISU-024)
   */
  async handleChangePermissionApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<{
    isApprovalReply: boolean;
    approved?: boolean;
    message?: string;
  }> {
    const handler = this.settingRegistry.get("change_permission");
    if (!handler) {
      return { isApprovalReply: false };
    }
    return handler.handleApprovalReply(sessionId, userMessage);
  }

  /**
   * 获取会话的当前权限级别
   */
  getSessionPermission(sessionId: string): FilePermissionLevel {
    if (!this.sessionPermissionManager) {
      return this.config.filePermission as FilePermissionLevel;
    }
    return this.sessionPermissionManager.getPermission(
      sessionId,
      this.config.filePermission as FilePermissionLevel,
    );
  }

  // ============================================
  // KURISU-023 方案B: 删除确认开关
  // ============================================

  /**
   * 检查是否有待审批的删除确认关闭请求
   * 委托给 DeleteConfirmHandler (KURISU-024)
   */
  hasPendingDeleteConfirmApproval(sessionId: string): boolean {
    const handler = this.settingRegistry.get("delete_confirm");
    return handler?.hasPending(sessionId) ?? false;
  }

  /**
   * 处理删除确认关闭审批回复
   * 委托给 DeleteConfirmHandler (KURISU-024)
   */
  async handleChangeDeleteConfirmApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<{
    isApprovalReply: boolean;
    approved?: boolean;
    message?: string;
  }> {
    const handler = this.settingRegistry.get("delete_confirm");
    if (!handler) {
      return { isApprovalReply: false };
    }
    return handler.handleApprovalReply(sessionId, userMessage);
  }

  /**
   * 检查会话是否跳过删除确认
   */
  shouldSkipDeleteConfirmation(sessionId: string): boolean {
    if (!this.sessionPermissionManager) {
      return false;
    }
    return this.sessionPermissionManager.shouldSkipDeleteConfirmation(
      sessionId,
    );
  }

  /**
   * 确保网关已启动
   */
  private ensureRunning(): void {
    if (!this.running) {
      throw new GatewayError("Gateway is not started");
    }
  }
}

// Re-export types
export * from "./types.js";
export * from "./errors.js";
export { SessionManager } from "./session-manager.js";
export { StreamHandler } from "./stream-handler.js";
export { CLIChannel } from "./channels/cli.js";
export { MockChannel } from "./channels/mock.js";
export { TelegramChannel } from "./channels/telegram.js";
export { QQChannel } from "./channels/qq.js";
export { BaseChannel, ChannelRoute } from "./channels/base.js";
export { KurisuServer } from "./server.js";
export { GatewayOrchestrator } from "./gateway-orchestrator.js";
export { GatewaySessionManager } from "./gateway-session.js";
