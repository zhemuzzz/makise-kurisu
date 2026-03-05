/**
 * 执行器配置 - 类型定义
 *
 * KURISU-019 Phase 3: 定义执行器配置相关的类型
 */

import type {
  Platform,
  DockerExecutorConfig,
  CloudExecutorConfig,
} from "../tools/executors/types.js";

// ============================================
// 权限级别（扩展自任务文档的三级权限）
// ============================================

/**
 * 文件权限级别
 *
 * - sandbox: 只能访问隔离的沙箱目录，最安全
 * - restricted: 可访问指定的用户文件夹
 * - full_access: 可操作整个电脑（危险）
 */
export type FilePermissionLevel = "sandbox" | "restricted" | "full_access";

/**
 * 权限级别配置
 */
export interface PermissionLevelConfig {
  /** 权限级别说明 */
  readonly description: string;
  /** 文件访问类型 */
  readonly fileAccess: "isolated" | "user_dirs" | "full";
  /** 是否允许网络访问 */
  readonly networkAccess: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 警告信息（可选） */
  readonly warning?: string;
}

// ============================================
// 平台特定配置
// ============================================

/**
 * 平台降级配置
 */
export interface FallbackConfig {
  /** 降级执行器类型 */
  readonly type: "process" | "cloud";
  /** 是否允许完全访问 */
  readonly allowFullAccess?: boolean;
  /** 隔离方式（macOS: sandbox-exec, Windows: job-object） */
  readonly isolation?: "sandbox-exec" | "job-object" | "proot" | "none";
}

/**
 * 平台配置
 */
export interface PlatformConfig {
  /** 首选执行器 */
  readonly prefer?: "docker" | "process" | "cloud";
  /** 降级配置 */
  readonly fallback?: FallbackConfig;
  /** 工作目录（Android Termux） */
  readonly workspace?: string;
  /** 云端端点（iOS） */
  readonly endpoint?: string;
}

// ============================================
// 完整执行器配置
// ============================================

/**
 * 审批配置
 */
export interface ApprovalConfig {
  /** 审批超时（毫秒） */
  readonly timeout: number;
  /** 超时是否自动拒绝 */
  readonly autoRejectOnTimeout: boolean;
  /** 高风险操作是否需要用户说明原因 */
  readonly criticalRequiresReason: boolean;
}

/**
 * 受限模式配置
 */
export interface RestrictedConfig {
  /** 允许访问的路径 */
  readonly allowedPaths: readonly string[];
}

/**
 * 执行器系统配置
 *
 * 对应 config/system/executor.yaml
 */
export interface ExecutorSystemConfig {
  /** 是否自动检测最优执行器 */
  readonly autoDetect: boolean;
  /** 手动指定执行器类型（覆盖自动检测） */
  readonly executor?: "docker" | "process" | "cloud";
  /** 平台特定配置 */
  readonly platforms: Partial<Record<Platform, PlatformConfig>>;
  /** Docker 配置 */
  readonly docker: DockerExecutorConfig;
  /** 云端配置 */
  readonly cloud: CloudExecutorConfig;
  /** 默认文件权限级别 */
  readonly defaultPermission: FilePermissionLevel;
  /** 受限模式配置 */
  readonly restricted: RestrictedConfig;
  /** 审批配置 */
  readonly approval: ApprovalConfig;
}

// ============================================
// 角色工具配置
// ============================================

/**
 * 角色工具配置
 *
 * 对应 config/personas/{role}/role.yaml 的 tools 字段
 */
export interface RoleToolConfig {
  /** 文件操作权限级别 */
  readonly filePermission: FilePermissionLevel;
  /** 是否允许联网 */
  readonly networkAccess: boolean;
  /** 允许访问的路径（restricted 模式） */
  readonly allowedPaths?: readonly string[];
  /** 需要审批的操作 */
  readonly requireConfirmation?: readonly string[];
}

// ============================================
// 默认配置
// ============================================

/**
 * 默认权限级别配置
 */
export const DEFAULT_PERMISSION_LEVELS: Record<
  FilePermissionLevel,
  PermissionLevelConfig
> = {
  sandbox: {
    description: "只能访问隔离的沙箱目录，最安全",
    fileAccess: "isolated",
    networkAccess: false,
    requiresApproval: false,
  },
  restricted: {
    description: "可访问您指定的文件夹",
    fileAccess: "user_dirs",
    networkAccess: false,
    requiresApproval: true, // 写操作需要审批
  },
  full_access: {
    description: "可操作整个电脑（危险）",
    fileAccess: "full",
    networkAccess: true,
    requiresApproval: true, // 所有操作都需要审批
    warning: "任何操作都可能影响系统文件",
  },
};

/**
 * 默认审批配置
 */
export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  timeout: 30000,
  autoRejectOnTimeout: true,
  criticalRequiresReason: false,
};

/**
 * 默认受限模式配置
 */
export const DEFAULT_RESTRICTED_CONFIG: RestrictedConfig = {
  allowedPaths: ["~/Documents", "~/Projects"],
};

/**
 * 默认角色工具配置
 */
export const DEFAULT_ROLE_TOOL_CONFIG: RoleToolConfig = {
  filePermission: "sandbox",
  networkAccess: false,
};
