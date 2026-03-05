/**
 * Platform Tools
 *
 * 导出所有工具相关模块
 */

// 类型
export * from "./types.js";

// MCP 桥接
export { MCPBridge, createMCPBridge, type MCPBridgeConfig } from "./mcp-bridge.js";

// 工具注册表
export {
  ToolRegistry,
  createToolRegistry,
  type ToolExecutor,
  type ToolRegistryConfig,
} from "./registry.js";

// 权限检查器
export {
  PermissionChecker,
  createPermissionChecker,
  type PermissionCheckerConfig,
  type PermissionCheckResult,
} from "./permission.js";

// 审批管理器
export {
  ApprovalManager,
  createApprovalManager,
  type ApprovalManagerConfig,
} from "./approval.js";

// 沙箱执行器
export {
  SandboxExecutor,
  createSandboxExecutor,
  shouldUseSandbox,
  type SandboxExecutorConfig,
  type ExecuteOptions,
} from "./sandbox.js";

// 人设包装器
export {
  PersonaWrapper,
  createPersonaWrapper,
  type PersonaWrapperConfig,
  type ToolOutputType,
} from "./persona-wrapper.js";

// 会话工作目录管理器 (KURISU-020)
export {
  SessionWorkDirManager,
  createSessionWorkDirManager,
  type SessionWorkDirState,
  type ChangeDirResult,
  type ChangeDirApprovalRequest,
  type PathValidationResult,
  type SessionWorkDirManagerConfig,
} from "./session-workdir.js";

// 会话权限管理器 (KURISU-021)
export {
  SessionPermissionManager,
  createSessionPermissionManager,
  type SessionPermissionState,
  type PermissionChangeResult,
  type PermissionApprovalRequest,
} from "./session-permission.js";
