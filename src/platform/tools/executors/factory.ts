/**
 * 跨平台工具执行器 - 执行器工厂
 *
 * 根据平台和 Docker 可用性自动创建最优执行器
 *
 * 优先级：
 * 1. 用户指定的执行器类型
 * 2. Docker 可用时使用 DockerExecutor
 * 3. 降级到 ProcessExecutor
 * 4. Android Termux 使用 TermuxExecutor
 * 5. iOS 使用 CloudExecutor
 */

import type { ToolExecutor, ExecutorConfig } from "./types.js";
import { DockerExecutor } from "./docker-executor.js";
import { ProcessExecutor } from "./process-executor.js";
import { TermuxExecutor } from "./termux-executor.js";
import { CloudExecutor } from "./cloud-executor.js";
import { detectPlatform, checkDockerAvailable } from "./platform.js";

/**
 * 创建的执行器信息
 */
export interface CreatedExecutor {
  /** 执行器实例 */
  readonly executor: ToolExecutor;
  /** 执行器类型 */
  readonly type: "docker" | "process" | "cloud";
  /** 创建原因 */
  readonly reason: string;
}

/**
 * 执行器工厂
 *
 * 根据以下优先级创建执行器：
 * 1. 用户指定的执行器类型
 * 2. Docker 可用时使用 DockerExecutor
 * 3. 根据平台降级到 ProcessExecutor（Phase 2 实现）
 * 4. iOS 平台使用 CloudExecutor（Phase 3 实现）
 */
export class ExecutorFactory {
  private static instance: ExecutorFactory | null = null;
  private cachedExecutor: CreatedExecutor | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): ExecutorFactory {
    if (!ExecutorFactory.instance) {
      ExecutorFactory.instance = new ExecutorFactory();
    }
    return ExecutorFactory.instance;
  }

  /**
   * 创建执行器
   *
   * @param config 执行器配置
   * @param forceRecreate 是否强制重新创建（忽略缓存）
   */
  async createExecutor(
    config?: ExecutorConfig,
    forceRecreate = false,
  ): Promise<CreatedExecutor> {
    // 检查缓存
    if (this.cachedExecutor && !forceRecreate) {
      return this.cachedExecutor;
    }

    // 用户指定了执行器类型
    if (config?.prefer === "cloud") {
      const executor = await this.createCloudExecutor(config);
      if (executor) {
        this.cachedExecutor = {
          executor,
          type: "cloud",
          reason: "User specified cloud executor",
        };
        return this.cachedExecutor;
      }
    }

    if (config?.prefer === "process") {
      const executor = await this.createProcessExecutor(config);
      if (executor) {
        this.cachedExecutor = {
          executor,
          type: "process",
          reason: "User specified process executor",
        };
        return this.cachedExecutor;
      }
    }

    // 尝试使用 Docker（优先）
    const dockerExecutor = await this.tryCreateDockerExecutor(config);
    if (dockerExecutor) {
      this.cachedExecutor = dockerExecutor;
      return dockerExecutor;
    }

    // 降级到 Process 执行器
    const processExecutor = await this.createProcessExecutor(config);
    if (processExecutor) {
      this.cachedExecutor = {
        executor: processExecutor,
        type: "process",
        reason: "Docker not available, using process executor",
      };
      return this.cachedExecutor;
    }

    // 最后尝试云端执行器
    const cloudExecutor = await this.createCloudExecutor(config);
    if (cloudExecutor) {
      this.cachedExecutor = {
        executor: cloudExecutor,
        type: "cloud",
        reason: "Local execution not available, using cloud executor",
      };
      return this.cachedExecutor;
    }

    // 无法创建任何执行器
    throw new Error("Failed to create any executor");
  }

  /**
   * 尝试创建 Docker 执行器
   */
  private async tryCreateDockerExecutor(
    config?: ExecutorConfig,
  ): Promise<CreatedExecutor | null> {
    // 检测平台
    const platformInfo = detectPlatform();

    // iOS 不支持 Docker
    if (platformInfo.platform === "ios") {
      return null;
    }

    // Android 不支持原生 Docker
    if (platformInfo.platform === "android") {
      return null;
    }

    // 检查 Docker 可用性
    const dockerAvailability = await checkDockerAvailable();
    if (!dockerAvailability.available) {
      return null;
    }

    // 创建 Docker 执行器
    const executor = new DockerExecutor(config?.docker);

    // 验证镜像是否存在（可选）
    const hasImage = await executor.hasImage();
    if (!hasImage) {
      return null;
    }

    return {
      executor,
      type: "docker",
      reason: `Docker available (version ${dockerAvailability.version})`,
    };
  }

  /**
   * 创建 Process 执行器
   *
   * 根据平台选择合适的执行器：
   * - Android Termux: TermuxExecutor
   * - 其他: ProcessExecutor
   */
  private async createProcessExecutor(
    config?: ExecutorConfig,
  ): Promise<ToolExecutor | null> {
    const platformInfo = detectPlatform();

    // Android Termux 环境
    if (platformInfo.isTermux) {
      // Termux 环境检测
      await TermuxExecutor.isProotAvailable();

      return new TermuxExecutor({
        rootfs: config?.termux?.rootfs ?? "",
        timeout: config?.termux?.timeout ?? 30000,
      });
    }

    // 其他平台使用 ProcessExecutor
    return new ProcessExecutor(config?.process);
  }

  /**
   * 创建 Cloud 执行器
   *
   * 需要 API Key 和 endpoint 配置
   */
  private async createCloudExecutor(
    config?: ExecutorConfig,
  ): Promise<ToolExecutor | null> {
    // 检查配置是否完整
    if (!config?.cloud?.apiKey || !config?.cloud?.endpoint) {
      return null;
    }

    return new CloudExecutor(config.cloud);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedExecutor = null;
  }

  /**
   * 获取缓存的执行器
   */
  getCachedExecutor(): CreatedExecutor | null {
    return this.cachedExecutor;
  }
}

/**
 * 创建执行器（便捷函数）
 */
export async function createExecutor(
  config?: ExecutorConfig,
  forceRecreate = false,
): Promise<CreatedExecutor> {
  const factory = ExecutorFactory.getInstance();
  return factory.createExecutor(config, forceRecreate);
}

/**
 * 获取执行器推荐类型
 *
 * 不创建执行器，仅返回推荐的类型
 */
export async function getRecommendedExecutorType(): Promise<{
  type: "docker" | "process" | "cloud";
  reason: string;
}> {
  const platformInfo = detectPlatform();

  // iOS 必须使用云端
  if (platformInfo.platform === "ios") {
    return {
      type: "cloud",
      reason: "iOS does not support local execution",
    };
  }

  // Android (Termux) 只能用进程隔离
  if (platformInfo.platform === "android") {
    return {
      type: "process",
      reason: "Android does not support Docker",
    };
  }

  // 检查 Docker
  const dockerAvailability = await checkDockerAvailable();
  if (dockerAvailability.available) {
    return {
      type: "docker",
      reason: `Docker available (version ${dockerAvailability.version})`,
    };
  }

  // 降级到进程执行
  return {
    type: "process",
    reason: `Docker not available: ${dockerAvailability.reason}`,
  };
}

/**
 * 检查 ProcessExecutor 是否可用
 */
export function isProcessExecutorAvailable(): boolean {
  const platformInfo = detectPlatform();
  // 所有桌面平台都支持 ProcessExecutor
  return (
    platformInfo.platform === "macos" ||
    platformInfo.platform === "windows" ||
    platformInfo.platform === "linux" ||
    platformInfo.platform === "android"
  );
}

/**
 * 检查 CloudExecutor 是否可用
 */
export function isCloudExecutorAvailable(config?: ExecutorConfig): boolean {
  return CloudExecutor.isAvailable(config?.cloud);
}
