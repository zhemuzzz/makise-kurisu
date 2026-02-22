/**
 * Skill Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { SkillLoader, SkillLoadError, createSkillLoader } from "../../src/skills/loader";
import type { SkillConfig } from "../../src/skills/types";

describe("SkillLoader", () => {
  let loader: SkillLoader;
  const testDir = join(__dirname, "test-skills");

  beforeEach(async () => {
    loader = createSkillLoader();
    // 创建测试目录
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // 清理测试目录
    await rm(testDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("应该成功加载有效的 skill.yaml", async () => {
      const skillConfig: SkillConfig = {
        id: "test-skill",
        name: "测试技能",
        version: "1.0.0",
        type: "knowledge",
        trigger: {
          keywords: ["测试", "test"],
        },
        context: "这是一个测试技能",
      };

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
    - test
context: 这是一个测试技能
`
      );

      const instance = await loader.load(testDir);

      expect(instance.config.id).toBe("test-skill");
      expect(instance.config.name).toBe("测试技能");
      expect(instance.config.type).toBe("knowledge");
      expect(instance.config.context).toBe("这是一个测试技能");
      expect(instance.status).toBe("inactive");
      expect(instance.loadedAt).toBeGreaterThan(0);
    });

    it("应该加载 hybrid 类型的 skill", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: hybrid-skill
name: 混合技能
version: "1.0.0"
type: hybrid
trigger:
  keywords:
    - 混合
  intent:
    - hybrid_action
context: 这是一个混合技能
examples:
  - user: "测试混合"
    assistant: "好的"
tools:
  mcpConfig: ./mcp.json
`
      );

      await writeFile(
        join(testDir, "mcp.json"),
        JSON.stringify({
          mcpServers: {
            test: {
              command: "node",
              args: ["test.js"],
            },
          },
        })
      );

      const instance = await loader.load(testDir);

      expect(instance.config.type).toBe("hybrid");
      expect(instance.config.examples).toBeDefined();
      expect(instance.config.examples?.length).toBe(1);
      expect(instance.config.tools?.mcpConfig).toBe("./mcp.json");
      expect(instance.mcpConfig).toBeDefined();
    });

    it("应该在缺少必填字段时抛出错误", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
name: 缺少ID的技能
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      await expect(loader.load(testDir)).rejects.toThrow(SkillLoadError);
      await expect(loader.load(testDir)).rejects.toThrow("Missing required field: id");
    });

    it("应该在无效类型时抛出错误", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: invalid-type
name: 无效类型
version: "1.0.0"
type: invalid
trigger: {}
`
      );

      await expect(loader.load(testDir)).rejects.toThrow(
        "Invalid type: invalid, must be knowledge/tool/hybrid"
      );
    });

    it("应该在无效 YAML 时抛出错误", async () => {
      await writeFile(join(testDir, "skill.yaml"), "invalid: yaml: content: [");

      await expect(loader.load(testDir)).rejects.toThrow(SkillLoadError);
      await expect(loader.load(testDir)).rejects.toThrow("Invalid YAML");
    });

    it("应该支持从文件路径加载", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: file-path-test
name: 文件路径测试
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      const instance = await loader.load(join(testDir, "skill.yaml"));
      expect(instance.config.id).toBe("file-path-test");
    });
  });

  describe("exists", () => {
    it("应该返回 true 当 skill.yaml 存在", async () => {
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: exists-test
name: 存在测试
version: "1.0.0"
type: knowledge
trigger: {}
`
      );

      const exists = await loader.exists(testDir);
      expect(exists).toBe(true);
    });

    it("应该返回 false 当 skill.yaml 不存在", async () => {
      const exists = await loader.exists("/nonexistent/path");
      expect(exists).toBe(false);
    });
  });
});
