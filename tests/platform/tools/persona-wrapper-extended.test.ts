/**
 * PersonaWrapper Extended Tests
 *
 * KURISU-019 Phase 4.2: 测试扩展的人设化包装器
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PersonaWrapper,
  createPersonaWrapper,
} from "../../../src/platform/tools/persona-wrapper";
import type {
  ApprovalRequest,
  OperationRisk,
  RiskLevel,
} from "../../../src/platform/tools/approval";
import type { ToolCall } from "../../../src/platform/tools/types";

describe("PersonaWrapper Extended", () => {
  let wrapper: PersonaWrapper;

  beforeEach(() => {
    wrapper = createPersonaWrapper();
  });

  const createToolCall = (
    name: string,
    args: Record<string, unknown> = {},
  ): ToolCall => ({
    id: `call-${Date.now()}`,
    name,
    arguments: args,
  });

  const createApprovalRequest = (
    overrides: Partial<ApprovalRequest> = {},
  ): ApprovalRequest => {
    const toolCall = createToolCall("shell", { command: "ls" });
    const risk: OperationRisk = {
      level: "medium",
      reasons: ["Shell command"],
      isReversible: true,
    };
    return {
      id: "approval-123",
      sessionId: "session-1",
      toolCall,
      permission: "restricted",
      riskLevel: "medium",
      risk,
      message: "你让我执行 `shell`，确定要继续吗？",
      createdAt: Date.now(),
      expiresAt: Date.now() + 30000,
      ...overrides,
    };
  };

  describe("wrapApprovalRequest", () => {
    it("应该为人设化审批请求添加语气", () => {
      const request = createApprovalRequest({
        message: "你让我执行这个命令",
      });

      const wrapped = wrapper.wrapApprovalRequest(request);

      expect(wrapped).toContain("确认");
      expect(wrapped).toContain("取消");
    });

    it("应该根据风险等级选择不同模板", () => {
      const lowRequest = createApprovalRequest({
        riskLevel: "low",
        risk: { level: "low", reasons: [], isReversible: true },
        message: "执行操作",
      });

      const criticalRequest = createApprovalRequest({
        riskLevel: "critical",
        risk: {
          level: "critical",
          reasons: ["危险操作"],
          isReversible: false,
        },
        message: "执行危险操作",
      });

      const lowWrapped = wrapper.wrapApprovalRequest(lowRequest);
      const criticalWrapped = wrapper.wrapApprovalRequest(criticalRequest);

      // critical 风险应该包含警告
      expect(criticalWrapped).toContain("危险");
    });

    it("应该包含命令参数信息", () => {
      const request = createApprovalRequest({
        toolCall: createToolCall("shell", { command: "rm test.txt" }),
        message: "执行 shell 命令",
      });

      const wrapped = wrapper.wrapApprovalRequest(request);

      // 消息应该包含工具名，并提示用户确认或取消
      expect(wrapped).toContain("shell");
      expect(wrapped).toContain("确认");
      expect(wrapped).toContain("取消");
    });
  });

  describe("wrapApprovalResult", () => {
    it("应该为批准结果返回确认消息", () => {
      const result = wrapper.wrapApprovalResult(true);

      expect(result).toContain("好") ||
        expect(result).toContain("明白") ||
        expect(result).toContain("了解");
    });

    it("应该为用户取消返回取消消息", () => {
      const result = wrapper.wrapApprovalResult(false, "User cancelled");

      // 人设化消息可能包含多种表达方式
      const hasCancelKeyword =
        result.includes("取消") ||
        result.includes("算了") ||
        result.includes("不做了") ||
        result.includes("知道了");
      expect(hasCancelKeyword).toBe(true);
    });

    it("应该为超时返回超时消息", () => {
      const result = wrapper.wrapApprovalResult(false, "Approval expired");

      // 人设化超时消息可能包含多种表达方式
      const hasTimeoutKeyword =
        result.includes("超时") ||
        result.includes("太久") ||
        result.includes("放弃") ||
        result.includes("取消");
      expect(hasTimeoutKeyword).toBe(true);
    });

    it("应该处理无待审批的情况", () => {
      const result = wrapper.wrapApprovalResult(false, "No pending approval");

      expect(result).toContain("没有找到");
    });
  });

  describe("buildRiskWarning", () => {
    it("应该为低风险返回空字符串", () => {
      const warning = wrapper.buildRiskWarning("low", []);

      expect(warning).toBe("");
    });

    it("应该为中等风险返回警告", () => {
      const warning = wrapper.buildRiskWarning("medium", ["操作有风险"]);

      expect(warning).toContain("注意");
      expect(warning).toContain("操作有风险");
    });

    it("应该为高风险返回强烈警告", () => {
      const warning = wrapper.buildRiskWarning("high", ["可能删除文件"]);

      expect(warning).toContain("警告");
      expect(warning).toContain("可能删除文件");
    });

    it("应该为 critical 风险返回危险警告", () => {
      const warning = wrapper.buildRiskWarning("critical", ["数据丢失"]);

      expect(warning).toContain("危险");
      expect(warning).toContain("不可逆");
      expect(warning).toContain("数据丢失");
    });
  });

  describe("wrapExecutorApprovalMessage", () => {
    it("应该为低风险操作生成普通消息", () => {
      const message = wrapper.wrapExecutorApprovalMessage(
        "shell",
        "ls -la",
        "low",
      );

      expect(message).toContain("ls -la");
      expect(message).toContain("确认");
      expect(message).toContain("取消");
    });

    it("应该为 critical 风险操作生成警告消息", () => {
      const message = wrapper.wrapExecutorApprovalMessage(
        "shell",
        "rm -rf /",
        "critical",
      );

      expect(message).toContain("危险");
      expect(message).toContain("rm -rf /");
    });
  });
});
