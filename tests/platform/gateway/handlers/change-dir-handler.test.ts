/**
 * ChangeDirHandler 测试
 *
 * KURISU-024: 会话设置流水线重构
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ChangeDirHandler,
  createChangeDirHandler,
} from "../../../../src/platform/gateway/handlers/change-dir-handler";
import type { SessionWorkDirManagerLike } from "../../../../src/platform/gateway/types";
import { MCPWorkDirSync } from "../../../../src/platform/tools/mcp-workdir-sync";

// ===========================================
// Mock SessionWorkDirManager
// ===========================================

function createMockWorkDirManager(): SessionWorkDirManagerLike {
  return {
    changeWorkingDir: vi.fn(),
    applyApprovedChange: vi.fn(),
    getWorkingDir: vi.fn(() => process.cwd()),
    hasPendingApproval: vi.fn(() => false),
  };
}

// ===========================================
// Tests
// ===========================================

describe("ChangeDirHandler", () => {
  let handler: ChangeDirHandler;
  let mockManager: SessionWorkDirManagerLike;

  const sessionId = "test-session-123";
  const defaultPermission = "sandbox";
  const allowedPaths = ["/home/user/allowed"];

  beforeEach(() => {
    mockManager = createMockWorkDirManager();
    handler = createChangeDirHandler(
      mockManager,
      defaultPermission,
      allowedPaths,
    );
  });

  describe("type", () => {
    it('should return "change_dir"', () => {
      expect(handler.type).toBe("change_dir");
    });
  });

  describe("detectIntent", () => {
    it("should detect 'cd /path' with high confidence", () => {
      const result = handler.detectIntent("cd /tmp");
      expect(result.isIntent).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.targetValue).toBe("/tmp");
    });

    it("should detect '切换目录到 xxx' with high confidence", () => {
      const result = handler.detectIntent("切换目录到 ~/Projects");
      expect(result.isIntent).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it("should not detect unrelated messages", () => {
      const result = handler.detectIntent("今天天气怎么样");
      expect(result.isIntent).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("should not detect messages without path", () => {
      const result = handler.detectIntent("我想切换目录"); // 没有目标路径
      expect(result.isIntent).toBe(false);
    });
  });

  describe("hasPending", () => {
    it("should return false initially", () => {
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("should return true after creating approval request", async () => {
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: false,
        requiresApproval: true,
        approvalRequest: {
          id: "approval-123",
          targetDir: "/etc",
          message: "需要确认",
        },
      });

      const intent = handler.detectIntent("cd /etc");
      await handler.handleIntent(sessionId, intent);

      expect(handler.hasPending(sessionId)).toBe(true);
    });
  });

  describe("handleIntent", () => {
    it("should return handled: false if no target directory", async () => {
      const result = await handler.handleIntent(sessionId, {
        isIntent: true,
        confidence: 0.9,
        originalInput: "cd",
      });

      expect(result.handled).toBe(false);
    });

    it("should handle direct success (sandbox path)", async () => {
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: true,
        newDir: "/tmp",
      });

      const intent = handler.detectIntent("cd /tmp");
      const result = await handler.handleIntent(sessionId, intent);

      expect(result.handled).toBe(true);
      expect(result.message).toContain("/tmp");
      expect(result.requiresApproval).toBeFalsy();
    });

    it("should request approval for protected path", async () => {
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: false,
        requiresApproval: true,
        approvalRequest: {
          id: "approval-123",
          targetDir: "/etc",
          message: "需要确认切换到 /etc",
        },
      });

      const intent = handler.detectIntent("cd /etc");
      const result = await handler.handleIntent(sessionId, intent);

      expect(result.handled).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalMessage).toBe("需要确认切换到 /etc");
      expect(handler.hasPending(sessionId)).toBe(true);
    });

    it("should handle failure with reason", async () => {
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: false,
        reason: "路径不存在",
      });

      const intent = handler.detectIntent("cd /nonexistent");
      const result = await handler.handleIntent(sessionId, intent);

      expect(result.handled).toBe(true);
      expect(result.message).toBe("路径不存在");
    });
  });

  describe("handleApprovalReply", () => {
    it("should return isApprovalReply: false if no pending approval", async () => {
      const result = await handler.handleApprovalReply(sessionId, "确认");

      expect(result.isApprovalReply).toBe(false);
    });

    it("should apply change on user confirm", async () => {
      // 先创建待审批
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: false,
        requiresApproval: true,
        approvalRequest: {
          id: "approval-123",
          targetDir: "/etc",
          message: "需要确认",
        },
      });

      const intent = handler.detectIntent("cd /etc");
      await handler.handleIntent(sessionId, intent);

      // 模拟用户确认
      vi.mocked(mockManager.applyApprovedChange).mockReturnValue({
        success: true,
        message: "好的，工作目录已切换到 `/etc`",
      });

      const result = await handler.handleApprovalReply(sessionId, "确定");

      expect(result.isApprovalReply).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.message).toContain("/etc");
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("should cancel on user reject", async () => {
      // 先创建待审批
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: false,
        requiresApproval: true,
        approvalRequest: {
          id: "approval-123",
          targetDir: "/etc",
          message: "需要确认",
        },
      });

      const intent = handler.detectIntent("cd /etc");
      await handler.handleIntent(sessionId, intent);

      const result = await handler.handleApprovalReply(sessionId, "取消");

      expect(result.isApprovalReply).toBe(true);
      expect(result.approved).toBe(false);
      expect(result.message).toContain("取消");
      expect(handler.hasPending(sessionId)).toBe(false);
    });

    it("should not reply if message is neither confirm nor reject", async () => {
      // 先创建待审批
      vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
        success: false,
        requiresApproval: true,
        approvalRequest: {
          id: "approval-123",
          targetDir: "/etc",
          message: "需要确认",
        },
      });

      const intent = handler.detectIntent("cd /etc");
      await handler.handleIntent(sessionId, intent);

      const result = await handler.handleApprovalReply(sessionId, "今天天气怎么样");

      expect(result.isApprovalReply).toBe(false);
      // pending 应该仍然存在
      expect(handler.hasPending(sessionId)).toBe(true);
    });
  });
});

describe("MCP WorkDir Sync integration", () => {
  let mockManager: SessionWorkDirManagerLike;

  const sessionId = "test-session-123";
  const defaultPermission = "sandbox";
  const allowedPaths = ["/home/user/allowed"];

  beforeEach(() => {
    mockManager = createMockWorkDirManager();
  });

  it("should trigger MCP sync on direct directory change success", async () => {
    const mockSync = {
      onWorkDirChanged: vi.fn().mockResolvedValue({
        success: true,
        workDir: "/tmp",
        restarted: ["filesystem"],
        failed: [],
        skipped: [],
        elapsedMs: 42,
      }),
    } as unknown as MCPWorkDirSync;

    vi.spyOn(MCPWorkDirSync, "formatSyncMessage").mockReturnValue(
      "好的，工作目录已切换到 `/tmp`，filesystem 工具已就绪。",
    );

    const handler = createChangeDirHandler(
      mockManager,
      defaultPermission,
      allowedPaths,
      mockSync,
    );

    vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
      success: true,
      newDir: "/tmp",
    });

    const intent = handler.detectIntent("cd /tmp");
    const result = await handler.handleIntent(sessionId, intent);

    expect(mockSync.onWorkDirChanged).toHaveBeenCalledWith(sessionId, "/tmp");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("filesystem");
  });

  it("should trigger MCP sync after approval confirmed", async () => {
    const mockSync = {
      onWorkDirChanged: vi.fn().mockResolvedValue({
        success: true,
        workDir: "/etc",
        restarted: [],
        failed: [],
        skipped: [],
        elapsedMs: 10,
      }),
    } as unknown as MCPWorkDirSync;

    vi.spyOn(MCPWorkDirSync, "formatSyncMessage").mockReturnValue(
      "好的，工作目录已切换到 `/etc`",
    );

    const handler = createChangeDirHandler(
      mockManager,
      defaultPermission,
      allowedPaths,
      mockSync,
    );

    // First trigger approval request
    vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
      success: false,
      requiresApproval: true,
      approvalRequest: {
        id: "approval-456",
        targetDir: "/etc",
        message: "需要确认切换到 /etc",
      },
    });

    const intent = handler.detectIntent("cd /etc");
    await handler.handleIntent(sessionId, intent);

    // Simulate user confirming
    vi.mocked(mockManager.applyApprovedChange).mockReturnValue({
      success: true,
      message: "好的，工作目录已切换到 `/etc`",
    });

    const result = await handler.handleApprovalReply(sessionId, "确定");

    expect(result.isApprovalReply).toBe(true);
    expect(result.approved).toBe(true);
    expect(mockSync.onWorkDirChanged).toHaveBeenCalledWith(sessionId, "/etc");
  });

  it("should include failure info when MCP sync partially fails", async () => {
    // Restore spies first so fresh mocks below are not affected
    vi.restoreAllMocks();

    // Re-create mockManager since restoreAllMocks cleared the beforeEach mocks
    mockManager = createMockWorkDirManager();

    const mockSync = {
      onWorkDirChanged: vi.fn().mockResolvedValue({
        success: false,
        workDir: "/tmp",
        restarted: ["filesystem"],
        failed: [{ serverName: "git-tools", error: "spawn failed" }],
        skipped: [],
        elapsedMs: 55,
      }),
    } as unknown as MCPWorkDirSync;

    const handler = createChangeDirHandler(
      mockManager,
      defaultPermission,
      allowedPaths,
      mockSync,
    );

    vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
      success: true,
      newDir: "/tmp",
    });

    const intent = handler.detectIntent("cd /tmp");
    const result = await handler.handleIntent(sessionId, intent);

    expect(result.handled).toBe(true);
    expect(result.message).toContain("git-tools");
  });

  it("should work without MCPWorkDirSync (backward compatible)", async () => {
    // Create handler WITHOUT mcpWorkDirSync
    const handler = createChangeDirHandler(
      mockManager,
      defaultPermission,
      allowedPaths,
    );

    vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
      success: true,
      newDir: "/tmp",
    });

    const intent = handler.detectIntent("cd /tmp");
    const result = await handler.handleIntent(sessionId, intent);

    expect(result.handled).toBe(true);
    expect(result.message).toBe("好的，工作目录已切换到 `/tmp`");
  });

  it("should NOT trigger MCP sync when directory change is rejected", async () => {
    const mockSync = {
      onWorkDirChanged: vi.fn(),
    } as unknown as MCPWorkDirSync;

    const handler = createChangeDirHandler(
      mockManager,
      defaultPermission,
      allowedPaths,
      mockSync,
    );

    // Setup pending approval
    vi.mocked(mockManager.changeWorkingDir).mockReturnValue({
      success: false,
      requiresApproval: true,
      approvalRequest: {
        id: "approval-789",
        targetDir: "/etc",
        message: "需要确认切换到 /etc",
      },
    });

    const intent = handler.detectIntent("cd /etc");
    await handler.handleIntent(sessionId, intent);

    // User rejects
    const result = await handler.handleApprovalReply(sessionId, "取消");

    expect(result.isApprovalReply).toBe(true);
    expect(result.approved).toBe(false);
    expect(mockSync.onWorkDirChanged).not.toHaveBeenCalled();
  });
});

describe("createChangeDirHandler", () => {
  it("should create a ChangeDirHandler instance", () => {
    const manager = createMockWorkDirManager();
    const handler = createChangeDirHandler(manager, "sandbox", []);

    expect(handler).toBeInstanceOf(ChangeDirHandler);
    expect(handler.type).toBe("change_dir");
  });
});
