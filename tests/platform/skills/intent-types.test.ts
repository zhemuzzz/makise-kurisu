/**
 * Intent Types Tests
 *
 * 意图分类类型结构和工厂函数测试
 */

import { describe, it, expect } from "vitest";
import {
  createEmptyIntentResult,
} from "../../../src/platform/skills/intent-types";
import type {
  SkillMatch,
  SkillIntentResult,
  MatchMethod,
} from "../../../src/platform/skills/intent-types";

describe("Intent Types", () => {
  describe("SkillMatch structure", () => {
    it("应支持 command 方法的匹配结果", () => {
      const match: SkillMatch = {
        skillId: "web-search",
        confidence: 0.95,
        reason: "command",
        matched: "/search",
      };

      expect(match.skillId).toBe("web-search");
      expect(match.confidence).toBe(0.95);
      expect(match.reason).toBe("command");
      expect(match.matched).toBe("/search");
    });

    it("应支持 llm 方法的匹配结果", () => {
      const match: SkillMatch = {
        skillId: "coding-assistant",
        confidence: 0.82,
        reason: "llm",
      };

      expect(match.skillId).toBe("coding-assistant");
      expect(match.confidence).toBe(0.82);
      expect(match.reason).toBe("llm");
      expect(match.matched).toBeUndefined();
    });
  });

  describe("SkillIntentResult structure", () => {
    it("应支持有匹配的结果", () => {
      const result: SkillIntentResult = {
        matches: [
          { skillId: "web-search", confidence: 0.95, reason: "command", matched: "/search" },
          { skillId: "coding-assistant", confidence: 0.7, reason: "llm" },
        ],
        classificationTime: 150,
        method: "command",
      };

      expect(result.matches).toHaveLength(2);
      expect(result.classificationTime).toBe(150);
      expect(result.method).toBe("command");
    });

    it("应支持无匹配的结果", () => {
      const result: SkillIntentResult = {
        matches: [],
        classificationTime: 50,
        method: "none",
      };

      expect(result.matches).toHaveLength(0);
      expect(result.method).toBe("none");
    });
  });

  describe("MatchMethod type", () => {
    it("command 和 llm 应为有效值", () => {
      const methods: MatchMethod[] = ["command", "llm"];
      expect(methods).toHaveLength(2);
      expect(methods).toContain("command");
      expect(methods).toContain("llm");
    });
  });

  describe("createEmptyIntentResult", () => {
    it("应返回空匹配列表", () => {
      const result = createEmptyIntentResult();
      expect(result.matches).toEqual([]);
      expect(result.method).toBe("none");
    });

    it("默认 classificationTime 为 0", () => {
      const result = createEmptyIntentResult();
      expect(result.classificationTime).toBe(0);
    });

    it("应接受自定义 classificationTime", () => {
      const result = createEmptyIntentResult(42);
      expect(result.classificationTime).toBe(42);
    });
  });
});
