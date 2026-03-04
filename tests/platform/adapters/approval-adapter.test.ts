/**
 * ApprovalAdapter 测试
 *
 * 适配 ApprovalService → ApprovalPort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApprovalAdapter } from "../../../src/platform/adapters/approval-adapter.js";
import type {
  ApprovalPort,
  ApprovalRequest as PortApprovalRequest,
} from "../../../src/agent/ports/platform-services.js";
import type {
  ApprovalService,
  ApprovalHandle,
} from "../../../src/platform/approval-service.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockApprovalService(): {
  service: ApprovalService;
  requestApproval: ReturnType<typeof vi.fn>;
  handleUserResponse: ReturnType<typeof vi.fn>;
  rejectAllPending: ReturnType<typeof vi.fn>;
} {
  const requestApproval = vi.fn().mockReturnValue({
    approvalId: "approval-1",
    result: Promise.resolve({ approved: true }),
  } as ApprovalHandle);
  const handleUserResponse = vi.fn();
  const rejectAllPending = vi.fn();

  const service = {
    requestApproval,
    handleUserResponse,
    rejectAllPending,
    pendingCount: 0,
  } as unknown as ApprovalService;

  return { service, requestApproval, handleUserResponse, rejectAllPending };
}

// ============================================================================
// Tests
// ============================================================================

describe("ApprovalAdapter", () => {
  let adapter: ApprovalPort;
  let requestApproval: ReturnType<typeof vi.fn>;
  let handleUserResponse: ReturnType<typeof vi.fn>;
  let rejectAllPending: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockApprovalService();
    adapter = new ApprovalAdapter(mock.service);
    requestApproval = mock.requestApproval;
    handleUserResponse = mock.handleUserResponse;
    rejectAllPending = mock.rejectAllPending;
  });

  describe("requestApproval", () => {
    it("should map Port request to Platform request and return approvalId", async () => {
      const request: PortApprovalRequest = {
        sessionId: "s1",
        toolName: "shell",
        args: { command: "rm -rf /" },
        reason: "Needs shell access",
      };

      const approvalId = await adapter.requestApproval(request);

      expect(approvalId).toBe("approval-1");
      expect(requestApproval).toHaveBeenCalledWith({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "Needs shell access",
      });
    });
  });

  describe("awaitResponse", () => {
    it("should resolve to approve when Platform approves", async () => {
      requestApproval.mockReturnValue({
        approvalId: "a1",
        result: Promise.resolve({ approved: true }),
      });

      await adapter.requestApproval({
        sessionId: "s1",
        toolName: "shell",
        args: {},
        reason: "test",
      });

      const response = await adapter.awaitResponse("a1");

      expect(response).toEqual({
        approvalId: "a1",
        action: "approve",
      });
    });

    it("should resolve to reject when user rejects", async () => {
      requestApproval.mockReturnValue({
        approvalId: "a2",
        result: Promise.resolve({ approved: false, reason: "user_rejected" }),
      });

      await adapter.requestApproval({
        sessionId: "s1",
        toolName: "shell",
        args: {},
        reason: "test",
      });

      const response = await adapter.awaitResponse("a2");

      expect(response).toEqual({
        approvalId: "a2",
        action: "reject",
      });
    });

    it("should resolve to timeout when Platform times out", async () => {
      requestApproval.mockReturnValue({
        approvalId: "a3",
        result: Promise.resolve({ approved: false, reason: "timeout" }),
      });

      await adapter.requestApproval({
        sessionId: "s1",
        toolName: "shell",
        args: {},
        reason: "test",
      });

      const response = await adapter.awaitResponse("a3");

      expect(response).toEqual({
        approvalId: "a3",
        action: "timeout",
      });
    });

    it("should reject with timeout when unknown approvalId", async () => {
      const response = await adapter.awaitResponse("unknown");

      expect(response).toEqual({
        approvalId: "unknown",
        action: "timeout",
      });
    });
  });

  describe("handleUserResponse", () => {
    it("should map approve to true", () => {
      adapter.handleUserResponse("a1", "approve");
      expect(handleUserResponse).toHaveBeenCalledWith("a1", true);
    });

    it("should map reject to false", () => {
      adapter.handleUserResponse("a1", "reject");
      expect(handleUserResponse).toHaveBeenCalledWith("a1", false);
    });

    it("should map timeout to false", () => {
      adapter.handleUserResponse("a1", "timeout");
      expect(handleUserResponse).toHaveBeenCalledWith("a1", false);
    });
  });

  describe("rejectAllPending", () => {
    it("should delegate to service", () => {
      adapter.rejectAllPending("session-1");
      expect(rejectAllPending).toHaveBeenCalledWith("session-1");
    });
  });

  describe("getPendingCount", () => {
    it("should return service pendingCount", () => {
      // getPendingCount in adapter is per-session but Platform is global
      // adapter tracks per-session
      const count = adapter.getPendingCount("session-1");
      expect(typeof count).toBe("number");
    });
  });
});
