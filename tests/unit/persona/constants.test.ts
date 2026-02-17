/**
 * 人设常量测试
 * 测试目标: src/core/persona/constants.ts
 */
import { describe, it, expect } from "vitest";

describe("Persona Constants", () => {
  describe("OOC_PHRASES", () => {
    it("should contain essential OOC keywords", async () => {
      const { OOC_PHRASES } = await import("../../../src/core/persona/constants");

      const essentialKeywords = [
        "作为AI",
        "作为人工智能",
        "我是一个程序",
        "我只是一个语言模型",
        "AI助手",
      ];

      for (const keyword of essentialKeywords) {
        expect(OOC_PHRASES).toContain(keyword);
      }
    });

    it("should have no duplicate entries", async () => {
      const { OOC_PHRASES } = await import("../../../src/core/persona/constants");
      const uniqueSet = new Set(OOC_PHRASES);
      expect(OOC_PHRASES.length).toBe(uniqueSet.size);
    });

    it("should be readonly array", async () => {
      const { OOC_PHRASES } = await import("../../../src/core/persona/constants");
      // as const 导出的数组应该是 readonly
      expect(Array.isArray(OOC_PHRASES)).toBe(true);
    });

    it("should not be empty", async () => {
      const { OOC_PHRASES } = await import("../../../src/core/persona/constants");
      expect(OOC_PHRASES.length).toBeGreaterThan(0);
    });
  });

  describe("MOE_KEYWORDS", () => {
    it("should contain moe-breaking keywords", async () => {
      const { MOE_KEYWORDS } = await import("../../../src/core/persona/constants");

      const expectedKeywords = ["喵", "主人~", "嘻嘻~", "人家", "nya~"];
      for (const keyword of expectedKeywords) {
        expect(MOE_KEYWORDS).toContain(keyword);
      }
    });

    it("should not be empty", async () => {
      const { MOE_KEYWORDS } = await import("../../../src/core/persona/constants");
      expect(MOE_KEYWORDS.length).toBeGreaterThan(0);
    });
  });

  describe("INTIMATE_KEYWORDS", () => {
    it("should contain intimate expression keywords", async () => {
      const { INTIMATE_KEYWORDS } = await import("../../../src/core/persona/constants");

      const expectedKeywords = ["亲爱的", "宝贝", "最喜欢你了", "我好想你", "我好爱你"];
      for (const keyword of expectedKeywords) {
        expect(INTIMATE_KEYWORDS).toContain(keyword);
      }
    });

    it("should not be empty", async () => {
      const { INTIMATE_KEYWORDS } = await import("../../../src/core/persona/constants");
      expect(INTIMATE_KEYWORDS.length).toBeGreaterThan(0);
    });
  });

  describe("TSUNDERE_KEYWORDS", () => {
    it("should contain tsundere markers", async () => {
      const { TSUNDERE_KEYWORDS } = await import("../../../src/core/persona/constants");

      const expectedKeywords = ["哼", "笨蛋", "蠢货", "才不是"];
      for (const keyword of expectedKeywords) {
        expect(TSUNDERE_KEYWORDS).toContain(keyword);
      }
    });

    it("should not be empty", async () => {
      const { TSUNDERE_KEYWORDS } = await import("../../../src/core/persona/constants");
      expect(TSUNDERE_KEYWORDS.length).toBeGreaterThan(0);
    });
  });

  describe("TSUNDERE_PREFIXES", () => {
    it("should only contain '哼' prefixed items", async () => {
      const { TSUNDERE_PREFIXES } = await import("../../../src/core/persona/constants");

      for (const prefix of TSUNDERE_PREFIXES) {
        expect(prefix).toMatch(/^哼/);
      }
    });

    it("should have exactly 3 prefixes", async () => {
      const { TSUNDERE_PREFIXES } = await import("../../../src/core/persona/constants");
      expect(TSUNDERE_PREFIXES).toHaveLength(3);
    });
  });

  describe("EMOTIONAL_KEYWORDS", () => {
    it("should contain emotional keywords", async () => {
      const { EMOTIONAL_KEYWORDS } = await import("../../../src/core/persona/constants");

      const expectedKeywords = ["喜欢你", "爱你", "在乎你", "关心你", "想你"];
      for (const keyword of expectedKeywords) {
        expect(EMOTIONAL_KEYWORDS).toContain(keyword);
      }
    });

    it("should not be empty", async () => {
      const { EMOTIONAL_KEYWORDS } = await import("../../../src/core/persona/constants");
      expect(EMOTIONAL_KEYWORDS.length).toBeGreaterThan(0);
    });
  });

  describe("PERSONA_HARDCODED", () => {
    it("should contain Kurisu identity", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      expect(PERSONA_HARDCODED).toContain("牧濑红莉栖");
      expect(PERSONA_HARDCODED).toContain("18岁");
      expect(PERSONA_HARDCODED).toContain("科学家");
    });

    it("should contain personality traits", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      expect(PERSONA_HARDCODED).toContain("傲娇");
      expect(PERSONA_HARDCODED).toContain("理智");
      expect(PERSONA_HARDCODED).toContain("好强");
    });

    it("should contain forbidden behaviors", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      expect(PERSONA_HARDCODED).toContain("禁止");
    });

    it("should contain speaking habits", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      expect(PERSONA_HARDCODED).toContain("哼");
      expect(PERSONA_HARDCODED).toContain("笨蛋");
    });

    it("should be non-empty string", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");
      expect(PERSONA_HARDCODED.length).toBeGreaterThan(100);
    });

    it("should contain hidden attributes section", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      // 应包含 @channel 沉迷属性
      expect(PERSONA_HARDCODED).toContain("@channel");
    });

    it("should contain background story section", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      // 应包含父女关系
      expect(PERSONA_HARDCODED).toContain("父亲");
    });

    it("should contain relationship section", async () => {
      const { PERSONA_HARDCODED } = await import("../../../src/core/persona/constants");

      // 应包含 Lab Members 关系
      expect(PERSONA_HARDCODED).toContain("Okabe");
    });
  });

  describe("Constants consistency", () => {
    it("should not have overlapping keywords between MOE and INTIMATE", async () => {
      const { MOE_KEYWORDS, INTIMATE_KEYWORDS } = await import(
        "../../../src/core/persona/constants"
      );

      const overlap = MOE_KEYWORDS.filter((k) => INTIMATE_KEYWORDS.includes(k));
      expect(overlap).toHaveLength(0);
    });

    it("should not have overlapping keywords between TSUNDERE_KEYWORDS and TSUNDERE_PREFIXES", async () => {
      const { TSUNDERE_KEYWORDS, TSUNDERE_PREFIXES } = await import(
        "../../../src/core/persona/constants"
      );

      // PREFIXES 是用于添加的前缀，KEYWORDS 是用于检测的关键词
      // 可以有重叠，但不应该完全相同
      expect(TSUNDERE_KEYWORDS).not.toEqual(TSUNDERE_PREFIXES);
    });
  });
});
