/**
 * 会话权限管理器
 *
 * KURISU-021: 会话级权限切换功能
 *
 * 负责:
 * 1. 管理每个会话的临时权限状态
 * 2. 验证权限变更请求
 * 3. 提供会话级权限覆盖（不持久化）
 */

import type { FilePermissionLevel } from "../models/executor-types.js";

/**
 * 权限级别优先级（用于判断升级/降级）
 */
const PERMISSION_PRIORITY: Record<FilePermissionLevel, number> = {
  sandbox: 0,
  restricted: 1,
  full_access: 2,
};

/**
 * 会话权限状态
 */
export interface SessionPermissionState {
  /** 会话 ID */
  readonly sessionId: string;
  /** 当前权限级别（临时覆盖） */
  readonly permission: FilePermissionLevel;
  /** 上次更新时间 */
  readonly updatedAt: number;
  /** 变更原因（可选） */
  readonly reason?: string;
  /**
   * 是否跳过删除确认（会话级）
   * KURISU-023 方案B: 用户明确确认风险后可关闭
   */
  readonly skipDeleteConfirmation?: boolean;
}

/**
 * 权限变更结果
 */
export interface PermissionChangeResult {
  /** 是否成功（需要审批时为 false，等待审批） */
  readonly success: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 新权限级别（成功时） */
  readonly newPermission?: FilePermissionLevel;
  /** 失败/拒绝原因 */
  readonly reason?: string;
  /** 审批请求（需要审批时） */
  readonly approvalRequest?: PermissionApprovalRequest;
  /** 是否是升级操作 */
  readonly isUpgrade: boolean;
  /** 是否是降级操作 */
  readonly isDowngrade: boolean;
}

/**
 * 权限变更审批请求
 */
export interface PermissionApprovalRequest {
  /** 请求 ID */
  readonly id: string;
  /** 会话 ID */
  readonly sessionId: string;
  /** 当前权限级别 */
  readonly currentPermission: FilePermissionLevel;
  /** 目标权限级别 */
  readonly targetPermission: FilePermissionLevel;
  /** 风险等级 */
  readonly riskLevel: "low" | "medium" | "high";
  /** 审批消息 */
  readonly message: string;
  /** 警告信息（可选） */
  readonly warning?: string;
  /** 创建时间 */
  readonly createdAt: number;
}

/**
 * 删除确认设置结果
 * KURISU-023 方案B
 */
export interface DeleteConfirmationResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 当前状态 */
  readonly skipDeleteConfirmation: boolean;
  /** 消息 */
  readonly message: string;
  /** 警告信息（关闭时） */
  readonly warning?: string;
}

/**
 * 会话权限管理器
 */
export class SessionPermissionManager {
  private readonly sessions: Map<string, SessionPermissionState> = new Map();

  /**
   * 获取会话的当前权限级别
   *
   * 如果未设置临时权限，返回角色默认权限
   */
  getPermission(
    sessionId: string,
    defaultPermission: FilePermissionLevel,
  ): FilePermissionLevel {
    const state = this.sessions.get(sessionId);
    return state?.permission ?? defaultPermission;
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId: string): SessionPermissionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 检查会话是否有临时权限覆盖
   */
  hasTemporaryPermission(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 判断是否是权限升级
   */
  isUpgrade(from: FilePermissionLevel, to: FilePermissionLevel): boolean {
    return PERMISSION_PRIORITY[to] > PERMISSION_PRIORITY[from];
  }

  /**
   * 判断是否是权限降级
   */
  isDowngrade(from: FilePermissionLevel, to: FilePermissionLevel): boolean {
    return PERMISSION_PRIORITY[to] < PERMISSION_PRIORITY[from];
  }

  /**
   * 请求权限变更
   *
   * @param sessionId 会话 ID
   * @param targetLevel 目标权限级别
   * @param currentDefault 角色默认权限
   * @returns 变更结果
   */
  requestPermissionChange(
    sessionId: string,
    targetLevel: FilePermissionLevel,
    currentDefault: FilePermissionLevel,
  ): PermissionChangeResult {
    // 获取当前权限（临时 > 默认）
    const currentPermission = this.getPermission(sessionId, currentDefault);

    // 如果目标权限与当前权限相同
    if (currentPermission === targetLevel) {
      return {
        success: true,
        requiresApproval: false,
        newPermission: targetLevel,
        reason: "权限已经是目标级别",
        isUpgrade: false,
        isDowngrade: false,
      };
    }

    const isDowngrade = this.isDowngrade(currentPermission, targetLevel);

    // 降级操作：直接应用，无需审批
    if (isDowngrade) {
      this.applyChange(sessionId, targetLevel);
      return {
        success: true,
        requiresApproval: false,
        newPermission: targetLevel,
        isUpgrade: false,
        isDowngrade: true,
      };
    }

    // 升级操作：需要审批
    return {
      success: false,
      requiresApproval: true,
      isUpgrade: true,
      isDowngrade: false,
      approvalRequest: this.createApprovalRequest(
        sessionId,
        currentPermission,
        targetLevel,
      ),
    };
  }

  /**
   * 应用审批通过后的权限变更
   */
  applyApprovedChange(
    sessionId: string,
    targetLevel: FilePermissionLevel,
  ): void {
    this.applyChange(sessionId, targetLevel);
  }

  /**
   * 重置为角色默认权限
   */
  resetToDefault(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * 清除所有会话的临时权限
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * 获取所有会话状态
   */
  getAllSessions(): SessionPermissionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取权限级别名称（用于显示）
   */
  getPermissionDisplayName(level: FilePermissionLevel): string {
    const names: Record<FilePermissionLevel, string> = {
      sandbox: "沙箱模式",
      restricted: "受限模式",
      full_access: "完全访问",
    };
    return names[level];
  }

  /**
   * 获取权限级别描述
   */
  getPermissionDescription(level: FilePermissionLevel): string {
    const descriptions: Record<FilePermissionLevel, string> = {
      sandbox: "只能在隔离的沙箱目录中操作，最安全",
      restricted: "可以访问指定的用户文件夹",
      full_access: "可以访问整个电脑（有风险）",
    };
    return descriptions[level];
  }

  // ============================================
  // 删除确认开关（KURISU-023 方案B）
  // ============================================

  /**
   * 检查是否跳过删除确认
   *
   * @param sessionId 会话 ID
   * @returns true 表示跳过确认，false 表示需要确认（默认）
   */
  shouldSkipDeleteConfirmation(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    return state?.skipDeleteConfirmation ?? false;
  }

  /**
   * 请求关闭删除确认（需要用户明确确认风险）
   *
   * @param sessionId 会话 ID
   * @returns 设置结果（包含需要确认的消息）
   */
  requestDisableDeleteConfirmation(
    sessionId: string,
  ): DeleteConfirmationResult {
    const currentState = this.shouldSkipDeleteConfirmation(sessionId);

    if (currentState) {
      return {
        success: true,
        skipDeleteConfirmation: true,
        message: "删除确认已经关闭了。",
      };
    }

    // 返回需要确认的请求（不直接修改状态）
    return {
      success: false,
      skipDeleteConfirmation: false,
      message:
        "你想要关闭删除确认？这意味着删除文件时不会再询问你。确定要继续吗？（回复 y 确认，n 取消）",
      warning: "⚠️ 关闭后，删除文件将直接执行，可能造成数据丢失。",
    };
  }

  /**
   * 应用关闭删除确认（用户确认后调用）
   *
   * @param sessionId 会话 ID
   */
  applyDisableDeleteConfirmation(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    this.sessions.set(sessionId, {
      sessionId,
      permission: existing?.permission ?? "sandbox",
      updatedAt: Date.now(),
      reason: "用户确认关闭删除确认",
      skipDeleteConfirmation: true,
    });
  }

  /**
   * 开启删除确认（恢复默认行为，无需确认）
   *
   * @param sessionId 会话 ID
   * @returns 设置结果
   */
  enableDeleteConfirmation(sessionId: string): DeleteConfirmationResult {
    const currentState = this.shouldSkipDeleteConfirmation(sessionId);

    if (!currentState) {
      return {
        success: true,
        skipDeleteConfirmation: false,
        message: "删除确认已经是开启状态。",
      };
    }

    // 恢复删除确认
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.sessions.set(sessionId, {
        ...existing,
        updatedAt: Date.now(),
        reason: "用户恢复删除确认",
        skipDeleteConfirmation: false,
      });
    }

    return {
      success: true,
      skipDeleteConfirmation: false,
      message: "已恢复删除确认。之后删除文件会先询问你。",
    };
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 应用权限变更
   */
  private applyChange(
    sessionId: string,
    permission: FilePermissionLevel,
    reason?: string,
  ): void {
    this.sessions.set(sessionId, {
      sessionId,
      permission,
      updatedAt: Date.now(),
      ...(reason !== undefined && { reason }),
    });
  }

  /**
   * 创建审批请求
   */
  private createApprovalRequest(
    sessionId: string,
    currentPermission: FilePermissionLevel,
    targetPermission: FilePermissionLevel,
  ): PermissionApprovalRequest {
    // 根据目标权限确定风险等级
    const riskLevel: "low" | "medium" | "high" =
      targetPermission === "full_access"
        ? "high"
        : targetPermission === "restricted"
          ? "medium"
          : "low";

    const warning =
      targetPermission === "full_access"
        ? "⚠️ 完全访问模式允许操作整个电脑，可能影响系统文件。"
        : undefined;

    const currentName = this.getPermissionDisplayName(currentPermission);
    const targetName = this.getPermissionDisplayName(targetPermission);

    return {
      id: `permission-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      currentPermission,
      targetPermission,
      riskLevel,
      message: `你让我把权限从「${currentName}」调到「${targetName}」。${warning ?? ""}确定要继续吗？`,
      ...(warning !== undefined && { warning }),
      createdAt: Date.now(),
    };
  }
}

/**
 * 创建会话权限管理器实例
 */
export function createSessionPermissionManager(): SessionPermissionManager {
  return new SessionPermissionManager();
}
