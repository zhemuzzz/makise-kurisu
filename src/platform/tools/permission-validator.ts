/**
 * PermissionValidator - 权限验证器
 *
 * KURISU-019 Phase 3.3: 运行时权限检查
 * KURISU-023 Phase 2: 操作安全增强
 *
 * 负责:
 * 1. 验证角色配置中的权限级别
 * 2. 验证请求的操作是否在允许范围内
 * 3. 检查路径访问权限
 * 4. 检查网络访问权限
 * 5. 删除操作永远需要确认（即使 full_access 模式）
 * 6. 支持用户可配置的敏感路径黑名单
 */

import path from "path";
import os from "os";
import type { RoleToolConfig } from "../models/executor-types.js";
import type { PermissionLevel } from "./types.js";

/**
 * 操作类型
 */
export type OperationType =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "shell"
  | "network"
  | "browser"
  | "screenshot"
  | "memory_read";

/**
 * 权限验证结果
 */
export interface PermissionValidationResult {
  /** 是否允许 */
  readonly allowed: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 拒绝原因（如果不允许） */
  readonly reason?: string;
  /** 风险等级 */
  readonly riskLevel: "low" | "medium" | "high" | "critical";
}

/**
 * 权限验证器配置
 */
export interface PermissionValidatorConfig {
  /** 默认角色工具配置 */
  readonly defaultConfig?: RoleToolConfig;
  /** 沙箱工作目录 */
  readonly sandboxDir?: string;
  /** 敏感路径黑名单（用户可配置） */
  readonly denyPaths?: readonly string[];
}

/**
 * 权限验证器
 *
 * 根据 RoleToolConfig 验证操作权限
 */
export class PermissionValidator {
  private readonly defaultConfig: RoleToolConfig;
  private readonly sandboxDir: string;
  private readonly denyPaths: readonly string[];

  constructor(config: PermissionValidatorConfig = {}) {
    this.defaultConfig = config.defaultConfig ?? {
      filePermission: "sandbox",
      networkAccess: false,
    };
    this.sandboxDir =
      config.sandboxDir ?? path.join(os.tmpdir(), "kurisu-workspace");
    this.denyPaths = config.denyPaths ?? [];
  }

  /**
   * 验证操作权限
   *
   * @param operation 操作类型
   * @param roleConfig 角色工具配置
   * @param targetPath 目标路径（可选，用于文件操作）
   * @param options 额外选项
   * @param options.skipDeleteConfirmation 是否跳过删除确认（会话级设置）
   * @returns 权限验证结果
   */
  validate(
    operation: OperationType,
    roleConfig: RoleToolConfig = this.defaultConfig,
    targetPath?: string,
    options?: { skipDeleteConfirmation?: boolean },
  ): PermissionValidationResult {
    // KURISU-023: 检查敏感路径黑名单
    if (targetPath && this.isPathOperation(operation)) {
      const denyCheck = this.checkDenyPath(targetPath);
      if (denyCheck) {
        return denyCheck;
      }
    }

    // KURISU-023 方案B: 删除操作需要确认，除非会话级已关闭
    if (operation === "file_delete") {
      const baseResult = this.validateByPermissionLevel(
        operation,
        roleConfig,
        targetPath,
      );

      // 如果用户已明确确认风险并关闭删除确认，则跳过
      if (options?.skipDeleteConfirmation === true) {
        return {
          ...baseResult,
          requiresApproval: false, // 会话级已关闭确认
          riskLevel: "high", // 仍保持高风险标记
        };
      }

      return {
        ...baseResult,
        requiresApproval: true, // 默认需要确认
        riskLevel: "high",
      };
    }

    // 根据权限级别检查
    return this.validateByPermissionLevel(operation, roleConfig, targetPath);
  }

  /**
   * 根据权限级别验证
   */
  private validateByPermissionLevel(
    operation: OperationType,
    roleConfig: RoleToolConfig,
    targetPath?: string,
  ): PermissionValidationResult {
    switch (roleConfig.filePermission) {
      case "sandbox":
        return this.validateSandbox(operation, roleConfig, targetPath);
      case "restricted":
        return this.validateRestricted(operation, roleConfig, targetPath);
      case "full_access":
        return this.validateFullAccess(operation, roleConfig);
      default:
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Unknown permission level: ${roleConfig.filePermission as string}`,
          riskLevel: "critical",
        };
    }
  }

  /**
   * 检查路径是否在黑名单中
   */
  private checkDenyPath(targetPath: string): PermissionValidationResult | null {
    const expandedTarget = this.expandPath(targetPath);

    for (const deniedPath of this.denyPaths) {
      const expandedDenied = this.expandPath(deniedPath);

      if (expandedTarget.startsWith(expandedDenied)) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `路径 "${targetPath}" 在保护列表中，如需操作请先移除保护`,
          riskLevel: "critical",
        };
      }
    }

    return null;
  }

  /**
   * 添加敏感路径到黑名单
   */
  addDenyPath(pathToAdd: string): void {
    // 注意：这是一个 mutable 操作，但为了实用性必须如此
    // 实际使用时应该通过配置文件管理
    (this.denyPaths as string[]).push(pathToAdd);
  }

  /**
   * 从黑名单移除敏感路径
   */
  removeDenyPath(pathToRemove: string): boolean {
    const index = this.denyPaths.findIndex(
      (p) => this.expandPath(p) === this.expandPath(pathToRemove),
    );
    if (index >= 0) {
      (this.denyPaths as string[]).splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * 获取当前黑名单
   */
  getDenyPaths(): readonly string[] {
    return [...this.denyPaths];
  }

  /**
   * 验证沙箱模式权限
   */
  private validateSandbox(
    operation: OperationType,
    roleConfig: RoleToolConfig,
    targetPath?: string,
  ): PermissionValidationResult {
    // 检查网络访问
    if (operation === "network" && !roleConfig.networkAccess) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: "Network access is disabled in sandbox mode",
        riskLevel: "high",
      };
    }

    // 检查路径是否在沙箱内
    if (targetPath && this.isPathOperation(operation)) {
      const expandedPath = this.expandPath(targetPath);
      const expandedSandbox = this.expandPath(this.sandboxDir);

      if (!expandedPath.startsWith(expandedSandbox)) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Path "${targetPath}" is outside sandbox directory`,
          riskLevel: "medium",
        };
      }
    }

    // 沙箱模式下的写操作需要审批
    if (this.isWriteOperation(operation)) {
      return {
        allowed: true,
        requiresApproval: true,
        riskLevel: "low",
      };
    }

    // 读取操作直接允许
    return {
      allowed: true,
      requiresApproval: false,
      riskLevel: "low",
    };
  }

  /**
   * 验证受限模式权限
   */
  private validateRestricted(
    operation: OperationType,
    roleConfig: RoleToolConfig,
    targetPath?: string,
  ): PermissionValidationResult {
    // 检查网络访问
    if (operation === "network" && !roleConfig.networkAccess) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: "Network access is disabled",
        riskLevel: "high",
      };
    }

    // 检查路径是否在允许列表内
    if (targetPath && this.isPathOperation(operation)) {
      const allowedPaths = roleConfig.allowedPaths ?? [];

      if (!this.isPathAllowed(targetPath, allowedPaths)) {
        return {
          allowed: false,
          requiresApproval: false,
          reason: `Path "${targetPath}" is not in allowed paths`,
          riskLevel: "medium",
        };
      }
    }

    // 检查是否需要审批
    const requireConfirmation = roleConfig.requireConfirmation ?? [];
    const needsApproval =
      requireConfirmation.includes(operation) ||
      requireConfirmation.includes("*");

    // 写操作需要审批
    if (this.isWriteOperation(operation)) {
      return {
        allowed: true,
        requiresApproval: true,
        riskLevel: "medium",
      };
    }

    return {
      allowed: true,
      requiresApproval: needsApproval,
      riskLevel: "low",
    };
  }

  /**
   * 验证完全访问模式权限
   */
  private validateFullAccess(
    operation: OperationType,
    roleConfig: RoleToolConfig,
  ): PermissionValidationResult {
    // 检查网络访问
    if (operation === "network" && !roleConfig.networkAccess) {
      return {
        allowed: false,
        requiresApproval: false,
        reason: "Network access is disabled",
        riskLevel: "high",
      };
    }

    // 完全访问模式下操作需要审批（但风险等级不同）
    return {
      allowed: true,
      requiresApproval: true,
      riskLevel: this.getOperationRiskLevel(operation),
    };
  }

  /**
   * 检查路径是否允许访问
   */
  private isPathAllowed(
    targetPath: string,
    allowedPaths: readonly string[],
  ): boolean {
    const expandedTarget = this.expandPath(targetPath);

    for (const allowedPath of allowedPaths) {
      const expandedAllowed = this.expandPath(allowedPath);

      // 检查目标路径是否在允许路径下
      if (expandedTarget.startsWith(expandedAllowed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 展开路径中的 ~ 为用户主目录
   */
  private expandPath(p: string): string {
    if (p.startsWith("~/")) {
      return path.join(os.homedir(), p.slice(2));
    }
    return path.resolve(p);
  }

  /**
   * 检查是否是路径操作
   */
  private isPathOperation(operation: OperationType): boolean {
    return ["file_read", "file_write", "file_delete"].includes(operation);
  }

  /**
   * 检查是否是写操作
   */
  private isWriteOperation(operation: OperationType): boolean {
    return ["file_write", "file_delete", "shell"].includes(operation);
  }

  /**
   * 获取操作风险等级
   */
  private getOperationRiskLevel(
    operation: OperationType,
  ): "low" | "medium" | "high" | "critical" {
    const riskLevels: Record<
      OperationType,
      "low" | "medium" | "high" | "critical"
    > = {
      file_read: "low",
      file_write: "medium",
      file_delete: "high",
      shell: "high",
      network: "medium",
      browser: "medium",
      screenshot: "low",
      memory_read: "low",
    };
    return riskLevels[operation] ?? "medium";
  }

  /**
   * 获取工具的权限级别（从 safe/confirm/deny 映射）
   */
  getToolPermissionLevel(toolName: string): PermissionLevel {
    // 安全工具
    const safeTools = [
      "web_search",
      "fetch",
      "file_read",
      "time",
      "screenshot",
      "memory_read",
    ];

    // 需要确认的工具
    const confirmTools = [
      "shell",
      "file_write",
      "file_delete",
      "browser",
      "computer_use",
    ];

    if (safeTools.includes(toolName)) {
      return "safe";
    }

    if (confirmTools.includes(toolName)) {
      return "confirm";
    }

    // 未知工具默认需要确认
    return "confirm";
  }

  /**
   * 将工具名映射到操作类型
   */
  mapToolToOperation(toolName: string): OperationType {
    const mapping: Record<string, OperationType> = {
      file_read: "file_read",
      file_write: "file_write",
      file_delete: "file_delete",
      shell: "shell",
      browser: "browser",
      screenshot: "screenshot",
      web_search: "network",
      fetch: "network",
      memory_read: "memory_read",
    };

    return mapping[toolName] ?? "shell";
  }

  /**
   * 验证 Shell 命令是否包含危险操作
   */
  validateShellCommand(command: string): PermissionValidationResult {
    // 危险命令模式
    const dangerousPatterns = [
      {
        pattern: /\brm\s+-rf\b/,
        level: "critical" as const,
        reason: "Recursive force delete",
      },
      {
        pattern: /\bdd\s+if=/,
        level: "critical" as const,
        reason: "Disk overwrite",
      },
      {
        pattern: /\bmkfs\b/,
        level: "critical" as const,
        reason: "Format disk",
      },
      {
        pattern: />\s*\/dev\//,
        level: "critical" as const,
        reason: "Write to device",
      },
      {
        pattern: /\bchmod\s+777\b/,
        level: "high" as const,
        reason: "Dangerous permissions",
      },
      {
        pattern: /\bsudo\b/,
        level: "high" as const,
        reason: "Privilege escalation",
      },
      { pattern: /\brm\b/, level: "medium" as const, reason: "Delete command" },
      { pattern: /\bmv\b/, level: "medium" as const, reason: "Move command" },
    ];

    for (const { pattern, level, reason } of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          allowed: true,
          requiresApproval: true,
          reason: `Dangerous command detected: ${reason}`,
          riskLevel: level,
        };
      }
    }

    return {
      allowed: true,
      requiresApproval: false,
      riskLevel: "low",
    };
  }
}

/**
 * 创建权限验证器实例
 */
export function createPermissionValidator(
  config?: PermissionValidatorConfig,
): PermissionValidator {
  return new PermissionValidator(config);
}
