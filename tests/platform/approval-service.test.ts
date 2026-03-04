/**
 * ApprovalService 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * PS-3: Promise-based suspend/resume/timeout
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("ApprovalService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  // 辅助：创建 ApprovalService 实例
  async function createService(
    options?: Record<string, unknown>,
  ) {
    const { createApprovalService } = await import(
      "@/platform/approval-service"
    );
    return createApprovalService(options as Parameters<typeof createApprovalService>[0]);
  }

  // ============ Core Flow ============

  describe("PS-3: Core Flow", () => {
    it("AS-01: requestApproval 返回 Promise + 生成 approvalId", async () => {
      const svc = await createService();
      const { approvalId, result } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "执行 ls -la",
      });

      expect(approvalId).toBeDefined();
      expect(typeof approvalId).toBe("string");
      expect(approvalId.length).toBeGreaterThan(0);
      expect(result).toBeInstanceOf(Promise);
    });

    it("AS-02: onApprovalCreated 回调被调用", async () => {
      const callback = vi.fn();
      const svc = await createService({
        onApprovalCreated: callback,
      });

      const { approvalId } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "执行 ls -la",
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        approvalId,
        expect.objectContaining({
          sessionId: "s1",
          action: "tool:execute",
          subject: "shell",
        }),
      );
    });

    it("AS-03: handleUserResponse approved=true → { approved: true }", async () => {
      const svc = await createService();
      const { approvalId, result } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "执行 ls -la",
      });

      svc.handleUserResponse(approvalId, true);

      const outcome = await result;
      expect(outcome).toEqual({ approved: true });
    });

    it("AS-04: handleUserResponse approved=false → { approved: false, reason: 'user_rejected' }", async () => {
      const svc = await createService();
      const { approvalId, result } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "执行 rm -rf",
      });

      svc.handleUserResponse(approvalId, false);

      const outcome = await result;
      expect(outcome).toEqual({
        approved: false,
        reason: "user_rejected",
      });
    });

    it("AS-05: 未知 approvalId → 无效果（不抛异常）", async () => {
      const svc = await createService();
      expect(() =>
        svc.handleUserResponse("nonexistent-id", true),
      ).not.toThrow();
    });

    it("AS-06: 重复响应 → 第二次无效", async () => {
      const svc = await createService();
      const { approvalId, result } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "test",
      });

      svc.handleUserResponse(approvalId, true);
      svc.handleUserResponse(approvalId, false); // 第二次无效

      const outcome = await result;
      expect(outcome).toEqual({ approved: true }); // 保持第一次结果
    });
  });

  // ============ Timeout ============

  describe("PS-3: Timeout", () => {
    it("AS-07: 超时 → { approved: false, reason: 'timeout' }", async () => {
      const svc = await createService({ defaultTimeout: 5000 });
      const { result } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "test",
      });

      vi.advanceTimersByTime(5001);

      const outcome = await result;
      expect(outcome).toEqual({
        approved: false,
        reason: "timeout",
      });
    });

    it("AS-08: 自定义超时生效", async () => {
      const svc = await createService({ defaultTimeout: 2000 });
      const { result } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "test",
      });

      // 2秒内未超时
      vi.advanceTimersByTime(1999);
      expect(svc.pendingCount).toBe(1);

      // 超时
      vi.advanceTimersByTime(2);
      const outcome = await result;
      expect(outcome).toEqual({
        approved: false,
        reason: "timeout",
      });
    });
  });

  // ============ Session Management ============

  describe("PS-3: Session Management", () => {
    it("AS-09: rejectAllPending → 'session_ended'", async () => {
      const svc = await createService();
      const { result: r1 } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "test1",
      });
      const { result: r2 } = svc.requestApproval({
        sessionId: "s1",
        action: "file:write",
        subject: "/tmp/test",
        description: "test2",
      });

      svc.rejectAllPending("s1");

      const [o1, o2] = await Promise.all([r1, r2]);
      expect(o1).toEqual({ approved: false, reason: "session_ended" });
      expect(o2).toEqual({ approved: false, reason: "session_ended" });
    });

    it("AS-10: rejectAllPending 不影响其他 session", async () => {
      const svc = await createService();
      const { result: r1 } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "s1 task",
      });
      const { approvalId: id2, result: r2 } = svc.requestApproval({
        sessionId: "s2",
        action: "tool:execute",
        subject: "browser",
        description: "s2 task",
      });

      svc.rejectAllPending("s1");

      const o1 = await r1;
      expect(o1).toEqual({ approved: false, reason: "session_ended" });

      // s2 仍 pending
      expect(svc.pendingCount).toBe(1);

      // s2 可以正常处理
      svc.handleUserResponse(id2, true);
      const o2 = await r2;
      expect(o2).toEqual({ approved: true });
    });

    it("AS-11: 多 session 并发审批独立工作", async () => {
      const svc = await createService();
      const { approvalId: id1, result: r1 } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "s1",
      });
      const { approvalId: id2, result: r2 } = svc.requestApproval({
        sessionId: "s2",
        action: "tool:execute",
        subject: "browser",
        description: "s2",
      });

      expect(svc.pendingCount).toBe(2);

      svc.handleUserResponse(id2, true);
      svc.handleUserResponse(id1, false);

      const [o1, o2] = await Promise.all([r1, r2]);
      expect(o1).toEqual({ approved: false, reason: "user_rejected" });
      expect(o2).toEqual({ approved: true });
    });
  });

  // ============ Pending Count ============

  describe("PS-3: Pending Count", () => {
    it("AS-12: pendingCount 反映当前状态", async () => {
      const svc = await createService();
      expect(svc.pendingCount).toBe(0);

      const { approvalId: id1 } = svc.requestApproval({
        sessionId: "s1",
        action: "tool:execute",
        subject: "shell",
        description: "t1",
      });
      expect(svc.pendingCount).toBe(1);

      svc.requestApproval({
        sessionId: "s1",
        action: "file:write",
        subject: "/tmp/test",
        description: "t2",
      });
      expect(svc.pendingCount).toBe(2);

      svc.handleUserResponse(id1, true);
      expect(svc.pendingCount).toBe(1);
    });
  });
});
