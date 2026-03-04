/**
 * ToolExecutorAdapter 测试
 *
 * 适配 ToolRegistry → ToolExecutorPort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolExecutorAdapter } from "../../../src/platform/adapters/tool-executor-adapter.js";
import type { ToolExecutorPort } from "../../../src/agent/ports/platform-services.js";
import type { ToolRegistry } from "../../../src/platform/tools/registry.js";
import type { ToolDef, ToolCall, ToolResult } from "../../../src/platform/tools/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

const sampleToolDef: ToolDef = {
  name: "web_search",
  description: "Search the web",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
  permission: "safe",
  source: { type: "native", nativeId: "web_search" },
};

function createMockRegistry(): {
  registry: ToolRegistry;
  execute: ReturnType<typeof vi.fn>;
  executeAll: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  has: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn().mockResolvedValue({
    callId: "call-1",
    toolName: "web_search",
    success: true,
    output: "result",
    latency: 100,
  } as ToolResult);
  const executeAll = vi.fn().mockResolvedValue([]);
  const list = vi.fn().mockReturnValue([sampleToolDef]);
  const has = vi.fn().mockReturnValue(true);

  const registry = {
    execute,
    executeAll,
    list,
    has,
    get: vi.fn().mockReturnValue(sampleToolDef),
  } as unknown as ToolRegistry;

  return { registry, execute, executeAll, list, has };
}

// ============================================================================
// Tests
// ============================================================================

describe("ToolExecutorAdapter", () => {
  let adapter: ToolExecutorPort;
  let execute: ReturnType<typeof vi.fn>;
  let executeAll: ReturnType<typeof vi.fn>;
  let list: ReturnType<typeof vi.fn>;
  let has: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockRegistry();
    adapter = new ToolExecutorAdapter(mock.registry);
    execute = mock.execute;
    executeAll = mock.executeAll;
    list = mock.list;
    has = mock.has;
  });

  describe("execute", () => {
    it("should inject sessionId into toolCall and delegate to registry", async () => {
      const toolCall: ToolCall = {
        id: "call-1",
        name: "web_search",
        arguments: { q: "test" },
      };

      await adapter.execute(toolCall, "session-1");

      expect(execute).toHaveBeenCalledWith({
        id: "call-1",
        name: "web_search",
        arguments: { q: "test" },
        sessionId: "session-1",
      });
    });

    it("should return ToolResult from registry", async () => {
      const toolCall: ToolCall = {
        id: "call-1",
        name: "web_search",
        arguments: {},
      };

      const result = await adapter.execute(toolCall, "session-1");

      expect(result.success).toBe(true);
      expect(result.toolName).toBe("web_search");
    });
  });

  describe("executeBatch", () => {
    it("should inject sessionId into all calls", async () => {
      const calls: ToolCall[] = [
        { id: "c1", name: "web_search", arguments: { q: "a" } },
        { id: "c2", name: "web_search", arguments: { q: "b" } },
      ];

      executeAll.mockResolvedValue([
        { callId: "c1", toolName: "web_search", success: true, output: "a", latency: 50 },
        { callId: "c2", toolName: "web_search", success: true, output: "b", latency: 60 },
      ]);

      await adapter.executeBatch(calls, "session-1");

      expect(executeAll).toHaveBeenCalledWith([
        { id: "c1", name: "web_search", arguments: { q: "a" }, sessionId: "session-1" },
        { id: "c2", name: "web_search", arguments: { q: "b" }, sessionId: "session-1" },
      ]);
    });
  });

  describe("getToolDefinitions", () => {
    it("should return tool definitions from registry", async () => {
      const defs = await adapter.getToolDefinitions();

      expect(defs).toHaveLength(1);
      expect(defs[0]!.name).toBe("web_search");
    });
  });

  describe("isToolAvailable", () => {
    it("should delegate to registry.has()", () => {
      has.mockReturnValue(true);
      expect(adapter.isToolAvailable("web_search")).toBe(true);

      has.mockReturnValue(false);
      expect(adapter.isToolAvailable("unknown")).toBe(false);
    });
  });
});
