/**
 * Skill Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { SkillRegistry, createSkillRegistry } from "../../src/skills/registry";

describe("SkillRegistry", () => {
  let registry: SkillRegistry;
  const testDir = join(__dirname, "test-registry-skills");

  beforeEach(async () => {
    registry = createSkillRegistry();
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("应该成功加载单个 Skill", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: test-skill
name: 测试技能
version: "1.0.0"
type: knowledge
trigger:
  keywords:
    - 测试
`
      );

      const instance = await registry.load(testDir);

      expect(instance.config.id).toBe("test-skill");
      expect(registry.get("test-skill")).toBe(instance);
    });

    it("应该替换已存在的同名 Skill", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: duplicate-skill
name: 重复技能
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      await registry.load(testDir);

      // 再次加载相同 ID 的 Skill
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: duplicate-skill
name: 重复技能V2
version: "2.0.0"
type: knowledge
trigger: {}
`
      );

      const instance = await registry.load(testDir);

      expect(instance.config.version).toBe("2.0.0");
      expect(registry.list().length).toBe(1);
    });
  });

  describe("loadFromDirectory", () => {
    it("应该从目录加载所有 Skills", async () => {
      // 创建多个 skill 目录
      const skill1Dir = join(testDir, "skill1");
      const skill2Dir = join(testDir, "skill2");

      await mkdir(skill1Dir, { recursive: true });
      await mkdir(skill2Dir, { recursive: true });

      await writeFile(
        join(skill1Dir, "skill.yaml"),
        `
id: skill-1
name: 技能1
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      await writeFile(
        join(skill2Dir, "skill.yaml"),
        `
id: skill-2
name: 技能2
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      const loaded = await registry.loadFromDirectory(testDir);

      expect(loaded.length).toBe(2);
      expect(registry.list().length).toBe(2);
    });

    it("应该在目录不存在时返回空数组", async () => {
      const loaded = await registry.loadFromDirectory("/nonexistent/path");

      expect(loaded).toEqual([]);
    });
  });

  describe("unload", () => {
    it("应该卸载指定的 Skill", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: unload-test
name: 卸载测试
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      await registry.load(testDir);
      expect(registry.get("unload-test")).toBeDefined();

      await registry.unload("unload-test");
      expect(registry.get("unload-test")).toBeUndefined();
    });

    it("应该在 Skill 不存在时静默处理", async () => {
      // 不应该抛出错误
      await expect(registry.unload("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("matchIntent", () => {
    beforeEach(async () => {
      // 创建测试 Skills
      const skill1Dir = join(testDir, "web-search");
      const skill2Dir = join(testDir, "file-tools");

      await mkdir(skill1Dir, { recursive: true });
      await mkdir(skill2Dir, { recursive: true });

      await writeFile(
        join(skill1Dir, "skill.yaml"),
        `
id: web-search
name: 网页搜索
version: "1.0.0"
type: hybrid
trigger:
  keywords:
    - 搜索
    - 查一下
    - 天气
`
      );

      await writeFile(
        join(skill2Dir, "skill.yaml"),
        `
id: file-tools
name: 文件操作
version: "1.0.0"
type: hybrid
trigger:
  keywords:
    - 文件
    - 读取
`
      );

      await registry.loadFromDirectory(testDir);
    });

    it("应该通过关键词匹配正确的 Skill", () => {
      const results = registry.matchIntent("帮我搜索一下");

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.skillId).toBe("web-search");
    });

    it("应该按置信度排序结果", () => {
      // "查一下文件" 同时匹配两个 Skill
      const results = registry.matchIntent("查一下文件内容");

      // web-search 通过 "查一下" 匹配
      // file-tools 通过 "文件" 匹配
      expect(results.length).toBeGreaterThanOrEqual(2);

      // 检查排序
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.confidence).toBeGreaterThanOrEqual(
          results[i]!.confidence
        );
      }
    });

    it("应该返回空数组当没有匹配时", () => {
      const results = registry.matchIntent("今天吃什么");

      expect(results).toEqual([]);
    });
  });

  describe("activate / deactivate", () => {
    beforeEach(async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: activate-test
name: 激活测试
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      await registry.load(testDir);
    });

    it("应该激活指定的 Skill", async () => {
      await registry.activate(["activate-test"]);

      const activeSkills = registry.getActiveSkills();
      expect(activeSkills.length).toBe(1);
      expect(activeSkills[0]?.config.id).toBe("activate-test");
    });

    it("应该停用指定的 Skill", async () => {
      await registry.activate(["activate-test"]);
      await registry.deactivate(["activate-test"]);

      const activeSkills = registry.getActiveSkills();
      expect(activeSkills.length).toBe(0);
    });

    it("应该忽略不存在的 Skill ID", async () => {
      // 不应该抛出错误
      await expect(
        registry.activate(["nonexistent"])
      ).resolves.toBeUndefined();
    });
  });

  describe("getAvailableTools", () => {
    it("应该返回激活 Skills 的所有工具", async () => {
      // 注意：由于没有真实的 MCP Bridge，工具列表为空
      // 这里主要测试逻辑正确性

      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: tool-test
name: 工具测试
version: "1.0.0"
type: tool
trigger: {}
`
      );

      await registry.load(testDir);
      await registry.activate(["tool-test"]);

      const tools = registry.getAvailableTools();
      // 由于没有 MCP 连接，工具列表为空
      expect(tools.length).toBe(0);
    });
  });

  describe("buildKnowledgeInjection", () => {
    it("应该返回知识注入内容", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: injection-test
name: 注入测试
version: "1.0.0"
type: knowledge
trigger: {}
context: 这是测试上下文
`
      );

      await registry.load(testDir);
      await registry.activate(["injection-test"]);

      const injection = registry.buildKnowledgeInjection();

      expect(injection).toContain("这是测试上下文");
    });
  });
});
