/**
 * PersonaEngine 主类单元测试
 * @vitest-environment node
 *
 * 新的三层架构需要先加载角色配置才能使用 getHardcodedPersona/getSystemPrompt 等方法
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PersonaEngine } from "../../../src/platform/identity/index";
import {
  SAMPLE_MENTAL_MODELS,
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

    beforeEach(async () => {
      engine = new PersonaEngine();
      await engine.loadRole("kurisu");
    });

    it("should return persona content", () => {
      const persona = engine.getHardcodedPersona();

      expect(persona).toHaveProperty("content");
      expect(persona.content).toContain("牧濑红莉栖");
    });

    it("should contain soul content", () => {
      const { content } = engine.getHardcodedPersona();

      // 新的三层架构使用 soul.md
      expect(content).toContain("我是");
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

  describe("integration scenarios", () => {
    let engine: PersonaEngine;

    it("should complete full validation cycle", async () => {
      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);
      await engine.loadRole("kurisu");

      // 1. 获取系统提示词
      const prompt = engine.getSystemPrompt();
      expect(prompt).toContain("牧濑红莉栖");

      // 2. 更新关系
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
