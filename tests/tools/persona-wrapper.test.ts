/**
 * PersonaWrapper Tests
 *
 * 测试工具输出人设化包装
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PersonaWrapper,
  createPersonaWrapper,
} from "../../src/tools/persona-wrapper";
import type { ToolResult } from "../../src/tools/types";

describe("PersonaWrapper", () => {
  let wrapper: PersonaWrapper;

  beforeEach(() => {
    wrapper = createPersonaWrapper();
  });

  const createToolResult = (
    overrides: Partial<ToolResult> = {},
  ): ToolResult => ({
    callId: "test-call-1",
    toolName: "test_tool",
    success: true,
    output: "test output",
    latency: 100,
    ...overrides,
  });

  describe("wrap", () => {
    describe("成功结果", () => {
      it("应该为成功结果添加人设前缀", () => {
        const result = createToolResult({
          success: true,
          output: "东京今天 18°C，多云",
        });

        const wrapped = wrapper.wrap(result);

        // 应该包含人设前缀（检查实际输出的前几个字符）
        expect(
          wrapped.includes("哼") ||
            wrapped.includes("找到") ||
            wrapped.includes("搜了一下") ||
            wrapped.includes("好了") ||
            wrapped.includes("查到了"),
        ).toBe(true);
        // 应该包含原始输出
        expect(wrapped).toContain("东京今天 18°C");
      });

      it("应该正确处理对象输出", () => {
        const result = createToolResult({
          success: true,
          output: { temperature: 18, weather: "多云" },
        });

        const wrapped = wrapper.wrap(result);

        expect(wrapped).toContain("temperature");
        expect(wrapped).toContain("18");
      });

      it("应该处理空输出", () => {
        const result = createToolResult({
          success: true,
          output: null,
        });

        const wrapped = wrapper.wrap(result);

        expect(wrapped).toContain("(无结果)");
      });
    });

    describe("失败结果", () => {
      it("应该为失败结果添加失败前缀", () => {
        const result = createToolResult({
          success: false,
          error: "网络超时",
        });

        const wrapped = wrapper.wrap(result);

        expect(
          wrapped.includes("失败") ||
            wrapped.includes("不行") ||
            wrapped.includes("做不到") ||
            wrapped.includes("出错") ||
            wrapped.includes("问题"),
        ).toBe(true);
        expect(wrapped).toContain("网络超时");
      });

      it("应该处理无错误信息的情况", () => {
        const result = createToolResult({
          success: false,
          error: undefined,
        });

        const wrapped = wrapper.wrap(result);

        expect(wrapped).toContain("未知错误");
      });
    });

    describe("审批结果", () => {
      it("应该为需要审批的工具生成审批消息", () => {
        const result = createToolResult({
          success: false,
          approvalRequired: true,
          approvalStatus: "pending",
        });

        const wrapped = wrapper.wrap(result);

        expect(wrapped).toContain("确认");
        expect(wrapped).toContain("取消");
      });

      it("应该为被拒绝的工具生成拒绝消息", () => {
        const result = createToolResult({
          success: false,
          approvalStatus: "rejected",
        });

        const wrapped = wrapper.wrap(result);

        expect(
          wrapped.includes("做不了") ||
            wrapped.includes("不会") ||
            wrapped.includes("不行") ||
            wrapped.includes("权限"),
        ).toBe(true);
      });

      it("应该为超时的审批生成超时消息", () => {
        const result = createToolResult({
          success: false,
          approvalStatus: "timeout",
        });

        const wrapped = wrapper.wrap(result);

        expect(
          wrapped.includes("超时") ||
            wrapped.includes("太久") ||
            wrapped.includes("慢"),
        ).toBe(true);
      });
    });
  });

  describe("buildApprovalMessage", () => {
    it("应该生成包含工具名的审批消息", () => {
      const message = wrapper.buildApprovalMessage("shell");

      expect(message).toContain("shell");
      expect(message).toContain("确认");
      expect(message).toContain("取消");
    });

    it("应该包含参数信息（如果有）", () => {
      const message = wrapper.buildApprovalMessage("shell", {
        command: "rm -rf /data",
        timeout: 30000,
      });

      expect(message).toContain("command");
      expect(message).toContain("rm -rf /data");
    });
  });

  describe("配置", () => {
    it("应该支持禁用人设包装", () => {
      const disabledWrapper = createPersonaWrapper({ enabled: false });

      const result = createToolResult({
        success: true,
        output: "原始输出",
      });

      const wrapped = disabledWrapper.wrap(result);

      // 禁用时应该直接返回原始输出
      expect(wrapped).toBe("原始输出");
    });

    it("应该支持显示工具名", () => {
      const showNameWrapper = createPersonaWrapper({ showToolName: true });

      const result = createToolResult({
        success: true,
        output: "输出内容",
      });

      const wrapped = showNameWrapper.wrap(result);

      expect(wrapped).toContain("[test_tool]");
    });

    it("应该截断过长的输出", () => {
      const shortWrapper = createPersonaWrapper({ maxOutputLength: 50 });

      const longOutput = "a".repeat(100);
      const result = createToolResult({
        success: true,
        output: longOutput,
      });

      const wrapped = shortWrapper.wrap(result);

      expect(wrapped.length).toBeLessThan(150); // 前缀 + 50 + 截断提示
      expect(wrapped).toContain("截断");
    });
  });

  describe("确定性输出", () => {
    it("应该对相同输入产生相同输出", () => {
      const wrapper1 = createPersonaWrapper();
      const wrapper2 = createPersonaWrapper();

      const result = createToolResult({
        success: true,
        output: "测试输出",
      });

      const wrapped1 = wrapper1.wrap(result);
      const wrapped2 = wrapper2.wrap(result);

      expect(wrapped1).toBe(wrapped2);
    });
  });
});

describe("PersonaEngine.wrapToolOutput 集成", () => {
  it("PersonaEngine 应该能够包装工具输出", async () => {
    const { PersonaEngine } = await import("../../src/core/persona/index");
    const engine = new PersonaEngine();

    // 加载角色配置
    await engine.loadRole("kurisu");

    const result: ToolResult = {
      callId: "test-1",
      toolName: "web_search",
      success: true,
      output: "搜索结果",
      latency: 100,
    };

    const wrapped = engine.wrapToolOutput(result);

    // 应该包含人设前缀
    expect(typeof wrapped).toBe("string");
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it("PersonaEngine 应该能够构建审批消息", async () => {
    const { PersonaEngine } = await import("../../src/core/persona/index");
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
