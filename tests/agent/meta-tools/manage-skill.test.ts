/**
 * manage-skill 元工具测试
 *
 * @see meta-tools.md §五
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  manageSkillDefinition,
  manageSkillHandler,
} from "../../../src/agent/meta-tools/manage-skill.js";
import type {
  MetaToolContext,
  SessionState,
} from "../../../src/agent/meta-tools/types.js";
import type {
  SkillManagerPort,
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

function createMockSkillManager(): SkillManagerPort {
  return {
    findSkill: vi.fn().mockResolvedValue([]),
    getActiveSkills: vi.fn().mockResolvedValue([]),
    activate: vi.fn().mockResolvedValue({ id: "test", name: "test", injectionLevel: "full", activatedAt: Date.now() }),
    archive: vi.fn().mockResolvedValue(true),
    createDraft: vi.fn().mockResolvedValue("draft-123"),
    confirmDraft: vi.fn().mockResolvedValue(true),
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

describe("manage-skill", () => {
  describe("toolDefinition", () => {
    it("should have correct name and permission", () => {
      expect(manageSkillDefinition.toolDef.name).toBe("manage-skill");
      expect(manageSkillDefinition.permission).toBe("confirm");
    });

    it("should have inputSchema with action", () => {
      const schema = manageSkillDefinition.toolDef.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.properties?.action).toBeDefined();
      expect(schema.required).toContain("action");
    });
  });

  describe("handler - create action", () => {
    it("should create draft via SkillManagerPort", async () => {
      const skillManager = createMockSkillManager();
      const context = createMockContext(skillManager);

      const result = await manageSkillHandler(
        {
          action: "create",
          draft: {
            name: "股票查询",
            description: "查询实时股价",
            category: "finance",
          },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(skillManager.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "股票查询",
          description: "查询实时股价",
          category: "finance",
        }),
      );
    });

    it("should return draft ID on success", async () => {
      const skillManager = createMockSkillManager();
      const context = createMockContext(skillManager);

      const result = await manageSkillHandler(
        {
          action: "create",
          draft: {
            name: "Test Skill",
            description: "A test skill",
            category: "test",
          },
        },
        context,
      );

      expect(result.success).toBe(true);
      const output = result.output as { success: boolean; draftId: string };
      expect(output.draftId).toBe("draft-123");
    });

    it("should fail without draft for create action", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler(
        { action: "create" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fail if draft is missing required fields", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler(
        { action: "create", draft: { name: "Only name" } },
        context,
      );

      expect(result.success).toBe(false);
    });
  });

  describe("handler - update action", () => {
    it("should create draft with skill_id for update", async () => {
      const skillManager = createMockSkillManager();
      const context = createMockContext(skillManager);

      const result = await manageSkillHandler(
        {
          action: "update",
          skill_id: "stock-query",
          draft: {
            name: "股票查询 v2",
            description: "查询实时股价和财报",
            category: "finance",
          },
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(skillManager.createDraft).toHaveBeenCalled();
    });

    it("should fail without skill_id for update", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler(
        {
          action: "update",
          draft: { name: "Test", description: "Test", category: "test" },
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("skill_id");
    });
  });

  describe("handler - archive action", () => {
    it("should archive via SkillManagerPort", async () => {
      const skillManager = createMockSkillManager();
      const context = createMockContext(skillManager);

      const result = await manageSkillHandler(
        {
          action: "archive",
          skill_id: "stock-query",
          reason: "API 已停服",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(skillManager.archive).toHaveBeenCalledWith(
        "stock-query",
        "API 已停服",
      );
    });

    it("should fail without skill_id for archive", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler(
        { action: "archive", reason: "test" },
        context,
      );

      expect(result.success).toBe(false);
    });

    it("should fail without reason for archive", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler(
        { action: "archive", skill_id: "test" },
        context,
      );

      expect(result.success).toBe(false);
    });

    it("should handle archive failure", async () => {
      const skillManager = createMockSkillManager();
      (skillManager.archive as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      const context = createMockContext(skillManager);

      const result = await manageSkillHandler(
        { action: "archive", skill_id: "test", reason: "不需要了" },
        context,
      );

      expect(result.success).toBe(false);
    });
  });

  describe("handler - validation", () => {
    it("should fail for missing action", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler({}, context);

      expect(result.success).toBe(false);
    });

    it("should fail for invalid action", async () => {
      const context = createMockContext();

      const result = await manageSkillHandler(
        { action: "destroy" },
        context,
      );

      expect(result.success).toBe(false);
    });

    it("should handle SkillManager errors gracefully", async () => {
      const skillManager = createMockSkillManager();
      (skillManager.createDraft as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Storage error"),
      );
      const context = createMockContext(skillManager);

      const result = await manageSkillHandler(
        {
          action: "create",
          draft: { name: "Test", description: "Test", category: "test" },
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Storage error");
    });
  });
});
