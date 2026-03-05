/**
 * 跨平台工具执行器 - Termux 执行器
 *
 * KURISU-019 Phase 2: 在 Android Termux 环境中执行命令
 *
 * 使用 proot 进行简单的进程隔离：
 * - 模拟 chroot 环境
 * - 限制文件系统访问
 * - 不支持 full_access 权限
 */

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import type { PermissionLevel } from "../types.js";
import type {
  ToolExecutor,
  ExecutorCapabilities,
  ExecuteOptions,
  ExecuteResult,
  TermuxExecutorConfig,
} from "./types.js";
import { detectPlatform } from "./platform.js";
import { checkDangerousCommand, filterSensitiveEnvVars } from "./security.js";

/**
 * 默认 Termux 执行器配置
 */
const DEFAULT_TERMUX_CONFIG: TermuxExecutorConfig = {
  rootfs: "",
  timeout: 30000,
};

/**
 * Termux 执行器
 *
 * 在 Android Termux 环境中执行命令：
 * - 使用 proot 提供简单的文件系统隔离
 * - 不支持网络隔离
 * - 不支持 full_access 权限
 */
export class TermuxExecutor implements ToolExecutor {
  private readonly config: TermuxExecutorConfig;

  constructor(config: Partial<TermuxExecutorConfig> = {}) {
    this.config = {
      ...DEFAULT_TERMUX_CONFIG,
      ...config,
    };
  }

  /**
   * 检查是否在 Termux 环境中
   */
  static isTermuxEnvironment(): boolean {
    const platformInfo = detectPlatform();
    return platformInfo.isTermux;
  }

  /**
   * 检查 proot 是否可用
   */
  static async isProotAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn("which", ["proot"], {
        timeout: 5000,
      });

      proc.on("close", (code) => {
        resolve(code === 0);
      });

      proc.on("error", () => {
        resolve(false);
      });
    });
  }

  /**
   * 执行命令
   */
  async execute(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? this.config.timeout ?? 30000;

    // 验证权限级别 - Termux 不支持 deny
    if (options.permission === "deny") {
      return {
        success: false,
        stdout: "",
        stderr: "Permission denied: deny level",
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "process",
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
        executorType: "process",
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
        executorType: "process",
      };
    }

    try {
      // 使用 proot 执行
      return await this.executeWithProot(command, options, timeout);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stdout: "",
        stderr: errorMessage,
        exitCode: 1,
        latency: Date.now() - startTime,
        executorType: "process",
      };
    }
  }

  /**
   * 使用 proot 执行命令
   *
   * proot 提供简单的文件系统隔离：
   * - 使用 -r 指定 rootfs
   * - 使用 -b 绑定目录
   * - 使用 -0 以 root 身份运行（模拟）
   */
  private async executeWithProot(
    command: string,
    options: ExecuteOptions,
    timeout: number,
  ): Promise<ExecuteResult> {
    const { workingDir } = options;

    // 构建 proot 命令参数
    const prootArgs: string[] = [];

    // 如果有 rootfs，使用隔离模式
    if (this.config.rootfs && fs.existsSync(this.config.rootfs)) {
      prootArgs.push("-r", this.config.rootfs);
      prootArgs.push("-0"); // 模拟 root

      // 绑定工作目录
      prootArgs.push("-b", `${workingDir}:/workspace`);

      // 绑定 Termux 必要目录
      const termuxPrefix =
        process.env["PREFIX"] || "/data/data/com.termux/files/usr";
      if (fs.existsSync(termuxPrefix)) {
        prootArgs.push("-b", `${termuxPrefix}:/usr`);
      }

      // 绑定临时目录
      const tmpDir = os.tmpdir();
      prootArgs.push("-b", `${tmpDir}:/tmp`);
    }

    // 添加要执行的命令
    prootArgs.push("sh", "-c", command);

    // 如果没有 rootfs，直接执行
    const executable = this.config.rootfs ? "proot" : "sh";
    const finalArgs = this.config.rootfs ? prootArgs : ["-c", command];

    return await this.runProcess(executable, finalArgs, options, timeout);
  }

  /**
   * 运行进程
   */
  private async runProcess(
    program: string,
    args: string[],
    options: ExecuteOptions,
    timeout: number,
  ): Promise<ExecuteResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // 过滤敏感环境变量
      const filteredEnv = options.env
        ? filterSensitiveEnvVars(options.env)
        : undefined;

      // Termux 环境变量 — 只传递白名单变量
      const safeBaseEnv = filterSensitiveEnvVars(
        process.env as Record<string, string>,
        "permissive",
      );
      const termuxEnv = {
        ...safeBaseEnv,
        ...filteredEnv,
        TERMUX_VERSION: process.env["TERMUX_VERSION"] || "",
        PREFIX: process.env["PREFIX"] || "/data/data/com.termux/files/usr",
        HOME: process.env["HOME"] || os.homedir(),
      };

      const proc = spawn(program, args, {
        cwd: options.workingDir,
        env: termuxEnv,
        timeout,
      });

      // 设置超时
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeout);

      proc.stdout.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });

      proc.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });

      proc.on("close", (code: number | null) => {
        clearTimeout(timer);
        const exitCode = code ?? (timedOut ? 137 : 1);
        const latency = Date.now() - startTime;

        resolve({
          success: exitCode === 0,
          stdout,
          stderr,
          exitCode,
          latency,
          executorType: "process",
          timedOut,
        });
      });

      proc.on("error", (error: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          stdout,
          stderr: error.message,
          exitCode: 1,
          latency: Date.now() - startTime,
          executorType: "process",
        });
      });
    });
  }

  /**
   * 获取执行器能力
   */
  getCapabilities(): ExecutorCapabilities {
    return {
      platform: "android",
      isolation: "process",
      supportedPermissions: ["safe", "confirm"],
      networkIsolation: false, // proot 不支持网络隔离
      maxMemory: 0, // 无限制
      supportsApproval: true, // 支持 confirm 级别审批
    };
  }

  /**
   * 检查特定权限是否可用
   */
  supportsPermission(level: PermissionLevel): boolean {
    // Termux 不支持 full_access
    return level === "safe" || level === "confirm";
  }

  /**
   * 健康检查
   *
   * 检查是否在 Termux 环境中
   */
  async healthCheck(): Promise<boolean> {
    return TermuxExecutor.isTermuxEnvironment();
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<TermuxExecutorConfig> {
    return this.config;
  }
}

/**
 * 创建 Termux 执行器
 */
export function createTermuxExecutor(
  config?: Partial<TermuxExecutorConfig>,
): TermuxExecutor {
  return new TermuxExecutor(config);
}
