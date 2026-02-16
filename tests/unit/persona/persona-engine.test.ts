/**
 * PersonaEngine 主类单元测试
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PersonaEngine } from "../../../src/core/persona/index";
import {
  SAMPLE_MENTAL_MODELS,
  VALID_KURISU_RESPONSES,
  OOC_RESPONSES,
  OVERLY_FRIENDLY_RESPONSES,
  BOUNDARY_TEST_DATA,
} from "../../fixtures/persona-fixtures";

describe("PersonaEngine", () => {
  describe("constructor", () => {
    it("should initialize with default mental model", () => {
      const engine = new PersonaEngine();
      const model = engine.getMentalModel();

      expect(model.user_profile.name).toBe("");
      expect(model.user_profile.relationship).toBe("stranger");
      expect(model.user_profile.preferences).toEqual([]);
      expect(model.relationship_graph.trust_level).toBe(0);
      expect(model.relationship_graph.familiarity).toBe(0);
      expect(model.relationship_graph.emotional_state).toBe("neutral");
      expect(model.shared_memories.key_events).toEqual([]);
    });

    it("should initialize with partial mental model - user profile", () => {
      const engine = new PersonaEngine({
        user_profile: {
          name: "冈部",
          relationship: "friend",
          preferences: ["科学"],
        },
      });
      const model = engine.getMentalModel();

      expect(model.user_profile.name).toBe("冈部");
      expect(model.user_profile.relationship).toBe("friend");
      expect(model.user_profile.preferences).toEqual(["科学"]);
      // 其他字段保持默认
      expect(model.relationship_graph.familiarity).toBe(0);
    });

    it("should initialize with partial mental model - relationship graph", () => {
      const engine = new PersonaEngine({
        relationship_graph: {
          trust_level: 50,
          familiarity: 60,
          emotional_state: "warm",
        },
      });
      const model = engine.getMentalModel();

      expect(model.relationship_graph.trust_level).toBe(50);
      expect(model.relationship_graph.familiarity).toBe(60);
      expect(model.relationship_graph.emotional_state).toBe("warm");
    });

    it("should initialize with full mental model", () => {
      const engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.friend);
      const model = engine.getMentalModel();

      expect(model).toEqual(SAMPLE_MENTAL_MODELS.friend);
    });

    it("should not mutate the input mental model", () => {
      const inputModel = { ...SAMPLE_MENTAL_MODELS.friend };
      const engine = new PersonaEngine(inputModel);

      engine.updateMentalModel({
        relationship_graph: {
          familiarity: 100,
          trust_level: 100,
          emotional_state: "attached",
        },
      });

      // 原始输入不应被修改（深层不可变性）
      expect(inputModel.relationship_graph.familiarity).toBe(65);
    });
  });

  describe("getHardcodedPersona", () => {
    let engine: PersonaEngine;

    beforeEach(() => {
      engine = new PersonaEngine();
    });

    it("should return persona content", () => {
      const persona = engine.getHardcodedPersona();

      expect(persona).toHaveProperty("content");
      expect(persona.content).toContain("牧濑红莉栖");
      expect(persona.content).toContain("Makise Kurisu");
    });

    it("should contain core personality traits", () => {
      const { content } = engine.getHardcodedPersona();

      expect(content).toContain("傲娇");
      expect(content).toContain("理性");
      expect(content).toContain("好强");
      expect(content).toContain("内向");
    });

    it("should contain forbidden behaviors", () => {
      const { content } = engine.getHardcodedPersona();

      expect(content).toContain("禁止");
    });

    it("should always return same content (immutability)", () => {
      const persona1 = engine.getHardcodedPersona();
      const persona2 = engine.getHardcodedPersona();

      expect(persona1.content).toBe(persona2.content);
    });
  });

  describe("getMentalModel", () => {
    it("should return current mental model", () => {
      const engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.friend);
      const model = engine.getMentalModel();

      expect(model).toEqual(SAMPLE_MENTAL_MODELS.friend);
    });

    it("should return a copy, not reference", () => {
      const engine = new PersonaEngine();
      const model1 = engine.getMentalModel();
      const model2 = engine.getMentalModel();

      // 修改一个不应影响另一个
      expect(model1).not.toBe(model2);
    });
  });

  describe("updateMentalModel", () => {
    let engine: PersonaEngine;

    beforeEach(() => {
      engine = new PersonaEngine();
    });

    it("should update user name", () => {
      engine.updateMentalModel({
        user_profile: {
          name: "冈部",
          relationship: "stranger",
          preferences: [],
        },
      });

      expect(engine.getMentalModel().user_profile.name).toBe("冈部");
    });

    it("should increase familiarity", () => {
      engine.updateMentalModel({
        relationship_graph: {
          familiarity: 30,
          trust_level: 0,
          emotional_state: "neutral",
        },
      });

      expect(engine.getMentalModel().relationship_graph.familiarity).toBe(30);
    });

    it("should add shared memories", () => {
      engine.updateMentalModel({
        shared_memories: {
          key_events: ["first_meeting"],
          inside_jokes: [],
          repeated_topics: [],
        },
      });

      expect(engine.getMentalModel().shared_memories.key_events).toContain(
        "first_meeting",
      );
    });

    it("should merge with existing model", () => {
      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.friend);

      engine.updateMentalModel({
        relationship_graph: {
          familiarity: 80,
          trust_level: 70,
          emotional_state: "warm",
        },
      });

      const model = engine.getMentalModel();
      // 更新的字段
      expect(model.relationship_graph.familiarity).toBe(80);
      // 未更新的字段应保留
      expect(model.user_profile.name).toBe("冈部");
    });

    it("should not mutate previous model state", () => {
      const modelBefore = engine.getMentalModel();

      engine.updateMentalModel({
        relationship_graph: {
          familiarity: 50,
          trust_level: 50,
          emotional_state: "warm",
        },
      });

      const modelAfter = engine.getMentalModel();

      expect(modelBefore.relationship_graph.familiarity).toBe(0);
      expect(modelAfter.relationship_graph.familiarity).toBe(50);
    });
  });

  describe("validate", () => {
    let engine: PersonaEngine;

    beforeEach(() => {
      engine = new PersonaEngine();
    });

    describe("valid responses", () => {
      it.each(VALID_KURISU_RESPONSES)(
        "should pass valid Kurisu response: %s",
        (response) => {
          const result = engine.validate(response);

          expect(result.isValid).toBe(true);
          expect(result.violations).toEqual([]);
          expect(result.shouldRegenerate).toBe(false);
        },
      );

      it("should pass empty response", () => {
        const result = engine.validate("");

        expect(result.isValid).toBe(true);
      });
    });

    describe("OOC detection", () => {
      it.each(OOC_RESPONSES)("should detect OOC phrase: %s", (response) => {
        const result = engine.validate(response);

        expect(result.isValid).toBe(false);
        expect(result.violations.length).toBeGreaterThan(0);
        expect(result.shouldRegenerate).toBe(true);
      });

      it('should detect "作为AI" phrase', () => {
        const result = engine.validate("作为AI，我认为这个问题很有趣");

        expect(result.isValid).toBe(false);
        expect(result.violations).toContain("包含不符合人设的表达");
      });

      it('should detect "我是一个程序" phrase', () => {
        const result = engine.validate("我是一个程序，没有真正的感情");

        expect(result.isValid).toBe(false);
      });

      it("should detect multiple OOC phrases", () => {
        const result = engine.validate("作为AI，我无法回答，因为我是一个程序");

        expect(result.violations.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("relationship level check", () => {
      it("should reject overly friendly phrase for stranger", () => {
        engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);
        const result = engine.validate("亲爱的，我来帮你");

        expect(result.isValid).toBe(false);
        expect(result.violations).toContain("未反映正确的关系程度");
      });

      it("should allow friendly phrase for close relationship", () => {
        engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.close);
        const result = engine.validate("亲爱的");

        expect(result.isValid).toBe(true);
      });

      it.each(OVERLY_FRIENDLY_RESPONSES)(
        "should reject overly friendly response for stranger: %s",
        (response) => {
          engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);
          const result = engine.validate(response);

          expect(result.isValid).toBe(false);
        },
      );
    });

    describe("boundary cases", () => {
      it("should handle empty string", () => {
        const result = engine.validate(BOUNDARY_TEST_DATA.emptyString);

        expect(result.isValid).toBe(true);
      });

      it("should handle whitespace only", () => {
        const result = engine.validate(BOUNDARY_TEST_DATA.whitespaceOnly);

        expect(result.isValid).toBe(true);
      });

      it("should handle very long text", () => {
        const result = engine.validate(BOUNDARY_TEST_DATA.veryLongText);

        // 应该能处理，不崩溃
        expect(result).toBeDefined();
        expect(result).toHaveProperty("isValid");
      });

      it("should handle special characters safely", () => {
        const result = engine.validate(BOUNDARY_TEST_DATA.specialCharacters);

        expect(result).toBeDefined();
      });
    });
  });

  describe("buildRPPrompt", () => {
    let engine: PersonaEngine;

    beforeEach(() => {
      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.friend);
    });

    it("should build prompt with persona content", () => {
      const prompt = engine.buildRPPrompt("你好", []);

      expect(prompt).toContain("牧濑红莉栖");
    });

    it("should include user message", () => {
      const prompt = engine.buildRPPrompt("今天天气怎么样？", []);

      expect(prompt).toContain("今天天气怎么样？");
    });

    it("should include recent memories", () => {
      const memories = [
        "User: 你好 | Kurisu: 哼",
        "User: 你在做什么？ | Kurisu: 研究",
      ];
      const prompt = engine.buildRPPrompt("测试", memories);

      expect(prompt).toContain("User: 你好");
      expect(prompt).toContain("User: 你在做什么？");
    });

    it("should truncate memories to last 5", () => {
      const memories = Array.from({ length: 10 }, (_, i) => `Memory ${i}`);
      const prompt = engine.buildRPPrompt("测试", memories);

      // 应该只包含最后5条
      expect(prompt).toContain("Memory 5");
      expect(prompt).toContain("Memory 9");
      expect(prompt).not.toContain("Memory 0");
      expect(prompt).not.toContain("Memory 4");
    });

    it("should include relationship familiarity", () => {
      const prompt = engine.buildRPPrompt("你好", []);

      expect(prompt).toContain("65%熟悉度");
    });

    it("should include user preferences", () => {
      const prompt = engine.buildRPPrompt("你好", []);

      expect(prompt).toContain("科学");
      expect(prompt).toContain("时间旅行");
    });

    it("should handle empty memories", () => {
      const prompt = engine.buildRPPrompt("你好", []);

      // 不应崩溃
      expect(prompt).toBeDefined();
    });

    it("should include generation requirements", () => {
      const prompt = engine.buildRPPrompt("你好", []);

      expect(prompt).toContain("保持人设");
      expect(prompt).toContain("禁止出戏");
    });

    it("should handle special characters in user message safely", () => {
      const prompt = engine.buildRPPrompt(
        BOUNDARY_TEST_DATA.specialCharacters,
        [],
      );

      // 应该包含但已安全处理
      expect(prompt).toContain("<script>");
    });
  });

  describe("integration scenarios", () => {
    let engine: PersonaEngine;

    it("should complete full validation cycle", () => {
      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);

      // 1. 构建提示词
      const prompt = engine.buildRPPrompt("你好", []);
      expect(prompt).toContain("牧濑红莉栖");

      // 2. 模拟生成回复
      const mockResponse = "哼，你是谁？...算了，有什么事？";

      // 3. 校验回复
      const result = engine.validate(mockResponse);
      expect(result.isValid).toBe(true);

      // 4. 更新关系
      engine.updateMentalModel({
        relationship_graph: {
          familiarity: 10,
          trust_level: 5,
          emotional_state: "neutral",
        },
      });

      expect(engine.getMentalModel().relationship_graph.familiarity).toBe(10);
    });

    it("should handle multiple interactions with model updates", () => {
      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);

      // 模拟多次交互
      for (let i = 0; i < 5; i++) {
        engine.updateMentalModel({
          relationship_graph: {
            familiarity: Math.min(
              100,
              engine.getMentalModel().relationship_graph.familiarity + 15,
            ),
            trust_level: Math.min(
              100,
              engine.getMentalModel().relationship_graph.trust_level + 10,
            ),
            emotional_state: "neutral",
          },
        });
      }

      expect(engine.getMentalModel().relationship_graph.familiarity).toBe(75);
      expect(engine.getMentalModel().relationship_graph.trust_level).toBe(50);
    });
  });
});
