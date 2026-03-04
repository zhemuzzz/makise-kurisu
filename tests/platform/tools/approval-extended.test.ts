/**
 * ApprovalManager Extended Tests
 *
 * KURISU-019 Phase 4.1: 测试扩展的审批管理器
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ApprovalManager,
  createApprovalManager,
  type RiskLevel,
  type OperationRisk,
} from "../../../src/platform/tools/approval";
import type { ToolCall } from "../../../src/platform/tools/types";
import type { FilePermissionLevel } from "../../../src/platform/models/executor-types";

describe("ApprovalManager Extended", () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = createApprovalManager({ timeout: 30000 });
  });

  const createToolCall = (
    name: string,
    args: Record<string, unknown> = {},
  ): ToolCall => ({
    id: `call-${Date.now()}`,
    name,
    arguments: args,
  });

  describe("assessRisk", () => {
    describe("shell 命令风险评估", () => {
      it("应该将 rm -rf 标记为 critical 风险", () => {
        const toolCall = createToolCall("shell", { command: "rm -rf /" });
        const risk = manager.assessRisk(toolCall, "full_access");

        expect(risk.level).toBe("critical");
        expect(risk.reasons).toContain(
          "Dangerous command detected: Recursive force delete",
        );
        expect(risk.isReversible).toBe(false);
      });

      it("应该将 dd 命令标记为 critical 风险", () => {
        const toolCall = createToolCall("shell", {
          command: "dd if=/dev/zero of=/dev/sda",
        });
        const risk = manager.assessRisk(toolCall, "full_access");

        expect(risk.level).toBe("critical");
        expect(risk.reasons[0]).toContain("Dangerous command detected");
      });

      it("应该将普通 rm 命令标记为 high 风险", () => {
        const toolCall = createToolCall("shell", { command: "rm test.txt" });
        const risk = manager.assessRisk(toolCall, "restricted");

        expect(risk.level).toBe("high");
        expect(risk.isReversible).toBe(false);
      });

      it("应该将安全 shell 命令标记为 medium 风险", () => {
        const toolCall = createToolCall("shell", { command: "ls -la" });
        const risk = manager.assessRisk(toolCall, "sandbox");

        expect(risk.level).toBe("medium");
        expect(risk.isReversible).toBe(true);
      });
    });

    describe("文件操作风险评估", () => {
      it("应该将文件删除标记为 high 风险", () => {
        const toolCall = createToolCall("file_delete", { path: "/test.txt" });
        const risk = manager.assessRisk(toolCall, "restricted");

        expect(risk.level).toBe("high");
        expect(risk.affectedPaths).toContain("/test.txt");
        expect(risk.isReversible).toBe(false);
      });

      it("应该将文件写入标记为 medium 风险", () => {
        const toolCall = createToolCall("file_write", { path: "/test.txt" });
        const risk = manager.assessRisk(toolCall, "sandbox");

        expect(risk.level).toBe("medium");
        expect(risk.affectedPaths).toContain("/test.txt");
        expect(risk.isReversible).toBe(true);
      });
    });

    describe("浏览器操作风险评估", () => {
      it("应该将浏览器操作标记为 medium 风险", () => {
        const toolCall = createToolCall("browser", { action: "navigate" });
        const risk = manager.assessRisk(toolCall, "restricted");

        expect(risk.level).toBe("medium");
      });
    });

    describe("权限级别影响", () => {
      it("full_access 模式下所有操作都是 medium 风险", () => {
        const toolCall = createToolCall("file_read", { path: "/test.txt" });
        const risk = manager.assessRisk(toolCall, "full_access");

        // full_access 模式下，没有特定规则的操作默认返回 medium 风险
        expect(risk.level).toBe("medium");
      });
    });
  });

  describe("buildApprovalMessageWithRisk", () => {
    it("应该为 shell 命令构建详细消息", () => {
      const toolCall = createToolCall("shell", { command: "rm test.txt" });
      const risk: OperationRisk = {
        level: "high",
        reasons: ["May delete files"],
        isReversible: false,
      };

      const message = manager.buildApprovalMessageWithRisk(toolCall, risk);

      expect(message).toContain("rm test.txt");
      expect(message).toContain("确定要继续");
    });

    it("应该为文件删除构建警告消息", () => {
      const toolCall = createToolCall("file_delete", { path: "/test.txt" });
      const risk: OperationRisk = {
        level: "high",
        reasons: ["File deletion"],
        affectedPaths: ["/test.txt"],
        isReversible: false,
      };

      const message = manager.buildApprovalMessageWithRisk(toolCall, risk);

      expect(message).toContain("/test.txt");
      expect(message).toContain("无法恢复");
    });

    it("应该为 critical 风险添加危险警告", () => {
      const toolCall = createToolCall("shell", { command: "rm -rf /" });
      const risk: OperationRisk = {
        level: "critical",
        reasons: ["Dangerous command"],
        isReversible: false,
      };

      const message = manager.buildApprovalMessageWithRisk(toolCall, risk);

      // 消息应该包含命令和确认提示
      expect(message).toContain("rm -rf /");
      expect(message).toContain("确定");
    });
  });

  describe("createApprovalRequest", () => {
    it("应该创建包含风险评估的审批请求", () => {
      const toolCall = createToolCall("shell", { command: "ls -la" });
      const request = manager.createApprovalRequest(
        "session-1",
        toolCall,
        "restricted",
      );

      expect(request.id).toContain("approval-");
      expect(request.sessionId).toBe("session-1");
      expect(request.toolCall).toBe(toolCall);
      expect(request.permission).toBe("restricted");
      expect(request.riskLevel).toBeDefined();
      expect(request.risk).toBeDefined();
      expect(request.message).toBeDefined();
      expect(request.expiresAt).toBeGreaterThan(request.createdAt);
    });

    it("应该返回已有的待审批请求", () => {
      const toolCall = createToolCall("shell", { command: "ls" });
      const request1 = manager.createApprovalRequest(
        "session-1",
        toolCall,
        "restricted",
      );
      const request2 = manager.createApprovalRequest(
        "session-1",
        toolCall,
        "restricted",
      );

      // 应该返回相同的会话
      expect(request2.sessionId).toBe(request1.sessionId);
    });
  });

  describe("handleApprovalReply", () => {
    it("应该正确处理确认回复", () => {
      const toolCall = createToolCall("shell", { command: "ls" });
      manager.createApprovalRequest("session-1", toolCall, "restricted");

      const result = manager.handleApprovalReply("session-1", "确认");

      expect(result.approved).toBe(true);
      expect(result.respondedAt).toBeDefined();
    });

    it("应该正确处理取消回复", () => {
      const toolCall = createToolCall("shell", { command: "ls" });
      manager.createApprovalRequest("session-1", toolCall, "restricted");

      const result = manager.handleApprovalReply("session-1", "取消");

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("User cancelled");
    });

    it("应该处理无效回复", () => {
      const toolCall = createToolCall("shell", { command: "ls" });
      manager.createApprovalRequest("session-1", toolCall, "restricted");

      const result = manager.handleApprovalReply("session-1", "hello");

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("Unrecognized reply");
    });

    it("应该处理不存在的审批", () => {
      const result = manager.handleApprovalReply("non-existent", "确认");

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("No pending approval");
    });
  });

  describe("needsApproval", () => {
    it("full_access 模式下所有操作都需要审批", () => {
      expect(manager.needsApproval("full_access", "file_read")).toBe(true);
      expect(manager.needsApproval("full_access", "file_write")).toBe(true);
      expect(manager.needsApproval("full_access", "shell")).toBe(true);
    });

    it("restricted 模式下写操作需要审批", () => {
      expect(manager.needsApproval("restricted", "file_read")).toBe(false);
      expect(manager.needsApproval("restricted", "file_write")).toBe(true);
      expect(manager.needsApproval("restricted", "file_delete")).toBe(true);
      expect(manager.needsApproval("restricted", "shell")).toBe(true);
    });

    it("sandbox 模式下不需要审批", () => {
      expect(manager.needsApproval("sandbox", "file_read")).toBe(false);
      expect(manager.needsApproval("sandbox", "file_write")).toBe(false);
    });
  });

  describe("getApprovalRequest", () => {
    it("应该获取有效的审批请求", () => {
      const toolCall = createToolCall("shell", { command: "ls" });
      manager.createApprovalRequest("session-1", toolCall, "restricted");

      const request = manager.getApprovalRequest("session-1", "restricted");

      expect(request).not.toBeNull();
      expect(request?.sessionId).toBe("session-1");
    });

    it("应该返回 null 如果没有待审批", () => {
      const request = manager.getApprovalRequest("non-existent", "restricted");

      expect(request).toBeNull();
    });
  });
});
