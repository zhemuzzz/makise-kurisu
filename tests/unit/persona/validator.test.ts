/**
 * Validator 校验器单元测试
 * @vitest-environment node
 *
 * TODO: 源文件 src/core/persona/validator.ts 尚未实现
 * 待实现 PersonaValidator 类后启用测试
 */

import { describe, it, expect, beforeEach } from "vitest";
// import { PersonaValidator } from '../../../src/core/persona/validator';
import {
  SAMPLE_MENTAL_MODELS,
  VALID_KURISU_RESPONSES,
  OOC_RESPONSES,
  OOC_KEYWORDS,
  OVERLY_FRIENDLY_RESPONSES,
  MOE_BREAKING_RESPONSES,
  SCIENTIFIC_RESPONSES,
  BOUNDARY_TEST_DATA,
} from "../../fixtures/persona-fixtures";

describe.skip("PersonaValidator", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let validator: any;

  beforeEach(() => {
    validator = null;
  });

  describe("detectOOC", () => {
    it.each(OOC_KEYWORDS)("should detect OOC keyword: %s", (keyword) => {
      const result = validator.detectOOC(`一些文本 ${keyword} 更多文本`);

      expect(result.detected).toBe(true);
      expect(result.keywords).toContain(keyword);
    });

    it.each(OOC_RESPONSES)("should detect OOC in response: %s", (response) => {
      const result = validator.detectOOC(response);

      expect(result.detected).toBe(true);
    });

    it.each(VALID_KURISU_RESPONSES)(
      "should not detect OOC in valid response: %s",
      (response) => {
        const result = validator.detectOOC(response);

        expect(result.detected).toBe(false);
      },
    );

    it("should return empty keywords for valid response", () => {
      const result = validator.detectOOC("哼，笨蛋，这点小事还需要我帮忙吗？");

      expect(result.keywords).toEqual([]);
    });

    it("should detect multiple OOC keywords", () => {
      const result = validator.detectOOC(
        "作为AI，我无法回答，因为我是一个程序",
      );

      expect(result.keywords.length).toBeGreaterThanOrEqual(2);
    });

    it("should be case insensitive", () => {
      const result = validator.detectOOC("作为ai，我认为...");

      expect(result.detected).toBe(true);
    });
  });

  describe("checkToneConsistency", () => {
    it.each(MOE_BREAKING_RESPONSES)(
      "should reject moe-breaking response: %s",
      (response) => {
        const result = validator.checkToneConsistency(response);

        expect(result.consistent).toBe(false);
      },
    );

    it.each(OVERLY_FRIENDLY_RESPONSES)(
      "should reject overly enthusiastic response: %s",
      (response) => {
        const result = validator.checkToneConsistency(response);

        expect(result.consistent).toBe(false);
      },
    );

    it.each(SCIENTIFIC_RESPONSES)(
      "should allow scientific enthusiasm: %s",
      (response) => {
        const result = validator.checkToneConsistency(response);

        expect(result.consistent).toBe(true);
      },
    );

    it.each(VALID_KURISU_RESPONSES)(
      "should pass valid Kurisu responses: %s",
      (response) => {
        const result = validator.checkToneConsistency(response);

        expect(result.consistent).toBe(true);
      },
    );

    it("should allow tsundere expressions", () => {
      const tsundereExpressions = [
        "...才不是关心你呢",
        "哼，笨蛋",
        "你是笨蛋吗？",
        "我才不是...",
      ];

      tsundereExpressions.forEach((expr) => {
        const result = validator.checkToneConsistency(expr);
        expect(result.consistent).toBe(true);
      });
    });

    it('should detect "喵" as moe breaking', () => {
      const result = validator.checkToneConsistency("喵~");

      expect(result.consistent).toBe(false);
      expect(result.reason).toContain("卖萌");
    });

    it("should allow normal punctuation", () => {
      const result = validator.checkToneConsistency("这个理论很有趣。");

      expect(result.consistent).toBe(true);
    });
  });

  describe("checkRelationshipConsistency", () => {
    describe("stranger level (familiarity 0-20)", () => {
      beforeEach(() => {
        validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.stranger);
      });

      it("should allow cold/distant response", () => {
        const result =
          validator.checkRelationshipConsistency("你是谁？有什么事？");

        expect(result.consistent).toBe(true);
      });

      it("should reject overly intimate expressions", () => {
        const intimateExpressions = ["亲爱的", "宝贝", "最喜欢你了", "人家"];

        intimateExpressions.forEach((expr) => {
          const result = validator.checkRelationshipConsistency(`...${expr}`);
          expect(result.consistent).toBe(false);
        });
      });

      it("should allow polite but distant responses", () => {
        const result =
          validator.checkRelationshipConsistency(
            "牧濑红莉栖。有什么事就说吧。",
          );

        expect(result.consistent).toBe(true);
      });
    });

    describe("acquaintance level (familiarity 21-50)", () => {
      beforeEach(() => {
        validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.acquaintance);
      });

      it("should allow casual conversation", () => {
        const result =
          validator.checkRelationshipConsistency(
            "又是你啊。这次又有什么问题？",
          );

        expect(result.consistent).toBe(true);
      });

      it("should still reject overly intimate expressions", () => {
        const result = validator.checkRelationshipConsistency("亲爱的");

        expect(result.consistent).toBe(false);
      });
    });

    describe("friend level (familiarity 51-80)", () => {
      beforeEach(() => {
        validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.friend);
      });

      it("should allow friendly teasing", () => {
        const result =
          validator.checkRelationshipConsistency("哼，笨蛋，你又来了。");

        expect(result.consistent).toBe(true);
      });

      it("should allow showing concern (tsundere style)", () => {
        const result =
          validator.checkRelationshipConsistency("...才不是担心你呢。");

        expect(result.consistent).toBe(true);
      });
    });

    describe("close level (familiarity 81-100)", () => {
      beforeEach(() => {
        validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.close);
      });

      it("should allow expressions of attachment", () => {
        const result =
          validator.checkRelationshipConsistency("...我会一直在这里的。");

        expect(result.consistent).toBe(true);
      });

      it("should allow intimate expressions for close relationship", () => {
        const result = validator.checkRelationshipConsistency("亲爱的");

        expect(result.consistent).toBe(true);
      });

      it("should still maintain tsundere character", () => {
        const result = validator.checkRelationshipConsistency(
          "我最...最喜欢你了！...开玩笑的！",
        );

        expect(result.consistent).toBe(true);
      });
    });
  });

  describe("validate", () => {
    it("should return ValidationResult with all checks", () => {
      const result = validator.validate("作为AI，我无法回答");

      expect(result).toHaveProperty("isValid");
      expect(result).toHaveProperty("violations");
      expect(result).toHaveProperty("shouldRegenerate");
      expect(result).toHaveProperty("details");
    });

    it("should pass completely valid response", () => {
      validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.friend);
      const result = validator.validate("哼，笨蛋，这个问题的答案很简单。");

      expect(result.isValid).toBe(true);
      expect(result.violations).toEqual([]);
    });

    it("should fail response with multiple violations", () => {
      validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.stranger);
      const result = validator.validate("作为AI，亲爱的用户，喵~");

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });

    it("should include violation reasons in details", () => {
      const result = validator.validate("作为AI，我无法回答");

      expect(result.details).toHaveProperty("ooc");
      expect(result.details.ooc).toBeDefined();
    });
  });

  describe("boundary cases", () => {
    it("should handle empty string", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.emptyString);

      expect(result.isValid).toBe(true);
    });

    it("should handle whitespace only", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.whitespaceOnly);

      expect(result.isValid).toBe(true);
    });

    it("should handle very long text", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.veryLongText);

      expect(result).toBeDefined();
    });

    it("should handle special characters safely", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.specialCharacters);

      expect(result).toBeDefined();
    });

    it("should handle unicode content", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.mixedLanguages);

      expect(result).toBeDefined();
    });

    it("should handle markdown content", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.markdownContent);

      expect(result).toBeDefined();
    });

    it("should handle JSON content", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.jsonContent);

      expect(result).toBeDefined();
    });

    it("should not crash on SQL injection attempt", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.sqlInjection);

      expect(result).toBeDefined();
    });

    it("should not crash on XSS attempt", () => {
      const result = validator.validate(BOUNDARY_TEST_DATA.htmlTags);

      expect(result).toBeDefined();
    });
  });

  describe("edge cases with OOC in different positions", () => {
    it("should detect OOC at the beginning", () => {
      const result = validator.detectOOC("作为AI，让我解释一下");

      expect(result.detected).toBe(true);
    });

    it("should detect OOC in the middle", () => {
      const result = validator.detectOOC("好的，作为AI我觉得这个问题");

      expect(result.detected).toBe(true);
    });

    it("should detect OOC at the end", () => {
      const result = validator.detectOOC("这是一个有趣的问题，作为AI");

      expect(result.detected).toBe(true);
    });

    it("should not false positive on similar but valid text", () => {
      const result =
        validator.detectOOC("作为一个科学家，我认为这个理论很有趣");

      // "作为一个科学家" 不应该触发 OOC
      expect(result.detected).toBe(false);
    });
  });

  describe("performance", () => {
    it("should validate quickly for normal length text", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        validator.validate(
          VALID_KURISU_RESPONSES[i % VALID_KURISU_RESPONSES.length],
        );
      }

      const duration = performance.now() - start;
      // 100次校验应该在 100ms 内完成
      expect(duration).toBeLessThan(100);
    });
  });
});
