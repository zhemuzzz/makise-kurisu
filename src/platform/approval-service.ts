/**
 * ApprovalService - 用户确认流程
 * 位置: src/platform/approval-service.ts
 *
 * PS-3: Promise-based suspend/resume/timeout
 *
 * 职责: 暂停执行 → 等待用户确认 → 恢复或拒绝
 * PermissionService 判定 'confirm' 后，Agent 调用此服务暂停等待用户确认。
 */

import { randomUUID } from "crypto";
import type { PermissionAction } from "./permission-service.js";

// ============ Types ============

export interface ApprovalRequest {
  readonly sessionId: string;
  readonly action: PermissionAction;
  readonly subject: string;
  readonly description: string;
}

export interface ApprovalResult {
  readonly approved: boolean;
  readonly reason?: "user_rejected" | "timeout" | "session_ended";
}

export interface ApprovalHandle {
  readonly approvalId: string;
  readonly result: Promise<ApprovalResult>;
}

// ============ Interface ============

export interface ApprovalService {
  /** 发起审批请求，返回 approvalId + 结果 Promise */
  requestApproval(request: ApprovalRequest): ApprovalHandle;

  /** 用户响应审批 */
  handleUserResponse(approvalId: string, approved: boolean): void;

  /** 拒绝某个 session 的所有待处理审批 */
  rejectAllPending(sessionId: string): void;

  /** 当前待处理审批数量 */
  readonly pendingCount: number;
}

// ============ Options ============

export interface ApprovalServiceOptions {
  readonly defaultTimeout?: number; // default 60000ms
  readonly onApprovalCreated?: (
    approvalId: string,
    request: ApprovalRequest,
  ) => void;
}

// ============ Internal ============

interface PendingApproval {
  readonly sessionId: string;
  readonly resolve: (result: ApprovalResult) => void;
  readonly timerId: ReturnType<typeof setTimeout>;
}

// ============ Implementation ============

class ApprovalServiceImpl implements ApprovalService {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly defaultTimeout: number;
  private readonly onApprovalCreated?: (
    approvalId: string,
    request: ApprovalRequest,
  ) => void;

  constructor(options?: ApprovalServiceOptions) {
    this.defaultTimeout = options?.defaultTimeout ?? 60000;
    if (options?.onApprovalCreated) {
      this.onApprovalCreated = options.onApprovalCreated;
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  requestApproval(request: ApprovalRequest): ApprovalHandle {
    const approvalId = randomUUID();

    const result = new Promise<ApprovalResult>((resolve) => {
      const timerId = setTimeout(() => {
        if (this.pending.has(approvalId)) {
          this.pending.delete(approvalId);
          resolve({ approved: false, reason: "timeout" });
        }
      }, this.defaultTimeout);

      this.pending.set(approvalId, {
        sessionId: request.sessionId,
        resolve,
        timerId,
      });
    });

    this.onApprovalCreated?.(approvalId, request);

    return { approvalId, result };
  }

  handleUserResponse(approvalId: string, approved: boolean): void {
    const entry = this.pending.get(approvalId);
    if (!entry) return;

    clearTimeout(entry.timerId);
    this.pending.delete(approvalId);

    if (approved) {
      entry.resolve({ approved: true });
    } else {
      entry.resolve({ approved: false, reason: "user_rejected" });
    }
  }

  rejectAllPending(sessionId: string): void {
    for (const [id, entry] of this.pending) {
      if (entry.sessionId === sessionId) {
        clearTimeout(entry.timerId);
        this.pending.delete(id);
        entry.resolve({ approved: false, reason: "session_ended" });
      }
    }
  }
}

// ============ Factory ============

export function createApprovalService(
  options?: ApprovalServiceOptions,
): ApprovalService {
  return new ApprovalServiceImpl(options);
}
