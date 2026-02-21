/**
 * SilentSafetyInterceptor 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SilentSafetyInterceptor,
  createSafetyInterceptor,
} from "../../../src/core/safety/silent-interceptor";
import type { SafetyConfig, ToolCall } from "../../../src/core/safety/types";
import { DEFAULT_SAFETY_CONFIG } from "../../../src/core/safety/types";

describe("SilentSafetyInterceptor", () => {
  let interceptor: SilentSafetyInterceptor;

  beforeEach(() => {
    interceptor = new SilentSafetyInterceptor();
  });

  describe("check", () => {
    it("should return success for safe tools", () => {
      const toolCall: ToolCall = { name: "web_search", params: { query: "test" } };
      const result = interceptor.check(toolCall);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should return NEED_CONFIRMATION for confirm tools", () => {
      const toolCall: ToolCall = { name: "file_write", params: { path: "/test.txt" } };
      const result = interceptor.check(toolCall);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_CONFIRMATION");
      expect(result.error?.toolName).toBe("file_write");
    });

    it("should return FORBIDDEN for forbidden tools", () => {
      const toolCall: ToolCall = { name: "system_modify", params: {} };
      const result = interceptor.check(toolCall);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("FORBIDDEN");
      expect(result.error?.toolName).toBe("system_modify");
    });

    it("should detect dangerous patterns in params", () => {
      const toolCall: ToolCall = {
        name: "shell_execute",
        params: { command: "rm -rf /" },
      };
      const result = interceptor.check(toolCall);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_CONFIRMATION");
    });

    it("should detect DROP TABLE pattern", () => {
      const toolCall: ToolCall = {
        name: "shell_execute",
        params: { query: "DROP TABLE users" },
      };
      const result = interceptor.check(toolCall);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe("NEED_CONFIRMATION");
    });

    it("should NOT produce any dialogue output", () => {
      const toolCall: ToolCall = { name: "system_modify", params: {} };
      const result = interceptor.check(toolCall);

      // internalMessage 只给 LLM 看，不是对话输出
      expect(result.error?.internalMessage).toBeDefined();
      expect(result.error?.internalMessage).not.toContain("请确认");
      expect(result.error?.internalMessage).not.toContain("对不起");
    });
  });

  describe("structured error format", () => {
    it("should return SafetyError with code", () => {
      const toolCall: ToolCall = { name: "file_delete", params: {} };
      const result = interceptor.check(toolCall);

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("NEED_CONFIRMATION");
    });

    it("should include toolName in error", () => {
      const toolCall: ToolCall = { name: "credential_access", params: {} };
      const result = interceptor.check(toolCall);

      expect(result.error?.toolName).toBe("credential_access");
    });

    it("should include internalMessage for LLM", () => {
      const toolCall: ToolCall = { name: "file_write", params: {} };
      const result = interceptor.check(toolCall);

      expect(result.error?.internalMessage).toContain("confirmation");
    });
  });

  describe("helper methods", () => {
    it("should identify safe tools", () => {
      expect(interceptor.isSafeTool("web_search")).toBe(true);
      expect(interceptor.isSafeTool("file_read")).toBe(true);
      expect(interceptor.isSafeTool("file_write")).toBe(false);
    });

    it("should identify confirm tools", () => {
      expect(interceptor.requiresConfirmation("file_write")).toBe(true);
      expect(interceptor.requiresConfirmation("shell_execute")).toBe(true);
      expect(interceptor.requiresConfirmation("web_search")).toBe(false);
    });

    it("should identify forbidden tools", () => {
      expect(interceptor.isForbidden("system_modify")).toBe(true);
      expect(interceptor.isForbidden("credential_access")).toBe(true);
      expect(interceptor.isForbidden("web_search")).toBe(false);
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const config = interceptor.getConfig();
      expect(config).toEqual(DEFAULT_SAFETY_CONFIG);
    });
  });

  describe("custom config", () => {
    it("should accept custom configuration", () => {
      const customConfig: SafetyConfig = {
        tools: {
          safe: ["custom_tool"],
          confirm: [],
          forbidden: [],
        },
        dangerousPatterns: [],
        interception: { silent: true },
      };

      const customInterceptor = new SilentSafetyInterceptor(customConfig);
      const result = customInterceptor.check({ name: "custom_tool", params: {} });

      expect(result.success).toBe(true);
    });
  });
});

describe("createSafetyInterceptor", () => {
  it("should create interceptor with default config", () => {
    const interceptor = createSafetyInterceptor();
    expect(interceptor).toBeInstanceOf(SilentSafetyInterceptor);
    expect(interceptor.getConfig()).toEqual(DEFAULT_SAFETY_CONFIG);
  });
});
