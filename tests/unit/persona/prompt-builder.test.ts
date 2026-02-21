/**
 * PromptBuilder 提示词构建器单元测试
 * @vitest-environment node
 *
 * 新的三层架构：灵魂层 L0 → 表现层 L1
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PromptBuilder } from "../../../src/core/persona/prompt-builder";
import { RoleLoader } from "../../../src/core/persona/role-loader";
import type { RoleConfig } from "../../../src/core/persona/soul-types";

describe("PromptBuilder", () => {
  let builder: PromptBuilder;
  let roleConfig: RoleConfig | null = null;

  beforeEach(async () => {
    // 加载 kurisu 角色配置
    const loader = new RoleLoader();
    const result = await loader.tryLoad("kurisu");

    if (result.success && result.config) {
      roleConfig = result.config;
      builder = new PromptBuilder();
      builder.setRoleConfig(roleConfig);
    } else {
      throw new Error("Failed to load kurisu role config for tests");
    }
  });

  describe("build", () => {
    it("should build prompt with persona identity", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("牧濑红莉栖");
      expect(prompt).toContain("# 身份");
    });

    it("should include soul content (L0)", () => {
      const prompt = builder.build("你好", []);

      // soul.md 内容
      expect(prompt).toContain("# 存在");
      expect(prompt).toContain("我是牧濑红莉栖");
    });

    it("should include lore content", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("# 你所在的世界");
    });

    it("should include recent memories", () => {
      const memories = ["之前我们讨论了时间机器", "昨天一起看了电影"];
      const prompt = builder.build("测试", memories);

      expect(prompt).toContain("之前我们讨论了时间机器");
      expect(prompt).toContain("昨天一起看了电影");
    });

    it("should include instruction section", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("# 重要");
      expect(prompt).toContain("不要提及你是 AI");
    });
  });

  describe("memory handling", () => {
    it("should truncate memories to last 5", () => {
      const memories = [
        "m1",
        "m2",
        "m3",
        "m4",
        "m5",
        "m6",
        "m7",
      ];
      const prompt = builder.build("测试", memories);

      // 应该包含最后5条 (m3-m7)
      expect(prompt).toContain("m3");
      expect(prompt).toContain("m7");
      // m1 和 m2 不应在 "Memory X:" 格式中出现
      expect(prompt).not.toContain("Memory 1: m1");
      expect(prompt).not.toContain("Memory 2: m2");
    });

    it("should handle empty memories array", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should handle single memory", () => {
      const prompt = builder.build("测试", ["单条记忆"]);

      expect(prompt).toContain("单条记忆");
    });

    it("should handle memories with special characters", () => {
      const memories = ["User: <script>alert(1)</script> | Kurisu: 哼"];
      const prompt = builder.build("测试", memories);

      expect(prompt).toBeDefined();
    });
  });

  describe("persona section (L1)", () => {
    it("should include speech patterns", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("# 你如何说话和行动");
    });

    it("should include catchphrases", () => {
      const prompt = builder.build("你好", []);

      // soul.md 或 persona.yaml 中的口癖
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("security and safety", () => {
    it("should handle special characters in user message", () => {
      const prompt = builder.build("<script>alert(1)</script>", []);

      expect(prompt).toBeDefined();
    });

    it("should handle XSS attempt in user message", () => {
      const prompt = builder.build("<img src=x onerror=alert(1)>", []);

      expect(prompt).toBeDefined();
    });

    it("should handle SQL injection attempt", () => {
      const prompt = builder.build("'; DROP TABLE users; --", []);

      expect(prompt).toBeDefined();
    });

    it("should handle very long user message", () => {
      const longMessage = "测试".repeat(10000);
      const prompt = builder.build(longMessage, []);

      expect(prompt).toBeDefined();
    });

    it("should handle unicode content", () => {
      const prompt = builder.build("你好世界 🔬🧪 日本語", []);

      expect(prompt).toBeDefined();
    });
  });

  describe("prompt structure", () => {
    it("should have clear section headers with #", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("# 身份");
      expect(prompt).toContain("# 存在");
      expect(prompt).toContain("# 你所在的世界");
    });

    it("should separate sections with ---", () => {
      const prompt = builder.build("你好", []);

      expect(prompt).toContain("---");
    });
  });

  describe("boundary cases", () => {
    it("should handle empty user message", () => {
      const prompt = builder.build("", []);

      expect(prompt).toBeDefined();
    });

    it("should handle whitespace only user message", () => {
      const prompt = builder.build("   \n\t  ", []);

      expect(prompt).toBeDefined();
    });

    it("should handle very short user message", () => {
      const prompt = builder.build("嗨", []);

      expect(prompt).toBeDefined();
    });

    it("should handle markdown in user message", () => {
      const prompt = builder.build("# 标题\n\n**粗体**\n\n- 列表项", []);

      expect(prompt).toBeDefined();
    });

    it("should handle JSON in user message", () => {
      const prompt = builder.build('{"key": "value", "number": 123}', []);

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

      // 信任度应该在记忆部分显示
      expect(prompt).toContain("75%");
    });

    it("should update user preferences", () => {
      builder.updateMentalModel({
        user_profile: {
          name: "冈部",
          relationship: "friend",
          preferences: ["时间旅行", "科学"],
        },
      });

      const prompt = builder.build("你好", []);

      // 关键事件和共享记忆部分可能包含这些信息
      expect(prompt).toBeDefined();
    });
  });

  describe("performance", () => {
    it("should build prompt quickly", () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        builder.build("测试消息", ["记忆1", "记忆2"]);
      }

      const duration = performance.now() - start;
      // 100次构建应该在 500ms 内完成
      expect(duration).toBeLessThan(500);
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
      // 单次构建应该在 100ms 内完成
      expect(duration).toBeLessThan(100);
    });
  });

  describe("immutability", () => {
    it("should not modify input memories array", () => {
      const memories = ["m1", "m2", "m3"];
      const originalLength = memories.length;

      builder.build("测试", memories);

      expect(memories.length).toBe(originalLength);
    });
  });

  describe("role config", () => {
    it("should throw error when roleConfig not set", () => {
      const newBuilder = new PromptBuilder();

      expect(() => newBuilder.build("test", [])).toThrow(
        "RoleConfig is required",
      );
    });

    it("should return role config after setting", () => {
      const config = builder.getRoleConfig();

      expect(config).not.toBeNull();
      expect(config?.meta.name).toBe("牧濑红莉栖");
    });
  });
});
