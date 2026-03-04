/**
 * git-tools Skill 测试（v2.1 — 符合 skill-system.md 规范）
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import { createSkillLoader } from "../../../src/platform/skills/loader";

const SKILL_PATH = join(__dirname, "../../../config/skills/git-tools");

describe("git-tools Skill", () => {
  const loader = createSkillLoader();

  describe("skill.yaml 解析", () => {
    it("应该能加载 skill 配置", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect(instance.config.id).toBe("git-tools");
      expect(instance.config.name).toBe("Git 操作");
      expect(instance.config.version).toBe("2.1");
      expect(instance.config.type).toBe("hybrid");
    });

    it("应该有 L1 命令触发", async () => {
      const instance = await loader.load(SKILL_PATH);
      const commands = instance.config.trigger.commands ?? [];

      expect(commands).toContain("/git");
      expect(commands).toContain("/commit");
      expect(commands).toContain("/push");
    });

    it("不应有 keywords/patterns/intent 死字段", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect(instance.config.trigger.keywords).toBeUndefined();
      expect(instance.config.trigger.patterns).toBeUndefined();
      expect(instance.config.trigger.intent).toBeUndefined();
    });

    it("应该有 context 包含工具概览", async () => {
      const instance = await loader.load(SKILL_PATH);
      const context = instance.config.context ?? "";

      expect(context).toContain("git_status");
      expect(context).toContain("git_log");
      expect(context).toContain("git_commit");
      expect(context).toContain("注意事项");
    });

    it("应该有 Few-Shot 示例", async () => {
      const instance = await loader.load(SKILL_PATH);
      const examples = instance.config.examples ?? [];

      expect(examples.length).toBeGreaterThan(0);

      const statusExample = examples.find((e) =>
        e.toolCalls?.some((t) => t.name === "git_status"),
      );
      expect(statusExample).toBeDefined();
    });

    it("应该有工具过滤配置", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect(instance.config.tools).toBeDefined();
      expect(instance.config.tools?.include).toBeDefined();

      const includeList = instance.config.tools?.include ?? [];

      expect(includeList).toContain("git_status");
      expect(includeList).toContain("git_log");
      expect(includeList).toContain("git_branch");
      expect(includeList).toContain("git_diff");
      expect(includeList).toContain("git_add");
      expect(includeList).toContain("git_commit");
      expect(includeList).toContain("git_push");
    });
  });

  describe("工具配置", () => {
    it("应该引用 git server", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect((instance.config.tools as { server: string })?.server).toBe("git");
    });
  });
});
