/**
 * SkillIntentClassifier Tests
 *
 * @module tests/platform/skills/intent-classifier
 * @description 2 级意图分类器测试：L1 命令匹配 + L2 LLM 分类
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSkillIntentClassifier,
  type ISkillIntentClassifier,
  type SkillIntentClassifierConfig,
} from "../../../src/platform/skills/intent-classifier";
import type { ISkillRegistry, SkillInstance, SkillConfig, TriggerRule } from "../../../src/platform/skills/types";
import type { IModelProvider, Message, ChatOptions, ChatResponse, IModel } from "../../../src/platform/models/types";

// ============================================================================
// Mock Helpers
// ============================================================================

function _createMockSkill(overrides: {
  id: string;
  name: string;
  trigger: TriggerRule;
  status?: string;
}): SkillInstance {
  return {
    config: {
      id: overrides.id,
      name: overrides.name,
      version: "1.0",
      type: "hybrid",
      trigger: overrides.trigger,
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

function _createMockModelProvider(responses?: string[]): IModelProvider {
  let callIndex = 0;
  const defaultResponse = JSON.stringify({
    matches: [
      { skillId: "coding-assistant", confidence: 0.85, reasoning: "User wants coding help" },
    ],
  });

  const mockModel: IModel = {
    name: "test-model",
    type: "cloud",
    provider: "test",
    chat: vi.fn(async (_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> => {
      const resp = responses?.[callIndex] ?? defaultResponse;
      callIndex++;
      return {
        content: resp,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        model: "test-model",
        latency: 50,
      };
    }),
    stream: vi.fn(),
    supportsStreaming: vi.fn(() => false),
    supportsVision: vi.fn(() => false),
    supportsFunctionCalling: vi.fn(() => false),
    estimateCost: vi.fn(() => 0),
    getAverageLatency: vi.fn(() => 50),
  };

  return {
    get: vi.fn(() => mockModel),
    getByCapability: vi.fn(() => mockModel),
    getByTask: vi.fn(() => mockModel),
    registerModel: vi.fn(),
    setDefaultModel: vi.fn(),
    listModels: vi.fn(() => []),
    healthCheck: vi.fn(async () => new Map()),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SkillIntentClassifier", () => {
  const webSearchSkill = _createMockSkill({
    id: "web-search",
    name: "网页搜索",
    trigger: { commands: ["/search", "/s"], keywords: ["搜索", "查找"] },
  });

  const codingSkill = _createMockSkill({
    id: "coding-assistant",
    name: "代码助手",
    trigger: { commands: ["/code"], keywords: ["代码", "编程", "debug"] },
  });

  const gitSkill = _createMockSkill({
    id: "git-tools",
    name: "Git 工具",
    trigger: { commands: ["/git"], keywords: ["git", "commit"] },
  });

  const inactiveSkill = _createMockSkill({
    id: "inactive-skill",
    name: "Inactive",
    trigger: { commands: ["/inactive"] },
    status: "inactive",
  });

  const allSkills = [webSearchSkill, codingSkill, gitSkill, inactiveSkill];

  describe("L1: Command Match", () => {
    it("应精确匹配命令", () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({ skillRegistry: registry });

      const result = classifier.classify("/search something");
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0]!.skillId).toBe("web-search");
      expect(result.matches[0]!.confidence).toBe(0.95);
      expect(result.matches[0]!.reason).toBe("command");
      expect(result.method).toBe("command");
    });

    it("应匹配短命令别名", () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({ skillRegistry: registry });

      const result = classifier.classify("/s query here");
      expect(result.matches[0]!.skillId).toBe("web-search");
      expect(result.matches[0]!.matched).toBe("/s");
    });

    it("命中 L1 即返回，不走 L2", () => {
      const modelProvider = _createMockModelProvider();
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
      });

      const result = classifier.classify("/search test");
      expect(result.method).toBe("command");
      // L2 不应被调用
      const model = modelProvider.getByCapability("conversation");
      expect(model.chat).not.toHaveBeenCalled();
    });

    it("应匹配命令前缀 (/code fix)", () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({ skillRegistry: registry });

      const result = classifier.classify("/code fix this bug");
      expect(result.matches[0]!.skillId).toBe("coding-assistant");
    });

    it("只考虑 active skills", () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({ skillRegistry: registry });

      const result = classifier.classify("/inactive test");
      expect(result.matches.length).toBe(0);
    });
  });

  describe("L2: LLM Classification", () => {
    it("L1 未命中时应调用 LLM 分类", async () => {
      const modelProvider = _createMockModelProvider();
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        confidenceThreshold: 0.6,
      });

      const result = await classifier.classifyAsync("帮我写一个排序算法");
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.method).toBe("llm");
    });

    it("置信度低于阈值应被过滤", async () => {
      const modelProvider = _createMockModelProvider([
        JSON.stringify({
          matches: [{ skillId: "coding-assistant", confidence: 0.3, reasoning: "low" }],
        }),
      ]);
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        confidenceThreshold: 0.6,
      });

      const result = await classifier.classifyAsync("maybe code");
      expect(result.matches.length).toBe(0);
    });

    it("超时应返回空（不报错）", async () => {
      const slowModel: IModel = {
        name: "slow-model",
        type: "cloud",
        provider: "test",
        chat: vi.fn(async () => {
          await new Promise((r) => setTimeout(r, 5000));
          return {
            content: "{}",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            model: "slow-model",
            latency: 5000,
          };
        }),
        stream: vi.fn(),
        supportsStreaming: vi.fn(() => false),
        supportsVision: vi.fn(() => false),
        supportsFunctionCalling: vi.fn(() => false),
        estimateCost: vi.fn(() => 0),
        getAverageLatency: vi.fn(() => 5000),
      };
      const modelProvider: IModelProvider = {
        get: vi.fn(() => slowModel),
        getByCapability: vi.fn(() => slowModel),
        getByTask: vi.fn(() => slowModel),
        registerModel: vi.fn(),
        setDefaultModel: vi.fn(),
        listModels: vi.fn(() => []),
        healthCheck: vi.fn(async () => new Map()),
      };
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        timeout: 50, // 50ms timeout
      });

      const result = await classifier.classifyAsync("test input");
      expect(result.matches).toEqual([]);
    });

    it("无 modelProvider 时应跳过 L2", async () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        // no modelProvider
      });

      const result = await classifier.classifyAsync("帮我写代码");
      expect(result.matches).toEqual([]);
      expect(result.method).toBe("none");
    });

    it("enabled=false 时应跳过 L2", async () => {
      const modelProvider = _createMockModelProvider();
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        enabled: false,
      });

      const result = await classifier.classifyAsync("帮我写代码");
      expect(result.matches).toEqual([]);
    });

    it("缓存命中时不应重复调用 LLM", async () => {
      const modelProvider = _createMockModelProvider();
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        cacheTTL: 60000,
      });

      await classifier.classifyAsync("帮我写代码");
      await classifier.classifyAsync("帮我写代码"); // same input

      const model = modelProvider.getByCapability("conversation");
      expect(model.chat).toHaveBeenCalledTimes(1);
    });

    it("LLM 返回格式错误时应优雅降级", async () => {
      const modelProvider = _createMockModelProvider(["invalid json {{{}"]);
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
      });

      const result = await classifier.classifyAsync("test");
      expect(result.matches).toEqual([]);
    });

    it("结果应按 confidence 降序排列", async () => {
      const modelProvider = _createMockModelProvider([
        JSON.stringify({
          matches: [
            { skillId: "git-tools", confidence: 0.7, reasoning: "git" },
            { skillId: "coding-assistant", confidence: 0.9, reasoning: "code" },
          ],
        }),
      ]);
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        confidenceThreshold: 0.6,
      });

      const result = await classifier.classifyAsync("git push 代码");
      expect(result.matches.length).toBe(2);
      expect(result.matches[0]!.confidence).toBeGreaterThanOrEqual(result.matches[1]!.confidence);
    });
  });

  describe("Edge Cases", () => {
    it("空输入应返回无匹配", () => {
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({ skillRegistry: registry });

      const result = classifier.classify("");
      expect(result.matches).toEqual([]);
    });

    it("无注册 skills 应返回无匹配", () => {
      const registry = _createMockRegistry([]);
      const classifier = createSkillIntentClassifier({ skillRegistry: registry });

      const result = classifier.classify("/search test");
      expect(result.matches).toEqual([]);
    });
  });

  describe("clearCache()", () => {
    it("清除后应重新调用 LLM", async () => {
      const modelProvider = _createMockModelProvider();
      const registry = _createMockRegistry(allSkills);
      const classifier = createSkillIntentClassifier({
        skillRegistry: registry,
        modelProvider,
        cacheTTL: 60000,
      });

      await classifier.classifyAsync("帮我写代码");
      classifier.clearCache();
      await classifier.classifyAsync("帮我写代码");

      const model = modelProvider.getByCapability("conversation");
      expect(model.chat).toHaveBeenCalledTimes(2);
    });
  });
});
