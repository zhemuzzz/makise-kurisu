/**
 * ToolExecutorAdapter 测试
 *
 * 适配 ToolRegistry → ToolExecutorPort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolExecutorAdapter } from "../../../src/platform/adapters/tool-executor-adapter.js";
import type { MetaToolDeps } from "../../../src/platform/adapters/tool-executor-adapter.js";
import type { ToolExecutorPort } from "../../../src/agent/ports/platform-services.js";
import type { ToolRegistry } from "../../../src/platform/tools/registry.js";
import type { ToolDef, ToolCall, ToolResult } from "../../../src/platform/tools/types.js";
import type { SessionState } from "../../../src/agent/meta-tools/types.js";

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

// ============================================================================
// Meta-tool Routing Tests (KURISU-040)
// ============================================================================

function createMockSessionState(): SessionState {
  return {
    getTodoState: () => undefined,
    setTodoState: () => {},
    getCognitionState: () => undefined,
    setCognitionState: () => {},
  };
}

function createMockMetaToolDeps(overrides?: Partial<MetaToolDeps>): MetaToolDeps {
  const sessionState = createMockSessionState();
  return {
    getSessionState: vi.fn().mockReturnValue(sessionState),
    skills: {
      findSkill: vi.fn().mockResolvedValue([]),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      activate: vi.fn(),
      archive: vi.fn(),
      createDraft: vi.fn(),
      confirmDraft: vi.fn(),
    } as unknown as MetaToolDeps["skills"],
    subAgents: {
      spawn: vi.fn().mockResolvedValue("sub-1"),
      awaitResult: vi.fn().mockResolvedValue({
        subAgentId: "sub-1",
        success: true,
        result: "done",
        stats: { iterations: 1, toolCallCount: 0, totalTokens: 100, inputTokens: 50, outputTokens: 50, duration: 1000, compactCount: 0 },
      }),
      abort: vi.fn(),
      getActiveCount: vi.fn().mockReturnValue(0),
      getStatus: vi.fn().mockReturnValue("completed"),
    } as unknown as MetaToolDeps["subAgents"],
    agentId: "test-agent",
    ...overrides,
  };
}

describe("ToolExecutorAdapter with MetaToolDeps", () => {
  let registry: ReturnType<typeof createMockRegistry>;
  let metaDeps: MetaToolDeps;
  let adapter: ToolExecutorAdapter;

  beforeEach(() => {
    registry = createMockRegistry();
    metaDeps = createMockMetaToolDeps();
    adapter = new ToolExecutorAdapter(registry.registry, metaDeps);
  });

  describe("meta-tool interception", () => {
    it("should intercept manage-todo and not delegate to registry", async () => {
      const toolCall: ToolCall = {
        id: "call-mt",
        name: "manage-todo",
        arguments: { todos: [{ id: "1", content: "Task", status: "pending" }] },
      };

      const result = await adapter.execute(toolCall, "session-1");

      expect(result.success).toBe(true);
      expect(result.toolName).toBe("manage-todo");
      // Should NOT have called registry.execute
      expect(registry.execute).not.toHaveBeenCalled();
    });

    it("should intercept manage-cognition and not delegate to registry", async () => {
      const toolCall: ToolCall = {
        id: "call-mc",
        name: "manage-cognition",
        arguments: { action: "read" },
      };

      const result = await adapter.execute(toolCall, "session-1");

      expect(result.success).toBe(true);
      expect(result.toolName).toBe("manage-cognition");
      expect(registry.execute).not.toHaveBeenCalled();
    });

    it("should delegate non-meta-tool to registry", async () => {
      const toolCall: ToolCall = {
        id: "call-ws",
        name: "web_search",
        arguments: { q: "test" },
      };

      await adapter.execute(toolCall, "session-1");

      expect(registry.execute).toHaveBeenCalledWith({
        id: "call-ws",
        name: "web_search",
        arguments: { q: "test" },
        sessionId: "session-1",
      });
    });

    it("should pass sessionId to getSessionState", async () => {
      const toolCall: ToolCall = {
        id: "call-mt2",
        name: "manage-todo",
        arguments: { todos: [] },
      };

      await adapter.execute(toolCall, "session-42");

      expect(metaDeps.getSessionState).toHaveBeenCalledWith("session-42");
    });
  });

  describe("getToolDefinitions with meta-tools", () => {
    it("should include both registry tools and meta-tool definitions", async () => {
      const defs = await adapter.getToolDefinitions();

      // Registry has 1 tool (web_search) + 5 meta-tools
      expect(defs.length).toBeGreaterThanOrEqual(6);
      const names = defs.map((d) => d.name);
      expect(names).toContain("web_search");
      expect(names).toContain("manage-todo");
      expect(names).toContain("manage-cognition");
      expect(names).toContain("find-skill");
      expect(names).toContain("manage-skill");
      expect(names).toContain("spawn-sub-agent");
    });
  });

  describe("isToolAvailable with meta-tools", () => {
    it("should return true for meta-tools", () => {
      expect(adapter.isToolAvailable("manage-todo")).toBe(true);
      expect(adapter.isToolAvailable("manage-cognition")).toBe(true);
      expect(adapter.isToolAvailable("find-skill")).toBe(true);
      expect(adapter.isToolAvailable("manage-skill")).toBe(true);
      expect(adapter.isToolAvailable("spawn-sub-agent")).toBe(true);
    });

    it("should still check registry for non-meta-tools", () => {
      registry.has.mockReturnValue(false);
      expect(adapter.isToolAvailable("unknown-tool")).toBe(false);
    });
  });

  describe("without metaToolDeps", () => {
    it("should not include meta-tool definitions", async () => {
      const adapterNoMeta = new ToolExecutorAdapter(registry.registry);
      const defs = await adapterNoMeta.getToolDefinitions();

      expect(defs).toHaveLength(1);
      expect(defs[0]!.name).toBe("web_search");
    });

    it("should not report meta-tools as available", () => {
      const adapterNoMeta = new ToolExecutorAdapter(registry.registry);
      registry.has.mockReturnValue(false);
      expect(adapterNoMeta.isToolAvailable("manage-todo")).toBe(false);
    });
  });
});
