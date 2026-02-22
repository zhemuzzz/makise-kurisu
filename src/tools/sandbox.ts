/**
 * Docker 沙箱执行器
 *
 * 在隔离的 Docker 容器中执行命令，用于 confirm 级工具的安全执行
 */

import Docker from "dockerode";
import type { SandboxConfig, SandboxResult } from "./types";
import { DEFAULT_SANDBOX_CONFIG } from "./types";

/**
 * 沙箱执行器配置
 */
export interface SandboxExecutorConfig {
  /** 沙箱配置 */
  sandbox?: Partial<SandboxConfig>;
  /** Docker 连接配置（可选，默认使用本地 Docker） */
  dockerOptions?: Docker.DockerOptions;
}

/**
 * 执行选项
 */
export interface ExecuteOptions {
  /** 要执行的命令 */
  readonly command: string;
  /** 环境变量 */
  readonly env?: Record<string, string>;
  /** 挂载的卷 */
  readonly volumes?: ReadonlyArray<{
    readonly hostPath: string;
    readonly containerPath: string;
    readonly readOnly?: boolean;
  }>;
  /** 工作目录（覆盖默认） */
  readonly workDir?: string;
  /** 超时（覆盖默认） */
  readonly timeout?: number;
}

/**
 * Docker 沙箱执行器
 *
 * 安全地在隔离容器中执行命令：
 * - 资源限制（CPU、内存）
 * - 网络隔离
 * - 只读根文件系统
 * - 非 root 用户执行
 */
export class SandboxExecutor {
  private readonly docker: Docker;
  private readonly config: SandboxConfig;

  constructor(config: SandboxExecutorConfig = {}) {
    this.docker = new Docker(config.dockerOptions);
    this.config = {
      ...DEFAULT_SANDBOX_CONFIG,
      ...config.sandbox,
    };
  }

  /**
   * 检查 Docker 是否可用
   */
  async isAvailable(): Promise<boolean> {
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
   * 在沙箱中执行命令
   */
  async execute(options: ExecuteOptions): Promise<SandboxResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? this.config.timeout;

    // 构建容器配置
    const containerConfig: Docker.ContainerCreateOptions = {
      Image: this.config.image,
      Cmd: ["sh", "-c", options.command],
      WorkingDir: options.workDir ?? this.config.workDir,
      User: "sandbox",
      Env: options.env
        ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`)
        : undefined,
      HostConfig: {
        Memory: this.config.memoryLimit,
        CpuQuota: Math.floor(this.config.cpuLimit * 100000),
        CpuPeriod: 100000,
        NetworkMode: this.config.networkDisabled ? "none" : "bridge",
        ReadonlyRootfs: true,
        AutoRemove: false,
        Binds: options.volumes?.map((v) =>
          v.readOnly
            ? `${v.hostPath}:${v.containerPath}:ro`
            : `${v.hostPath}:${v.containerPath}`,
        ),
      },
      Tty: false,
      AttachStdout: true,
      AttachStderr: true,
    };

    let container: Docker.Container | null = null;

    try {
      // 创建容器
      container = await this.docker.createContainer(containerConfig);

      // 启动容器
      await container.start();

      // 等待容器完成（带超时）
      const result = await this.waitForContainer(container, timeout);

      // 获取日志
      const logs = await container.logs({
        stdout: true,
        stderr: true,
      });

      const output = logs.toString("utf-8");
      // Docker logs 以 8 字节 header 开始，需要跳过
      const stdout = this.parseDockerLogs(output, "stdout");
      const stderr = this.parseDockerLogs(output, "stderr");

      return {
        exitCode: result.StatusCode ?? 1,
        stdout,
        stderr,
        latency: Date.now() - startTime,
        timedOut: result.StatusCode === 137, // SIGKILL 通常是 137
      };
    } catch (error) {
      // 超时错误
      if (error instanceof Error && error.message.includes("timeout")) {
        return {
          exitCode: 137, // SIGKILL
          stdout: "",
          stderr: `Execution timeout after ${timeout}ms`,
          latency: Date.now() - startTime,
          timedOut: true,
        };
      }

      throw error;
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
   * 获取当前配置
   */
  getConfig(): Readonly<SandboxConfig> {
    return this.config;
  }
}

/**
 * 创建沙箱执行器
 */
export function createSandboxExecutor(
  config?: SandboxExecutorConfig,
): SandboxExecutor {
  return new SandboxExecutor(config);
}

/**
 * 检查命令是否需要沙箱执行
 *
 * confirm 级工具应该在沙箱中执行
 */
export function shouldUseSandbox(
  permission: "safe" | "confirm" | "deny",
  sandboxEnabled: boolean,
): boolean {
  return permission === "confirm" && sandboxEnabled;
}
