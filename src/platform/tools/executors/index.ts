/**
 * 跨平台工具执行器
 *
 * KURISU-019: 统一的工具执行抽象层
 */

// 类型导出
export type {
  Platform,
  IsolationType,
  ExecutorCapabilities,
  VolumeMapping,
  ExecuteOptions,
  ExecuteResult,
  ToolExecutor,
  DockerExecutorConfig,
  ProcessExecutorConfig,
  TermuxExecutorConfig,
  CloudExecutorConfig,
  ExecutorConfig,
} from "./types.js";

export {
  DEFAULT_DOCKER_CONFIG,
  DEFAULT_PROCESS_CONFIG,
  DEFAULT_EXECUTE_OPTIONS,
} from "./types.js";

// 平台检测
export {
  detectPlatform,
  checkDockerAvailable,
  isDockerLikelyAvailable,
  clearPlatformCache,
  getRecommendedWorkDir,
} from "./platform.js";

export type { PlatformInfo, DockerAvailability } from "./platform.js";

// 执行器
export { DockerExecutor, createDockerExecutor } from "./docker-executor.js";
export { ProcessExecutor, createProcessExecutor } from "./process-executor.js";
export { TermuxExecutor, createTermuxExecutor } from "./termux-executor.js";
export { CloudExecutor, createCloudExecutor } from "./cloud-executor.js";

// 工厂
export {
  ExecutorFactory,
  createExecutor,
  getRecommendedExecutorType,
  isProcessExecutorAvailable,
  isCloudExecutorAvailable,
} from "./factory.js";

export type { CreatedExecutor } from "./factory.js";

// 安全验证
export {
  validateToolName,
  checkDangerousCommand,
  filterSensitiveEnvVars,
  validateAllowedPaths,
  buildSafeCommand,
  decodeBase64Args,
} from "./security.js";
