/**
 * Knowledge Injector Tests
 */

import { describe, it, expect } from "vitest";
import {
  KnowledgeInjector,
  createKnowledgeInjector,
} from "../../src/skills/knowledge-injector";
import type { SkillInstance } from "../../src/skills/types";
import type { ToolDef } from "../../src/tools/types";

describe("KnowledgeInjector", () => {
  let injector: KnowledgeInjector;

  const createMockSkill = (
    id: string,
    context?: string,
    examples?: Array<{ user: string; assistant: string }>,
    toolDefs?: ToolDef[]
  ): SkillInstance => ({
    config: {
      id,
      name: `Skill ${id}`,
      version: "1.0.0",
      type: "hybrid",
      trigger: {},
      context,
      examples,
    },
    toolDefs: toolDefs ?? [],
    status: "active",
    loadedAt: Date.now(),
  });

  const mockToolDef: ToolDef = {
    name: "test_tool",
    description: "A test tool",
    inputSchema: { type: "object" },
    permission: "safe",
    source: { type: "mcp", serverName: "test" },
  };

  beforeEach(() => {
    injector = createKnowledgeInjector();
  });

  describe("inject", () => {
    it("应该注入 context 内容", () => {
      const skills: SkillInstance[] = [
        createMockSkill("skill-1", "这是第一个技能的上下文"),
        createMockSkill("skill-2", "这是第二个技能的上下文"),
      ];

      const result = injector.inject(skills);

      expect(result).toContain("这是第一个技能的上下文");
      expect(result).toContain("这是第二个技能的上下文");
    });

    it("应该注入 Few-Shot 示例", () => {
      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, [
          { user: "你好", assistant: "你好！" },
          { user: "再见", assistant: "再见！" },
        ]),
      ];

      const result = injector.inject(skills);

      expect(result).toContain("对话示例");
      expect(result).toContain("用户: 你好");
      expect(result).toContain("助手: 你好！");
    });

    it("应该注入工具描述", () => {
      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, undefined, [mockToolDef]),
      ];

      const result = injector.inject(skills);

      expect(result).toContain("可用工具");
      expect(result).toContain("test_tool");
      expect(result).toContain("A test tool");
    });

    it("应该返回空字符串当没有激活的 Skills", () => {
      const result = injector.inject([]);
      expect(result).toBe("");
    });

    it("应该限制示例数量", () => {
      const manyExamples = Array.from({ length: 10 }, (_, i) => ({
        user: `问题 ${i}`,
        assistant: `回答 ${i}`,
      }));

      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, manyExamples),
      ];

      const customInjector = createKnowledgeInjector({ maxExamples: 2 });
      const result = customInjector.inject(skills);

      // 应该只包含 2 个示例
      const questionCount = (result.match(/问题 \d+/g) || []).length;
      expect(questionCount).toBeLessThanOrEqual(4); // maxExamples * 2
    });
  });

  describe("buildSystemPrompt", () => {
    it("应该构建完整的 System Prompt", () => {
      const skills: SkillInstance[] = [
        createMockSkill("skill-1", "技能上下文"),
      ];

      const result = injector.buildSystemPrompt(skills, "基础提示词");

      expect(result).toContain("基础提示词");
      expect(result).toContain("激活的技能");
      expect(result).toContain("技能上下文");
    });

    it("应该只返回基础提示词当没有激活的 Skills", () => {
      const result = injector.buildSystemPrompt([], "基础提示词");

      expect(result).toBe("基础提示词");
    });
  });

  describe("buildToolDefinitions", () => {
    it("应该构建工具定义用于 function calling", () => {
      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, undefined, [
          mockToolDef,
          {
            name: "another_tool",
            description: "Another tool",
            inputSchema: { type: "object", properties: { query: { type: "string" } } },
            permission: "safe",
            source: { type: "mcp", serverName: "test" },
          },
        ]),
      ];

      const definitions = injector.buildToolDefinitions(skills);

      expect(definitions.length).toBe(2);
      expect(definitions[0]?.name).toBe("test_tool");
      expect(definitions[1]?.name).toBe("another_tool");
    });

    it("应该去重重复的工具", () => {
      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, undefined, [mockToolDef]),
        createMockSkill("skill-2", undefined, undefined, [mockToolDef]),
      ];

      const definitions = injector.buildToolDefinitions(skills);

      expect(definitions.length).toBe(1);
    });
  });

  describe("配置", () => {
    it("应该支持禁用工具描述", () => {
      const customInjector = createKnowledgeInjector({
        includeToolDescriptions: false,
      });

      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, undefined, [mockToolDef]),
      ];

      const result = customInjector.inject(skills);

      expect(result).not.toContain("可用工具");
    });

    it("应该支持 prompt 格式的示例", () => {
      const customInjector = createKnowledgeInjector({
        exampleFormat: "prompt",
      });

      const skills: SkillInstance[] = [
        createMockSkill("skill-1", undefined, [
          { user: "问题", assistant: "回答" },
        ]),
      ];

      const result = customInjector.inject(skills);

      expect(result).toContain("Input: 问题");
      expect(result).toContain("Output: 回答");
    });
  });
});
