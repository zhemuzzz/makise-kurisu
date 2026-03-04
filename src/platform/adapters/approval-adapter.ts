/**
 * ApprovalAdapter - ApprovalService → ApprovalPort
 *
 * 适配 Platform 的 ApprovalService 到 Agent 的 ApprovalPort 接口。
 * - ApprovalHandle 拆解为 requestApproval → awaitResponse 两步
 * - ApprovalResult → ApprovalResponse 映射
 * - 维护 approvalId → handle 映射表
 * - 追踪 per-session pending count
 *
 * @module platform/adapters/approval-adapter
 */

import type {
  ApprovalPort,
  ApprovalRequest as PortApprovalRequest,
  ApprovalResponse,
  UserApprovalAction,
} from "../../agent/ports/platform-services.js";
import type {
  ApprovalService,
  ApprovalHandle,
  ApprovalResult,
} from "../approval-service.js";

// ============================================================================
// Adapter
// ============================================================================

export class ApprovalAdapter implements ApprovalPort {
  private readonly service: ApprovalService;
  /** approvalId → { handle, sessionId } */
  private readonly handles = new Map<
    string,
    { handle: ApprovalHandle; sessionId: string }
  >();

  constructor(service: ApprovalService) {
    this.service = service;
  }

  async requestApproval(request: PortApprovalRequest): Promise<string> {
    const handle = this.service.requestApproval({
      sessionId: request.sessionId,
      action: "tool:execute",
      subject: request.toolName,
      description: request.reason,
    });

    this.handles.set(handle.approvalId, {
      handle,
      sessionId: request.sessionId,
    });

    return handle.approvalId;
  }

  async awaitResponse(
    approvalId: string,
    signal?: AbortSignal,
  ): Promise<ApprovalResponse> {
    const entry = this.handles.get(approvalId);
    if (entry === undefined) {
      return { approvalId, action: "timeout" };
    }

    try {
      let result: ApprovalResult;

      if (signal !== undefined) {
        // Race between approval result and abort signal
        result = await Promise.race([
          entry.handle.result,
          new Promise<ApprovalResult>((_, reject) => {
            signal.addEventListener("abort", () => {
              reject(new Error("Aborted"));
            }, { once: true });
          }),
        ]);
      } else {
        result = await entry.handle.result;
      }

      return {
        approvalId,
        action: mapResultToAction(result),
      };
    } catch {
      return { approvalId, action: "timeout" };
    } finally {
      this.handles.delete(approvalId);
    }
  }

  handleUserResponse(
    approvalId: string,
    response: UserApprovalAction,
  ): void {
    this.service.handleUserResponse(
      approvalId,
      response === "approve",
    );
  }

  rejectAllPending(sessionId: string): void {
    // Clean up tracked handles for this session
    for (const [id, entry] of this.handles) {
      if (entry.sessionId === sessionId) {
        this.handles.delete(id);
      }
    }
    this.service.rejectAllPending(sessionId);
  }

  getPendingCount(sessionId: string): number {
    let count = 0;
    for (const entry of this.handles.values()) {
      if (entry.sessionId === sessionId) {
        count++;
      }
    }
    return count;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function mapResultToAction(result: ApprovalResult): UserApprovalAction {
  if (result.approved) {
    return "approve";
  }
  if (result.reason === "timeout") {
    return "timeout";
  }
  return "reject";
}
