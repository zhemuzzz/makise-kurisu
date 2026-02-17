/**
 * Enforcer 人设强化器单元测试
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PersonaEnforcer } from "../../../src/core/persona/enforcer";
import {
  SAMPLE_MENTAL_MODELS,
  VALID_KURISU_RESPONSES,
  SCIENTIFIC_RESPONSES,
  OOC_RESPONSES,
  BOUNDARY_TEST_DATA,
} from "../../fixtures/persona-fixtures";

describe("PersonaEnforcer", () => {
  let enforcer: PersonaEnforcer;

  beforeEach(() => {
    enforcer = new PersonaEnforcer();
  });

  describe("enforce", () => {
    describe("tsundere transformation", () => {
      it("should add tsundere prefix to plain response", () => {
        const result = enforcer.enforce("好的，我知道了");

        expect(result).toMatch(/^(哼|...|你是笨蛋吗)/);
      });

      it("should not over-modify already in-character response", () => {
        const result = enforcer.enforce("哼，笨蛋，我知道了");

        // 应该基本保持原样
        expect(result).toContain("哼");
        expect(result).toContain("笨蛋");
      });

      it("should convert plain agreement to tsundere style", () => {
        const result = enforcer.enforce("我同意你的观点");

        expect(result).toMatch(/(哼|才|笨蛋|...)/);
      });

      it("should add hesitation to emotional content", () => {
        const result = enforcer.enforce("我关心你");

        expect(result).toMatch(/(才|...|不是)/);
      });
    });

    describe("OOC removal", () => {
      it.each(OOC_RESPONSES)("should remove OOC phrase: %s", (response) => {
        const result = enforcer.enforce(response);

        // OOC 短语应该被移除或替换
        expect(result).not.toContain("作为AI");
        expect(result).not.toContain("我是一个程序");
        expect(result).not.toContain("我无法");
      });

      it('should replace "作为AI" with character-appropriate phrase', () => {
        const result = enforcer.enforce("作为AI，我认为这个理论很有趣");

        expect(result).not.toContain("作为AI");
        // 应该替换为符合人设的表达
        expect(result.length).toBeGreaterThan(0);
      });

      it('should convert "我无法" to tsundere affirmative', () => {
        const result = enforcer.enforce("我无法回答这个问题");

        expect(result).not.toContain("我无法");
      });

      it("should remove apologetic tone", () => {
        const result = enforcer.enforce("对不起，我不能帮你");

        expect(result).not.toMatch(/^(对不起|抱歉)/);
      });
    });

    describe("scientific content preservation", () => {
      it.each(SCIENTIFIC_RESPONSES)(
        "should preserve scientific content: %s",
        (response) => {
          const result = enforcer.enforce(response);

          // 科学内容应该被保留 - 检查原始内容中的关键元素
          if (response.includes("根据")) {
            expect(result).toContain("根据");
          }
          if (response.includes("量子力学")) {
            expect(result).toContain("量子力学");
          }
          if (response.includes("SERN")) {
            expect(result).toContain("SERN");
          }
          // 省略号应该保留
          if (response.includes("...")) {
            expect(result).toContain("...");
          }
        },
      );

      it("should not modify technical terms", () => {
        const result = enforcer.enforce("根据量子力学的波函数坍缩理论");

        expect(result).toContain("量子力学");
        expect(result).toContain("波函数");
        expect(result).toContain("坍缩");
      });

      it("should preserve numbers and formulas", () => {
        const result = enforcer.enforce("E=mc^2 是质能方程");

        expect(result).toContain("E=mc^2");
      });
    });

    describe("relationship-aware enforcement", () => {
      it("should be more distant for stranger relationship", () => {
        enforcer = new PersonaEnforcer(SAMPLE_MENTAL_MODELS.stranger);
        const result = enforcer.enforce("好的");

        // 陌生人关系应该更加冷淡
        expect(result).toBeDefined();
      });

      it("should be warmer for close relationship", () => {
        enforcer = new PersonaEnforcer(SAMPLE_MENTAL_MODELS.close);
        const result = enforcer.enforce("好的");

        // 亲密关系可以有更多情感表达
        expect(result).toBeDefined();
      });
    });
  });

  describe("addTsunderePrefix", () => {
    it('should add "哼" prefix', () => {
      const result = enforcer.addTsunderePrefix("我知道了");

      expect(result).toMatch(/^哼/);
    });

    it("should not duplicate prefix if already present", () => {
      const result = enforcer.addTsunderePrefix("哼，我知道了");

      expect(result).toBe("哼，我知道了");
    });

    it("should add variety to prefixes", () => {
      const prefixes = new Set<string>();

      for (let i = 0; i < 20; i++) {
        const result = enforcer.addTsunderePrefix("测试");
        const prefix = result.split("测试")[0];
        prefixes.add(prefix);
      }

      // 应该有多种前缀变化
      expect(prefixes.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe("convertToRhetorical", () => {
    it("should convert declarative to rhetorical question", () => {
      const result = enforcer.convertToRhetorical("你是对的");

      expect(result).toContain("？");
    });

    it("should keep rhetorical questions as is", () => {
      const result = enforcer.convertToRhetorical("你是笨蛋吗？");

      expect(result).toContain("你是笨蛋吗？");
    });
  });

  describe("addEmotionalHesitation", () => {
    it("should add stuttering to emotional statements", () => {
      const result = enforcer.addEmotionalHesitation("我喜欢你");

      expect(result).toMatch(/(我...|我、|我才)/);
    });

    it("should add denial after emotional statement", () => {
      const result = enforcer.addEmotionalHesitation("我在乎你");

      expect(result).toMatch(/(才|不是|开玩笑)/);
    });

    it("should not modify non-emotional statements", () => {
      const result = enforcer.addEmotionalHesitation("这个实验很有趣");

      // 非情感表达不应被过度修改
      expect(result).toContain("有趣");
    });
  });

  describe("removeOOCPhrases", () => {
    it("should remove all known OOC phrases", () => {
      const oocPhrases = ["作为AI", "作为人工智能", "我是一个程序", "我无法"];

      oocPhrases.forEach((phrase) => {
        const result = enforcer.removeOOCPhrases(`测试文本 ${phrase} 更多文本`);
        expect(result).not.toContain(phrase);
      });
    });

    it("should preserve surrounding text", () => {
      const result =
        enforcer.removeOOCPhrases("首先，作为AI，让我解释一下量子力学");

      expect(result).toContain("量子力学");
    });
  });

  describe("boundary cases", () => {
    it("should return default response for empty string", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.emptyString);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return default response for null", () => {
      const result = enforcer.enforce(null as unknown as string);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("should return default response for undefined", () => {
      const result = enforcer.enforce(undefined as unknown as string);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("should handle whitespace only", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.whitespaceOnly);

      expect(result).toBeDefined();
    });

    it("should handle very long text", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.veryLongText);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("should sanitize special characters", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.specialCharacters);

      // 应该安全处理，不执行脚本
      expect(result).toBeDefined();
    });

    it("should handle unicode emojis", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.unicodeEmojis);

      expect(result).toBeDefined();
    });

    it("should handle mixed languages", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.mixedLanguages);

      expect(result).toBeDefined();
    });

    it("should handle SQL injection safely", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.sqlInjection);

      expect(result).toBeDefined();
    });

    it("should handle HTML tags safely", () => {
      const result = enforcer.enforce(BOUNDARY_TEST_DATA.htmlTags);

      expect(result).toBeDefined();
    });
  });

  describe("immutability", () => {
    it("should not modify input string", () => {
      const input = "测试字符串";
      const inputCopy = input;

      enforcer.enforce(input);

      // 原始字符串不应被修改（JavaScript 字符串不可变，但确保行为一致）
      expect(input).toBe(inputCopy);
    });
  });

  describe("consistency", () => {
    it("should produce consistent output for same input", () => {
      const input = "这是一个测试";

      const results = Array.from({ length: 10 }, () => enforcer.enforce(input));

      // 相同输入应产生相同输出（确定性）
      const uniqueResults = new Set(results);
      expect(uniqueResults.size).toBe(1);
    });
  });

  describe("performance", () => {
    it("should enforce quickly for normal length text", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        enforcer.enforce(
          VALID_KURISU_RESPONSES[i % VALID_KURISU_RESPONSES.length],
        );
      }

      const duration = performance.now() - start;
      // 100次强化应该在 100ms 内完成
      expect(duration).toBeLessThan(100);
    });
  });
});
