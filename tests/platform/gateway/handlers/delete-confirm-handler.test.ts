/**
 * 删除确认处理器测试
 *
 * KURISU-024: 会话设置流水线重构
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DeleteConfirmHandler,
  createDeleteConfirmHandler,
} from "../../../../src/platform/gateway/handlers/delete-confirm-handler";
import type { SessionPermissionManagerLike } from "../../../../src/platform/gateway/types";

// Mock SessionPermissionManagerLike
function createMockPermissionManager(): SessionPermissionManagerLike {
  return {
    getPermission: vi.fn(),
    requestPermissionChange: vi.fn(),
    applyApprovedChange: vi.fn(),
    resetToDefault: vi.fn(),
    isDowngrade: vi.fn(),
    getPermissionDisplayName: vi.fn(),
    requestDisableDeleteConfirmation: vi.fn(),
    applyDisableDeleteConfirmation: vi.fn(),
    enableDeleteConfirmation: vi.fn(() => ({ message: "好的，删除确认已开启。" })),
    getDeleteConfirmationState: vi.fn(),
  };
}

describe("DeleteConfirmHandler", () => {
  let handler: DeleteConfirmHandler;
  let mockManager: SessionPermissionManagerLike;
  const sessionId = "test-session";

  beforeEach(() => {
    mockManager = createMockPermissionManager();
    handler = createDeleteConfirmHandler(mockManager);
    vi.clearAllMocks();
  });

  describe("构造和属性", () => {
    it("应该正确设置 type 属性", () => {
      expect(handler.type).toBe("delete_confirm");
    });
  });

  describe("detectIntent", () => {
    it("应该检测到 '删除不要确认' 意图（disable）", () => {
      const result = handler.detectIntent("删除不要确认");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("disable");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("应该检测到 '关闭删除确认' 意图（disable）", () => {
      const result = handler.detectIntent("关闭删除确认");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("disable");
    });

    it("应该检测到 '开启删除确认' 意图（enable）", () => {
      const result = handler.detectIntent("开启删除确认");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("enable");
    });

    it("应该检测到 '删除文件需要确认' 意图（enable）", () => {
      const result = handler.detectIntent("删除文件需要确认");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("enable");
    });

    it("不应该检测到无关消息", () => {
      const result = handler.detectIntent("今天天气怎么样");
      expect(result.isIntent).toBe(false);
    });
  });

  describe("hasPending", () => {
    it("初始状态应该没有待处理的审批", () => {
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("请求关闭删除确认后应该有 pending 审批", async () => {
      vi.mocked(mockManager.requestDisableDeleteConfirmation).mockReturnValue({
        message: "关闭删除确认有风险，确认继续？",
      });

      const intent = handler.detectIntent("关闭删除确认");
      await handler.handleIntent(sessionId, intent);

      expect(handler.hasPending(sessionId)).toBe(true);
    });
  });

  describe("handleIntent", () => {
    describe("开启删除确认", () => {
      it("开启删除确认应该直接执行", async () => {
        const intent = handler.detectIntent("开启删除确认");
        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(true);
        expect(result.message).toBe("好的，删除确认已开启。");
        expect(result.requiresApproval).toBeFalsy();
        expect(mockManager.enableDeleteConfirmation).toHaveBeenCalledWith(
          sessionId,
        );
      });
    });

    describe("关闭删除确认", () => {
      it("关闭删除确认应该需要审批", async () => {
        vi.mocked(mockManager.requestDisableDeleteConfirmation).mockReturnValue({
          message: "关闭删除确认有风险，确认继续？",
        });

        const intent = handler.detectIntent("关闭删除确认");
        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.approvalMessage).toBe("关闭删除确认有风险，确认继续？");
        expect(handler.hasPending(sessionId)).toBe(true);
      });
    });

    describe("无效输入", () => {
      it("没有 action 时应该返回 handled: false", async () => {
        const intent = {
          isIntent: true,
          confidence: 0.8,
          action: undefined,
          originalInput: "随机消息",
        };

        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(false);
      });
    });
  });

  describe("handleApprovalReply", () => {
    beforeEach(async () => {
      // 设置 pending 状态
      vi.mocked(mockManager.requestDisableDeleteConfirmation).mockReturnValue({
        message: "关闭删除确认有风险，确认继续？",
      });

      const intent = handler.detectIntent("关闭删除确认");
      await handler.handleIntent(sessionId, intent);
    });

    it("没有 pending 审批时应该返回 isApprovalReply: false", async () => {
      const result = await handler.handleApprovalReply(
        "other-session",
        "确定",
      );
      expect(result.isApprovalReply).toBe(false);
    });

    it("用户确认应该关闭删除确认", async () => {
      const result = await handler.handleApprovalReply(sessionId, "确定");

      expect(result.isApprovalReply).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.message).toContain("已关闭删除确认");
      expect(mockManager.applyDisableDeleteConfirmation).toHaveBeenCalledWith(
        sessionId,
      );
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("用户拒绝应该保持删除确认开启", async () => {
      const result = await handler.handleApprovalReply(sessionId, "取消");

      expect(result.isApprovalReply).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.message).toBe("好的，删除确认保持开启。");
      expect(mockManager.applyDisableDeleteConfirmation).not.toHaveBeenCalled();
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("非确认/拒绝消息应该返回 isApprovalReply: false", async () => {
      const result = await handler.handleApprovalReply(
        sessionId,
        "随机消息",
      );

      expect(result.isApprovalReply).toBe(false);
      expect(handler.hasPending(sessionId)).toBe(true);
    });

    it("应该支持多种确认表达", async () => {
      const confirmPhrases = ["是", "ok", "好的", "yes", "可以"];

      for (const phrase of confirmPhrases) {
        // 重新设置 pending 状态
        vi.mocked(mockManager.requestDisableDeleteConfirmation).mockReturnValue({
          message: "确认？",
        });
        const intent = handler.detectIntent("关闭删除确认");
        await handler.handleIntent(sessionId, intent);

        const result = await handler.handleApprovalReply(sessionId, phrase);
        expect(result.isApprovalReply).toBe(true);
        expect(result.approved).toBe(true);
      }
    });

    it("应该支持多种拒绝表达", async () => {
      const rejectPhrases = ["否", "no", "不用", "不要"];

      for (const phrase of rejectPhrases) {
        // 重新设置 pending 状态
        vi.mocked(mockManager.requestDisableDeleteConfirmation).mockReturnValue({
          message: "确认？",
        });
        const intent = handler.detectIntent("关闭删除确认");
        await handler.handleIntent(sessionId, intent);

        const result = await handler.handleApprovalReply(sessionId, phrase);
        expect(result.isApprovalReply).toBe(true);
        expect(result.approved).toBe(false);
      }
    });
  });
});
