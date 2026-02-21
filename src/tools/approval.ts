/**
 * 审批管理器
 *
 * 管理 confirm 级工具的用户审批流程
 */

import type { ToolCall, ApprovalState } from "./types";

/**
 * 审批管理器配置
 */
export interface ApprovalManagerConfig {
  /** 审批超时（毫秒） */
  timeout?: number;
  /** 确认关键词 */
  confirmKeywords?: string[];
  /** 取消关键词 */
  cancelKeywords?: string[];
}

/**
 * 审批管理器
 *
 * 负责:
 * 1. 创建审批请求
 * 2. 处理用户回复
 * 3. 管理审批状态
 */
export class ApprovalManager {
  private pendingApprovals: Map<string, ApprovalState> = new Map();
  private timeout: number;
  private confirmKeywords: string[];
  private cancelKeywords: string[];

  constructor(config: ApprovalManagerConfig = {}) {
    this.timeout = config.timeout ?? 30000;
    this.confirmKeywords = config.confirmKeywords ?? ["确认", "yes", "ok", "好的", "继续", "执行"];
    this.cancelKeywords = config.cancelKeywords ?? ["取消", "放弃", "no", "不", "停止", "cancel"];
  }

  /**
   * 创建审批请求
   */
  createApproval(sessionId: string, toolCall: ToolCall): ApprovalState {
    // 检查是否已有等待中的审批
    const existing = this.pendingApprovals.get(sessionId);
    if (existing && existing.status === "pending") {
      return existing;
    }

    const approval: ApprovalState = {
      sessionId,
      toolCall,
      message: this.buildApprovalMessage(toolCall),
      status: "pending",
      createdAt: Date.now(),
      timeout: this.timeout,
    };

    this.pendingApprovals.set(sessionId, approval);
    return approval;
  }

  /**
   * 构建审批消息
   */
  private buildApprovalMessage(toolCall: ToolCall): string {
    return `你让我执行 \`${toolCall.name}\`，这可能会有风险。确定要继续吗？\n回复「确认」继续，回复「取消」放弃。`;
  }

  /**
   * 处理用户回复
   *
   * @returns 审批结果: 'approved' | 'rejected' | 'invalid' | 'timeout'
   */
  handleReply(sessionId: string, reply: string): "approved" | "rejected" | "invalid" | "timeout" {
    const approval = this.pendingApprovals.get(sessionId);
    if (!approval) {
      return "invalid";
    }

    // 检查超时
    if (Date.now() - approval.createdAt > this.timeout) {
      this.pendingApprovals.delete(sessionId);
      return "timeout";
    }

    const normalizedReply = reply.toLowerCase().trim();

    // 检查确认
    if (this.confirmKeywords.some((kw) => normalizedReply.includes(kw.toLowerCase()))) {
      // 更新状态（由于 ApprovalState 是 immutable 的，需要删除重建）
      this.pendingApprovals.delete(sessionId);
      return "approved";
    }

    // 检查取消
    if (this.cancelKeywords.some((kw) => normalizedReply.includes(kw.toLowerCase()))) {
      this.pendingApprovals.delete(sessionId);
      return "rejected";
    }

    // 无法识别的回复
    return "invalid";
  }

  /**
   * 获取审批状态
   */
  getApproval(sessionId: string): ApprovalState | undefined {
    return this.pendingApprovals.get(sessionId);
  }

  /**
   * 检查是否有待审批
   */
  hasPendingApproval(sessionId: string): boolean {
    const approval = this.pendingApprovals.get(sessionId);
    return approval !== undefined && approval.status === "pending";
  }

  /**
   * 取消审批
   */
  cancelApproval(sessionId: string): boolean {
    return this.pendingApprovals.delete(sessionId);
  }

  /**
   * 清理过期审批
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, approval] of this.pendingApprovals) {
      if (now - approval.createdAt > this.timeout) {
        this.pendingApprovals.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 获取所有待审批数量
   */
  getPendingCount(): number {
    return this.pendingApprovals.size;
  }
}

/**
 * 创建审批管理器
 */
export function createApprovalManager(config?: ApprovalManagerConfig): ApprovalManager {
  return new ApprovalManager(config);
}
