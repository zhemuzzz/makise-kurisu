/**
 * 跨平台工具执行器 - 类型定义
 *
 * KURISU-019 Phase 1: 定义统一的执行器接口
 */

import type { PermissionLevel } from "../types.js";

// ============================================
// 平台类型
// ============================================

/**
 * 支持的平台类型
 */
export type Platform = "linux" | "macos" | "windows" | "android" | "ios";

/**
 * 隔离类型
 */
export type IsolationType = "docker" | "process" | "cloud" | "none";

// ============================================
// 执行器能力
// ============================================

/**
 * 执行器能力描述
 */
export interface ExecutorCapabilities {
  /** 运行平台 */
  readonly platform: Platform;
  /** 隔离类型 */
  readonly isolation: IsolationType;
  /** 支持的权限级别 */
  readonly supportedPermissions: readonly PermissionLevel[];
  /** 是否支持网络隔离 */
  readonly networkIsolation: boolean;
  /** 最大内存限制（MB），0 = 无限制 */
  readonly maxMemory: number;
  /** 是否支持审批流程 */
  readonly supportsApproval: boolean;
}

// ============================================
// 执行选项和结果
// ============================================

/**
 * 卷映射
 */
export interface VolumeMapping {
  /** 主机路径 */
  readonly hostPath: string;
  /** 容器路径 */
  readonly containerPath: string;
  /** 是否只读 */
  readonly readOnly: boolean;
}

/**
 * 执行选项
 */
export interface ExecuteOptions {
  /** 权限级别 */
  readonly permission: PermissionLevel;
  /** 是否允许网络访问 */
  readonly networkAccess: boolean;
  /** 超时时间（毫秒） */
  readonly timeout: number;
  /** 工作目录 */
  readonly workingDir: string;
  /** 环境变量 */
  readonly env?: Record<string, string>;
  /** 卷映射 */
  readonly volumes?: readonly VolumeMapping[];
  /** 是否已审批（用于 confirm 级工具） */
  readonly approved?: boolean;
}

/**
 * 执行结果
 */
export interface ExecuteResult {
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
  /** 执行器类型 */
  readonly executorType: IsolationType;
  /** 是否超时 */
  readonly timedOut?: boolean;
}

// ============================================
// 执行器接口
// ============================================

/**
 * 工具执行器接口
 *
 * 所有执行器必须实现此接口，提供统一的工具调用能力
 */
export interface ToolExecutor {
  /**
   * 执行命令
   * @param command 要执行的命令
   * @param options 执行选项
   * @returns 执行结果
   */
  execute(command: string, options: ExecuteOptions): Promise<ExecuteResult>;

  /**
   * 获取执行器能力
   */
  getCapabilities(): ExecutorCapabilities;

  /**
   * 检查特定权限是否可用
   */
  supportsPermission(level: PermissionLevel): boolean;

  /**
   * 健康检查
   */
  healthCheck(): Promise<boolean>;

  /**
   * 清理资源（可选）
   */
  cleanup?(): Promise<void>;
}

// ============================================
// 执行器配置
// ============================================

/**
 * Docker 执行器配置
 */
export interface DockerExecutorConfig {
  /** Docker 镜像 */
  readonly image: string;
  /** 沙箱目录 */
  readonly sandboxDir: string;
  /** 允许访问的路径 */
  readonly allowedPaths?: readonly string[];
  /** 内存限制（MB） */
  readonly memoryLimit?: number;
  /** CPU 限制（0-1） */
  readonly cpuLimit?: number;
  /** 默认超时（毫秒） */
  readonly timeout?: number;
  /** Docker 连接选项 */
  readonly dockerOptions?: Record<string, unknown>;
}

/**
 * Process 执行器配置
 */
export interface ProcessExecutorConfig {
  /** 允许访问的路径 */
  readonly allowedPaths?: readonly string[];
  /** 是否允许完全访问 */
  readonly allowFullAccess?: boolean;
  /** 默认超时（毫秒） */
  readonly timeout?: number;
}

/**
 * Termux 执行器配置
 */
export interface TermuxExecutorConfig {
  /** proot rootfs 路径 */
  readonly rootfs: string;
  /** 默认超时（毫秒） */
  readonly timeout?: number;
}

/**
 * Cloud 执行器配置
 */
export interface CloudExecutorConfig {
  /** 云端 API 端点 */
  readonly endpoint: string;
  /** API Key */
  readonly apiKey: string;
  /** 默认超时（毫秒） */
  readonly timeout?: number;
}

/**
 * 执行器配置（联合类型）
 */
export interface ExecutorConfig {
  /** 首选执行器类型 */
  readonly prefer?: "docker" | "process" | "cloud";
  /** Docker 配置 */
  readonly docker?: DockerExecutorConfig;
  /** Process 配置 */
  readonly process?: ProcessExecutorConfig;
  /** Termux 配置 */
  readonly termux?: TermuxExecutorConfig;
  /** Cloud 配置 */
  readonly cloud?: CloudExecutorConfig;
}

// ============================================
// 默认配置
// ============================================

/**
 * 默认 Docker 执行器配置
 */
export const DEFAULT_DOCKER_CONFIG: DockerExecutorConfig = {
  image: "kurisu-sandbox:latest",
  sandboxDir: "/tmp/kurisu-workspace",
  memoryLimit: 512,
  cpuLimit: 0.5,
  timeout: 30000,
};

/**
 * 默认 Process 执行器配置
 */
export const DEFAULT_PROCESS_CONFIG: ProcessExecutorConfig = {
  allowFullAccess: false,
  timeout: 30000,
};

/**
 * 默认执行选项
 */
export const DEFAULT_EXECUTE_OPTIONS: Omit<ExecuteOptions, "workingDir"> = {
  permission: "safe",
  networkAccess: false,
  timeout: 30000,
};
