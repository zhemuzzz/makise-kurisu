/**
 * 权限切换处理器
 *
 * KURISU-024: 会话设置流水线重构
 *
 * 实现 SessionSettingHandler 接口，迁移自 Gateway 中的：
 * - detectChangePermissionIntent
 * - handleChangePermissionIntent
 * - hasPendingPermissionApproval
 * - handleChangePermissionApprovalReply
 *
 * @module gateway/handlers/change-permission-handler
 */

import { isUserConfirm, isUserReject } from "../session-setting-constants.js";

// TODO: KURISU-035 Phase 3+ — will be reimplemented as platform service
/**
 * Inline stub for ChangePermissionIntentRecognizer (was in agents/intent/, now deleted)
 */
class ChangePermissionIntentRecognizer {
  recognize(input: string): {
    isIntent: boolean;
    confidence: number;
    action?: string;
    targetLevel?: string;
    originalInput: string;
  } {
    const upgradeMatch = input.match(/(?:升级|提升)(?:权限)?(?:(?:到|为)(?:完全访问|full_access))?|(?:切换到?)(?:权限)?(?:到|为)?(?:完全访问|full_access)/i);
    const downgradeMatch = input.match(/(?:降级|降低)(?:权限)?(?:(?:到|为)(?:沙箱|sandbox|受限|restricted))?|(?:切换到?)(?:权限)?(?:到|为)?(?:沙箱|sandbox|受限|restricted)/i);
    const resetMatch = input.match(/(?:重置|恢复)(?:权限|默认)/i);

    if (resetMatch) {
      return { isIntent: true, confidence: 0.9, action: "reset", originalInput: input };
    }
    if (upgradeMatch) {
      return { isIntent: true, confidence: 0.9, action: "upgrade", targetLevel: "full_access", originalInput: input };
    }
    if (downgradeMatch) {
      return { isIntent: true, confidence: 0.9, action: "downgrade", targetLevel: "sandbox", originalInput: input };
    }
    return { isIntent: false, confidence: 0, originalInput: input };
  }
}
import type {
  SessionSettingHandler,
  SessionSettingIntent,
  SessionSettingHandleResult,
  SessionSettingApprovalResult,
} from "../session-setting-registry.js";
import type {
  SessionPermissionManagerLike,
  FilePermissionLevel,
} from "../types.js";

/**
 * 权限切换处理器
 *
 * 处理用户的权限切换请求，包括：
 * - 检测权限切换意图（如 "升级权限", "切换到完全访问"）
 * - 对于权限升级触发审批流程
 * - 权限降级直接执行
 * - 处理用户的确认/拒绝回复
 *
 * @example
 * ```typescript
 * const handler = new ChangePermissionHandler(
 *   sessionPermissionManager,
 *   "sandbox"
 * );
 *
 * const intent = handler.detectIntent("升级权限到完全访问");
 * if (intent.isIntent) {
 *   const result = await handler.handleIntent(sessionId, intent);
 *   if (result.requiresApproval) {
 *     // 等待用户确认（权限升级需要确认）
 *   }
 * }
 * ```
 */
export class ChangePermissionHandler implements SessionSettingHandler {
  readonly type = "change_permission";

  private readonly recognizer: ChangePermissionIntentRecognizer;

  /**
   * 待处理的权限切换审批
   *
   * Key: sessionId
   * Value: 审批请求信息
   */
  private readonly pendingApprovals: Map<
    string,
    { readonly targetLevel: FilePermissionLevel; readonly requestId: string }
  > = new Map();

  constructor(
    private readonly permissionManager: SessionPermissionManagerLike,
    private readonly defaultPermission: FilePermissionLevel,
  ) {
    this.recognizer = new ChangePermissionIntentRecognizer();
  }

  /**
   * 检测用户输入是否包含权限切换意图
   */
  detectIntent(input: string): SessionSettingIntent {
    const result = this.recognizer.recognize(input);
    return {
      isIntent: result.isIntent,
      confidence: result.confidence,
      ...(result.action && { action: result.action }),
      ...(result.targetLevel && { targetValue: result.targetLevel }),
      originalInput: result.originalInput,
    };
  }

  /**
   * 检查会话是否有待处理的权限切换审批
   */
  hasPending(sessionId: string): boolean {
    return this.pendingApprovals.has(sessionId);
  }

  /**
   * 处理权限切换意图
   *
   * - 权限降级：直接执行，无需审批
   * - 权限升级：触发审批流程，等待用户确认
   * - 重置：直接执行
   */
  async handleIntent(
    sessionId: string,
    intent: SessionSettingIntent,
  ): Promise<SessionSettingHandleResult> {
    const action = intent.action;
    const targetLevel = intent.targetValue as FilePermissionLevel | undefined;

    // 重置权限
    if (action === "reset") {
      const resetResult = this.permissionManager.resetToDefault(sessionId);
      return {
        handled: true,
        message: resetResult
          ? "好的，权限已恢复默认设置。"
          : "权限已经是默认设置。",
      };
    }

    // 没有目标级别，无法处理
    if (!targetLevel) {
      return { handled: false };
    }

    const currentLevel = this.permissionManager.getPermission(
      sessionId,
      this.defaultPermission,
    );

    // 降级或同级：直接执行
    if (
      this.permissionManager.isDowngrade(currentLevel, targetLevel) ||
      currentLevel === targetLevel
    ) {
      this.permissionManager.applyApprovedChange(sessionId, targetLevel);
      const displayName =
        this.permissionManager.getPermissionDisplayName(targetLevel);
      return {
        handled: true,
        message: `好的，权限已降级为「${displayName}」。`,
      };
    }

    // 升级：请求审批
    const changeResult = this.permissionManager.requestPermissionChange(
      sessionId,
      targetLevel,
      this.defaultPermission,
    );

    if (changeResult.requiresApproval && changeResult.approvalRequest) {
      this.pendingApprovals.set(sessionId, {
        targetLevel: changeResult.approvalRequest.targetPermission,
        requestId: changeResult.approvalRequest.id,
      });

      return {
        handled: true,
        requiresApproval: true,
        approvalMessage: changeResult.approvalRequest.message,
        message: changeResult.approvalRequest.message,
      };
    }

    // 不需要审批（理论上不会走到这里，升级都需要审批）
    return {
      handled: true,
      message: changeResult.reason ?? "权限变更已处理。",
    };
  }

  /**
   * 处理权限切换审批回复
   *
   * - 用户确认：应用权限升级
   * - 用户拒绝：取消审批
   */
  async handleApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<SessionSettingApprovalResult> {
    const pending = this.pendingApprovals.get(sessionId);
    if (!pending) {
      return { isApprovalReply: false };
    }

    if (isUserConfirm(userMessage)) {
      // 用户确认
      this.pendingApprovals.delete(sessionId);
      this.permissionManager.applyApprovedChange(
        sessionId,
        pending.targetLevel,
      );

      const displayName = this.permissionManager.getPermissionDisplayName(
        pending.targetLevel,
      );
      return {
        isApprovalReply: true,
        approved: true,
        message: `好的，权限已升级为「${displayName}」。请谨慎操作，重启后会恢复默认设置。`,
      };
    }

    if (isUserReject(userMessage)) {
      // 用户拒绝
      this.pendingApprovals.delete(sessionId);
      return {
        isApprovalReply: true,
        approved: false,
        message: "好的，权限保持不变。",
      };
    }

    // 不是审批回复
    return { isApprovalReply: false };
  }
}

// ===========================================
// 工厂函数
// ===========================================

/**
 * 创建权限切换处理器
 */
export function createChangePermissionHandler(
  permissionManager: SessionPermissionManagerLike,
  defaultPermission: FilePermissionLevel,
): ChangePermissionHandler {
  return new ChangePermissionHandler(permissionManager, defaultPermission);
}
