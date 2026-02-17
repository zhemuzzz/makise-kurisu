/**
 * L1 交互网关 - 类型定义
 */

// ===========================================
// 渠道类型
// ===========================================

/**
 * 支持的渠道类型
 */
export enum ChannelType {
  CLI = 0,
  REST = 1,
  DISCORD = 2,
  WEBSOCKET = 3,
}

/**
 * 渠道类型名称映射
 */
export const CHANNEL_TYPE_NAMES: Record<ChannelType, string> = {
  [ChannelType.CLI]: 'cli',
  [ChannelType.REST]: 'rest',
  [ChannelType.DISCORD]: 'discord',
  [ChannelType.WEBSOCKET]: 'websocket',
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
  [StreamEventType.TEXT_DELTA]: 'text_delta',
  [StreamEventType.TEXT_COMPLETE]: 'text_complete',
  [StreamEventType.ERROR]: 'error',
  [StreamEventType.METADATA]: 'metadata',
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
    typeof event === 'object' &&
    (event as TextDeltaEvent).type === StreamEventType.TEXT_DELTA
  );
}

/**
 * 检查是否为文本完成事件
 */
export function isTextCompleteEvent(event: unknown): event is TextCompleteEvent {
  return (
    event !== null &&
    typeof event === 'object' &&
    (event as TextCompleteEvent).type === StreamEventType.TEXT_COMPLETE
  );
}

/**
 * 检查是否为错误事件
 */
export function isErrorEvent(event: unknown): event is ErrorEvent {
  return (
    event !== null &&
    typeof event === 'object' &&
    (event as ErrorEvent).type === StreamEventType.ERROR
  );
}

/**
 * 检查是否为元数据事件
 */
export function isMetadataEvent(event: unknown): event is MetadataEvent {
  return (
    event !== null &&
    typeof event === 'object' &&
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
}

/**
 * Gateway 依赖接口
 */
export interface GatewayDeps {
  orchestrator: IOrchestrator;
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
