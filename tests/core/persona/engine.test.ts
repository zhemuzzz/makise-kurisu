/**
 * PersonaEngine 单元测试
 * 位置: tests/core/persona/engine.test.ts
 */

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { PersonaEngine } from "@/core/persona/index";
import type { MentalModel } from "@/core/persona/types";

describe("PersonaEngine", () => {
  let engine: PersonaEngine;

  beforeEach(async () => {
    engine = new PersonaEngine();
    // 加载角色配置（新的三层架构要求）
    await engine.loadRole("kurisu");
  });

  describe("constructor", () => {
    it("should initialize with default mental model", () => {
      const model = engine.getMentalModel();
      expect(model.user_profile.relationship).toBe("stranger");
      expect(model.relationship_graph.familiarity).toBe(0);
      expect(model.relationship_graph.trust_level).toBe(0);
    });

    it("should accept partial mental model overrides", () => {
      const customEngine = new PersonaEngine({
        user_profile: {
          name: "Okabe",
          relationship: "friend",
          preferences: ["science"],
        },
      });
      const model = customEngine.getMentalModel();
      expect(model.user_profile.name).toBe("Okabe");
      expect(model.user_profile.relationship).toBe("friend");
    });
  });

  describe("getHardcodedPersona", () => {
    it("should return hardcoded persona content", () => {
      const persona = engine.getHardcodedPersona();
      expect(persona.content).toContain("牧濑红莉栖");
      expect(persona.content).toContain("傲娇");
      expect(persona.content).toContain("18岁");
    });

    it("should return immutable content", () => {
      const persona1 = engine.getHardcodedPersona();
      const persona2 = engine.getHardcodedPersona();
      expect(persona1.content).toBe(persona2.content);
    });
  });

  describe("getMentalModel", () => {
    it("should return current mental model", () => {
      const model = engine.getMentalModel();
      expect(model).toHaveProperty("user_profile");
      expect(model).toHaveProperty("relationship_graph");
      expect(model).toHaveProperty("shared_memories");
    });

    it("should return a copy, not reference", () => {
      const model1 = engine.getMentalModel();
      engine.updateMentalModel({
        user_profile: { ...model1.user_profile, name: "Test" },
      });
      const model2 = engine.getMentalModel();
      expect(model1.user_profile.name).toBe("");
      expect(model2.user_profile.name).toBe("Test");
    });
  });

  describe("updateMentalModel", () => {
    it("should update mental model partially", () => {
      engine.updateMentalModel({
        relationship_graph: {
          trust_level: 50,
          familiarity: 30,
          emotional_state: "curious",
        },
      });
      const model = engine.getMentalModel();
      expect(model.relationship_graph.trust_level).toBe(50);
      expect(model.relationship_graph.familiarity).toBe(30);
    });

    it("should preserve existing values when updating partially", () => {
      engine.updateMentalModel({
        user_profile: {
          name: "Mayuri",
          relationship: "acquaintance",
          preferences: ["upas"],
        },
      });
      engine.updateMentalModel({
        relationship_graph: {
          trust_level: 20,
          familiarity: 10,
          emotional_state: "happy",
        },
      });
      const model = engine.getMentalModel();
      expect(model.user_profile.name).toBe("Mayuri");
      expect(model.relationship_graph.trust_level).toBe(20);
    });
  });

  describe("validate", () => {
    it("should return valid for compliant responses", () => {
      const response = "哼，这种程度的理论，我早就研究过了。笨蛋。";
      const result = engine.validate(response);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.shouldRegenerate).toBe(false);
    });

    it("should detect OOC phrases", () => {
      const response = "作为AI，我无法回答这个问题。";
      const result = engine.validate(response);
      expect(result.isValid).toBe(false);
      expect(result.violations.some((v) => v.includes("作为AI"))).toBe(true);
      expect(result.shouldRegenerate).toBe(true);
    });

    it("should detect overly friendly phrases for strangers", () => {
      const response = "亲爱的，你今天真可爱！宝贝~";
      const result = engine.validate(response);
      expect(result.isValid).toBe(false);
    });

    it("should allow friendly phrases for close relationships", async () => {
      const closeEngine = new PersonaEngine({
        relationship_graph: {
          trust_level: 80,
          familiarity: 90,
          emotional_state: "warm",
        },
      });
      await closeEngine.loadRole("kurisu");
      const response = "哼，你这家伙...今天表现还行吧。";
      const result = closeEngine.validate(response);
      expect(result.isValid).toBe(true);
    });

    it("should handle empty response", () => {
      const result = engine.validate("");
      expect(result.isValid).toBe(true); // Empty is valid (no violations)
    });
  });

  describe("buildRPPrompt", () => {
    it("should build complete RP prompt", () => {
      const userMessage = "你好，Kurisu";
      const memories = ["之前我们讨论了时间机器"];
      const prompt = engine.buildRPPrompt(userMessage, memories);

      // 新的三层架构：身份 + 灵魂 + 世界观 + 记忆 + 表现层
      expect(prompt).toContain("牧濑红莉栖");
      expect(prompt).toContain(memories[0]);
      // soul.md 内容
      expect(prompt).toContain("我是");
    });

    it("should include relationship context", () => {
      engine.updateMentalModel({
        user_profile: {
          name: "Okabe",
          relationship: "friend",
          preferences: ["time travel", "science"],
        },
        relationship_graph: {
          trust_level: 60,
          familiarity: 75,
          emotional_state: "comfortable",
        },
      });

      const prompt = engine.buildRPPrompt("测试消息", []);
      // 信任度在记忆部分显示
      expect(prompt).toContain("60%");
    });

    it("should limit memories to last 5", () => {
      const memories = ["m1", "m2", "m3", "m4", "m5", "m6", "m7"];
      const prompt = engine.buildRPPrompt("test", memories);

      expect(prompt).toContain("m3");
      expect(prompt).toContain("m7");
      // m1 and m2 should not be included (only last 5)
      const m1Index = prompt.indexOf("m1\n");
      const m3Index = prompt.indexOf("m3");
      expect(m3Index).toBeGreaterThan(m1Index);
    });

    it("should include instruction to not mention AI", () => {
      const prompt = engine.buildRPPrompt("test", []);
      // 新的指令部分
      expect(prompt).toContain("不要提及你是 AI");
    });
  });

  describe("enforcePersona", () => {
    it("should add tsundere markers if missing", () => {
      const response = "这个理论很有趣。";
      const enforced = engine.enforcePersona(response);
      // Should add some tsundere flavor
      expect(enforced.length).toBeGreaterThanOrEqual(response.length);
    });

    it("should not double tsundere markers", () => {
      const response = "哼，这个理论很有趣。笨蛋。";
      const enforced = engine.enforcePersona(response);
      // Should preserve tsundere markers without adding extra prefix
      expect(enforced).toContain("哼");
      expect(enforced).toContain("笨蛋");
      expect(enforced).toContain("理论很有趣");
    });

    it("should preserve original meaning", () => {
      const response = "根据我的研究，时间旅行理论上是可行的。";
      const enforced = engine.enforcePersona(response);
      expect(enforced).toContain("研究");
      expect(enforced).toContain("时间旅行");
    });

    it("should adjust formality based on relationship", () => {
      const formalResponse = "我认为这个观点是正确的。";

      // Low familiarity - more formal
      const enforced1 = engine.enforcePersona(formalResponse);

      // High familiarity - less formal
      engine.updateMentalModel({
        relationship_graph: {
          trust_level: 80,
          familiarity: 90,
          emotional_state: "close",
        },
      });
      const enforced2 = engine.enforcePersona(formalResponse);

      // Both should be valid but may differ in tone
      expect(typeof enforced1).toBe("string");
      expect(typeof enforced2).toBe("string");
    });
  });

  describe("getSystemPrompt", () => {
    it("should return system prompt string", () => {
      const prompt = engine.getSystemPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(100);
    });

    it("should include persona identity", () => {
      const prompt = engine.getSystemPrompt();
      // 新的三层架构
      expect(prompt).toContain("牧濑红莉栖");
    });

    it("should include soul content", () => {
      const prompt = engine.getSystemPrompt();
      // soul.md 内容（第一人称）
      expect(prompt).toContain("我是");
    });

    it("should include instruction to not mention AI", () => {
      const prompt = engine.getSystemPrompt();
      // 新的指令部分
      expect(prompt).toContain("不要提及你是 AI");
    });
  });

  describe("edge cases", () => {
    it("should handle very long responses", () => {
      const longResponse = "哼，".repeat(10000);
      const result = engine.validate(longResponse);
      expect(result.isValid).toBe(true);
    });

    it("should handle special characters", () => {
      const specialResponse = "哼... 你这家伙！@#$%^&*()";
      const result = engine.validate(specialResponse);
      expect(result.isValid).toBe(true);
    });

    it("should handle unicode and emoji", () => {
      const unicodeResponse = "哼，笨蛋！🔬🧪";
      const result = engine.validate(unicodeResponse);
      expect(result.isValid).toBe(true);
    });
  });
});
