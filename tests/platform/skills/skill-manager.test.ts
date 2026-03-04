/**
 * SkillManager Tests
 *
 * @module tests/platform/skills/skill-manager
 * @description SkillManagerPort adapter 实现测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSkillManager,
  type ISkillManager,
  type SkillManagerConfig,
} from "../../../src/platform/skills/skill-manager";
import type {
  ISkillRegistry,
  SkillInstance,
  SkillConfig,
  TriggerRule,
} from "../../../src/platform/skills/types";
import type {
  ISkillIntentClassifier,
} from "../../../src/platform/skills/intent-classifier";
import type {
  SkillIntentResult,
} from "../../../src/platform/skills/intent-types";
import type {
  SkillDraft,
} from "../../../src/agent/ports/platform-services";

// ============================================================================
// Mock Helpers
// ============================================================================

function _createMockSkill(overrides: {
  id: string;
  name: string;
  trigger?: TriggerRule;
  status?: string;
  description?: string;
}): SkillInstance {
  return {
    config: {
      id: overrides.id,
      name: overrides.name,
      version: "1.0",
      type: "hybrid",
      trigger: overrides.trigger ?? { commands: [] },
      metadata: {
        description: overrides.description ?? "",
      },
    } as SkillConfig,
    toolDefs: [],
    status: (overrides.status ?? "active") as "active" | "inactive",
    loadedAt: Date.now(),
  };
}

function _createMockRegistry(skills: SkillInstance[]): ISkillRegistry {
  return {
    load: vi.fn(),
    unload: vi.fn(),
    get: vi.fn((id) => skills.find((s) => s.config.id === id)),
    list: vi.fn(() => skills),
    matchIntent: vi.fn(() => []),
    activate: vi.fn(),
  };
}

function _createMockClassifier(overrides?: {
  classifyResult?: SkillIntentResult;
  classifyAsyncResult?: SkillIntentResult;
}): ISkillIntentClassifier {
  const defaultResult: SkillIntentResult = {
    matches: [],
    classificationTime: 10,
    method: "none",
  };

  return {
    classify: vi.fn(() => overrides?.classifyResult ?? defaultResult),
    classifyAsync: vi.fn(async () => overrides?.classifyAsyncResult ?? defaultResult),
    clearCache: vi.fn(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SkillManager", () => {
  const webSearchSkill = _createMockSkill({
    id: "web-search",
    name: "网页搜索",
    trigger: { commands: ["/search"] },
    description: "Search the web",
  });

  const codingSkill = _createMockSkill({
    id: "coding-assistant",
    name: "代码助手",
    trigger: { commands: ["/code"] },
    description: "Coding help",
  });

  const gitSkill = _createMockSkill({
    id: "git-tools",
    name: "Git 工具",
    trigger: { commands: ["/git"] },
    description: "Git operations",
  });

  const allSkills = [webSearchSkill, codingSkill, gitSkill];

  describe("findSkill()", () => {
    it("应使用 IntentClassifier 搜索并返回结果", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier({
        classifyAsyncResult: {
          matches: [
            { skillId: "coding-assistant", confidence: 0.85, reason: "llm" },
          ],
          classificationTime: 50,
          method: "llm",
        },
      });
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const results = await manager.findSkill("帮我写代码");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.id).toBe("coding-assistant");
      expect(results[0]!.relevanceScore).toBe(0.85);
    });

    it("应结合 registry 文本搜索", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier(); // 返回空
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      // 名称包含 "搜索"
      const results = await manager.findSkill("搜索");
      expect(results.some((r) => r.id === "web-search")).toBe(true);
    });

    it("应去重（多源匹配同一 skill）", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier({
        classifyAsyncResult: {
          matches: [
            { skillId: "web-search", confidence: 0.9, reason: "llm" },
          ],
          classificationTime: 50,
          method: "llm",
        },
      });
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      // "搜索" 会同时命中 classifier 和 registry 文本搜索
      const results = await manager.findSkill("搜索");
      const ids = results.map((r) => r.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it("应尊重 limit 参数", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier({
        classifyAsyncResult: {
          matches: [
            { skillId: "web-search", confidence: 0.9, reason: "llm" },
            { skillId: "coding-assistant", confidence: 0.8, reason: "llm" },
            { skillId: "git-tools", confidence: 0.7, reason: "llm" },
          ],
          classificationTime: 50,
          method: "llm",
        },
      });
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const results = await manager.findSkill("test", 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe("getActiveSkills()", () => {
    it("新 session 应返回空", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const active = await manager.getActiveSkills("session-1");
      expect(active).toEqual([]);
    });

    it("activate 后应返回激活列表", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      await manager.activate("web-search", "session-1", "full");
      const active = await manager.getActiveSkills("session-1");
      expect(active.length).toBe(1);
      expect(active[0]!.id).toBe("web-search");
      expect(active[0]!.injectionLevel).toBe("full");
    });
  });

  describe("activate()", () => {
    it("应添加到 session 状态", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const activation = await manager.activate("coding-assistant", "session-1", "tools-only");
      expect(activation.id).toBe("coding-assistant");
      expect(activation.name).toBe("代码助手");
      expect(activation.injectionLevel).toBe("tools-only");
      expect(activation.activatedAt).toBeGreaterThan(0);
    });

    it("应调用 SkillRegistry.activate()", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      await manager.activate("web-search", "session-1", "full");
      expect(registry.activate).toHaveBeenCalledWith(["web-search"]);
    });

    it("超出 maxActivePerSession 限制时应报错", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 2,
      });

      await manager.activate("web-search", "session-1", "full");
      await manager.activate("coding-assistant", "session-1", "full");

      await expect(
        manager.activate("git-tools", "session-1", "full"),
      ).rejects.toThrow(/max.*active/i);
    });

    it("未知 skillId 应报错", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      await expect(
        manager.activate("nonexistent", "session-1", "full"),
      ).rejects.toThrow(/not found/i);
    });

    it("重复 activate 同一 skill 应幂等", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      await manager.activate("web-search", "session-1", "full");
      await manager.activate("web-search", "session-1", "full"); // 不报错

      const active = await manager.getActiveSkills("session-1");
      expect(active.length).toBe(1);
    });
  });

  describe("archive()", () => {
    it("应返回 true", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const result = await manager.archive("web-search", "no longer needed");
      expect(result).toBe(true);
    });

    it("应从 active sessions 中移除", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      await manager.activate("web-search", "session-1", "full");
      await manager.archive("web-search", "deprecated");

      const active = await manager.getActiveSkills("session-1");
      expect(active.length).toBe(0);
    });
  });

  describe("createDraft()", () => {
    it("应返回有效 draftId", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const draft: SkillDraft = {
        name: "Test Skill",
        description: "A test skill",
        category: "utility",
      };

      const draftId = await manager.createDraft(draft);
      expect(typeof draftId).toBe("string");
      expect(draftId.length).toBeGreaterThan(0);
    });

    it("应存储带时间戳的 draft", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const draft: SkillDraft = {
        name: "Test Skill",
        description: "A test skill",
        category: "utility",
      };

      const draftId = await manager.createDraft(draft);
      // Confirm draft should succeed (proves it was stored)
      const confirmed = await manager.confirmDraft(draftId);
      expect(confirmed).toBe(true);
    });
  });

  describe("confirmDraft()", () => {
    it("有效 draftId 应成功确认", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const draftId = await manager.createDraft({
        name: "New Skill",
        description: "test",
        category: "utility",
      });

      const result = await manager.confirmDraft(draftId);
      expect(result).toBe(true);
    });

    it("无效 draftId 应失败", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const result = await manager.confirmDraft("invalid-id");
      expect(result).toBe(false);
    });

    it("确认后重复确认应失败 (draft 已消费)", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      const draftId = await manager.createDraft({
        name: "New Skill",
        description: "test",
        category: "utility",
      });

      await manager.confirmDraft(draftId);
      const secondResult = await manager.confirmDraft(draftId);
      expect(secondResult).toBe(false);
    });
  });

  describe("Session 隔离", () => {
    it("不同 session 应独立", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = _createMockClassifier();
      const manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 5,
      });

      await manager.activate("web-search", "session-1", "full");
      await manager.activate("coding-assistant", "session-2", "full");

      const s1Active = await manager.getActiveSkills("session-1");
      const s2Active = await manager.getActiveSkills("session-2");

      expect(s1Active.length).toBe(1);
      expect(s1Active[0]!.id).toBe("web-search");
      expect(s2Active.length).toBe(1);
      expect(s2Active[0]!.id).toBe("coding-assistant");
    });
  });
});
