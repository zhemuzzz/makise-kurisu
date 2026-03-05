/**
 * 目录切换处理器
 *
 * KURISU-024: 会话设置流水线重构
 *
 * 实现 SessionSettingHandler 接口，迁移自 Gateway 中的：
 * - detectChangeDirIntent
 * - handleChangeDirIntent
 * - hasPendingChangeDirApproval
 * - handleChangeDirApprovalReply
 *
 * @module gateway/handlers/change-dir-handler
 */

import { isUserConfirm, isUserReject } from "../session-setting-constants.js";
import type {
  SessionSettingHandler,
  SessionSettingIntent,
  SessionSettingHandleResult,
  SessionSettingApprovalResult,
} from "../session-setting-registry.js";
import type { SessionWorkDirManagerLike, FilePermissionLevel } from "../types.js";
import { MCPWorkDirSync } from "../../tools/mcp-workdir-sync.js";

// TODO: KURISU-035 Phase 3+ — will be reimplemented as platform service
/**
 * Inline stub for ChangeDirIntentRecognizer (was in agents/intent/, now deleted)
 */
class ChangeDirIntentRecognizer {
  recognize(input: string): { isChangeDir: boolean; confidence: number; targetDir?: string } {
    const cdMatch = input.match(/^(?:cd|切换目录(?:到)?|切换到目录)\s+(.+)$/i);
    if (cdMatch) {
      const dir = cdMatch[1]?.trim();
      return dir
        ? { isChangeDir: true, confidence: 0.9, targetDir: dir }
        : { isChangeDir: true, confidence: 0.9 };
    }
    return { isChangeDir: false, confidence: 0 };
  }
}

/**
 * 目录切换处理器
 *
 * 处理用户的切换工作目录请求，包括：
 * - 检测切换目录意图（如 "cd /tmp", "切换目录到 ~/Projects"）
 * - 对于受保护目录触发审批流程
 * - 处理用户的确认/拒绝回复
 *
 * @example
 * ```typescript
 * const handler = new ChangeDirHandler(
 *   sessionWorkDirManager,
 *   "sandbox",
 *   ["/home/user/allowed"]
 * );
 *
 * const intent = handler.detectIntent("cd /tmp");
 * if (intent.isIntent) {
 *   const result = await handler.handleIntent(sessionId, intent);
 *   if (result.requiresApproval) {
 *     // 等待用户确认
 *   }
 * }
 * ```
 */
export class ChangeDirHandler implements SessionSettingHandler {
  readonly type = "change_dir";

  private readonly recognizer: ChangeDirIntentRecognizer;

  /**
   * 待处理的目录切换审批
   *
   * Key: sessionId
   * Value: 审批请求信息
   */
  private readonly pendingApprovals: Map<
    string,
    { readonly targetDir: string; readonly requestId: string }
  > = new Map();

  constructor(
    private readonly workDirManager: SessionWorkDirManagerLike,
    private readonly defaultPermission: FilePermissionLevel,
    private readonly allowedPaths: readonly string[],
    private readonly mcpWorkDirSync?: MCPWorkDirSync,
  ) {
    this.recognizer = new ChangeDirIntentRecognizer();
  }

  /**
   * 检测用户输入是否包含切换目录意图
   */
  detectIntent(input: string): SessionSettingIntent {
    const result = this.recognizer.recognize(input);
    return {
      isIntent: result.isChangeDir,
      confidence: result.confidence,
      ...(result.isChangeDir && { action: "change" }),
      ...(result.targetDir !== undefined && { targetValue: result.targetDir }),
      originalInput: input,
    };
  }

  /**
   * 检查会话是否有待处理的目录切换审批
   */
  hasPending(sessionId: string): boolean {
    return this.pendingApprovals.has(sessionId);
  }

  /**
   * 处理切换目录意图
   *
   * - 如果目录在允许范围内，直接切换成功
   * - 如果目录需要审批，创建审批请求并等待用户确认
   */
  async handleIntent(
    sessionId: string,
    intent: SessionSettingIntent,
  ): Promise<SessionSettingHandleResult> {
    const targetDir = intent.targetValue as string | undefined;
    if (!targetDir) {
      return { handled: false };
    }

    const result = this.workDirManager.changeWorkingDir(
      sessionId,
      targetDir,
      this.defaultPermission,
      this.allowedPaths,
    );

    // 直接成功（目录在允许范围内）
    if (result.success) {
      const message = await this.syncMCPAndBuildMessage(
        sessionId,
        result.newDir!,
      );
      return { handled: true, message };
    }

    // 需要用户确认（目录受保护）
    if (result.requiresApproval && result.approvalRequest) {
      this.pendingApprovals.set(sessionId, {
        targetDir: result.approvalRequest.targetDir,
        requestId: result.approvalRequest.id,
      });

      return {
        handled: true,
        requiresApproval: true,
        approvalMessage: result.approvalRequest.message,
        message: result.approvalRequest.message,
      };
    }

    // 其他失败原因（如路径不存在）
    return {
      handled: true,
      message: result.reason ?? "无法切换到此目录",
    };
  }

  /**
   * 处理目录切换审批回复
   *
   * - 用户确认：应用目录切换
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
      this.workDirManager.applyApprovedChange(sessionId, pending.targetDir);

      const message = await this.syncMCPAndBuildMessage(
        sessionId,
        pending.targetDir,
      );
      return {
        isApprovalReply: true,
        approved: true,
        message,
      };
    }

    if (isUserReject(userMessage)) {
      // 用户拒绝
      this.pendingApprovals.delete(sessionId);
      return {
        isApprovalReply: true,
        approved: false,
        message: "好的，已取消目录切换。",
      };
    }

    // 不是审批回复
    return { isApprovalReply: false };
  }

  /**
   * 同步 MCP Server 并构建用户提示消息
   *
   * KURISU-026: 目录切换成功后触发 MCP Server 热重启
   */
  private async syncMCPAndBuildMessage(
    sessionId: string,
    newWorkDir: string,
  ): Promise<string> {
    if (!this.mcpWorkDirSync) {
      return `好的，工作目录已切换到 \`${newWorkDir}\``;
    }

    const syncResult = await this.mcpWorkDirSync.onWorkDirChanged(
      sessionId,
      newWorkDir,
    );

    return MCPWorkDirSync.formatSyncMessage(syncResult);
  }
}

// ===========================================
// 工厂函数
// ===========================================

/**
 * 创建目录切换处理器
 */
export function createChangeDirHandler(
  workDirManager: SessionWorkDirManagerLike,
  defaultPermission: FilePermissionLevel,
  allowedPaths: readonly string[],
  mcpWorkDirSync?: MCPWorkDirSync,
): ChangeDirHandler {
  return new ChangeDirHandler(
    workDirManager,
    defaultPermission,
    allowedPaths,
    mcpWorkDirSync,
  );
}
