/**
 * ApprovalHandler 测试
 *
 * KURISU-023 Phase 1: 审批流程 Mixin
 */

import { describe, it, expect, vi } from "vitest";
import {
  ApprovalHandler,
  createApprovalHandler,
  type ApprovalGatewayLike,
  type ToolApprovalResult,
  type GenericApprovalResult,
} from "../../../../src/platform/gateway/channels/approval-handler";

// ===========================================
// Mock Gateway
// ===========================================

function createMockGateway(): ApprovalGatewayLike {
  return {
    checkApprovalReply: vi.fn(
      async (): Promise<ToolApprovalResult> => ({
        isApprovalReply: false,
      }),
    ),
    executeApprovedTool: vi.fn(async () => "工具执行成功"),
    handleChangeDirApprovalReply: vi.fn(
      async (): Promise<GenericApprovalResult> => ({
        isApprovalReply: false,
      }),
    ),
    handleChangePermissionApprovalReply: vi.fn(
      async (): Promise<GenericApprovalResult> => ({
        isApprovalReply: false,
      }),
    ),
    handleChangeDeleteConfirmApprovalReply: vi.fn(
      async (): Promise<GenericApprovalResult> => ({
        isApprovalReply: false,
      }),
    ),
  };
}

describe("ApprovalHandler", () => {
  describe("createApprovalHandler", () => {
    it("应该创建 ApprovalHandler 实例", () => {
      const gateway = createMockGateway();
      const handler = createApprovalHandler(gateway);
      expect(handler).toBeInstanceOf(ApprovalHandler);
    });
  });

  describe("handleApproval", () => {
    it("没有审批时应该返回 handled=false", async () => {
      const gateway = createMockGateway();
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "你好");

      expect(result.handled).toBe(false);
    });

    it("权限切换审批应该被正确处理", async () => {
      const gateway = createMockGateway();
      gateway.handleChangePermissionApprovalReply = vi.fn(
        async (): Promise<GenericApprovalResult> => ({
          isApprovalReply: true,
          approved: true,
          message: "权限已升级到完全访问模式",
        }),
      );
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "y");

      expect(result.handled).toBe(true);
      expect(result.type).toBe("change_permission");
      expect(result.approved).toBe(true);
      expect(result.message).toBe("权限已升级到完全访问模式");
    });

    it("目录切换审批应该被正确处理", async () => {
      const gateway = createMockGateway();
      gateway.handleChangeDirApprovalReply = vi.fn(
        async (): Promise<GenericApprovalResult> => ({
          isApprovalReply: true,
          approved: true,
          message: "工作目录已切换到 /tmp",
        }),
      );
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "y");

      expect(result.handled).toBe(true);
      expect(result.type).toBe("change_dir");
      expect(result.approved).toBe(true);
    });

    it("工具审批应该被正确处理", async () => {
      const gateway = createMockGateway();
      gateway.checkApprovalReply = vi.fn(
        async (): Promise<ToolApprovalResult> => ({
          isApprovalReply: true,
          result: "approved",
          toolCall: {
            id: "call-1",
            name: "file_write",
            arguments: { path: "/tmp/test.txt", content: "hello" },
          },
        }),
      );
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "y");

      expect(result.handled).toBe(true);
      expect(result.type).toBe("tool");
      expect(result.approved).toBe(true);
      expect(result.toolCall).toBeDefined();
      expect(result.toolCall?.name).toBe("file_write");
    });

    it("工具拒绝应该返回 approved=false", async () => {
      const gateway = createMockGateway();
      gateway.checkApprovalReply = vi.fn(
        async (): Promise<ToolApprovalResult> => ({
          isApprovalReply: true,
          result: "rejected",
          toolCall: {
            id: "call-1",
            name: "shell",
            arguments: { command: "rm -rf /" },
          },
        }),
      );
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "n");

      expect(result.handled).toBe(true);
      expect(result.type).toBe("tool");
      expect(result.approved).toBe(false);
    });

    it("审批优先级：权限切换 > 目录切换 > 工具审批", async () => {
      const gateway = createMockGateway();
      // 所有审批都返回 true
      gateway.handleChangePermissionApprovalReply = vi.fn(
        async (): Promise<GenericApprovalResult> => ({
          isApprovalReply: true,
          approved: true,
          message: "权限已切换",
        }),
      );
      gateway.handleChangeDirApprovalReply = vi.fn(
        async (): Promise<GenericApprovalResult> => ({
          isApprovalReply: true,
          approved: true,
          message: "目录已切换",
        }),
      );
      gateway.checkApprovalReply = vi.fn(
        async (): Promise<ToolApprovalResult> => ({
          isApprovalReply: true,
          result: "approved",
        }),
      );
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "y");

      // 应该返回权限切换结果（最高优先级）
      expect(result.type).toBe("change_permission");
      // 其他审批方法不应该被调用
      expect(gateway.handleChangeDirApprovalReply).not.toHaveBeenCalled();
      expect(gateway.checkApprovalReply).not.toHaveBeenCalled();
    });

    it("目录切换应该在权限切换之后检查", async () => {
      const gateway = createMockGateway();
      gateway.handleChangePermissionApprovalReply = vi.fn(
        async (): Promise<GenericApprovalResult> => ({
          isApprovalReply: false,
        }),
      );
      gateway.handleChangeDirApprovalReply = vi.fn(
        async (): Promise<GenericApprovalResult> => ({
          isApprovalReply: true,
          approved: true,
          message: "目录已切换",
        }),
      );
      const handler = createApprovalHandler(gateway);

      const result = await handler.handleApproval("session-1", "y");

      expect(result.type).toBe("change_dir");
      expect(gateway.handleChangePermissionApprovalReply).toHaveBeenCalled();
      expect(gateway.handleChangeDirApprovalReply).toHaveBeenCalled();
    });
  });

  describe("executeApprovedTool", () => {
    it("应该调用 gateway.executeApprovedTool", async () => {
      const gateway = createMockGateway();
      const handler = createApprovalHandler(gateway);

      const toolCall = {
        id: "call-1",
        name: "file_read",
        arguments: { path: "/tmp/test.txt" },
      };

      const result = await handler.executeApprovedTool("session-1", toolCall);

      expect(result).toBe("工具执行成功");
      expect(gateway.executeApprovedTool).toHaveBeenCalledWith(
        "session-1",
        toolCall,
      );
    });
  });
});
