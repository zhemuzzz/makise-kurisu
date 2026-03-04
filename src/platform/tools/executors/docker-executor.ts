/**
 * 跨平台工具执行器 - Docker 执行器
 *
 * 在隔离的 Docker 容器中执行命令，提供最强的隔离能力
 */

import Docker from "dockerode";
import path from "path";
import fs from "fs";
import type { PermissionLevel } from "../types";
import type {
  ToolExecutor,
  ExecutorCapabilities,
  ExecuteOptions,
  ExecuteResult,
  DockerExecutorConfig,
} from "./types";
import { DEFAULT_DOCKER_CONFIG } from "./types";
import { detectPlatform } from "./platform";
import {
  checkDangerousCommand,
  filterSensitiveEnvVars,
  validateAllowedPaths,
} from "./security";

/**
 * 权限级别到容器配置的映射
 */
interface PermissionContainerConfig {
  /** 用户 */
  readonly user: string;
  /** 卷挂载 */
  readonly volumes: readonly string[];
  /** 是否只读根文件系统 */
  readonly readOnlyRoot: boolean;
}

/**
 * 验证挂载卷路径是否安全
 *
 * 防止路径遍历攻击
 */
function validateVolumePath(hostPath: string): {
  valid: boolean;
  error?: string;
} {
  // 必须是绝对路径
  if (!path.isAbsolute(hostPath)) {
    return { valid: false, error: `路径必须是绝对路径: ${hostPath}` };
  }

  // 规范化路径并检查是否包含 ..
  const normalized = path.normalize(hostPath);
  if (normalized.includes("..") || hostPath.includes("..")) {
    return { valid: false, error: `路径不能包含 .. : ${hostPath}` };
  }

  // 检查路径是否存在
  try {
    fs.accessSync(normalized, fs.constants.R_OK);
  } catch {
    return { valid: false, error: `路径不存在或不可访问: ${hostPath}` };
  }

  return { valid: true };
}

/**
 * Docker 执行器
 *
 * 在 Docker 容器中安全地执行命令：
 * - 资源限制（CPU、内存）
 * - 网络隔离
 * - 只读根文件系统
 * - 非 root 用户执行
 * - 根据权限级别配置不同的隔离策略
 */
export class DockerExecutor implements ToolExecutor {
  private readonly docker: Docker;
  private readonly config: DockerExecutorConfig;

  constructor(config: Partial<DockerExecutorConfig> = {}) {
    this.config = {
      ...DEFAULT_DOCKER_CONFIG,
      ...config,
    };

    // 创建 Docker 客户端
    const dockerOptions = this.config.dockerOptions as
      | Docker.DockerOptions
      | undefined;
    this.docker = new Docker(dockerOptions);
  }

  /**
   * 执行命令
   */
  async execute(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const startTime = Date.now();
    const timeout =
      options.timeout ?? this.config.timeout ?? DEFAULT_DOCKER_CONFIG.timeout!;

    // 验证权限级别
    if (!this.supportsPermission(options.permission)) {
      return {
        success: false,
        stdout: "",
        stderr: `Permission level not supported: ${options.permission}`,
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "docker",
      };
    }

    // confirm 级别需要审批
    if (options.permission === "confirm" && !options.approved) {
      return {
        success: false,
        stdout: "",
        stderr: "confirm level requires approval",
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "docker",
      };
    }

    // 检查危险命令模式
    const dangerCheck = checkDangerousCommand(command);
    if (!dangerCheck.safe) {
      return {
        success: false,
        stdout: "",
        stderr: `Dangerous command detected: ${dangerCheck.warnings.join(", ")}`,
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "docker",
      };
    }

    // 验证挂载卷路径安全性
    if (options.volumes) {
      for (const volume of options.volumes) {
        const validation = validateVolumePath(volume.hostPath);
        if (!validation.valid) {
          return {
            success: false,
            stdout: "",
            stderr: `安全错误: ${validation.error}`,
            exitCode: 1,
            latency: Date.now() - startTime,
            executorType: "docker",
            timedOut: false,
          };
        }
      }
    }

    // 构建容器配置
    const containerConfig = this.buildContainerConfig(command, options);

    let container: Docker.Container | null = null;

    try {
      // 创建容器
      container = await this.docker.createContainer(containerConfig);

      // 启动容器
      await container.start();

      // 等待容器完成（带超时）
      const waitResult = await this.waitForContainer(container, timeout);

      // 获取日志
      const logs = await container.logs({
        stdout: true,
        stderr: true,
      });

      const output = logs.toString("utf-8");
      const stdout = this.parseDockerLogs(output, "stdout");
      const stderr = this.parseDockerLogs(output, "stderr");

      const exitCode = waitResult.StatusCode ?? 1;
      const timedOut = exitCode === 137; // SIGKILL

      return {
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
        latency: Date.now() - startTime,
        executorType: "docker",
        timedOut,
      };
    } catch (error) {
      // 超时错误
      if (error instanceof Error && error.message.includes("timeout")) {
        return {
          success: false,
          stdout: "",
          stderr: `Execution timeout after ${timeout}ms`,
          exitCode: 137,
          latency: Date.now() - startTime,
          executorType: "docker",
          timedOut: true,
        };
      }

      // 其他错误
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stdout: "",
        stderr: errorMessage,
        exitCode: 1,
        latency: Date.now() - startTime,
        executorType: "docker",
      };
    } finally {
      // 清理容器
      if (container) {
        try {
          await container.remove({ force: true });
        } catch {
          // 忽略清理错误
        }
      }
    }
  }

  /**
   * 构建容器配置
   */
  private buildContainerConfig(
    command: string,
    options: ExecuteOptions,
  ): Docker.ContainerCreateOptions {
    const { permission, networkAccess, timeout, workingDir, env, volumes } =
      options;

    // 根据权限级别获取配置
    const permissionConfig = this.getPermissionConfig(permission, workingDir);

    // 构建卷挂载
    const binds = [
      ...permissionConfig.volumes,
      ...(volumes?.map((v) =>
        v.readOnly
          ? `${v.hostPath}:${v.containerPath}:ro`
          : `${v.hostPath}:${v.containerPath}`,
      ) ?? []),
    ];

    // 过滤敏感环境变量
    const filteredEnv = env ? filterSensitiveEnvVars(env) : undefined;

    return {
      Image: this.config.image,
      Cmd: ["sh", "-c", command],
      WorkingDir: workingDir,
      User: permissionConfig.user,
      Env: filteredEnv
        ? Object.entries(filteredEnv).map(([k, v]) => `${k}=${v}`)
        : undefined,
      HostConfig: {
        Memory: (this.config.memoryLimit ?? 512) * 1024 * 1024, // MB to bytes
        CpuQuota: Math.floor((this.config.cpuLimit ?? 0.5) * 100000),
        CpuPeriod: 100000,
        NetworkMode: networkAccess ? "bridge" : "none",
        ReadonlyRootfs: permissionConfig.readOnlyRoot,
        AutoRemove: false,
        Binds: binds.length > 0 ? binds : undefined,
      },
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
      StopTimeout: Math.ceil(timeout / 1000),
    };
  }

  /**
   * 根据权限级别获取容器配置
   */
  private getPermissionConfig(
    permission: PermissionLevel,
    workingDir: string,
  ): PermissionContainerConfig {
    const sandboxDir = this.config.sandboxDir;

    // 验证并过滤允许的路径
    const { valid: validatedPaths } = validateAllowedPaths(
      this.config.allowedPaths ?? [],
    );

    switch (permission) {
      case "safe":
        // 安全级别：只读访问沙箱目录
        return {
          user: "sandbox",
          volumes: [`${sandboxDir}:${workingDir}:ro`],
          readOnlyRoot: true,
        };

      case "confirm":
        // 确认级别：读写访问验证后的指定目录
        return {
          user: "sandbox",
          volumes:
            validatedPaths.length > 0
              ? validatedPaths.map((p) => `${p}:${workingDir}:rw`)
              : [`${sandboxDir}:${workingDir}:rw`],
          readOnlyRoot: true,
        };

      case "deny":
        // 拒绝级别：最小权限
        return {
          user: "nobody",
          volumes: [],
          readOnlyRoot: true,
        };

      default:
        // 默认使用安全配置
        return {
          user: "sandbox",
          volumes: [`${sandboxDir}:${workingDir}:ro`],
          readOnlyRoot: true,
        };
    }
  }

  /**
   * 等待容器完成（带超时）
   */
  private async waitForContainer(
    container: Docker.Container,
    timeout: number,
  ): Promise<{ StatusCode: number | null }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        container.kill().catch(() => {});
        reject(new Error(`Container execution timeout after ${timeout}ms`));
      }, timeout);

      container
        .wait()
        .then((result: { StatusCode: number | null }) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 解析 Docker 日志输出
   *
   * Docker multiplexed stream 格式：
   * [8 bytes header][payload]
   * header: [1 byte stream type][3 bytes padding][4 bytes size]
   */
  private parseDockerLogs(output: string, type: "stdout" | "stderr"): string {
    const buffer = Buffer.from(output, "utf-8");
    const lines: string[] = [];
    let offset = 0;

    const targetType = type === "stdout" ? 1 : 2;

    while (offset < buffer.length) {
      // 至少需要 8 字节 header
      if (offset + 8 > buffer.length) break;

      const streamType = buffer.readUInt8(offset);
      // 跳过 3 字节 padding
      const size = buffer.readUInt32BE(offset + 4);

      if (offset + 8 + size > buffer.length) break;

      if (streamType === targetType) {
        const payload = buffer.subarray(offset + 8, offset + 8 + size);
        lines.push(payload.toString("utf-8"));
      }

      offset += 8 + size;
    }

    return lines.join("");
  }

  /**
   * 获取执行器能力
   */
  getCapabilities(): ExecutorCapabilities {
    return {
      platform: detectPlatform().platform,
      isolation: "docker",
      supportedPermissions: ["safe", "confirm", "deny"],
      networkIsolation: true,
      maxMemory: this.config.memoryLimit ?? 512,
      supportsApproval: true,
    };
  }

  /**
   * 检查特定权限是否可用
   */
  supportsPermission(level: PermissionLevel): boolean {
    return ["safe", "confirm", "deny"].includes(level);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检查沙箱镜像是否存在
   */
  async hasImage(): Promise<boolean> {
    try {
      await this.docker.getImage(this.config.image).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<DockerExecutorConfig> {
    return this.config;
  }
}

/**
 * 创建 Docker 执行器
 */
export function createDockerExecutor(
  config?: Partial<DockerExecutorConfig>,
): DockerExecutor {
  return new DockerExecutor(config);
}
