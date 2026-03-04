/**
 * Applicators 测试
 * 位置: tests/evolution/applicators.test.ts
 */

import { describe, expect, it, vi } from "vitest";
import { createKnowledgeStoreApplicator } from "../../src/evolution/applicators/knowledge-store-applicator.js";
import { createSkillManagerApplicator } from "../../src/evolution/applicators/skill-manager-applicator.js";
import { createRoutineRegistryApplicator } from "../../src/evolution/applicators/routine-registry-applicator.js";
import { createSandboxApplicator } from "../../src/evolution/applicators/sandbox-applicator.js";
import { createConfigApplicator } from "../../src/evolution/applicators/config-applicator.js";
import type { ValidatedMutation } from "../../src/evolution/types.js";

// ============ Helpers ============

function makeValidatedMutation(overrides: Partial<ValidatedMutation> = {}): ValidatedMutation {
  return {
    id: "mut-001",
    type: "knowledge",
    target: { system: "knowledge-store" },
    content: {
      action: "create",
      payload: { text: "Docker 调试技巧" },
      reason: "学到新知识",
    },
    source: { type: "reflection", sessionId: "s1" },
    createdAt: new Date(),
    validation: { passed: true, checks: [] },
    risk: "low",
    ...overrides,
  };
}

// ============ Tests ============

describe("Applicators", () => {
  describe("KnowledgeStoreApplicator", () => {
    it("should create knowledge entry", async () => {
      const store = {
        write: vi.fn().mockResolvedValue("k-123"),
        archive: vi.fn(),
        delete: vi.fn(),
      };
      const applicator = createKnowledgeStoreApplicator(store);

      const result = await applicator.apply(makeValidatedMutation());
      expect(result).toEqual({ status: "applied", id: "k-123", action: "create" });
      expect(store.write).toHaveBeenCalledWith(
        expect.objectContaining({ content: "Docker 调试技巧", source: "reflection" }),
      );
    });

    it("should archive knowledge entry", async () => {
      const store = {
        write: vi.fn(),
        archive: vi.fn(),
        delete: vi.fn(),
      };
      const applicator = createKnowledgeStoreApplicator(store);

      const mutation = makeValidatedMutation({
        content: { action: "archive", payload: { id: "k-old" }, reason: "过时" },
        target: { system: "knowledge-store", existingId: "k-old" },
      });
      const result = await applicator.apply(mutation);
      expect(result).toEqual({ status: "applied", id: "k-old", action: "archive" });
      expect(store.archive).toHaveBeenCalledWith("k-old", "过时");
    });

    it("should handle merge (archive old + create new)", async () => {
      const store = {
        write: vi.fn().mockResolvedValue("k-new"),
        archive: vi.fn(),
        delete: vi.fn(),
      };
      const applicator = createKnowledgeStoreApplicator(store);

      const mutation = makeValidatedMutation({
        content: {
          action: "merge",
          payload: { text: "合并后的知识", mergeFrom: "k-old" },
          reason: "整合重复",
        },
        target: { system: "knowledge-store", existingId: "k-old" },
      });
      const result = await applicator.apply(mutation);
      expect(result.status).toBe("merged");
      expect(store.archive).toHaveBeenCalled();
      expect(store.write).toHaveBeenCalled();
    });

    it("should reject unsupported action", async () => {
      const store = { write: vi.fn(), archive: vi.fn(), delete: vi.fn() };
      const applicator = createKnowledgeStoreApplicator(store);

      const mutation = makeValidatedMutation({
        content: { action: "update" as "create", payload: {}, reason: "" },
      });
      const result = await applicator.apply(mutation);
      expect(result.status).toBe("rejected");
    });
  });

  describe("SkillManagerApplicator", () => {
    it("should create draft for new skill", async () => {
      const manager = {
        createDraft: vi.fn().mockResolvedValue("draft-1"),
        confirmDraft: vi.fn(),
        archive: vi.fn(),
      };
      const applicator = createSkillManagerApplicator(manager);

      const mutation = makeValidatedMutation({
        type: "skill",
        target: { system: "skill-manager" },
        content: {
          action: "create",
          payload: { name: "docker-debug", type: "hybrid" },
          reason: "新技能",
        },
      });
      const result = await applicator.apply(mutation);
      expect(result).toEqual({ status: "pending-approval", approvalId: "draft-1" });
    });

    it("should archive skill", async () => {
      const manager = {
        createDraft: vi.fn(),
        confirmDraft: vi.fn(),
        archive: vi.fn(),
      };
      const applicator = createSkillManagerApplicator(manager);

      const mutation = makeValidatedMutation({
        type: "skill",
        target: { system: "skill-manager", existingId: "sk-old" },
        content: { action: "archive", payload: {}, reason: "不再需要" },
      });
      const result = await applicator.apply(mutation);
      expect(result).toEqual({ status: "applied", id: "sk-old", action: "archive" });
    });
  });

  describe("RoutineRegistryApplicator", () => {
    it("should add routine", async () => {
      const registry = {
        add: vi.fn().mockResolvedValue("rt-123"),
        update: vi.fn(),
        remove: vi.fn(),
      };
      const applicator = createRoutineRegistryApplicator(registry);

      const mutation = makeValidatedMutation({
        type: "routine",
        target: { system: "routine-registry" },
        content: {
          action: "create",
          payload: { name: "docker-learning", trigger: "cron:0 6 * * *" },
          reason: "新学习任务",
        },
      });
      const result = await applicator.apply(mutation);
      expect(result).toEqual({ status: "applied", id: "rt-123", action: "create" });
    });

    it("should remove routine", async () => {
      const registry = { add: vi.fn(), update: vi.fn(), remove: vi.fn() };
      const applicator = createRoutineRegistryApplicator(registry);

      const mutation = makeValidatedMutation({
        type: "routine",
        target: { system: "routine-registry", existingId: "rt-old" },
        content: { action: "delete", payload: {}, reason: "过期" },
      });
      const result = await applicator.apply(mutation);
      expect(result).toEqual({ status: "applied", id: "rt-old", action: "delete" });
    });
  });

  describe("SandboxApplicator", () => {
    it("should write code to sandbox", async () => {
      const executor = {
        execute: vi.fn().mockResolvedValue({ success: true, output: "", exitCode: 0 }),
      };
      const applicator = createSandboxApplicator(executor);

      const mutation = makeValidatedMutation({
        type: "code",
        target: { system: "sandbox" },
        content: {
          action: "create",
          payload: { code: "console.log('hello')", path: "tool.ts" },
          reason: "新工具",
        },
      });
      const result = await applicator.apply(mutation);
      expect(result.status).toBe("applied");
      expect(executor.execute).toHaveBeenCalled();
    });

    it("should reject on sandbox failure", async () => {
      const executor = {
        execute: vi.fn().mockResolvedValue({
          success: false,
          output: "permission denied",
          exitCode: 1,
        }),
      };
      const applicator = createSandboxApplicator(executor);

      const mutation = makeValidatedMutation({
        type: "code",
        target: { system: "sandbox" },
        content: { action: "create", payload: { code: "rm -rf /" }, reason: "" },
      });
      const result = await applicator.apply(mutation);
      expect(result.status).toBe("rejected");
    });
  });

  describe("ConfigApplicator", () => {
    it("should reject all mutations (stub)", async () => {
      const applicator = createConfigApplicator();

      const mutation = makeValidatedMutation({
        type: "config",
        target: { system: "config-manager" },
        content: { action: "update", payload: {}, reason: "" },
      });
      const result = await applicator.apply(mutation);
      expect(result.status).toBe("rejected");
      expect((result as { reason: string }).reason).toContain("not yet supported");
    });
  });
});
