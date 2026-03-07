/**
 * Kurisu 统一错误类型 — Anthropic API 风格
 * 全链路复用：Agent / Gateway / Tool / Permission
 */
export type KurisuErrorType =
  // LLM / API
  | "llm_error"
  | "rate_limit_error"
  | "network_error"
  | "model_unavailable"
  | "context_overflow"
  // Tool
  | "tool_not_found"
  | "tool_execution_error"
  | "tool_timeout"
  | "invalid_params"
  | "mcp_connection_lost"
  // Permission
  | "permission_denied"
  | "user_rejected"
  // Gateway
  | "session_not_found"
  | "session_expired"
  | "invalid_input"
  | "stream_error"
  | "gateway_error";

/**
 * 统一错误信封
 */
export interface KurisuError {
  readonly type: KurisuErrorType;
  readonly message: string;
}
