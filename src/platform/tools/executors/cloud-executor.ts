/**
 * 跨平台工具执行器 - 云端执行器
 *
 * KURISU-019 Phase 2: 将命令发送到云端 Kurisu 服务器执行
 *
 * 用于无法本地执行的场景：
 * - iOS 设备
 * - 受限环境（无 Docker、无沙箱）
 * - 需要更多资源的任务
 */

import type { PermissionLevel } from "../types";
import type {
  ToolExecutor,
  ExecutorCapabilities,
  ExecuteOptions,
  ExecuteResult,
  CloudExecutorConfig,
} from "./types";
import { detectPlatform } from "./platform";
import { checkDangerousCommand } from "./security";

/**
 * 默认云端执行器配置
 */
const DEFAULT_CLOUD_CONFIG: CloudExecutorConfig = {
  endpoint: "https://api.kurisu.ai/v1/execute",
  apiKey: "",
  timeout: 60000, // 云端执行需要更长超时
};

/**
 * 云端执行请求
 */
interface CloudExecuteRequest {
  /** 命令 */
  readonly command: string;
  /** 权限级别 */
  readonly permission: PermissionLevel;
  /** 是否允许网络 */
  readonly networkAccess: boolean;
  /** 超时时间（毫秒） */
  readonly timeout: number;
  /** 工作目录 */
  readonly workingDir: string;
  /** 环境变量 */
  readonly env?: Record<string, string>;
  /** 是否已审批 */
  readonly approved?: boolean;
}

/**
 * 云端执行响应
 */
interface CloudExecuteResponse {
  /** 是否成功 */
  readonly success: boolean;
  /** 标准输出 */
  readonly stdout: string;
  /** 标准错误 */
  readonly stderr: string;
  /** 退出码 */
  readonly exitCode: number;
  /** 执行耗时（毫秒） */
  readonly latency: number;
  /** 是否超时 */
  readonly timedOut?: boolean;
  /** 错误信息 */
  readonly error?: string;
}

/**
 * 云端执行器
 *
 * 通过 HTTP API 将命令发送到云端服务器执行：
 * - 支持所有权限级别
 * - 使用 API Key 认证
 * - 自动处理超时
 */
export class CloudExecutor implements ToolExecutor {
  private readonly config: CloudExecutorConfig;

  constructor(config: Partial<CloudExecutorConfig> = {}) {
    this.config = {
      ...DEFAULT_CLOUD_CONFIG,
      ...config,
    };
  }

  /**
   * 检查云端执行器是否可用
   *
   * 需要：
   * 1. 配置了 API endpoint
   * 2. 配置了 API Key
   */
  static isAvailable(config?: CloudExecutorConfig): boolean {
    const finalConfig = {
      ...DEFAULT_CLOUD_CONFIG,
      ...config,
    };
    return finalConfig.endpoint.length > 0 && finalConfig.apiKey.length > 0;
  }

  /**
   * 执行命令
   */
  async execute(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    const startTime = Date.now();
    const timeout = options.timeout ?? this.config.timeout ?? 60000;

    // 验证配置
    if (!this.config.apiKey) {
      return {
        success: false,
        stdout: "",
        stderr: "Cloud executor requires API key",
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "cloud",
      };
    }

    if (!this.config.endpoint) {
      return {
        success: false,
        stdout: "",
        stderr: "Cloud executor requires endpoint",
        exitCode: 126,
        latency: Date.now() - startTime,
        executorType: "cloud",
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
        executorType: "cloud",
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
        executorType: "cloud",
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
        executorType: "cloud",
      };
    }

    try {
      // 发送请求到云端
      const response = await this.sendRequest({
        command,
        permission: options.permission,
        networkAccess: options.networkAccess ?? false,
        timeout,
        workingDir: options.workingDir,
        ...(options.env ? { env: options.env } : {}),
        ...(options.approved !== undefined
          ? { approved: options.approved }
          : {}),
      });

      return {
        success: response.success,
        stdout: response.stdout,
        stderr: response.stderr,
        exitCode: response.exitCode,
        latency: Date.now() - startTime,
        executorType: "cloud",
        ...(response.timedOut !== undefined
          ? { timedOut: response.timedOut }
          : {}),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        stdout: "",
        stderr: `Cloud execution failed: ${errorMessage}`,
        exitCode: 1,
        latency: Date.now() - startTime,
        executorType: "cloud",
      };
    }
  }

  /**
   * 发送请求到云端
   */
  private async sendRequest(
    request: CloudExecuteRequest,
  ): Promise<CloudExecuteResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), request.timeout);

    try {
      const response = await fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "User-Agent": "Kurisu-CloudExecutor/1.0",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as CloudExecuteResponse;
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 获取执行器能力
   */
  getCapabilities(): ExecutorCapabilities {
    return {
      platform: detectPlatform().platform,
      isolation: "cloud",
      supportedPermissions: ["safe", "confirm"],
      networkIsolation: true, // 云端支持网络隔离
      maxMemory: 1024, // 云端有更大的内存限制
      supportsApproval: true,
    };
  }

  /**
   * 检查特定权限是否可用
   */
  supportsPermission(level: PermissionLevel): boolean {
    return level === "safe" || level === "confirm";
  }

  /**
   * 健康检查
   *
   * 检查云端服务是否可用
   */
  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey || !this.config.endpoint) {
      return false;
    }

    try {
      // 发送简单的健康检查请求
      const response = await fetch(
        `${this.config.endpoint.replace(/\/execute$/, "/health")}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        },
      );

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<CloudExecutorConfig> {
    return this.config;
  }
}

/**
 * 创建云端执行器
 */
export function createCloudExecutor(
  config?: Partial<CloudExecutorConfig>,
): CloudExecutor {
  return new CloudExecutor(config);
}
