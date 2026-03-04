/**
 * 会话工作目录管理器
 *
 * KURISU-020: 对话切换工作目录功能
 *
 * 负责:
 * 1. 管理每个会话的工作目录状态
 * 2. 验证目录切换请求的权限
 * 3. 提供会话级工作目录隔离
 */

import path from "path";
import os from "os";
import fs from "fs";
import type { FilePermissionLevel } from "../models/executor-types";
import { DEFAULT_RESTRICTED_CONFIG } from "../models/executor-types";
import { getRecommendedWorkDir } from "./executors/platform";

/**
 * 会话工作目录状态
 */
export interface SessionWorkDirState {
  /** 会话 ID */
  readonly sessionId: string;
  /** 当前工作目录 */
  readonly workingDir: string;
  /** 上次更新时间 */
  readonly updatedAt: number;
}

/**
 * 目录切换结果
 */
export interface ChangeDirResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 新目录（成功时） */
  readonly newDir?: string;
  /** 失败原因 */
  readonly reason?: string;
  /** 审批请求（需要审批时） */
  readonly approvalRequest?: ChangeDirApprovalRequest;
}

/**
 * 切换目录审批请求
 */
export interface ChangeDirApprovalRequest {
  /** 请求 ID */
  readonly id: string;
  /** 会话 ID */
  readonly sessionId: string;
  /** 目标目录 */
  readonly targetDir: string;
  /** 原始用户输入 */
  readonly originalInput?: string;
  /** 风险等级 */
  readonly riskLevel: "low" | "medium" | "high";
  /** 审批消息 */
  readonly message: string;
  /** 创建时间 */
  readonly createdAt: number;
}

/**
 * 路径验证结果
 */
export interface PathValidationResult {
  /** 是否允许 */
  readonly allowed: boolean;
  /** 是否需要审批 */
  readonly requiresApproval: boolean;
  /** 展开后的路径 */
  readonly expandedPath: string;
  /** 失败原因 */
  readonly reason?: string;
}

/**
 * 工作目录管理器配置
 */
export interface SessionWorkDirManagerConfig {
  /** 默认工作目录（未设置时使用） */
  readonly defaultWorkDir?: string;
  /** 沙箱目录 */
  readonly sandboxDir?: string;
}

/**
 * 会话工作目录管理器
 */
export class SessionWorkDirManager {
  private readonly sessions: Map<string, SessionWorkDirState> = new Map();
  private readonly defaultWorkDir: string;
  private readonly sandboxDir: string;

  constructor(config: SessionWorkDirManagerConfig = {}) {
    this.defaultWorkDir = config.defaultWorkDir ?? getRecommendedWorkDir();
    this.sandboxDir =
      config.sandboxDir ?? path.join(os.tmpdir(), "kurisu-workspace");
  }

  /**
   * 获取会话的工作目录
   *
   * 如果未设置，返回默认目录
   */
  getWorkingDir(sessionId: string): string {
    const state = this.sessions.get(sessionId);
    return state?.workingDir ?? this.defaultWorkDir;
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId: string): SessionWorkDirState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * 检查会话是否有自定义工作目录
   */
  hasCustomWorkDir(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 尝试切换工作目录
   *
   * @param sessionId 会话 ID
   * @param targetPath 目标路径
   * @param permission 文件权限级别
   * @param allowedPaths 允许的路径列表（restricted 模式）
   * @returns 切换结果
   */
  changeWorkingDir(
    sessionId: string,
    targetPath: string,
    permission: FilePermissionLevel,
    allowedPaths?: readonly string[],
  ): ChangeDirResult {
    // 1. 展开路径
    const expandedPath = this.expandPath(targetPath);

    // 2. 检查路径是否存在
    if (!fs.existsSync(expandedPath)) {
      return {
        success: false,
        requiresApproval: false,
        reason: `目录 "${targetPath}" 不存在`,
      };
    }

    // 3. 检查是否是目录
    try {
      const stats = fs.statSync(expandedPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          requiresApproval: false,
          reason: `"${targetPath}" 不是目录`,
        };
      }
    } catch (error) {
      return {
        success: false,
        requiresApproval: false,
        reason: `无法访问目录 "${targetPath}"`,
      };
    }

    // 4. 根据权限级别验证
    const validation = this.validatePathAccess(
      expandedPath,
      permission,
      allowedPaths,
    );

    if (!validation.allowed) {
      return {
        success: false,
        requiresApproval: false,
        ...(validation.reason ? { reason: validation.reason } : {}),
      };
    }

    // 5. 如果需要审批，返回审批请求
    if (validation.requiresApproval) {
      return {
        success: false,
        requiresApproval: true,
        approvalRequest: this.createApprovalRequest(
          sessionId,
          expandedPath,
          permission,
        ),
      };
    }

    // 6. 直接应用切换
    this.applyChange(sessionId, expandedPath);

    return {
      success: true,
      requiresApproval: false,
      newDir: expandedPath,
    };
  }

  /**
   * 应用审批通过后的目录切换
   */
  applyApprovedChange(sessionId: string, targetPath: string): void {
    // 再次验证路径存在
    if (fs.existsSync(targetPath)) {
      this.applyChange(sessionId, targetPath);
    }
  }

  /**
   * 验证路径是否可访问
   */
  validatePathAccess(
    targetPath: string,
    permission: FilePermissionLevel,
    allowedPaths?: readonly string[],
  ): PathValidationResult {
    const expandedPath = this.expandPath(targetPath);

    switch (permission) {
      case "sandbox": {
        const expandedSandbox = this.expandPath(this.sandboxDir);
        if (!expandedPath.startsWith(expandedSandbox)) {
          return {
            allowed: false,
            requiresApproval: false,
            expandedPath,
            reason: `沙箱模式下只能访问沙箱目录：${this.sandboxDir}`,
          };
        }
        return {
          allowed: true,
          requiresApproval: false,
          expandedPath,
        };
      }

      case "restricted": {
        const paths = allowedPaths ?? DEFAULT_RESTRICTED_CONFIG.allowedPaths;
        if (!this.isPathInAllowed(expandedPath, paths)) {
          return {
            allowed: false,
            requiresApproval: false,
            expandedPath,
            reason: `受限模式下只能访问：${paths.join(", ")}`,
          };
        }
        return {
          allowed: true,
          requiresApproval: false,
          expandedPath,
        };
      }

      case "full_access": {
        // 完全访问模式允许任意目录，但需要审批
        return {
          allowed: true,
          requiresApproval: true,
          expandedPath,
        };
      }

      default: {
        return {
          allowed: false,
          requiresApproval: false,
          expandedPath,
          reason: `未知权限级别: ${permission as string}`,
        };
      }
    }
  }

  /**
   * 清除会话的工作目录设置
   */
  clearWorkingDir(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * 清除所有会话的工作目录设置
   */
  clearAll(): void {
    this.sessions.clear();
  }

  /**
   * 获取所有会话状态
   */
  getAllSessions(): SessionWorkDirState[] {
    return Array.from(this.sessions.values());
  }

  // ============================================
  // 私有方法
  // ============================================

  /**
   * 应用目录切换
   */
  private applyChange(sessionId: string, workingDir: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      workingDir,
      updatedAt: Date.now(),
    });
  }

  /**
   * 展开路径中的 ~ 为用户主目录
   * 并解析符号链接，返回真实路径
   */
  private expandPath(p: string): string {
    let expanded: string;
    if (p.startsWith("~/")) {
      expanded = path.join(os.homedir(), p.slice(2));
    } else {
      expanded = path.resolve(p);
    }

    // 解析符号链接以获得真实路径（macOS 上 /var -> /private/var）
    try {
      return fs.realpathSync(expanded);
    } catch {
      // 如果路径不存在，返回规范化后的路径
      return expanded;
    }
  }

  /**
   * 检查路径是否在允许列表内
   */
  private isPathInAllowed(
    targetPath: string,
    allowedPaths: readonly (string | undefined)[],
  ): boolean {
    for (const allowedPath of allowedPaths) {
      if (!allowedPath) continue;

      const expandedAllowed = this.expandPath(allowedPath);

      // 检查目标路径是否在允许路径下
      if (targetPath.startsWith(expandedAllowed)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 创建审批请求
   */
  private createApprovalRequest(
    sessionId: string,
    targetDir: string,
    permission: FilePermissionLevel,
  ): ChangeDirApprovalRequest {
    const riskLevel: "low" | "medium" | "high" =
      permission === "full_access" ? "medium" : "low";

    return {
      id: `change-dir-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      targetDir,
      riskLevel,
      message: `你让我把工作目录切换到 \`${targetDir}\`，确定要继续吗？`,
      createdAt: Date.now(),
    };
  }
}

/**
 * 创建会话工作目录管理器实例
 */
export function createSessionWorkDirManager(
  config?: SessionWorkDirManagerConfig,
): SessionWorkDirManager {
  return new SessionWorkDirManager(config);
}
