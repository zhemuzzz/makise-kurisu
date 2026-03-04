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
} from "./types";

export {
  DEFAULT_DOCKER_CONFIG,
  DEFAULT_PROCESS_CONFIG,
  DEFAULT_EXECUTE_OPTIONS,
} from "./types";

// 平台检测
export {
  detectPlatform,
  checkDockerAvailable,
  isDockerLikelyAvailable,
  clearPlatformCache,
  getRecommendedWorkDir,
} from "./platform";

export type { PlatformInfo, DockerAvailability } from "./platform";

// 执行器
export { DockerExecutor, createDockerExecutor } from "./docker-executor";
export { ProcessExecutor, createProcessExecutor } from "./process-executor";
export { TermuxExecutor, createTermuxExecutor } from "./termux-executor";
export { CloudExecutor, createCloudExecutor } from "./cloud-executor";

// 工厂
export {
  ExecutorFactory,
  createExecutor,
  getRecommendedExecutorType,
  isProcessExecutorAvailable,
  isCloudExecutorAvailable,
} from "./factory";

export type { CreatedExecutor } from "./factory";

// 安全验证
export {
  validateToolName,
  checkDangerousCommand,
  filterSensitiveEnvVars,
  validateAllowedPaths,
  buildSafeCommand,
  decodeBase64Args,
} from "./security";
