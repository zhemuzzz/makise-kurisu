/**
 * 删除确认处理器
 *
 * KURISU-024: 会话设置流水线重构
 *
 * 实现 SessionSettingHandler 接口，迁移自 Gateway 中的：
 * - detectDeleteConfirmationIntent
 * - handleChangeDeleteConfirmIntent
 * - hasPendingDeleteConfirmApproval
 * - handleChangeDeleteConfirmApprovalReply
 *
 * @module gateway/handlers/delete-confirm-handler
 */

import { isUserConfirm, isUserReject } from "../session-setting-constants.js";

// TODO: KURISU-035 Phase 3+ — will be reimplemented as platform service
/**
 * Inline stub for DeleteConfirmationIntentRecognizer (was in agents/intent/, now deleted)
 */
class DeleteConfirmationIntentRecognizer {
  recognize(input: string): {
    isIntent: boolean;
    confidence: number;
    action?: string;
    originalInput: string;
  } {
    const disableMatch = input.match(/(?:关闭|取消|不要|不用)(?:删除)?确认/i);
    const enableMatch = input.match(/(?:开启|恢复|启用)(?:删除)?确认|删除(?:文件)?(?:需要|要)确认/i);

    if (disableMatch) {
      return { isIntent: true, confidence: 0.9, action: "disable", originalInput: input };
    }
    if (enableMatch) {
      return { isIntent: true, confidence: 0.9, action: "enable", originalInput: input };
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
import type { SessionPermissionManagerLike } from "../types.js";

/**
 * 删除确认处理器
 *
 * 处理用户的删除确认开关请求，包括：
 * - 检测关闭/开启删除确认的意图
 * - 关闭删除确认需要用户确认（安全措施）
 * - 开启删除确认直接执行
 *
 * @example
 * ```typescript
 * const handler = new DeleteConfirmHandler(sessionPermissionManager);
 *
 * // 关闭删除确认（需要用户二次确认）
 * const intent = handler.detectIntent("删除不要确认");
 * const result = await handler.handleIntent(sessionId, intent);
 * // result.requiresApproval === true
 *
 * // 开启删除确认（直接执行）
 * const intent2 = handler.detectIntent("开启删除确认");
 * const result2 = await handler.handleIntent(sessionId, intent2);
 * // result2.handled === true, result2.message === "好的，删除确认已开启。"
 * ```
 */
export class DeleteConfirmHandler implements SessionSettingHandler {
  readonly type = "delete_confirm";

  private readonly recognizer: DeleteConfirmationIntentRecognizer;

  /**
   * 待处理的删除确认关闭审批
   *
   * Key: sessionId
   * Value: 审批请求 ID
   */
  private readonly pendingApprovals: Map<
    string,
    { readonly requestId: string }
  > = new Map();

  constructor(
    private readonly permissionManager: SessionPermissionManagerLike,
  ) {
    this.recognizer = new DeleteConfirmationIntentRecognizer();
  }

  /**
   * 检测用户输入是否包含删除确认开关意图
   */
  detectIntent(input: string): SessionSettingIntent {
    const result = this.recognizer.recognize(input);
    return {
      isIntent: result.isIntent,
      confidence: result.confidence,
      ...(result.action && { action: result.action }),
      originalInput: result.originalInput,
    };
  }

  /**
   * 检查会话是否有待处理的删除确认关闭审批
   */
  hasPending(sessionId: string): boolean {
    return this.pendingApprovals.has(sessionId);
  }

  /**
   * 处理删除确认开关意图
   *
   * - 开启删除确认：直接执行
   * - 关闭删除确认：需要用户确认（安全措施）
   */
  async handleIntent(
    sessionId: string,
    intent: SessionSettingIntent,
  ): Promise<SessionSettingHandleResult> {
    const action = intent.action;

    // 开启删除确认（直接执行）
    if (action === "enable") {
      const result = this.permissionManager.enableDeleteConfirmation(sessionId);
      return {
        handled: true,
        message: result.message,
      };
    }

    // 关闭删除确认（需要用户确认）
    if (action === "disable") {
      // 先请求关闭，获取提示消息
      const requestResult =
        this.permissionManager.requestDisableDeleteConfirmation(sessionId);

      // 创建待审批记录
      this.pendingApprovals.set(sessionId, {
        requestId: `delete-confirm-${Date.now()}`,
      });

      return {
        handled: true,
        requiresApproval: true,
        approvalMessage: requestResult.message,
        message: requestResult.message,
      };
    }

    return { handled: false };
  }

  /**
   * 处理删除确认关闭审批回复
   *
   * - 用户确认：关闭删除确认
   * - 用户拒绝：保持删除确认开启
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
      // 用户确认关闭删除确认
      this.pendingApprovals.delete(sessionId);
      this.permissionManager.applyDisableDeleteConfirmation(sessionId);

      return {
        isApprovalReply: true,
        approved: true,
        message:
          "好的，已关闭删除确认。之后删除文件会直接执行，不会再询问你。如果需要恢复，可以说「开启删除确认」。",
      };
    }

    if (isUserReject(userMessage)) {
      // 用户拒绝
      this.pendingApprovals.delete(sessionId);
      return {
        isApprovalReply: true,
        approved: false,
        message: "好的，删除确认保持开启。",
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
 * 创建删除确认处理器
 */
export function createDeleteConfirmHandler(
  permissionManager: SessionPermissionManagerLike,
): DeleteConfirmHandler {
  return new DeleteConfirmHandler(permissionManager);
}
