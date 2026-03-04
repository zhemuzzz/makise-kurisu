/**
 * 跨平台工具执行器 - 进程执行器
 *
 * KURISU-019 Phase 2: 在本地进程中执行命令，使用系统级隔离
 *
 * 平台支持：
 * - macOS: sandbox-exec 原生沙箱
 * - Windows: Job Object（简化实现）
 * - Linux: 直接执行（无隔离，仅限安全命令）
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "crypto";
import type { PermissionLevel } from "../types";
import type {
  ToolExecutor,
  ExecutorCapabilities,
  ExecuteOptions,
  ExecuteResult,
  ProcessExecutorConfig,
} from "./types";
import { DEFAULT_PROCESS_CONFIG } from "./types";
import { detectPlatform } from "./platform";
import {
  filterSensitiveEnvVars,
  validateAllowedPaths,
  validateCommandSecurity,
} from "./security";

/**
 * 进程权限级别
 *
 * - sandbox: 严格沙箱隔离（只读文件系统，无网络）
 * - restricted: 受限执行（可访问指定目录，无网络）
 * - full_access: 完全访问（需要审批）
 */
type ProcessPermission = "sandbox" | "restricted" | "full_access";

/**
 * 权限级别映射到进程权限
 */
function mapPermissionLevel(level: PermissionLevel): ProcessPermission {
  switch (level) {
    case "safe":
      return "sandbox";
    case "confirm":
      return "restricted";
    case "deny":
      return "sandbox"; // deny 不执行，但如果执行则用最严格模式
    default:
      return "sandbox";
  }
}

/**
 * 进程执行器
 *
 * 根据平台使用不同的隔离技术：
 * - macOS: sandbox-exec ( Seatbelt )
 * - Windows: Job Object (简化实现)
 * - Linux: 直接执行 (无隔离)
 */
export class ProcessExecutor implements ToolExecutor {
  private readonly config: ProcessExecutorConfig;

  constructor(config: Partial<ProcessExecutorConfig> = {}) {
    this.config = {
      ...DEFAULT_PROCESS_CONFIG,
      ...config,
    };
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

    // 验证权限级别
    const processPermission = mapPermissionLevel(options.permission);

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

    // full_access 需要审批
    if (processPermission === "full_access" && !options.approved) {
      return {
        success: false,
        stdout: "",
        stderr: "full_access level requires approval",
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "process",
      };
    }

    // deny 级别始终拒绝
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

    // 综合安全检查（危险命令 + shell 元字符）
    const securityCheck = validateCommandSecurity(command);
    if (!securityCheck.safe) {
      const allWarnings = [
        ...securityCheck.dangerousWarnings,
        ...securityCheck.shellIssues.issues.map(
          (i) => `${i.description} (${i.severity})`,
        ),
      ];
      return {
        success: false,
        stdout: "",
        stderr: `Security violation: ${allWarnings.join("; ")}`,
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "process",
      };
    }

    // 对于 high 风险的 shell 元字符，在非 full_access 模式下也阻止
    if (
      securityCheck.shellIssues.hasHigh &&
      processPermission !== "full_access"
    ) {
      return {
        success: false,
        stdout: "",
        stderr: `High-risk shell patterns require full_access approval: ${securityCheck.shellIssues.issues
          .filter((i) => i.severity === "high")
          .map((i) => i.description)
          .join(", ")}`,
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "process",
      };
    }

    // 根据平台选择执行方式
    const platformInfo = detectPlatform();

    try {
      let result: ExecuteResult;

      if (platformInfo.platform === "macos") {
        result = await this.executeWithSandboxExec(command, options, timeout);
      } else if (platformInfo.platform === "windows") {
        result = await this.executeWithJobObject(command, options, timeout);
      } else {
        // Linux 和其他平台直接执行
        result = await this.executeDirect(command, options, timeout);
      }

      return result;
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
   * macOS: 使用 sandbox-exec 执行
   *
   * sandbox-exec 是 macOS 的原生沙箱机制，使用 Seatbelt 规则
   */
  private async executeWithSandboxExec(
    command: string,
    options: ExecuteOptions,
    timeout: number,
  ): Promise<ExecuteResult> {
    // 构建 sandbox profile
    const sandboxProfile = this.buildSandboxProfile(options);

    // 创建临时 profile 文件（使用随机 UUID 防止预测攻击）
    const profilePath = path.join(
      os.tmpdir(),
      `kurisu-sandbox-${Date.now()}-${randomUUID()}.sb`,
    );

    try {
      fs.writeFileSync(profilePath, sandboxProfile, "utf-8");

      // 使用 sandbox-exec 执行
      const args = ["-f", profilePath, "sh", "-c", command];

      return await this.runProcess("sandbox-exec", args, options, timeout);
    } finally {
      // 清理临时文件
      try {
        fs.unlinkSync(profilePath);
      } catch {
        // 忽略清理错误
      }
    }
  }

  /**
   * 构建 macOS sandbox profile (Seatbelt 规则)
   */
  private buildSandboxProfile(options: ExecuteOptions): string {
    const processPermission = mapPermissionLevel(options.permission);
    const { workingDir, networkAccess } = options;

    // 基础规则：允许执行
    const rules: string[] = [
      "(version 1)",
      "(deny default)",
      "(allow process-exec)",
      "(allow sysctl-read)",
      '(allow file-read-data (literal "/dev/null"))',
      '(allow file-write-data (literal "/dev/null"))',
    ];

    // 允许基本库读取
    rules.push(
      '(allow file-read-data (subpath "/usr/lib"))',
      '(allow file-read-data (subpath "/usr/share"))',
      '(allow file-read-data (subpath "/System/Library"))',
    );

    // 允许临时目录写入
    rules.push(
      `(allow file-read-data (subpath "${os.tmpdir()}"))`,
      `(allow file-write-data (subpath "${os.tmpdir()}"))`,
    );

    // 工作目录访问
    if (processPermission === "sandbox") {
      // sandbox: 只读访问
      rules.push(`(allow file-read-data (subpath "${workingDir}"))`);
    } else if (processPermission === "restricted") {
      // restricted: 读写访问指定目录
      rules.push(
        `(allow file-read-data (subpath "${workingDir}"))`,
        `(allow file-write-data (subpath "${workingDir}"))`,
      );

      // 验证并添加额外允许的路径
      if (this.config.allowedPaths) {
        const { valid } = validateAllowedPaths(this.config.allowedPaths);
        for (const p of valid) {
          rules.push(
            `(allow file-read-data (subpath "${p}"))`,
            `(allow file-write-data (subpath "${p}"))`,
          );
        }
      }
    } else if (processPermission === "full_access") {
      // full_access: 完全文件系统访问
      rules.push("(allow file-read-data)", "(allow file-write-data)");
    }

    // 网络访问
    if (networkAccess) {
      rules.push("(allow network-outbound)");
    }

    return rules.join("\n");
  }

  /**
   * Windows: 使用 Job Object 执行（简化实现）
   *
   * 注意：这是一个简化实现，仅通过进程限制来提供基本隔离
   * 完整的 Job Object 实现需要 native 模块
   */
  private async executeWithJobObject(
    command: string,
    options: ExecuteOptions,
    timeout: number,
  ): Promise<ExecuteResult> {
    const processPermission = mapPermissionLevel(options.permission);

    // Windows 简化实现：直接执行，但限制工作目录
    // 真正的 Job Object 隔离需要 native addon 或外部工具
    if (processPermission === "full_access") {
      // full_access: 直接执行
      return await this.runProcess(
        "cmd.exe",
        ["/c", command],
        options,
        timeout,
      );
    }

    // sandbox/restricted: 限制在工作目录
    const restrictedOptions: ExecuteOptions = {
      ...options,
      workingDir: options.workingDir,
    };

    // 在 Windows 上，我们通过设置工作目录来提供基本隔离
    return await this.runProcess(
      "cmd.exe",
      ["/c", command],
      restrictedOptions,
      timeout,
    );
  }

  /**
   * Linux: 直接执行（无系统级隔离）
   *
   * 注意：Linux 上没有原生沙箱机制（除非使用 namespaces/cgroups）
   * 这里仅提供基本的安全检查
   */
  private async executeDirect(
    command: string,
    options: ExecuteOptions,
    timeout: number,
  ): Promise<ExecuteResult> {
    const processPermission = mapPermissionLevel(options.permission);

    // full_access 且已审批：直接执行
    if (processPermission === "full_access" && options.approved) {
      return await this.runProcess("sh", ["-c", command], options, timeout);
    }

    // sandbox/restricted: 限制在工作目录执行
    return await this.runProcess("sh", ["-c", command], options, timeout);
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

      // 过滤敏感环境变量（严格模式，仅白名单）
      // 不继承 process.env，只使用显式允许的变量
      const filteredUserEnv = options.env
        ? filterSensitiveEnvVars(options.env, "strict")
        : {};

      // 合并环境变量：先过滤系统变量，再添加用户变量
      const mergedEnv: Record<string, string> = {
        ...filterSensitiveEnvVars(
          process.env as Record<string, string>,
          "strict",
        ),
        ...filteredUserEnv,
      };

      const proc = spawn(program, args, {
        cwd: options.workingDir,
        env: mergedEnv,
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
    const platformInfo = detectPlatform();

    // 根据平台设置能力
    const networkIsolation = platformInfo.platform === "macos"; // 只有 macOS 支持网络隔离
    const supportedPermissions: PermissionLevel[] = ["safe", "confirm"];

    // 如果允许完全访问，添加 full_access 支持
    if (this.config.allowFullAccess) {
      // full_access 映射到 confirm（需要审批）
      supportedPermissions.push("confirm");
    }

    return {
      platform: platformInfo.platform,
      isolation: "process",
      supportedPermissions,
      networkIsolation,
      maxMemory: 0, // 无限制
      supportsApproval: this.config.allowFullAccess ?? false,
    };
  }

  /**
   * 检查特定权限是否可用
   */
  supportsPermission(level: PermissionLevel): boolean {
    const capabilities = this.getCapabilities();
    return capabilities.supportedPermissions.includes(level);
  }

  /**
   * 健康检查
   *
   * 进程执行器始终可用
   */
  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<ProcessExecutorConfig> {
    return this.config;
  }
}

/**
 * 创建进程执行器
 */
export function createProcessExecutor(
  config?: Partial<ProcessExecutorConfig>,
): ProcessExecutor {
  return new ProcessExecutor(config);
}
