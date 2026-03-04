/**
 * find-skill 元工具测试
 *
 * @see meta-tools.md §2.5
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findSkillDefinition,
  findSkillHandler,
} from "../../../src/agent/meta-tools/find-skill.js";
import type {
  MetaToolContext,
  SessionState,
} from "../../../src/agent/meta-tools/types.js";
import type {
  SkillManagerPort,
  SkillSearchResult,
} from "../../../src/agent/ports/platform-services.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockSessionState(): SessionState {
  return {
    getTodoState: () => undefined,
    setTodoState: () => {},
  };
}

function createMockSkillManager(
  results: SkillSearchResult[] = [],
): SkillManagerPort {
  return {
    findSkill: vi.fn().mockResolvedValue(results),
    getActiveSkills: vi.fn().mockResolvedValue([]),
    activate: vi.fn(),
    archive: vi.fn(),
    createDraft: vi.fn(),
    confirmDraft: vi.fn(),
  } as unknown as SkillManagerPort;
}

function createMockContext(
  skillManager?: SkillManagerPort,
): MetaToolContext {
  return {
    sessionId: "test-session",
    userId: "test-user",
    agentId: "test-agent",
    sessionState: createMockSessionState(),
    skills: skillManager ?? createMockSkillManager(),
    subAgents: {} as MetaToolContext["subAgents"],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("find-skill", () => {
  describe("toolDefinition", () => {
    it("should have correct name and permission", () => {
      expect(findSkillDefinition.toolDef.name).toBe("find-skill");
      expect(findSkillDefinition.permission).toBe("safe");
    });

    it("should have inputSchema with query", () => {
      const schema = findSkillDefinition.toolDef.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.properties?.query).toBeDefined();
      expect(schema.required).toContain("query");
    });
  });

  describe("handler", () => {
    const sampleResults: SkillSearchResult[] = [
      {
        id: "coding-assistant",
        name: "代码助手",
        description: "编程和调试辅助",
        category: "development",
        status: "active",
        relevanceScore: 0.95,
      },
      {
        id: "web-search",
        name: "网页搜索",
        description: "搜索网页信息",
        category: "search",
        status: "active",
        relevanceScore: 0.7,
      },
    ];

    it("should delegate to SkillManagerPort.findSkill", async () => {
      const skillManager = createMockSkillManager(sampleResults);
      const context = createMockContext(skillManager);

      const result = await findSkillHandler(
        { query: "代码" },
        context,
      );

      expect(result.success).toBe(true);
      expect(skillManager.findSkill).toHaveBeenCalledWith("代码", undefined);
    });

    it("should pass limit parameter", async () => {
      const skillManager = createMockSkillManager(sampleResults);
      const context = createMockContext(skillManager);

      await findSkillHandler({ query: "代码", limit: 5 }, context);

      expect(skillManager.findSkill).toHaveBeenCalledWith("代码", 5);
    });

    it("should return search results", async () => {
      const skillManager = createMockSkillManager(sampleResults);
      const context = createMockContext(skillManager);

      const result = await findSkillHandler({ query: "代码" }, context);

      expect(result.success).toBe(true);
      const output = result.output as { success: boolean; results: SkillSearchResult[] };
      expect(output.results).toHaveLength(2);
      expect(output.results[0].id).toBe("coding-assistant");
    });

    it("should handle empty results", async () => {
      const skillManager = createMockSkillManager([]);
      const context = createMockContext(skillManager);

      const result = await findSkillHandler({ query: "不存在" }, context);

      expect(result.success).toBe(true);
      const output = result.output as { success: boolean; results: SkillSearchResult[] };
      expect(output.results).toHaveLength(0);
    });

    it("should return error for missing query", async () => {
      const context = createMockContext();

      const result = await findSkillHandler({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error for non-string query", async () => {
      const context = createMockContext();

      const result = await findSkillHandler({ query: 123 }, context);

      expect(result.success).toBe(false);
    });

    it("should handle SkillManager errors gracefully", async () => {
      const skillManager = createMockSkillManager();
      (skillManager.findSkill as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Service unavailable"),
      );
      const context = createMockContext(skillManager);

      const result = await findSkillHandler({ query: "test" }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Service unavailable");
    });
  });
});
