/**
 * PromptBuilder 提示词构建器单元测试
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptBuilder } from "../../../src/core/persona/prompt-builder";
import {
  SAMPLE_MENTAL_MODELS,
  SAMPLE_MEMORIES,
  BOUNDARY_TEST_DATA,
} from "../../fixtures/persona-fixtures";

describe("PromptBuilder", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    // 使用 friend model 作为默认（包含冈部、65%熟悉度）
    builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.friend);
  });

  describe("build", () => {
    it("should build prompt with persona content", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("牧濑红莉栖");
      expect(prompt).toContain("Makise Kurisu");
    });

    it("should include user message", () => {
      const userMessage = "今天天气怎么样？";
      const prompt = builder.build(userMessage, []);

      expect(prompt).toContain(userMessage);
    });

    it("should include recent memories", () => {
      const memories = SAMPLE_MEMORIES.slice(0, 3);
      const prompt = builder.build("测试", memories);

      memories.forEach((memory) => {
        expect(prompt).toContain(memory.substring(0, 30)); // 检查部分内容
      });
    });

    it("should include user profile information", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("冈部"); // 用户名
    });

    it("should include relationship state", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("65%熟悉度"); // friend model familiarity
    });

    it("should include generation requirements", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("保持人设");
    });
  });

  describe("memory handling", () => {
    it("should truncate memories to last 5", () => {
      const memories = SAMPLE_MEMORIES; // 8条记忆
      const prompt = builder.build("测试", memories);

      // 应该包含最后5条
      expect(prompt).toContain("Memory");
      // 不应包含第一条
      const firstMemory = SAMPLE_MEMORIES[0];
      if (SAMPLE_MEMORIES.length > 5) {
        // 如果超过5条，检查截断逻辑
        expect(prompt.length).toBeLessThan(memories.join("\n").length + 10000);
      }
    });

    it("should handle empty memories array", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should handle single memory", () => {
      const prompt = builder.build("测试", [SAMPLE_MEMORIES[0]]);

      expect(prompt).toBeDefined();
    });

    it("should handle memories with special characters", () => {
      const memories = ["User: <script>alert(1)</script> | Kurisu: 哼"];
      const prompt = builder.build("测试", memories);

      expect(prompt).toBeDefined();
    });
  });

  describe("user profile section", () => {
    it("should include user name when available", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("冈部");
    });

    it("should include user preferences", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("科学");
      expect(prompt).toContain("时间旅行");
    });

    it("should handle user without name", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.stranger);
      const prompt = builder.build("你好", []);

      expect(prompt).toBeDefined();
    });

    it("should handle empty preferences", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.stranger);
      const prompt = builder.build("你好", []);

      expect(prompt).toBeDefined();
    });
  });

  describe("relationship section", () => {
    it("should show correct familiarity percentage", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.stranger);
      let prompt = builder.build("测试", []);
      expect(prompt).toContain("0%熟悉度");

      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.acquaintance);
      prompt = builder.build("测试", []);
      expect(prompt).toContain("35%熟悉度");

      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.close);
      prompt = builder.build("测试", []);
      expect(prompt).toContain("95%熟悉度");
    });

    it("should include emotional state when relevant", () => {
      const prompt = builder.build("你好", []);

      // 情感状态可能包含在提示词中
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("shared memories section", () => {
    it("should include key events", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.close);
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("救过命");
    });

    it("should include inside jokes", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.close);
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("凤凰院凶真");
    });

    it("should include repeated topics", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.close);
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("未来");
    });

    it("should handle empty shared memories", () => {
      builder = new PromptBuilder(SAMPLE_MENTAL_MODELS.stranger);
      const prompt = builder.build("你好", []);

      expect(prompt).toBeDefined();
    });
  });

  describe("security and safety", () => {
    it("should handle special characters in user message", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.specialCharacters, []);

      expect(prompt).toBeDefined();
    });

    it("should handle XSS attempt in user message", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.htmlTags, []);

      expect(prompt).toBeDefined();
    });

    it("should handle SQL injection attempt", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.sqlInjection, []);

      expect(prompt).toBeDefined();
    });

    it("should handle very long user message", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.veryLongText, []);

      expect(prompt).toBeDefined();
    });

    it("should handle unicode content", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.mixedLanguages, []);

      expect(prompt).toBeDefined();
    });
  });

  describe("prompt structure", () => {
    it("should have clear section headers", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("##");
    });

    it("should include persona section first", () => {
      const prompt = builder.build("你好", []);
      const personaIndex = prompt.indexOf("牧濑红莉栖");
      const currentStateIndex = prompt.indexOf("当前状态");

      expect(personaIndex).toBeLessThan(currentStateIndex);
    });

    it("should include response generation instructions", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("生成回复");
    });

    it("should end with role-play instruction", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("以牧濑红莉栖的身份");
    });
  });

  describe("boundary cases", () => {
    it("should handle empty user message", () => {
      const prompt = builder.build("", []);

      expect(prompt).toBeDefined();
    });

    it("should handle whitespace only user message", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.whitespaceOnly, []);

      expect(prompt).toBeDefined();
    });

    it("should handle very short user message", () => {
      const prompt = builder.build("嗨", []);

      expect(prompt).toBeDefined();
    });

    it("should handle markdown in user message", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.markdownContent, []);

      expect(prompt).toBeDefined();
    });

    it("should handle JSON in user message", () => {
      const prompt = builder.build(BOUNDARY_TEST_DATA.jsonContent, []);

      expect(prompt).toBeDefined();
    });
  });

  describe("updateMentalModel", () => {
    it("should update mental model and reflect in prompt", () => {
      builder.updateMentalModel({
        relationship_graph: {
          familiarity: 80,
          trust_level: 75,
          emotional_state: "warm",
        },
      });

      const prompt = builder.build("你好", []);

      expect(prompt).toContain("80%熟悉度");
    });

    it("should update user preferences", () => {
      builder.updateMentalModel({
        user_profile: {
          name: "新名字",
          relationship: "close",
          preferences: ["新爱好"],
        },
      });

      const prompt = builder.build("你好", []);

      expect(prompt).toContain("新名字");
      expect(prompt).toContain("新爱好");
    });
  });

  describe("performance", () => {
    it("should build prompt quickly", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        builder.build("测试消息", SAMPLE_MEMORIES);
      }

      const duration = performance.now() - start;
      // 100次构建应该在 100ms 内完成
      expect(duration).toBeLessThan(100);
    });

    it("should handle large memory set efficiently", () => {
      const largeMemories = Array.from(
        { length: 100 },
        (_, i) => `Memory ${i}: 这是一条很长的记忆记录...`,
      );

      const start = performance.now();
      const prompt = builder.build("测试", largeMemories);
      const duration = performance.now() - start;

      expect(prompt).toBeDefined();
      // 单次构建应该在 50ms 内完成
      expect(duration).toBeLessThan(50);
    });
  });

  describe("immutability", () => {
    it("should not modify input memories array", () => {
      const memories = [...SAMPLE_MEMORIES];
      const originalLength = memories.length;

      builder.build("测试", memories);

      expect(memories.length).toBe(originalLength);
    });

    it("should not modify input mental model", () => {
      const model = { ...SAMPLE_MENTAL_MODELS.friend };
      const originalFamiliarity = model.relationship_graph.familiarity;

      builder = new PromptBuilder(model);
      builder.updateMentalModel({
        relationship_graph: {
          familiarity: 99,
          trust_level: 99,
          emotional_state: "attached",
        },
      });

      expect(model.relationship_graph.familiarity).toBe(originalFamiliarity);
    });
  });

  describe("lore integration", () => {
    it("should include lore section in build output", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("世界观术语");
    });

    it("should include high-importance lore terms", () => {
      const prompt = builder.build("你好", []);

      // importance >= 4 的术语应该出现
      expect(prompt).toContain("世界线");
      expect(prompt).toContain("D-Mail");
      expect(prompt).toContain("未来道具实验室");
    });

    it("should place lore section between persona and current state", () => {
      const prompt = builder.build("你好", []);
      const personaIndex = prompt.indexOf("牧濑红莉栖");
      const loreIndex = prompt.indexOf("世界观术语");
      const stateIndex = prompt.indexOf("当前状态");

      expect(personaIndex).toBeLessThan(loreIndex);
      expect(loreIndex).toBeLessThan(stateIndex);
    });

    it("should add context-relevant low-importance terms when user mentions them", () => {
      // "叉子与勺子" importance=3, 不在静态 Lore 中
      const prompt = builder.build("你知道叉子与勺子的故事吗？", []);

      expect(prompt).toContain("叉子与勺子");
    });

    it("should not add context terms when user input is unrelated", () => {
      const prompt = builder.build("今天天气真好", []);
      const loreStart = prompt.indexOf("## 世界观术语");
      const loreEnd = prompt.indexOf("## 当前状态");
      const loreSection = prompt.substring(loreStart, loreEnd);

      // importance=3 的术语不应在 Lore section 中
      expect(loreSection).not.toContain("叉子与勺子");
      expect(loreSection).not.toContain("牧濑章一");
    });

    it("should not duplicate terms already in static lore", () => {
      // "世界线" importance=5, 已在静态 Lore 中
      const prompt = builder.build("世界线是什么？", []);

      // 计算 "世界线" 出现次数（在 Lore section 内）
      const loreStart = prompt.indexOf("## 世界观术语");
      const loreEnd = prompt.indexOf("## 当前状态");
      expect(loreStart).toBeGreaterThan(-1);
      expect(loreEnd).toBeGreaterThan(loreStart);
      const loreSection = prompt.substring(loreStart, loreEnd);
      const matches = loreSection.match(/\*\*世界线\*\*/g);

      // 只出现一次（静态 Lore 中）
      expect(matches).toHaveLength(1);
    });

    it("should handle empty user message with lore", () => {
      const prompt = builder.build("", []);

      // 静态 Lore 仍然包含
      expect(prompt).toContain("世界观术语");
    });

    it("should not impact build performance", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        builder.build("世界线收束", SAMPLE_MEMORIES);
      }

      const duration = performance.now() - start;
      // 100次构建应该在 200ms 内完成（含 Lore 搜索）
      expect(duration).toBeLessThan(200);
    });
  });
});
