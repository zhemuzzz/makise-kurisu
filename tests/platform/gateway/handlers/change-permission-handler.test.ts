/**
 * 权限切换处理器测试
 *
 * KURISU-024: 会话设置流水线重构
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ChangePermissionHandler,
  createChangePermissionHandler,
} from "../../../../src/platform/gateway/handlers/change-permission-handler";
import type {
  SessionPermissionManagerLike,
  FilePermissionLevel,
  PermissionChangeResult,
  PermissionApprovalRequest,
} from "../../../../src/platform/gateway/types";

// Mock SessionPermissionManagerLike
function createMockPermissionManager(): SessionPermissionManagerLike {
  return {
    getPermission: vi.fn(),
    requestPermissionChange: vi.fn(),
    applyApprovedChange: vi.fn(),
    resetToDefault: vi.fn(),
    isDowngrade: vi.fn(),
    getPermissionDisplayName: vi.fn((level: FilePermissionLevel) => {
      const names: Record<FilePermissionLevel, string> = {
        sandbox: "沙箱模式",
        restricted: "受限模式",
        full_access: "完全访问",
      };
      return names[level];
    }),
    requestDisableDeleteConfirmation: vi.fn(),
    applyDisableDeleteConfirmation: vi.fn(),
    enableDeleteConfirmation: vi.fn(),
    getDeleteConfirmationState: vi.fn(),
  };
}

describe("ChangePermissionHandler", () => {
  let handler: ChangePermissionHandler;
  let mockManager: SessionPermissionManagerLike;
  const sessionId = "test-session";
  const defaultPermission: FilePermissionLevel = "sandbox";

  beforeEach(() => {
    mockManager = createMockPermissionManager();
    handler = createChangePermissionHandler(mockManager, defaultPermission);
    vi.clearAllMocks();
  });

  describe("构造和属性", () => {
    it("应该正确设置 type 属性", () => {
      expect(handler.type).toBe("change_permission");
    });
  });

  describe("detectIntent", () => {
    it("应该检测到 '升级权限' 意图", () => {
      const result = handler.detectIntent("升级权限");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("upgrade");
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("应该检测到 '切换到完全访问' 意图", () => {
      const result = handler.detectIntent("切换到完全访问");
      expect(result.isIntent).toBe(true);
      expect(result.targetValue).toBe("full_access");
    });

    it("应该检测到 '降级权限' 意图", () => {
      const result = handler.detectIntent("降级权限");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("downgrade");
    });

    it("应该检测到 '重置权限' 意图", () => {
      const result = handler.detectIntent("重置权限");
      expect(result.isIntent).toBe(true);
      expect(result.action).toBe("reset");
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

    it("有 pending 审批时应该返回 true", async () => {
      // 模拟权限升级需要审批
      vi.mocked(mockManager.getPermission).mockReturnValue("sandbox");
      vi.mocked(mockManager.isDowngrade).mockReturnValue(false);
      vi.mocked(mockManager.requestPermissionChange).mockReturnValue({
        success: false,
        requiresApproval: true,
        isUpgrade: true,
        isDowngrade: false,
        approvalRequest: {
          id: "test-id",
          sessionId,
          currentPermission: "sandbox",
          targetPermission: "full_access",
          riskLevel: "high",
          message: "确认升级？",
        },
      });

      const intent = handler.detectIntent("升级到完全访问");
      await handler.handleIntent(sessionId, intent);

      expect(handler.hasPending(sessionId)).toBe(true);
    });
  });

  describe("handleIntent", () => {
    describe("重置权限", () => {
      it("重置成功应该返回正确的消息", async () => {
        vi.mocked(mockManager.resetToDefault).mockReturnValue(true);

        const intent = handler.detectIntent("重置权限");
        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(true);
        expect(result.message).toBe("好的，权限已恢复默认设置。");
      });

      it("已经是默认设置时应该返回相应消息", async () => {
        vi.mocked(mockManager.resetToDefault).mockReturnValue(false);

        const intent = handler.detectIntent("重置权限");
        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(true);
        expect(result.message).toBe("权限已经是默认设置。");
      });
    });

    describe("权限降级", () => {
      it("权限降级应该直接执行", async () => {
        vi.mocked(mockManager.getPermission).mockReturnValue("full_access");
        vi.mocked(mockManager.isDowngrade).mockReturnValue(true);

        const intent = handler.detectIntent("降级到沙箱模式");
        intent.targetValue = "sandbox"; // 确保有目标值

        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(true);
        expect(result.message).toContain("沙箱模式");
        expect(result.requiresApproval).toBeFalsy();
        expect(mockManager.applyApprovedChange).toHaveBeenCalledWith(
          sessionId,
          "sandbox",
        );
      });
    });

    describe("权限升级", () => {
      it("权限升级应该需要审批", async () => {
        vi.mocked(mockManager.getPermission).mockReturnValue("sandbox");
        vi.mocked(mockManager.isDowngrade).mockReturnValue(false);

        const approvalRequest: PermissionApprovalRequest = {
          id: "approval-123",
          sessionId,
          currentPermission: "sandbox",
          targetPermission: "full_access",
          riskLevel: "high",
          message: "升级到完全访问模式存在风险，确认继续？",
        };

        vi.mocked(mockManager.requestPermissionChange).mockReturnValue({
          success: false,
          requiresApproval: true,
          isUpgrade: true,
          isDowngrade: false,
          approvalRequest,
        });

        const intent = handler.detectIntent("升级到完全访问");
        intent.targetValue = "full_access"; // 确保有目标值

        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.approvalMessage).toBe(approvalRequest.message);
        expect(handler.hasPending(sessionId)).toBe(true);
      });
    });

    describe("无效输入", () => {
      it("没有目标级别时应该返回 handled: false", async () => {
        const intent = {
          isIntent: true,
          confidence: 0.8,
          action: "upgrade",
          targetValue: undefined,
          originalInput: "升级权限",
        };

        const result = await handler.handleIntent(sessionId, intent);

        expect(result.handled).toBe(false);
      });
    });
  });

  describe("handleApprovalReply", () => {
    beforeEach(async () => {
      // 设置 pending 状态
      vi.mocked(mockManager.getPermission).mockReturnValue("sandbox");
      vi.mocked(mockManager.isDowngrade).mockReturnValue(false);

      const approvalRequest: PermissionApprovalRequest = {
        id: "approval-123",
        sessionId,
        currentPermission: "sandbox",
        targetPermission: "full_access",
        riskLevel: "high",
        message: "确认升级？",
      };

      vi.mocked(mockManager.requestPermissionChange).mockReturnValue({
        success: false,
        requiresApproval: true,
        isUpgrade: true,
        isDowngrade: false,
        approvalRequest,
      });

      const intent = handler.detectIntent("升级到完全访问");
      intent.targetValue = "full_access";
      await handler.handleIntent(sessionId, intent);
    });

    it("没有 pending 审批时应该返回 isApprovalReply: false", async () => {
      const result = await handler.handleApprovalReply(
        "other-session",
        "确定",
      );
      expect(result.isApprovalReply).toBe(false);
    });

    it("用户确认应该应用权限升级", async () => {
      const result = await handler.handleApprovalReply(sessionId, "确定");

      expect(result.isApprovalReply).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.message).toContain("完全访问");
      expect(mockManager.applyApprovedChange).toHaveBeenCalledWith(
        sessionId,
        "full_access",
      );
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("用户拒绝应该取消审批", async () => {
      const result = await handler.handleApprovalReply(sessionId, "取消");

      expect(result.isApprovalReply).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.message).toBe("好的，权限保持不变。");
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
  });
});
