/**
 * 工具权限检查器
 *
 * 根据 three-tier 权限模型检查工具权限
 */

import type { PermissionLevel, ToolPermissionConfig } from "./types";
import { DEFAULT_TOOL_SYSTEM_CONFIG } from "./types";

/**
 * 权限检查结果
 */
export interface PermissionCheckResult {
  /** 权限级别 */
  level: PermissionLevel;
  /** 是否允许 */
  allowed: boolean;
  /** 是否需要审批 */
  requiresApproval: boolean;
  /** 拒绝原因 */
  reason?: string;
}

/**
 * 权限检查器配置
 */
export interface PermissionCheckerConfig {
  /** 权限配置 */
  permissions?: ToolPermissionConfig;
  /** 角色工具白名单（可选） */
  roleAllowedTools?: string[];
}

/**
 * 工具权限检查器
 *
 * 负责:
 * 1. 检查工具权限级别
 * 2. 判断是否允许执行
 * 3. 判断是否需要审批
 */
export class PermissionChecker {
  private safeTools: Set<string>;
  private confirmTools: Set<string>;
  private denyTools: Set<string>;
  private roleAllowedTools: Set<string>;

  constructor(config: PermissionCheckerConfig = {}) {
    const permissions = config.permissions ?? DEFAULT_TOOL_SYSTEM_CONFIG.permissions;

    this.safeTools = new Set(permissions.safe);
    this.confirmTools = new Set(permissions.confirm);
    this.denyTools = new Set(permissions.deny);
    this.roleAllowedTools = new Set(config.roleAllowedTools ?? []);
  }

  /**
   * 获取工具的权限级别
   */
  getPermission(toolName: string): PermissionLevel {
    // 1. 检查 deny 列表
    if (this.denyTools.has(toolName)) {
      return "deny";
    }

    // 2. 检查 confirm 列表
    if (this.confirmTools.has(toolName)) {
      return "confirm";
    }

    // 3. 检查 safe 列表
    if (this.safeTools.has(toolName)) {
      return "safe";
    }

    // 4. 未配置的工具默认 deny
    return "deny";
  }

  /**
   * 检查工具权限
   */
  check(toolName: string): PermissionCheckResult {
    const level = this.getPermission(toolName);

    // 检查角色白名单
    if (
      this.roleAllowedTools.size > 0 &&
      !this.roleAllowedTools.has(toolName)
    ) {
      return {
        level: "deny",
        allowed: false,
        requiresApproval: false,
        reason: `Tool not in role whitelist: ${toolName}`,
      };
    }

    switch (level) {
      case "safe":
        return {
          level: "safe",
          allowed: true,
          requiresApproval: false,
        };

      case "confirm":
        return {
          level: "confirm",
          allowed: true,
          requiresApproval: true,
        };

      case "deny":
        return {
          level: "deny",
          allowed: false,
          requiresApproval: false,
          reason: `Tool denied by policy: ${toolName}`,
        };
    }
  }

  /**
   * 检查是否允许执行
   */
  isAllowed(toolName: string): boolean {
    return this.check(toolName).allowed;
  }

  /**
   * 检查是否需要审批
   */
  requiresApproval(toolName: string): boolean {
    return this.check(toolName).requiresApproval;
  }

  /**
   * 添加 safe 工具
   */
  addSafeTool(toolName: string): void {
    this.safeTools.add(toolName);
    this.confirmTools.delete(toolName);
    this.denyTools.delete(toolName);
  }

  /**
   * 添加 confirm 工具
   */
  addConfirmTool(toolName: string): void {
    this.confirmTools.add(toolName);
    this.safeTools.delete(toolName);
    this.denyTools.delete(toolName);
  }

  /**
   * 添加 deny 工具
   */
  addDenyTool(toolName: string): void {
    this.denyTools.add(toolName);
    this.safeTools.delete(toolName);
    this.confirmTools.delete(toolName);
  }

  /**
   * 设置角色工具白名单
   */
  setRoleAllowedTools(tools: string[]): void {
    this.roleAllowedTools = new Set(tools);
  }

  /**
   * 获取所有 safe 工具
   */
  getSafeTools(): string[] {
    return Array.from(this.safeTools);
  }

  /**
   * 获取所有 confirm 工具
   */
  getConfirmTools(): string[] {
    return Array.from(this.confirmTools);
  }

  /**
   * 获取所有 deny 工具
   */
  getDenyTools(): string[] {
    return Array.from(this.denyTools);
  }

  /**
   * 过滤允许的工具
   */
  filterAllowed(toolNames: string[]): string[] {
    return toolNames.filter((name) => this.isAllowed(name));
  }

  /**
   * 过滤需要审批的工具
   */
  filterRequiresApproval(toolNames: string[]): string[] {
    return toolNames.filter((name) => this.requiresApproval(name));
  }
}

/**
 * 创建权限检查器
 */
export function createPermissionChecker(
  config?: PermissionCheckerConfig,
): PermissionChecker {
  return new PermissionChecker(config);
}
