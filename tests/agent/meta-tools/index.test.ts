/**
 * Meta-tools index 测试
 *
 * 测试元工具注册、查找、执行路由
 */

import { describe, it, expect, vi } from "vitest";
import {
  META_TOOL_DEFINITIONS,
  getMetaToolDefs,
  isMetaTool,
  executeMetaTool,
  getMetaToolPermission,
} from "../../../src/agent/meta-tools/index.js";
import type {
  MetaToolContext,
  SessionState,
} from "../../../src/agent/meta-tools/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContext(): MetaToolContext {
  const sessionState: SessionState = {
    getTodoState: () => undefined,
    setTodoState: () => {},
    getCognitionState: () => undefined,
    setCognitionState: () => {},
  };

  return {
    sessionId: "test-session",
    userId: "test-user",
    agentId: "test-agent",
    sessionState,
    skills: {
      findSkill: vi.fn().mockResolvedValue([]),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      activate: vi.fn(),
      archive: vi.fn(),
      createDraft: vi.fn(),
      confirmDraft: vi.fn(),
    } as unknown as MetaToolContext["skills"],
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
    } as unknown as MetaToolContext["subAgents"],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("meta-tools index", () => {
  describe("META_TOOL_DEFINITIONS", () => {
    it("should contain exactly 5 meta-tools", () => {
      expect(META_TOOL_DEFINITIONS).toHaveLength(5);
    });

    it("should include all expected tools", () => {
      const names = META_TOOL_DEFINITIONS.map((d) => d.toolDef.name);
      expect(names).toContain("manage-todo");
      expect(names).toContain("manage-cognition");
      expect(names).toContain("find-skill");
      expect(names).toContain("manage-skill");
      expect(names).toContain("spawn-sub-agent");
    });

    it("should have correct permissions", () => {
      const permMap = new Map(
        META_TOOL_DEFINITIONS.map((d) => [d.toolDef.name, d.permission]),
      );
      expect(permMap.get("manage-todo")).toBe("safe");
      expect(permMap.get("manage-cognition")).toBe("safe");
      expect(permMap.get("find-skill")).toBe("safe");
      expect(permMap.get("manage-skill")).toBe("confirm");
      expect(permMap.get("spawn-sub-agent")).toBe("safe");
    });
  });

  describe("getMetaToolDefs", () => {
    it("should return 5 ToolDef objects", () => {
      const defs = getMetaToolDefs();
      expect(defs).toHaveLength(5);
      for (const def of defs) {
        expect(def.name).toBeDefined();
        expect(def.description).toBeDefined();
        expect(def.inputSchema).toBeDefined();
      }
    });
  });

  describe("isMetaTool", () => {
    it("should return true for meta-tools", () => {
      expect(isMetaTool("manage-todo")).toBe(true);
      expect(isMetaTool("manage-cognition")).toBe(true);
      expect(isMetaTool("find-skill")).toBe(true);
      expect(isMetaTool("manage-skill")).toBe(true);
      expect(isMetaTool("spawn-sub-agent")).toBe(true);
    });

    it("should return false for non-meta-tools", () => {
      expect(isMetaTool("web_search")).toBe(false);
      expect(isMetaTool("shell")).toBe(false);
      expect(isMetaTool("")).toBe(false);
    });
  });

  describe("getMetaToolPermission", () => {
    it("should return correct permission for each meta-tool", () => {
      expect(getMetaToolPermission("manage-todo")).toBe("safe");
      expect(getMetaToolPermission("manage-cognition")).toBe("safe");
      expect(getMetaToolPermission("find-skill")).toBe("safe");
      expect(getMetaToolPermission("manage-skill")).toBe("confirm");
      expect(getMetaToolPermission("spawn-sub-agent")).toBe("safe");
    });

    it("should return undefined for non-meta-tools", () => {
      expect(getMetaToolPermission("web_search")).toBeUndefined();
    });
  });

  describe("executeMetaTool", () => {
    it("should return undefined for non-meta-tools", async () => {
      const context = createMockContext();
      const result = await executeMetaTool("web_search", {}, context);
      expect(result).toBeUndefined();
    });

    it("should route manage-todo correctly", async () => {
      const context = createMockContext();
      const result = await executeMetaTool(
        "manage-todo",
        { todos: [{ id: "1", content: "Task", status: "pending" }] },
        context,
      );
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.toolName).toBe("manage-todo");
    });

    it("should route find-skill correctly", async () => {
      const context = createMockContext();
      const result = await executeMetaTool(
        "find-skill",
        { query: "test" },
        context,
      );
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.toolName).toBe("find-skill");
    });

    it("should route manage-skill correctly", async () => {
      const context = createMockContext();
      (context.skills.createDraft as ReturnType<typeof vi.fn>).mockResolvedValue("draft-1");
      const result = await executeMetaTool(
        "manage-skill",
        { action: "create", draft: { name: "Test", description: "Test", category: "test" } },
        context,
      );
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.toolName).toBe("manage-skill");
    });

    it("should route spawn-sub-agent correctly", async () => {
      const context = createMockContext();
      const result = await executeMetaTool(
        "spawn-sub-agent",
        { task_goal: "Test task" },
        context,
      );
      expect(result).toBeDefined();
      expect(result!.success).toBe(true);
      expect(result!.toolName).toBe("spawn-sub-agent");
    });
  });
});
