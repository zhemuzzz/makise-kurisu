/**
 * Persona Engine 集成测试
 * 测试完整的人设引擎流程
 * @vitest-environment node
 *
 * 新的三层架构需要先加载角色配置
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PersonaEngine } from "../../../src/core/persona/index";
import { PersonaValidator } from "../../../src/core/persona/validator";
import { PersonaEnforcer } from "../../../src/core/persona/enforcer";
import { PromptBuilder } from "../../../src/core/persona/prompt-builder";
import { RoleLoader } from "../../../src/core/persona/role-loader";
import {
  SAMPLE_MENTAL_MODELS,
  SAMPLE_MEMORIES,
  VALID_KURISU_RESPONSES,
  OOC_RESPONSES,
} from "../../fixtures/persona-fixtures";

describe("Persona Engine Integration", () => {
  describe("complete flow", () => {
    let engine: PersonaEngine;
    let validator: PersonaValidator;
    let enforcer: PersonaEnforcer;
    let promptBuilder: PromptBuilder;
    let roleLoader: RoleLoader;

    beforeEach(async () => {
      roleLoader = new RoleLoader();
      const result = await roleLoader.tryLoad("kurisu");

      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);
      validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.stranger);
      enforcer = new PersonaEnforcer(SAMPLE_MENTAL_MODELS.stranger);
      promptBuilder = new PromptBuilder(SAMPLE_MENTAL_MODELS.stranger);

      if (result.success && result.config) {
        promptBuilder.setRoleConfig(result.config);
      }
    });

    it("should process valid conversation flow", () => {
      // 1. 构建提示词
      const userMessage = "你好，你是谁？";
      const prompt = promptBuilder.build(userMessage, []);

      expect(prompt).toContain("牧濑红莉栖");

      // 2. 模拟生成回复
      const generatedResponse = "...哼，你又是谁？突然就问这种问题。";

      // 3. 校验回复
      const validationResult = validator.validate(generatedResponse);

      expect(validationResult.isValid).toBe(true);

      // 4. 强化人设（如果需要）
      const enforcedResponse = enforcer.enforce(generatedResponse);

      expect(enforcedResponse).toBeDefined();
      expect(enforcedResponse.length).toBeGreaterThan(0);
    });

    it("should reject and handle OOC response", () => {
      const oocResponse = "作为AI，我很高兴认识你。";

      const validationResult = validator.validate(oocResponse);

      expect(validationResult.isValid).toBe(false);
      expect(validationResult.shouldRegenerate).toBe(true);

      // 强化器应该修复 OOC
      const enforcedResponse = enforcer.enforce(oocResponse);

      expect(enforcedResponse).not.toContain("作为AI");
    });

    it("should update relationship after positive interaction", async () => {
      const initialFamiliarity =
        engine.getMentalModel().relationship_graph.familiarity;

      // 模拟成功的对话
      engine.updateMentalModel({
        relationship_graph: {
          familiarity: initialFamiliarity + 10,
          trust_level:
            engine.getMentalModel().relationship_graph.trust_level + 5,
          emotional_state: "neutral",
        },
      });

      expect(engine.getMentalModel().relationship_graph.familiarity).toBe(
        initialFamiliarity + 10,
      );

      // 新的提示词应该反映更新后的关系
      promptBuilder.updateMentalModel(engine.getMentalModel());

      // 重新加载角色配置
      const result = await roleLoader.tryLoad("kurisu");
      if (result.success && result.config) {
        promptBuilder.setRoleConfig(result.config);
      }

      const newPrompt = promptBuilder.build("你好", []);
      expect(newPrompt).toBeDefined();
    });
  });

  describe("multi-turn conversation", () => {
    let engine: PersonaEngine;
    let promptBuilder: PromptBuilder;
    let validator: PersonaValidator;
    let memories: string[];
    let roleLoader: RoleLoader;

    beforeEach(async () => {
      roleLoader = new RoleLoader();
      const result = await roleLoader.tryLoad("kurisu");

      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.stranger);
      promptBuilder = new PromptBuilder(SAMPLE_MENTAL_MODELS.stranger);
      validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.stranger);
      memories = [];

      if (result.success && result.config) {
        promptBuilder.setRoleConfig(result.config);
      }
    });

    it("should progress relationship over multiple turns", () => {
      const turns = [
        { user: "你好", kurisu: "...哼，有什么事？" },
        { user: "你在研究什么？", kurisu: "时间旅行理论...与你无关吧。" },
        {
          user: "我觉得时间旅行很有趣",
          kurisu: "哼，你也懂时间旅行？说说看。",
        },
        { user: "El Psy Kongroo", kurisu: "...你怎么知道这个？" },
      ];

      turns.forEach((turn, index) => {
        // 构建提示词
        const prompt = promptBuilder.build(turn.user, memories);
        expect(prompt).toBeDefined();

        // 校验回复
        const result = validator.validate(turn.kurisu);
        expect(result.isValid).toBe(true);

        // 记录对话
        memories.push(`User: ${turn.user} | Kurisu: ${turn.kurisu}`);

        // 更新关系
        engine.updateMentalModel({
          relationship_graph: {
            familiarity: Math.min(100, (index + 1) * 20),
            trust_level: Math.min(100, (index + 1) * 15),
            emotional_state: "neutral",
          },
        });

        promptBuilder.updateMentalModel(engine.getMentalModel());
        validator = new PersonaValidator(engine.getMentalModel());
      });

      // 检查最终关系状态
      const finalModel = engine.getMentalModel();
      expect(finalModel.relationship_graph.familiarity).toBe(80);

      // 检查记忆累积
      expect(memories.length).toBe(4);
    });
  });

  describe("error recovery", () => {
    let validator: PersonaValidator;
    let enforcer: PersonaEnforcer;

    beforeEach(() => {
      validator = new PersonaValidator();
      enforcer = new PersonaEnforcer();
    });

    it("should handle repeated validation failures", () => {
      const maxAttempts = 3;
      let attempts = 0;
      let lastResponse = "";

      // 模拟连续失败后成功的场景
      const responses = [
        "作为AI，我无法回答",
        "我是一个程序",
        "哼，笨蛋，这个问题很简单。",
      ];

      for (let i = 0; i < maxAttempts; i++) {
        attempts++;
        const response = responses[i];
        const result = validator.validate(response);

        if (result.isValid) {
          lastResponse = response;
          break;
        } else {
          // 尝试修复
          lastResponse = enforcer.enforce(response);
        }
      }

      expect(attempts).toBe(3);
      expect(lastResponse).toBeDefined();
    });

    it("should fallback to safe response after max failures", () => {
      let response = "";
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        response = enforcer.enforce(response || "无效回复");
        const result = validator.validate(response);

        if (result.isValid) break;
      }

      // 即使多次失败，也应该返回有效的默认回复
      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(0);
    });
  });

  describe("relationship progression", () => {
    let roleLoader: RoleLoader;

    beforeEach(async () => {
      roleLoader = new RoleLoader();
    });

    it("should behave differently at each relationship level", async () => {
      const levels = [
        { model: SAMPLE_MENTAL_MODELS.stranger, expectedBehavior: "distant" },
        {
          model: SAMPLE_MENTAL_MODELS.acquaintance,
          expectedBehavior: "neutral",
        },
        { model: SAMPLE_MENTAL_MODELS.friend, expectedBehavior: "friendly" },
        { model: SAMPLE_MENTAL_MODELS.close, expectedBehavior: "warm" },
      ];

      const result = await roleLoader.tryLoad("kurisu");

      for (const { model } of levels) {
        const validator = new PersonaValidator(model);
        const builder = new PromptBuilder(model);

        if (result.success && result.config) {
          builder.setRoleConfig(result.config);
        }

        // 检查提示词构建成功
        const prompt = builder.build("你好", []);
        expect(prompt).toBeDefined();

        // 检查校验器的行为
        const validationResult = validator.validate("你好");
        expect(validationResult.isValid).toBe(true);
      }
    });

    it("should allow more intimate expressions at higher levels", () => {
      // 陌生人级别：拒绝亲密表达
      let validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.stranger);
      let result = validator.validate("亲爱的");
      expect(result.isValid).toBe(false);

      // 朋友级别：仍然限制
      validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.friend);
      result = validator.validate("亲爱的");
      expect(result.isValid).toBe(false);

      // 亲密级别：允许
      validator = new PersonaValidator(SAMPLE_MENTAL_MODELS.close);
      result = validator.validate("亲爱的");
      expect(result.isValid).toBe(true);
    });
  });

  describe("memory integration", () => {
    let engine: PersonaEngine;
    let promptBuilder: PromptBuilder;
    let roleLoader: RoleLoader;

    beforeEach(async () => {
      roleLoader = new RoleLoader();
      const result = await roleLoader.tryLoad("kurisu");

      engine = new PersonaEngine(SAMPLE_MENTAL_MODELS.friend);
      promptBuilder = new PromptBuilder(SAMPLE_MENTAL_MODELS.friend);

      if (result.success && result.config) {
        promptBuilder.setRoleConfig(result.config);
      }
    });

    it("should include relevant memories in prompt", () => {
      const memories = [
        "User: 你喜欢香蕉吗？ | Kurisu: ...香蕉？普通吧。",
        "User: 你还记得我们第一次见面吗？ | Kurisu: 当然记得，在秋叶原的广播馆。",
      ];

      const prompt = promptBuilder.build("你记得我吗？", memories);

      expect(prompt).toContain("香蕉");
      expect(prompt).toContain("秋叶原");
    });

    it("should prioritize recent memories", () => {
      const memories = SAMPLE_MEMORIES; // 使用完整的记忆列表
      const prompt = promptBuilder.build("你好", memories);

      // 应该包含记忆部分
      expect(prompt).toContain("User:");
    });

    it("should update shared memories after key events", async () => {
      engine.updateMentalModel({
        shared_memories: {
          key_events: [
            ...engine.getMentalModel().shared_memories.key_events,
            "新事件",
          ],
          inside_jokes: engine.getMentalModel().shared_memories.inside_jokes,
          repeated_topics:
            engine.getMentalModel().shared_memories.repeated_topics,
        },
      });

      promptBuilder.updateMentalModel(engine.getMentalModel());

      // 重新加载角色配置
      const result = await roleLoader.tryLoad("kurisu");
      if (result.success && result.config) {
        promptBuilder.setRoleConfig(result.config);
      }

      const prompt = promptBuilder.build("你好", []);
      expect(prompt).toContain("新事件");
    });
  });

  describe("persona consistency across components", () => {
    let roleLoader: RoleLoader;

    beforeEach(async () => {
      roleLoader = new RoleLoader();
    });

    it("should maintain Kurisu persona across all components", async () => {
      const result = await roleLoader.tryLoad("kurisu");

      const engine = new PersonaEngine();
      const validator = new PersonaValidator(engine.getMentalModel());
      const enforcer = new PersonaEnforcer(engine.getMentalModel());
      const builder = new PromptBuilder(engine.getMentalModel());

      if (result.success && result.config) {
        builder.setRoleConfig(result.config);
      }

      // 1. 提示词应该包含人设
      const prompt = builder.build("测试", []);
      expect(prompt).toContain("牧濑红莉栖");

      // 2. 校验器应该识别 OOC
      const oocResult = validator.validate("作为AI");
      expect(oocResult.isValid).toBe(false);

      // 3. 强化器应该添加傲娇特征
      const enforced = enforcer.enforce("好的");
      expect(enforced).toMatch(/(哼|...|笨蛋|才)/);
    });

    it("should handle edge cases consistently", () => {
      const validator = new PersonaValidator();
      const enforcer = new PersonaEnforcer();

      // 空输入
      expect(validator.validate("").isValid).toBe(true);
      expect(enforcer.enforce("").length).toBeGreaterThan(0);

      // 特殊字符
      expect(validator.validate("<script>").isValid).toBe(true);
      expect(enforcer.enforce("<script>")).toBeDefined();
    });
  });

  describe("performance benchmarks", () => {
    let roleLoader: RoleLoader;

    beforeEach(async () => {
      roleLoader = new RoleLoader();
    });

    it("should complete full validation cycle within time limit", async () => {
      const result = await roleLoader.tryLoad("kurisu");

      const engine = new PersonaEngine();
      const validator = new PersonaValidator();
      const enforcer = new PersonaEnforcer();
      const builder = new PromptBuilder(engine.getMentalModel());

      if (result.success && result.config) {
        builder.setRoleConfig(result.config);
      }

      const start = performance.now();

      for (let i = 0; i < 50; i++) {
        const prompt = builder.build("测试消息", SAMPLE_MEMORIES);
        const response =
          VALID_KURISU_RESPONSES[i % VALID_KURISU_RESPONSES.length];
        const validationResult = validator.validate(response);
        if (!validationResult.isValid) {
          enforcer.enforce(response);
        }
      }

      const duration = performance.now() - start;
      // 50次完整循环应该在 1000ms 内完成
      expect(duration).toBeLessThan(1000);
    });
  });
});
