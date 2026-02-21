/**
 * L6 工具执行层 - 类型定义
 *
 * 定义工具、权限、调用、结果等核心类型
 */

// ============================================
// 权限级别
// ============================================

/**
 * 工具权限级别
 *
 * - safe: 安全工具，直接执行（web_search, file_read）
 * - confirm: 需要用户确认后执行（shell, file_write）
 * - deny: 始终拒绝
 */
export type PermissionLevel = "safe" | "confirm" | "deny";

// ============================================
// 工具定义
// ============================================

/**
 * JSON Schema 类型（简化版）
 */
export interface JSONSchema {
  readonly type: string;
  readonly properties?: Record<string, JSONSchema>;
  readonly required?: readonly string[];
  readonly description?: string;
  readonly items?: JSONSchema;
  readonly enum?: readonly string[];
  readonly default?: unknown;
}

/**
 * 工具来源类型
 */
export type ToolSourceType = "mcp" | "native" | "http";

/**
 * 工具来源
 */
export interface ToolSource {
  /** 来源类型 */
  readonly type: ToolSourceType;
  /** MCP Server 名称（type=mcp 时） */
  readonly serverName?: string;
  /** HTTP endpoint（type=http 时） */
  readonly endpoint?: string;
  /** 原生工具标识（type=native 时） */
  readonly nativeId?: string;
}

/**
 * 工具定义
 *
 * 描述一个可调用的工具
 */
export interface ToolDef {
  /** 工具名称，唯一标识 */
  readonly name: string;
  /** 工具标题，用于展示 */
  readonly title?: string;
  /** 工具描述，给 LLM 看的 */
  readonly description: string;
  /** 输入参数 JSON Schema */
  readonly inputSchema: JSONSchema;
  /** 权限级别 */
  readonly permission: PermissionLevel;
  /** 工具来源 */
  readonly source: ToolSource;
  /** 是否启用 */
  readonly enabled?: boolean;
  /** 超时时间（毫秒） */
  readonly timeout?: number;
}

// ============================================
// 工具调用
// ============================================

/**
 * 工具调用请求（LLM 返回的）
 */
export interface ToolCall {
  /** 调用 ID，用于匹配结果 */
  readonly id: string;
  /** 工具名称 */
  readonly name: string;
  /** 调用参数 */
  readonly arguments: Record<string, unknown>;
}

/**
 * 工具调用请求（OpenAI 格式，用于传给模型）
 */
export interface OpenAIToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JSONSchema;
  };
}

// ============================================
// 工具结果
// ============================================

/**
 * 审批状态
 */
export type ApprovalStatus = "pending" | "approved" | "rejected" | "timeout";

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 调用 ID，对应 ToolCall.id */
  readonly callId: string;
  /** 工具名称 */
  readonly toolName: string;
  /** 是否成功 */
  readonly success: boolean;
  /** 输出内容 */
  readonly output: unknown;
  /** 错误信息（失败时） */
  readonly error?: string;
  /** 执行耗时（毫秒） */
  readonly latency: number;
  /** 是否需要审批 */
  readonly approvalRequired?: boolean;
  /** 审批状态 */
  readonly approvalStatus?: ApprovalStatus;
  /** 是否在沙箱中执行 */
  readonly sandboxed?: boolean;
}

// ============================================
// 审批状态
// ============================================

/**
 * 审批状态（会话级别）
 */
export interface ApprovalState {
  /** 会话 ID */
  readonly sessionId: string;
  /** 待审批的工具调用 */
  readonly toolCall: ToolCall;
  /** 发送给用户的审批消息 */
  readonly message: string;
  /** 审批状态 */
  readonly status: ApprovalStatus;
  /** 创建时间 */
  readonly createdAt: number;
  /** 超时时间（毫秒） */
  readonly timeout?: number;
}

// ============================================
// 沙箱配置
// ============================================

/**
 * Docker 沙箱配置
 */
export interface SandboxConfig {
  /** 是否启用沙箱 */
  readonly enabled: boolean;
  /** Docker 镜像 */
  readonly image: string;
  /** 执行超时（毫秒） */
  readonly timeout: number;
  /** 内存限制（字节） */
  readonly memoryLimit: number;
  /** CPU 限制（0-1） */
  readonly cpuLimit: number;
  /** 是否禁用网络 */
  readonly networkDisabled: boolean;
  /** 工作目录 */
  readonly workDir: string;
}

/**
 * 沙箱执行结果
 */
export interface SandboxResult {
  /** 退出码 */
  readonly exitCode: number;
  /** 标准输出 */
  readonly stdout: string;
  /** 标准错误 */
  readonly stderr: string;
  /** 执行耗时（毫秒） */
  readonly latency: number;
  /** 是否超时 */
  readonly timedOut: boolean;
}

// ============================================
// 工具配置
// ============================================

/**
 * 工具权限配置
 */
export interface ToolPermissionConfig {
  /** safe 级工具列表 */
  readonly safe: readonly string[];
  /** confirm 级工具列表 */
  readonly confirm: readonly string[];
  /** deny 级工具列表 */
  readonly deny: readonly string[];
}

/**
 * 工具系统配置
 */
export interface ToolSystemConfig {
  /** 权限配置 */
  readonly permissions: ToolPermissionConfig;
  /** 沙箱配置 */
  readonly sandbox: SandboxConfig;
  /** 审批超时（毫秒），默认 30000 */
  readonly approvalTimeout: number;
  /** 最大工具调用迭代次数，默认 5 */
  readonly maxToolCallIterations: number;
}

// ============================================
// 错误类型
// ============================================

/**
 * 工具错误基类
 */
export abstract class ToolError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    options?: { cause?: Error },
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * 工具未找到错误
 */
export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`, toolName);
  }
}

/**
 * 工具权限拒绝错误
 */
export class ToolPermissionDeniedError extends ToolError {
  constructor(
    toolName: string,
    public readonly permission: PermissionLevel,
  ) {
    super(`Tool permission denied: ${toolName} (${permission})`, toolName);
  }
}

/**
 * 工具执行错误
 */
export class ToolExecutionError extends ToolError {
  constructor(
    toolName: string,
    public readonly reason: string,
  ) {
    super(`Tool execution failed: ${toolName}: ${reason}`, toolName);
  }
}

/**
 * 工具超时错误
 */
export class ToolTimeoutError extends ToolError {
  constructor(
    toolName: string,
    public readonly timeout: number,
  ) {
    super(`Tool execution timeout: ${toolName} (${timeout}ms)`, toolName);
  }
}

/**
 * 审批超时错误
 */
export class ApprovalTimeoutError extends ToolError {
  constructor(
    toolName: string,
    public readonly timeout: number,
  ) {
    super(`Approval timeout: ${toolName} (${timeout}ms)`, toolName);
  }
}

// ============================================
// 常量
// ============================================

/**
 * 默认沙箱配置
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  image: "kurisu-sandbox:latest",
  timeout: 30000,
  memoryLimit: 512 * 1024 * 1024, // 512MB
  cpuLimit: 0.5,
  networkDisabled: true,
  workDir: "/workspace",
};

/**
 * 默认工具系统配置
 */
export const DEFAULT_TOOL_SYSTEM_CONFIG: ToolSystemConfig = {
  permissions: {
    safe: ["web_search", "fetch", "file_read", "time", "screenshot"],
    confirm: ["shell", "file_write", "file_delete", "browser"],
    deny: [],
  },
  sandbox: DEFAULT_SANDBOX_CONFIG,
  approvalTimeout: 30000,
  maxToolCallIterations: 5,
};

/**
 * 默认工具超时
 */
export const DEFAULT_TOOL_TIMEOUT = 30000;
