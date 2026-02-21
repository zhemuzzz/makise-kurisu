/**
 * 安全层类型定义
 *
 * L-1 系统安全层 - 静默运行，不产生对话
 */

// ============================================
// 错误代码
// ============================================

/**
 * 安全错误代码
 */
export type SafetyErrorCode =
  | "NEED_CONFIRMATION" // 需要用户确认
  | "FORBIDDEN" // 禁止执行
  | "UNAUTHORIZED" // 未授权
  | "RATE_LIMITED"; // 频率限制

// ============================================
// 错误和结果类型
// ============================================

/**
 * 安全错误
 * 注意：internalMessage 只给 LLM 看，不直接输出给用户
 */
export interface SafetyError {
  readonly code: SafetyErrorCode;
  readonly toolName: string;
  readonly internalMessage: string;
}

/**
 * 安全检查结果
 */
export interface SafetyResult {
  readonly success: boolean;
  readonly error?: SafetyError;
}

// ============================================
// 工具调用类型
// ============================================

/**
 * 工具调用请求
 */
export interface ToolCall {
  readonly name: string;
  readonly params: unknown;
}

// ============================================
// 配置类型
// ============================================

/**
 * 危险操作模式
 */
export interface DangerousPattern {
  readonly pattern: string;
  readonly action: "confirm" | "forbid";
}

/**
 * 拦截行为配置
 */
export interface InterceptionConfig {
  readonly silent: boolean;
}

/**
 * 工具权限配置
 */
export interface ToolPermissions {
  readonly safe: readonly string[];
  readonly confirm: readonly string[];
  readonly forbidden: readonly string[];
}

/**
 * 安全配置
 */
export interface SafetyConfig {
  readonly tools: ToolPermissions;
  readonly dangerousPatterns: readonly DangerousPattern[];
  readonly interception: InterceptionConfig;
}

// ============================================
// 默认配置
// ============================================

/**
 * 默认安全配置
 */
export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  tools: {
    safe: ["web_search", "file_read", "screenshot", "memory_read"],
    confirm: [
      "file_write",
      "file_delete",
      "shell_execute",
      "browser_action",
      "send_message",
    ],
    forbidden: ["system_modify", "credential_access"],
  },
  dangerousPatterns: [
    { pattern: "rm -rf", action: "confirm" },
    { pattern: "DROP TABLE", action: "confirm" },
    { pattern: "delete from", action: "confirm" },
    { pattern: "format", action: "confirm" },
  ],
  interception: {
    silent: true,
  },
};
