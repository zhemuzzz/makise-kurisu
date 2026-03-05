/**
 * L1 交互网关 - 类型定义
 */

// ===========================================
// 渠道类型
// ===========================================

/**
 * 支持的渠道类型
 * @description KURISU-013 扩展多平台支持
 */
export enum ChannelType {
  CLI = 0,
  REST = 1,
  DISCORD = 2,
  WEBSOCKET = 3,
  WECHAT = 4, // 微信公众号
  WECOM = 5, // 企业微信
  QQ = 6, // QQ Bot
  TELEGRAM = 7, // Telegram
  FEISHU = 8, // 飞书
  DINGTALK = 9, // 钉钉
}

/**
 * 渠道类型名称映射
 */
export const CHANNEL_TYPE_NAMES: Record<ChannelType, string> = {
  [ChannelType.CLI]: "cli",
  [ChannelType.REST]: "rest",
  [ChannelType.DISCORD]: "discord",
  [ChannelType.WEBSOCKET]: "websocket",
  [ChannelType.WECHAT]: "wechat",
  [ChannelType.WECOM]: "wecom",
  [ChannelType.QQ]: "qq",
  [ChannelType.TELEGRAM]: "telegram",
  [ChannelType.FEISHU]: "feishu",
  [ChannelType.DINGTALK]: "dingtalk",
};

// ===========================================
// 流事件类型
// ===========================================

/**
 * 流事件类型枚举
 */
export enum StreamEventType {
  TEXT_DELTA = 0,
  TEXT_COMPLETE = 1,
  ERROR = 2,
  METADATA = 3,
}

/**
 * 流事件类型名称映射
 */
export const STREAM_EVENT_TYPE_NAMES: Record<StreamEventType, string> = {
  [StreamEventType.TEXT_DELTA]: "text_delta",
  [StreamEventType.TEXT_COMPLETE]: "text_complete",
  [StreamEventType.ERROR]: "error",
  [StreamEventType.METADATA]: "metadata",
};

// ===========================================
// 会话信息
// ===========================================

/**
 * 会话信息
 */
export interface SessionInfo {
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 渠道类型 */
  channelType: ChannelType;
  /** 创建时间 */
  createdAt: Date;
  /** 最后活跃时间 */
  lastActiveAt: Date;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 创建会话信息参数
 */
export interface CreateSessionParams {
  sessionId: string;
  userId: string;
  channelType: ChannelType;
  metadata?: Record<string, unknown>;
}

/**
 * 创建会话信息工厂函数
 */
export function createSessionInfo(params: CreateSessionParams): SessionInfo {
  const now = new Date();
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    channelType: params.channelType,
    createdAt: now,
    lastActiveAt: now,
    metadata: params.metadata ? { ...params.metadata } : {},
  };
}

// ===========================================
// 流事件类型
// ===========================================

/**
 * 文本增量事件
 */
export interface TextDeltaEvent {
  type: StreamEventType.TEXT_DELTA;
  text: string;
  isFinal: boolean;
  timestamp: Date;
}

/**
 * 文本完成事件
 */
export interface TextCompleteEvent {
  type: StreamEventType.TEXT_COMPLETE;
  text: string;
  timestamp: Date;
}

/**
 * 错误事件
 */
export interface ErrorEvent {
  type: StreamEventType.ERROR;
  message: string;
  code?: string;
  timestamp: Date;
}

/**
 * 元数据事件
 */
export interface MetadataEvent {
  type: StreamEventType.METADATA;
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * 任意流事件类型
 */
export type AnyStreamEvent =
  | TextDeltaEvent
  | TextCompleteEvent
  | ErrorEvent
  | MetadataEvent;

// ===========================================
// 类型守卫
// ===========================================

/**
 * 检查是否为文本增量事件
 */
export function isTextDeltaEvent(event: unknown): event is TextDeltaEvent {
  return (
    event !== null &&
    typeof event === "object" &&
    (event as TextDeltaEvent).type === StreamEventType.TEXT_DELTA
  );
}

/**
 * 检查是否为文本完成事件
 */
export function isTextCompleteEvent(
  event: unknown,
): event is TextCompleteEvent {
  return (
    event !== null &&
    typeof event === "object" &&
    (event as TextCompleteEvent).type === StreamEventType.TEXT_COMPLETE
  );
}

/**
 * 检查是否为错误事件
 */
export function isErrorEvent(event: unknown): event is ErrorEvent {
  return (
    event !== null &&
    typeof event === "object" &&
    (event as ErrorEvent).type === StreamEventType.ERROR
  );
}

/**
 * 检查是否为元数据事件
 */
export function isMetadataEvent(event: unknown): event is MetadataEvent {
  return (
    event !== null &&
    typeof event === "object" &&
    (event as MetadataEvent).type === StreamEventType.METADATA
  );
}

// ===========================================
// 流回调
// ===========================================

/**
 * 流回调接口
 */
export interface StreamCallbacks {
  /** 每个文本块回调 */
  onChunk?: (chunk: string) => void;
  /** 完成回调 */
  onComplete?: (fullText: string) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
  /** 元数据回调 */
  onMetadata?: (data: Record<string, unknown>) => void;
}

// ===========================================
// Gateway 依赖
// ===========================================

// Import and re-export ToolCall and ApprovalState from tools/types
import type {
  ToolCall as ToolCallType,
  ApprovalState as ApprovalStateType,
} from "../tools/types.js";
import type { MCPWorkDirSync } from "../tools/mcp-workdir-sync.js";

export type ToolCall = ToolCallType;
export type ApprovalState = ApprovalStateType;

/**
 * 审批管理器接口
 */
export interface ApprovalManagerLike {
  /** 检查是否有待审批 */
  hasPendingApproval(sessionId: string): boolean;
  /** 获取审批状态 */
  getApproval(sessionId: string): ApprovalState | undefined;
  /** 处理审批回复 */
  handleReply(
    sessionId: string,
    reply: string,
  ): "approved" | "rejected" | "invalid" | "timeout";
}

/**
 * Orchestrator 接口
 */
export interface IOrchestrator {
  processStream(params: {
    sessionId: string;
    input: string;
    userId?: string;
    channelType?: ChannelType;
  }): Promise<GatewayStreamResult | string>;
  createSession(params: {
    sessionId: string;
    userId: string;
    channelType: ChannelType;
  }): void;
  hasSession(sessionId: string): boolean;
  getSession?(sessionId: string): SessionInfo | null;
  deleteSession?(sessionId: string): void;
  /** 执行已批准的工具（可选） */
  executeTool?(sessionId: string, toolCall: ToolCall): Promise<string>;
}

/**
 * Gateway 依赖接口
 */
export interface GatewayDeps {
  orchestrator: IOrchestrator;
  /** 审批管理器（可选） */
  approvalManager?: ApprovalManagerLike;
  /** 会话工作目录管理器（可选，KURISU-020） */
  sessionWorkDirManager?: SessionWorkDirManagerLike;
  /** 会话权限管理器（可选，KURISU-021） */
  sessionPermissionManager?: SessionPermissionManagerLike;
  /** MCP 工作目录同步器（可选，KURISU-026） */
  mcpWorkDirSync?: MCPWorkDirSync;
  /** MCP 桥接（可选，KURISU-029 优雅退出） */
  mcpBridge?: { disconnectAll(timeout?: number): Promise<void> };
}

/**
 * Gateway 配置接口
 */
export interface GatewayConfig {
  /** 会话 TTL (毫秒) */
  sessionTTL?: number;
  /** 最大会话数 */
  maxSessions?: number;
  /** 清理间隔 (毫秒) */
  cleanupInterval?: number;
  /** 文件权限级别（KURISU-020） */
  filePermission?: FilePermissionLevel;
  /** 允许的路径列表（restricted 模式，KURISU-020） */
  allowedPaths?: readonly string[];
}

// ===========================================
// 流结果
// ===========================================

/**
 * Gateway 流结果
 */
export interface GatewayStreamResult {
  /** 文本流 */
  textStream: AsyncGenerator<string>;
  /** 完整事件流 */
  fullStream: AsyncGenerator<AnyStreamEvent>;
  /** 最终响应 Promise */
  finalResponse: Promise<string>;
  /** 是否需要审批 (confirm 级工具) */
  approvalRequired?: boolean;
  /** 审批消息（需要审批时发送给用户） */
  approvalMessage?: string;
  /** 待审批的工具调用 */
  pendingToolCall?: ToolCall;
}

// ===========================================
// Session Manager 配置
// ===========================================

/**
 * Session Manager 配置
 */
export interface SessionManagerConfig {
  /** 会话 TTL (毫秒) */
  ttl: number;
  /** 清理间隔 (毫秒) */
  cleanupInterval?: number;
}

// ===========================================
// 统一消息格式 (KURISU-013)
// ===========================================

/**
 * 消息类型
 */
export type MessageType = "text" | "image" | "voice" | "file";

/**
 * 统一入站消息格式
 * @description 各平台消息转换为统一格式，便于后续处理
 */
export interface InboundMessage {
  /** 渠道类型 */
  channelType: ChannelType;
  /** 会话 ID，格式: {platform}-{userId} */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 消息内容 */
  content: string;
  /** 消息类型 */
  messageType: MessageType;
  /** 时间戳 (毫秒) */
  timestamp: number;
  /** 平台特定元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 统一出站消息格式
 * @description 统一响应格式，各平台 Channel 负责转换为平台特定格式
 */
export interface OutboundMessage {
  /** 渠道类型 */
  channelType: ChannelType;
  /** 会话 ID */
  sessionId: string;
  /** 响应内容 */
  content: string;
  /** 回复的消息 ID (可选) */
  replyTo?: string;
  /** 平台特定元数据 */
  metadata?: Record<string, unknown>;
}

// ===========================================
// KURISU-020: 切换工作目录
// ===========================================

/**
 * 文件权限级别
 */
export type FilePermissionLevel =
  | "sandbox" // 只能在沙箱目录内
  | "restricted" // 只能在允许列表内
  | "full_access"; // 完全访问（需审批）

/**
 * 切换目录意图识别结果
 */
export interface ChangeDirIntent {
  /** 是否是切换目录意图 */
  readonly isChangeDir: boolean;
  /** 目标目录（识别成功时） */
  readonly targetDir?: string;
  /** 置信度 0-1 */
  readonly confidence: number;
}

/**
 * 切换目录结果
 */
export interface ChangeDirResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 新目录（成功时） */
  readonly newDir?: string;
  /** 失败原因 */
  readonly reason?: string;
  /** 审批请求（需要审批时） */
  readonly approvalRequest?: ChangeDirApprovalRequest;
}

/**
 * 切换目录审批请求
 */
export interface ChangeDirApprovalRequest {
  /** 请求 ID */
  readonly id: string;
  /** 会话 ID */
  readonly sessionId: string;
  /** 目标目录 */
  readonly targetDir: string;
  /** 风险等级 */
  readonly riskLevel: "low" | "medium" | "high";
  /** 审批消息 */
  readonly message: string;
}

/**
 * SessionWorkDirManager 接口
 */
export interface SessionWorkDirManagerLike {
  /** 获取会话的工作目录 */
  getWorkingDir(sessionId: string): string;
  /** 尝试切换工作目录 */
  changeWorkingDir(
    sessionId: string,
    targetPath: string,
    permission: FilePermissionLevel,
    allowedPaths?: readonly string[],
  ): ChangeDirResult;
  /** 应用审批通过后的目录切换 */
  applyApprovedChange(sessionId: string, targetPath: string): void;
  /** 清除会话的工作目录设置 */
  clearWorkingDir(sessionId: string): boolean;
}

// ===========================================
// KURISU-021: 会话权限切换
// ===========================================

/**
 * 权限切换意图
 */
export interface ChangePermissionIntent {
  /** 是否识别到意图 */
  readonly isIntent: boolean;
  /** 操作类型 */
  readonly action: "upgrade" | "downgrade" | "reset" | "set" | null;
  /** 目标权限级别 */
  readonly targetLevel: FilePermissionLevel | null;
  /** 原始用户输入 */
  readonly originalInput: string;
  /** 置信度 (0-1) */
  readonly confidence: number;
}

/**
 * 权限变更结果
 */
export interface PermissionChangeResult {
  /** 是否成功（需要审批时为 false，等待审批） */
  readonly success: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 新权限级别（成功时） */
  readonly newPermission?: FilePermissionLevel;
  /** 失败/拒绝原因 */
  readonly reason?: string;
  /** 审批请求（需要审批时） */
  readonly approvalRequest?: PermissionApprovalRequest;
  /** 是否是升级操作 */
  readonly isUpgrade: boolean;
  /** 是否是降级操作 */
  readonly isDowngrade: boolean;
}

/**
 * 权限变更审批请求
 */
export interface PermissionApprovalRequest {
  /** 请求 ID */
  readonly id: string;
  /** 会话 ID */
  readonly sessionId: string;
  /** 当前权限级别 */
  readonly currentPermission: FilePermissionLevel;
  /** 目标权限级别 */
  readonly targetPermission: FilePermissionLevel;
  /** 风险等级 */
  readonly riskLevel: "low" | "medium" | "high";
  /** 审批消息 */
  readonly message: string;
  /** 警告信息（可选） */
  readonly warning?: string;
}

/**
 * SessionPermissionManager 接口
 */
export interface SessionPermissionManagerLike {
  /** 获取会话的当前权限级别 */
  getPermission(
    sessionId: string,
    defaultPermission: FilePermissionLevel,
  ): FilePermissionLevel;
  /** 检查会话是否有临时权限覆盖 */
  hasTemporaryPermission(sessionId: string): boolean;
  /** 请求权限变更 */
  requestPermissionChange(
    sessionId: string,
    targetLevel: FilePermissionLevel,
    currentDefault: FilePermissionLevel,
  ): PermissionChangeResult;
  /** 应用审批通过后的权限变更 */
  applyApprovedChange(
    sessionId: string,
    targetLevel: FilePermissionLevel,
  ): void;
  /** 重置为角色默认权限 */
  resetToDefault(sessionId: string): boolean;
  /** 判断是否是权限升级 */
  isUpgrade(from: FilePermissionLevel, to: FilePermissionLevel): boolean;
  /** 判断是否是权限降级 */
  isDowngrade(from: FilePermissionLevel, to: FilePermissionLevel): boolean;
  /** 获取权限级别名称 */
  getPermissionDisplayName(level: FilePermissionLevel): string;

  // KURISU-023 方案B: 删除确认开关
  /** 检查是否跳过删除确认 */
  shouldSkipDeleteConfirmation(sessionId: string): boolean;
  /** 请求关闭删除确认 */
  requestDisableDeleteConfirmation(sessionId: string): DeleteConfirmationResult;
  /** 应用关闭删除确认 */
  applyDisableDeleteConfirmation(sessionId: string): void;
  /** 开启删除确认 */
  enableDeleteConfirmation(sessionId: string): DeleteConfirmationResult;
}

/**
 * 删除确认设置结果
 * KURISU-023 方案B
 */
export interface DeleteConfirmationResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 当前状态 */
  readonly skipDeleteConfirmation: boolean;
  /** 消息 */
  readonly message: string;
  /** 警告信息（关闭时） */
  readonly warning?: string;
}
