/**
 * Meta-tool 类型定义
 *
 * @module agent/meta-tools/types
 * @description 4 个元工具的通用类型：MetaToolContext, MetaToolHandler, MetaToolError
 *
 * @see meta-tools.md §一（元工具总览）
 * @see meta-tools.md §四（统一错误反馈规范）
 */

import type { ToolDef, ToolResult, PermissionLevel } from "../../platform/tools/types.js";
import type {
  SkillManagerPort,
  SubAgentManagerPort,
} from "../ports/platform-services.js";
import type { TodoState } from "../types.js";

// ============================================================================
// MetaToolContext - 元工具执行上下文
// ============================================================================

/**
 * 元工具执行上下文
 *
 * 由 ReAct 循环注入，每个元工具 handler 接收
 */
export interface MetaToolContext {
  /** 会话 ID */
  readonly sessionId: string;

  /** 用户 ID */
  readonly userId: string;

  /** Agent ID */
  readonly agentId: string;

  /** 会话级状态（可变，用于 manage-todo 等跨轮次状态） */
  readonly sessionState: SessionState;

  /** Platform Services（按需使用） */
  readonly skills: SkillManagerPort;
  readonly subAgents: SubAgentManagerPort;
}

/**
 * 会话级状态
 *
 * 存储 manage-todo 维护的 TodoState 等跨轮次数据
 */
export interface SessionState {
  /** 获取 todo 状态 */
  getTodoState(): TodoState | undefined;

  /** 设置 todo 状态 */
  setTodoState(state: TodoState): void;
}

// ============================================================================
// MetaToolDefinition - 元工具注册信息
// ============================================================================

/**
 * 元工具定义（完整注册信息）
 */
export interface MetaToolDefinition {
  /** 工具定义（LLM 可见） */
  readonly toolDef: ToolDef;

  /** 执行函数 */
  readonly handler: MetaToolHandler;

  /** 权限级别 */
  readonly permission: PermissionLevel;
}

/**
 * 元工具 handler 签名
 */
export type MetaToolHandler = (
  params: Record<string, unknown>,
  context: MetaToolContext,
) => Promise<ToolResult>;

// ============================================================================
// 统一错误反馈（meta-tools.md §四）
// ============================================================================

/**
 * 元工具错误码
 *
 * @see meta-tools.md §四
 */
export const MetaToolErrorCode = {
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  USER_REJECTED: "USER_REJECTED",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  TIMEOUT: "TIMEOUT",
  INVALID_PARAMS: "INVALID_PARAMS",
  RATE_LIMITED: "RATE_LIMITED",
} as const;

export type MetaToolErrorCodeType =
  (typeof MetaToolErrorCode)[keyof typeof MetaToolErrorCode];

/**
 * 元工具错误信息
 */
export interface MetaToolError {
  readonly code: MetaToolErrorCodeType;
  readonly message: string;
  readonly hint?: string;
}

// ============================================================================
// Helper: 创建标准 ToolResult
// ============================================================================

/**
 * 创建成功结果
 */
export function createSuccessResult(
  callId: string,
  toolName: string,
  output: unknown,
): ToolResult {
  return {
    callId,
    toolName,
    success: true,
    output,
    latency: 0,
  };
}

/**
 * 创建失败结果（统一错误反馈格式）
 */
export function createErrorResult(
  callId: string,
  toolName: string,
  error: MetaToolError,
): ToolResult {
  return {
    callId,
    toolName,
    success: false,
    output: { success: false, error },
    error: error.message,
    latency: 0,
  };
}
