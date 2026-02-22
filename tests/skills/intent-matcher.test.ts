/**
 * Intent Matcher Tests
 */

import { describe, it, expect } from "vitest";
import {
  IntentMatcher,
  createIntentMatcher,
} from "../../src/skills/intent-matcher";
import type { SkillInstance } from "../../src/skills/types";

describe("IntentMatcher", () => {
  let matcher: IntentMatcher;

  const createMockSkill = (
    id: string,
    keywords?: string[],
    intent?: string[],
    patterns?: string[],
  ): SkillInstance => ({
    config: {
      id,
      name: `Skill ${id}`,
      version: "1.0.0",
      type: "hybrid",
      trigger: {
        keywords,
        intent,
        patterns,
      },
    },
    toolDefs: [],
    status: "inactive",
    loadedAt: Date.now(),
  });

  beforeEach(() => {
    matcher = createIntentMatcher();
  });

  describe("match", () => {
    it("应该通过关键词匹配 Skill", () => {
      const skills: SkillInstance[] = [
        createMockSkill("web-search", ["搜索", "查一下", "天气"]),
        createMockSkill("file-tools", ["文件", "读取", "写入"]),
      ];

      const results = matcher.match("帮我查一下今天东京的天气", skills);

      expect(results.length).toBeGreaterThan(0);
      // IntentMatcher 不设置 skillId，由 SkillRegistry 填充
      expect(results[0]?.reason).toBe("keyword");
      expect(results[0]?.matched).toBe("查一下");
    });

    it("应该通过意图匹配 Skill", () => {
      const skills: SkillInstance[] = [
        createMockSkill("web-search", undefined, ["search", "lookup"]),
        createMockSkill("time", undefined, ["get_time", "time_query"]),
      ];

      const results = matcher.match("我想 lookup 一些信息", skills);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.reason).toBe("intent");
      expect(results[0]?.matched).toBe("lookup");
    });

    it("应该通过正则匹配 Skill", () => {
      const skills: SkillInstance[] = [
        createMockSkill("pattern-skill", undefined, undefined, [
          "今天.*天气",
          "几点.*了",
        ]),
      ];

      const results = matcher.match("今天北京的天气怎么样", skills);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.reason).toBe("pattern");
      expect(results[0]?.confidence).toBe(0.9);
    });

    it("应该按置信度排序结果", () => {
      const skills: SkillInstance[] = [
        createMockSkill("keyword-skill", ["测试"], undefined, undefined),
        createMockSkill("pattern-skill", undefined, undefined, [".*测试.*"]),
      ];

      const results = matcher.match("这是一个测试", skills);

      // 正则匹配应该有更高的置信度
      expect(results.length).toBe(2);
      expect(results[0]?.confidence).toBeGreaterThanOrEqual(
        results[1]?.confidence ?? 0,
      );
    });

    it("应该返回空数组当没有匹配时", () => {
      const skills: SkillInstance[] = [
        createMockSkill("web-search", ["搜索", "查一下"]),
      ];

      const results = matcher.match("今天吃什么", skills);

      expect(results).toEqual([]);
    });

    it("应该忽略无效的正则表达式", () => {
      const skills: SkillInstance[] = [
        createMockSkill(
          "invalid-regex",
          ["关键词"],
          undefined,
          ["[invalid(regex"], // 无效正则
        ),
      ];

      // 不应该抛出错误，应该 fallback 到关键词匹配
      const results = matcher.match("这个关键词很重要", skills);

      expect(results.length).toBe(1);
      expect(results[0]?.reason).toBe("keyword");
    });
  });

  describe("配置", () => {
    it("应该支持自定义置信度阈值", () => {
      const customMatcher = createIntentMatcher({
        minConfidence: 0.9,
      });

      const skills: SkillInstance[] = [createMockSkill("web-search", ["搜索"])];

      // 关键词匹配默认置信度 0.7，低于 0.9 阈值
      const results = customMatcher.match("帮我搜索一下", skills);

      expect(results).toEqual([]);
    });
  });
});
