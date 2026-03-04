/**
 * 工具调用链集成测试
 *
 * 测试完整的工具调用流程：
 * 1. 意图匹配 → Skill 激活
 * 2. 权限检查 → 执行/拒绝
 * 3. PersonaWrapper 人设化输出
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createPersonaWrapper } from "../../../src/platform/tools/persona-wrapper";
import { createPermissionChecker } from "../../../src/platform/tools/permission";
import { createApprovalManager } from "../../../src/platform/tools/approval";
import type { ToolResult } from "../../../src/platform/tools/types";

/**
 * 辅助函数：检查字符串是否包含人设前缀
 */
function hasPersonaPrefix(text: string): boolean {
  return (
    text.includes("哼") ||
    text.includes("找到") ||
    text.includes("搜了一下") ||
    text.includes("好了") ||
    text.includes("查到了")
  );
}

/**
 * 辅助函数：检查字符串是否包含失败前缀
 */
function hasFailurePrefix(text: string): boolean {
  return (
    text.includes("失败") ||
    text.includes("不行") ||
    text.includes("做不到") ||
    text.includes("出错") ||
    text.includes("问题")
  );
}

/**
 * 辅助函数：检查字符串是否包含拒绝消息
 */
function hasDeniedMessage(text: string): boolean {
  return (
    text.includes("做不了") ||
    text.includes("不会") ||
    text.includes("不行") ||
    text.includes("权限") ||
    text.includes("拒绝")
  );
}

describe("Tool Chain Integration", () => {
  // NOTE: "意图匹配 → Skill 激活" tests were v1 IntentMatcher behavior,
  // replaced by Phase 3c IntentClassifier. Tests removed.

  describe("权限检查 → 执行决策", () => {
    it("应该允许 safe 级工具直接执行", () => {
      const checker = createPermissionChecker();

      const result = checker.check("web_search");

      expect(result.allowed).toBe(true);
      expect(result.level).toBe("safe");
    });

    it("应该要求 confirm 级工具需要审批", () => {
      const checker = createPermissionChecker();

      const result = checker.check("shell");

      expect(result.allowed).toBe(true);
      expect(result.level).toBe("confirm");
    });

    it("应该拒绝 deny 级工具", () => {
      const checker = createPermissionChecker({
        permissions: {
          safe: ["web_search"],
          confirm: [],
          deny: ["dangerous_tool"],
        },
      });

      const result = checker.check("dangerous_tool");

      expect(result.allowed).toBe(false);
      expect(result.level).toBe("deny");
    });
  });

  describe("审批流程", () => {
    it("应该正确处理审批确认", () => {
      const manager = createApprovalManager();
      const sessionId = "test-session-1";

      // 创建审批
      const approval = manager.createApproval(sessionId, {
        id: "call-1",
        name: "shell",
        arguments: { command: "ls -la" },
      });

      expect(approval.status).toBe("pending");
      expect(approval.message).toContain("shell");
      expect(approval.message).toContain("确认");

      // 处理确认
      const result = manager.handleReply(sessionId, "确认");
      expect(result).toBe("approved");

      // 验证审批已被移除（approved 后会被清理）
      const approvalAfter = manager.getApproval(sessionId);
      expect(approvalAfter).toBeUndefined();
    });

    it("应该正确处理审批拒绝", () => {
      const manager = createApprovalManager();
      const sessionId = "test-session-2";

      manager.createApproval(sessionId, {
        id: "call-2",
        name: "shell",
        arguments: { command: "rm -rf /" },
      });

      const result = manager.handleReply(sessionId, "取消");
      expect(result).toBe("rejected");

      // 审批被清理
      const approvalAfter = manager.getApproval(sessionId);
      expect(approvalAfter).toBeUndefined();
    });

    it("应该忽略无效的回复", () => {
      const manager = createApprovalManager();
      const sessionId = "test-session-3";

      manager.createApproval(sessionId, {
        id: "call-3",
        name: "shell",
        arguments: { command: "echo test" },
      });

      const result = manager.handleReply(sessionId, "随便说点什么");
      expect(result).toBe("invalid");

      // 状态应该仍然是 pending
      const approval = manager.getApproval(sessionId);
      expect(approval?.status).toBe("pending");
    });
  });

  describe("PersonaWrapper 人设化输出", () => {
    let wrapper: ReturnType<typeof createPersonaWrapper>;

    beforeEach(() => {
      wrapper = createPersonaWrapper();
    });

    it("应该为成功的工具输出添加人设前缀", () => {
      const result: ToolResult = {
        callId: "call-1",
        toolName: "web_search",
        success: true,
        output: "东京今天 18°C，多云",
        latency: 150,
      };

      const wrapped = wrapper.wrap(result);

      // 应该包含人设特征
      expect(hasPersonaPrefix(wrapped)).toBe(true);
      // 应该包含原始输出
      expect(wrapped).toContain("18°C");
    });

    it("应该为失败的工具输出添加失败前缀", () => {
      const result: ToolResult = {
        callId: "call-2",
        toolName: "web_search",
        success: false,
        error: "网络连接失败",
        latency: 5000,
      };

      const wrapped = wrapper.wrap(result);

      expect(hasFailurePrefix(wrapped)).toBe(true);
      expect(wrapped).toContain("网络连接失败");
    });

    it("应该为需要审批的工具生成审批消息", () => {
      const result: ToolResult = {
        callId: "call-3",
        toolName: "shell",
        success: false,
        latency: 0,
        approvalRequired: true,
        approvalStatus: "pending",
      };

      const wrapped = wrapper.wrap(result);

      expect(wrapped).toContain("shell");
      expect(wrapped).toContain("确认");
      expect(wrapped).toContain("取消");
    });

    it("应该为被拒绝的工具生成拒绝消息", () => {
      const result: ToolResult = {
        callId: "call-4",
        toolName: "shell",
        success: false,
        latency: 0,
        approvalStatus: "rejected",
      };

      const wrapped = wrapper.wrap(result);

      expect(hasDeniedMessage(wrapped)).toBe(true);
    });
  });

  describe("完整工具调用链", () => {
    // NOTE: "safe 级完整调用链" test depended on v1 matchIntent. Removed.

    it("应该完成 confirm 级工具的审批流程", async () => {
      const checker = createPermissionChecker();
      const manager = createApprovalManager();
      const wrapper = createPersonaWrapper();
      const sessionId = "chain-session-1";

      // 1. 检查权限（需要确认）
      const permission = checker.check("shell");
      expect(permission.level).toBe("confirm");

      // 2. 创建审批
      const approval = manager.createApproval(sessionId, {
        id: "shell-1",
        name: "shell",
        arguments: { command: "ls -la" },
      });

      // 3. 生成审批消息
      const approvalMessage = wrapper.buildApprovalMessage("shell", {
        command: "ls -la",
      });
      expect(approvalMessage).toContain("shell");
      expect(approvalMessage).toContain("确认");

      // 4. 用户确认
      const replyResult = manager.handleReply(sessionId, "确认");
      expect(replyResult).toBe("approved");

      // 5. 模拟执行
      const result: ToolResult = {
        callId: "shell-1",
        toolName: "shell",
        success: true,
        output: "file1.txt\nfile2.txt",
        latency: 100,
        sandboxed: true,
      };

      const wrappedOutput = wrapper.wrap(result);

      // 6. 验证输出
      expect(wrappedOutput).toContain("file1.txt");
      expect(hasPersonaPrefix(wrappedOutput)).toBe(true);
    });

    it("应该处理被拒绝的工具调用", async () => {
      const checker = createPermissionChecker();
      const manager = createApprovalManager();
      const wrapper = createPersonaWrapper();
      const sessionId = "chain-session-2";

      // 1. 检查权限
      const permission = checker.check("shell");
      expect(permission.level).toBe("confirm");

      // 2. 创建审批
      manager.createApproval(sessionId, {
        id: "shell-2",
        name: "shell",
        arguments: { command: "rm -rf /data" },
      });

      // 3. 用户拒绝
      const replyResult = manager.handleReply(sessionId, "取消");
      expect(replyResult).toBe("rejected");

      // 4. 生成拒绝输出
      const result: ToolResult = {
        callId: "shell-2",
        toolName: "shell",
        success: false,
        latency: 0,
        approvalStatus: "rejected",
      };

      const wrappedOutput = wrapper.wrap(result);

      // 5. 验证拒绝消息
      expect(hasDeniedMessage(wrappedOutput)).toBe(true);
    });
  });

  describe("PersonaEngine 集成", () => {
    it("PersonaEngine 应该能够包装工具输出", async () => {
      const { PersonaEngine } = await import("../../../src/platform/identity/index");
      const engine = new PersonaEngine();

      await engine.loadRole("kurisu");

      const result: ToolResult = {
        callId: "pe-1",
        toolName: "web_search",
        success: true,
        output: "搜索结果",
        latency: 100,
      };

      const wrapped = engine.wrapToolOutput(result);

      expect(typeof wrapped).toBe("string");
      expect(wrapped.length).toBeGreaterThan(0);
    });

    it("PersonaEngine 应该能够构建审批消息", async () => {
      const { PersonaEngine } = await import("../../../src/platform/identity/index");
      const engine = new PersonaEngine();

      await engine.loadRole("kurisu");

      const message = engine.buildApprovalMessage("shell", {
        command: "rm -rf /data",
      });

      expect(message).toContain("shell");
      expect(message).toContain("确认");
      expect(message).toContain("取消");
    });
  });
});
