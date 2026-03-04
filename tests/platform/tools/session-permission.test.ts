/**
 * 会话权限管理器测试
 *
 * KURISU-021: 会话级权限切换功能
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SessionPermissionManager,
  createSessionPermissionManager,
} from "../../../src/platform/tools/session-permission";
import type { FilePermissionLevel } from "../../../src/platform/models/executor-types";

describe("SessionPermissionManager", () => {
  let manager: SessionPermissionManager;

  beforeEach(() => {
    manager = createSessionPermissionManager();
  });

  describe("getPermission", () => {
    it("应该返回默认权限（未设置临时权限时）", () => {
      expect(manager.getPermission("session-1", "sandbox")).toBe("sandbox");
      expect(manager.getPermission("session-1", "restricted")).toBe(
        "restricted",
      );
      expect(manager.getPermission("session-1", "full_access")).toBe(
        "full_access",
      );
    });

    it("应该返回临时权限（已设置时）", () => {
      manager.requestPermissionChange("session-1", "restricted", "sandbox");
      manager.applyApprovedChange("session-1", "restricted");

      expect(manager.getPermission("session-1", "sandbox")).toBe("restricted");
    });
  });

  describe("hasTemporaryPermission", () => {
    it("未设置时应该返回 false", () => {
      expect(manager.hasTemporaryPermission("session-1")).toBe(false);
    });

    it("设置后应该返回 true", () => {
      manager.requestPermissionChange("session-1", "restricted", "sandbox");
      manager.applyApprovedChange("session-1", "restricted");

      expect(manager.hasTemporaryPermission("session-1")).toBe(true);
    });
  });

  describe("requestPermissionChange", () => {
    describe("降级操作", () => {
      it("降级应该直接成功（无需审批）", () => {
        const result = manager.requestPermissionChange(
          "session-1",
          "sandbox",
          "full_access",
        );

        expect(result.success).toBe(true);
        expect(result.requiresApproval).toBe(false);
        expect(result.newPermission).toBe("sandbox");
        expect(result.isDowngrade).toBe(true);
        expect(result.isUpgrade).toBe(false);
      });

      it("降级后 getPermission 应该返回新权限", () => {
        manager.requestPermissionChange("session-1", "sandbox", "full_access");

        expect(manager.getPermission("session-1", "full_access")).toBe(
          "sandbox",
        );
      });

      it("restricted → sandbox 应该是降级", () => {
        const result = manager.requestPermissionChange(
          "session-1",
          "sandbox",
          "restricted",
        );

        expect(result.isDowngrade).toBe(true);
        expect(result.success).toBe(true);
      });
    });

    describe("升级操作", () => {
      it("升级应该需要审批", () => {
        const result = manager.requestPermissionChange(
          "session-1",
          "full_access",
          "sandbox",
        );

        expect(result.success).toBe(false);
        expect(result.requiresApproval).toBe(true);
        expect(result.isUpgrade).toBe(true);
        expect(result.approvalRequest).toBeDefined();
      });

      it("升级请求应该包含正确的审批信息", () => {
        const result = manager.requestPermissionChange(
          "session-1",
          "restricted",
          "sandbox",
        );

        expect(result.approvalRequest?.currentPermission).toBe("sandbox");
        expect(result.approvalRequest?.targetPermission).toBe("restricted");
        expect(result.approvalRequest?.riskLevel).toBe("medium");
        expect(result.approvalRequest?.message).toContain("沙箱模式");
        expect(result.approvalRequest?.message).toContain("受限模式");
      });

      it("升级到 full_access 应该有高风险等级和警告", () => {
        const result = manager.requestPermissionChange(
          "session-1",
          "full_access",
          "sandbox",
        );

        expect(result.approvalRequest?.riskLevel).toBe("high");
        expect(result.approvalRequest?.warning).toBeDefined();
      });

      it("升级不应该立即改变权限", () => {
        manager.requestPermissionChange("session-1", "full_access", "sandbox");

        expect(manager.getPermission("session-1", "sandbox")).toBe("sandbox");
      });
    });

    describe("相同权限", () => {
      it("目标权限与当前相同时应该返回成功", () => {
        const result = manager.requestPermissionChange(
          "session-1",
          "sandbox",
          "sandbox",
        );

        expect(result.success).toBe(true);
        expect(result.requiresApproval).toBe(false);
        expect(result.reason).toBe("权限已经是目标级别");
      });
    });

    describe("临时权限场景", () => {
      it("从临时权限升级应该需要审批", () => {
        // 先设置临时权限为 restricted
        manager.applyApprovedChange("session-1", "restricted");

        // 再请求升级到 full_access
        const result = manager.requestPermissionChange(
          "session-1",
          "full_access",
          "sandbox", // 默认权限
        );

        expect(result.requiresApproval).toBe(true);
        expect(result.approvalRequest?.currentPermission).toBe("restricted");
      });

      it("从临时权限降级应该直接成功", () => {
        // 先设置临时权限为 full_access
        manager.applyApprovedChange("session-1", "full_access");

        // 再请求降级到 sandbox
        const result = manager.requestPermissionChange(
          "session-1",
          "sandbox",
          "restricted",
        );

        expect(result.success).toBe(true);
        expect(result.isDowngrade).toBe(true);
      });
    });
  });

  describe("applyApprovedChange", () => {
    it("应该应用审批通过的权限变更", () => {
      manager.applyApprovedChange("session-1", "full_access");

      expect(manager.getPermission("session-1", "sandbox")).toBe("full_access");
    });

    it("应该更新会话状态", () => {
      manager.applyApprovedChange("session-1", "restricted");

      const state = manager.getSessionState("session-1");
      expect(state).toBeDefined();
      expect(state?.permission).toBe("restricted");
      expect(state?.updatedAt).toBeGreaterThan(0);
    });
  });

  describe("resetToDefault", () => {
    it("应该清除临时权限", () => {
      manager.applyApprovedChange("session-1", "full_access");
      expect(manager.hasTemporaryPermission("session-1")).toBe(true);

      const result = manager.resetToDefault("session-1");

      expect(result).toBe(true);
      expect(manager.hasTemporaryPermission("session-1")).toBe(false);
      expect(manager.getPermission("session-1", "sandbox")).toBe("sandbox");
    });

    it("清除不存在的会话应该返回 false", () => {
      const result = manager.resetToDefault("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("应该清除所有会话的临时权限", () => {
      manager.applyApprovedChange("session-1", "full_access");
      manager.applyApprovedChange("session-2", "restricted");

      manager.clearAll();

      expect(manager.hasTemporaryPermission("session-1")).toBe(false);
      expect(manager.hasTemporaryPermission("session-2")).toBe(false);
    });
  });

  describe("getAllSessions", () => {
    it("应该返回所有会话状态", () => {
      manager.applyApprovedChange("session-1", "full_access");
      manager.applyApprovedChange("session-2", "restricted");

      const sessions = manager.getAllSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.sessionId)).toContain("session-1");
      expect(sessions.map((s) => s.sessionId)).toContain("session-2");
    });

    it("空管理器应该返回空数组", () => {
      expect(manager.getAllSessions()).toHaveLength(0);
    });
  });

  describe("isUpgrade", () => {
    it("应该正确判断升级", () => {
      expect(manager.isUpgrade("sandbox", "restricted")).toBe(true);
      expect(manager.isUpgrade("sandbox", "full_access")).toBe(true);
      expect(manager.isUpgrade("restricted", "full_access")).toBe(true);
    });

    it("同级和降级应该返回 false", () => {
      expect(manager.isUpgrade("sandbox", "sandbox")).toBe(false);
      expect(manager.isUpgrade("full_access", "sandbox")).toBe(false);
    });
  });

  describe("isDowngrade", () => {
    it("应该正确判断降级", () => {
      expect(manager.isDowngrade("full_access", "restricted")).toBe(true);
      expect(manager.isDowngrade("full_access", "sandbox")).toBe(true);
      expect(manager.isDowngrade("restricted", "sandbox")).toBe(true);
    });

    it("同级和升级应该返回 false", () => {
      expect(manager.isDowngrade("sandbox", "sandbox")).toBe(false);
      expect(manager.isDowngrade("sandbox", "full_access")).toBe(false);
    });
  });

  describe("getPermissionDisplayName", () => {
    it("应该返回正确的显示名称", () => {
      expect(manager.getPermissionDisplayName("sandbox")).toBe("沙箱模式");
      expect(manager.getPermissionDisplayName("restricted")).toBe("受限模式");
      expect(manager.getPermissionDisplayName("full_access")).toBe("完全访问");
    });
  });

  describe("getPermissionDescription", () => {
    it("应该返回正确的描述", () => {
      expect(manager.getPermissionDescription("sandbox")).toContain("沙箱");
      expect(manager.getPermissionDescription("restricted")).toContain("指定");
      expect(manager.getPermissionDescription("full_access")).toContain(
        "整个电脑",
      );
    });
  });

  // ============================================
  // KURISU-023 方案B: 删除确认开关
  // ============================================

  describe("shouldSkipDeleteConfirmation", () => {
    it("默认应该返回 false（需要确认）", () => {
      expect(manager.shouldSkipDeleteConfirmation("session-1")).toBe(false);
    });

    it("关闭删除确认后应该返回 true", () => {
      manager.applyDisableDeleteConfirmation("session-1");
      expect(manager.shouldSkipDeleteConfirmation("session-1")).toBe(true);
    });
  });

  describe("requestDisableDeleteConfirmation", () => {
    it("首次请求应该需要确认", () => {
      const result = manager.requestDisableDeleteConfirmation("session-1");

      expect(result.success).toBe(false);
      expect(result.skipDeleteConfirmation).toBe(false);
      expect(result.message).toContain("确定要继续吗");
      expect(result.warning).toBeDefined();
    });

    it("已经关闭时应该返回成功", () => {
      manager.applyDisableDeleteConfirmation("session-1");
      const result = manager.requestDisableDeleteConfirmation("session-1");

      expect(result.success).toBe(true);
      expect(result.skipDeleteConfirmation).toBe(true);
      expect(result.message).toContain("已经关闭");
    });
  });

  describe("applyDisableDeleteConfirmation", () => {
    it("应该应用关闭删除确认", () => {
      manager.applyDisableDeleteConfirmation("session-1");

      expect(manager.shouldSkipDeleteConfirmation("session-1")).toBe(true);

      const state = manager.getSessionState("session-1");
      expect(state?.skipDeleteConfirmation).toBe(true);
    });
  });

  describe("enableDeleteConfirmation", () => {
    it("应该恢复删除确认", () => {
      manager.applyDisableDeleteConfirmation("session-1");
      expect(manager.shouldSkipDeleteConfirmation("session-1")).toBe(true);

      const result = manager.enableDeleteConfirmation("session-1");

      expect(result.success).toBe(true);
      expect(result.skipDeleteConfirmation).toBe(false);
      expect(result.message).toContain("恢复删除确认");
      expect(manager.shouldSkipDeleteConfirmation("session-1")).toBe(false);
    });

    it("已经是开启状态时应该返回成功", () => {
      const result = manager.enableDeleteConfirmation("session-1");

      expect(result.success).toBe(true);
      expect(result.skipDeleteConfirmation).toBe(false);
      expect(result.message).toContain("已经是开启状态");
    });
  });
});
