/**
 * PlatformConfig Skills Section Tests
 *
 * 验证 SkillsConfigSchema 校验、默认值、边界条件
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  SkillsConfigSchema,
  SKILLS_CONFIG_DEFAULTS,
} from "../../../src/platform/types/config";
import type { SkillsConfig } from "../../../src/platform/types/config";

describe("SkillsConfig", () => {
  describe("Defaults", () => {
    it("应提供所有默认值", () => {
      const result = SkillsConfigSchema.parse({});

      expect(result.classifierCapability).toBe("conversation");
      expect(result.classifierTimeout).toBe(3000);
      expect(result.classifierConfidence).toBe(0.6);
      expect(result.maxActivePerSession).toBe(5);
      expect(result.knowledgeCapacity).toBe(500);
      expect(result.knowledgeMaxTokensPerEntry).toBe(2000);
      expect(result.compensationIntervalMs).toBe(1800000);
    });

    it("SKILLS_CONFIG_DEFAULTS 应与 schema 默认值一致", () => {
      const parsed = SkillsConfigSchema.parse({});
      expect(parsed.classifierCapability).toBe(SKILLS_CONFIG_DEFAULTS.classifierCapability);
      expect(parsed.classifierTimeout).toBe(SKILLS_CONFIG_DEFAULTS.classifierTimeout);
      expect(parsed.classifierConfidence).toBe(SKILLS_CONFIG_DEFAULTS.classifierConfidence);
      expect(parsed.maxActivePerSession).toBe(SKILLS_CONFIG_DEFAULTS.maxActivePerSession);
      expect(parsed.knowledgeCapacity).toBe(SKILLS_CONFIG_DEFAULTS.knowledgeCapacity);
      expect(parsed.knowledgeMaxTokensPerEntry).toBe(SKILLS_CONFIG_DEFAULTS.knowledgeMaxTokensPerEntry);
      expect(parsed.compensationIntervalMs).toBe(SKILLS_CONFIG_DEFAULTS.compensationIntervalMs);
    });
  });

  describe("Validation", () => {
    it("应接受有效的完整配置", () => {
      const config: SkillsConfig = {
        classifierCapability: "coding",
        classifierTimeout: 5000,
        classifierConfidence: 0.8,
        maxActivePerSession: 3,
        knowledgeCapacity: 200,
        knowledgeMaxTokensPerEntry: 1000,
        compensationIntervalMs: 3600000,
      };

      const result = SkillsConfigSchema.parse(config);
      expect(result.classifierCapability).toBe("coding");
      expect(result.classifierTimeout).toBe(5000);
    });

    it("应接受部分配置并补充默认值", () => {
      const result = SkillsConfigSchema.parse({
        classifierTimeout: 5000,
      });

      expect(result.classifierTimeout).toBe(5000);
      expect(result.classifierCapability).toBe("conversation"); // default
      expect(result.classifierConfidence).toBe(0.6); // default
    });

    it("classifierConfidence 应在 0-1 之间", () => {
      expect(() =>
        SkillsConfigSchema.parse({ classifierConfidence: -0.1 }),
      ).toThrow();

      expect(() =>
        SkillsConfigSchema.parse({ classifierConfidence: 1.1 }),
      ).toThrow();

      // 边界值应通过
      expect(SkillsConfigSchema.parse({ classifierConfidence: 0 }).classifierConfidence).toBe(0);
      expect(SkillsConfigSchema.parse({ classifierConfidence: 1 }).classifierConfidence).toBe(1);
    });

    it("classifierTimeout 应为正数", () => {
      expect(() =>
        SkillsConfigSchema.parse({ classifierTimeout: 0 }),
      ).toThrow();

      expect(() =>
        SkillsConfigSchema.parse({ classifierTimeout: -100 }),
      ).toThrow();
    });

    it("maxActivePerSession 应为正整数", () => {
      expect(() =>
        SkillsConfigSchema.parse({ maxActivePerSession: 0 }),
      ).toThrow();

      expect(() =>
        SkillsConfigSchema.parse({ maxActivePerSession: -1 }),
      ).toThrow();
    });

    it("knowledgeCapacity 应为正整数", () => {
      expect(() =>
        SkillsConfigSchema.parse({ knowledgeCapacity: 0 }),
      ).toThrow();
    });

    it("knowledgeMaxTokensPerEntry 应为正数", () => {
      expect(() =>
        SkillsConfigSchema.parse({ knowledgeMaxTokensPerEntry: 0 }),
      ).toThrow();
    });

    it("compensationIntervalMs 应为正数", () => {
      expect(() =>
        SkillsConfigSchema.parse({ compensationIntervalMs: 0 }),
      ).toThrow();
    });

    it("classifierCapability 应为非空字符串", () => {
      expect(() =>
        SkillsConfigSchema.parse({ classifierCapability: "" }),
      ).toThrow();
    });
  });

  describe("Type Safety", () => {
    it("解析结果应满足 SkillsConfig 接口", () => {
      const result: SkillsConfig = SkillsConfigSchema.parse({});

      // TypeScript 编译时检查 + 运行时验证
      expect(typeof result.classifierCapability).toBe("string");
      expect(typeof result.classifierTimeout).toBe("number");
      expect(typeof result.classifierConfidence).toBe("number");
      expect(typeof result.maxActivePerSession).toBe("number");
      expect(typeof result.knowledgeCapacity).toBe("number");
      expect(typeof result.knowledgeMaxTokensPerEntry).toBe("number");
      expect(typeof result.compensationIntervalMs).toBe("number");
    });
  });
});
