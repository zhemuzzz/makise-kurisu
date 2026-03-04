/**
 * Skill Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { SkillRegistry, createSkillRegistry } from "../../../src/platform/skills/registry";
import type { MCPBridge } from "../../../src/platform/tools/mcp-bridge";

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
`,
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
`,
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
`,
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
`,
      );

      await writeFile(
        join(skill2Dir, "skill.yaml"),
        `
id: skill-2
name: 技能2
version: "1.0.0"
type: knowledge
trigger: {}
`,
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
`,
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

  // NOTE: matchIntent keyword matching was v1 IntentMatcher behavior,
  // replaced by Phase 3c IntentClassifier. Tests removed.

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
`,
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
      await expect(registry.activate(["nonexistent"])).resolves.toBeUndefined();
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
`,
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
`,
      );

      await registry.load(testDir);
      await registry.activate(["injection-test"]);

      const injection = registry.buildKnowledgeInjection();

      expect(injection).toContain("这是测试上下文");
    });
  });

  describe("unload with MCP cleanup", () => {
    it("应该在卸载 Skill 时断开无其他使用者的 MCP Server", async () => {
      // 创建 mock MCPBridge
      const mockMCPBridge = {
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as MCPBridge;

      // 使用 mock MCPBridge 创建 registry
      registry = createSkillRegistry({ mcpBridge: mockMCPBridge });

      // 创建带有 MCP 配置的 Skill
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: skill-with-mcp
name: MCP技能
version: "1.0.0"
type: tool
trigger: {}
`,
      );

      // 手动添加一个带有 MCP 配置的 SkillInstance
      const instance = await registry.load(testDir);

      // 使用 Object.assign 添加 mcpConfig（因为是 readonly）
      const instanceWithMCP = Object.assign({}, instance, {
        mcpConfig: {
          mcpServers: {
            "test-server": {
              command: "node",
              args: ["test.js"],
            },
          },
        },
      });

      // 替换 registry 中的实例
      (
        registry as unknown as { skills: Map<string, typeof instanceWithMCP> }
      ).skills.set("skill-with-mcp", instanceWithMCP);

      // 卸载 Skill
      await registry.unload("skill-with-mcp");

      // 应该调用 disconnect
      expect(mockMCPBridge.disconnect).toHaveBeenCalledWith("test-server");
      expect(mockMCPBridge.disconnect).toHaveBeenCalledTimes(1);

      // Skill 应该被移除
      expect(registry.get("skill-with-mcp")).toBeUndefined();
    });

    it("应该在卸载 Skill 时保持有其他使用者的 MCP Server 连接", async () => {
      // 创建 mock MCPBridge
      const mockMCPBridge = {
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as MCPBridge;

      // 使用 mock MCPBridge 创建 registry
      registry = createSkillRegistry({ mcpBridge: mockMCPBridge });

      // 创建两个使用相同 MCP Server 的 Skills
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
type: tool
trigger: {}
`,
      );

      await writeFile(
        join(skill2Dir, "skill.yaml"),
        `
id: skill-2
name: 技能2
version: "1.0.0"
type: tool
trigger: {}
`,
      );

      // 加载两个 Skills
      const instance1 = await registry.load(skill1Dir);
      const instance2 = await registry.load(skill2Dir);

      // 为两个实例添加相同的 MCP 配置
      const mcpConfig = {
        mcpServers: {
          "shared-server": {
            command: "node",
            args: ["shared.js"],
          },
        },
      };

      const instance1WithMCP = Object.assign({}, instance1, { mcpConfig });
      const instance2WithMCP = Object.assign({}, instance2, { mcpConfig });

      // 替换 registry 中的实例
      (
        registry as unknown as { skills: Map<string, typeof instance1WithMCP> }
      ).skills.set("skill-1", instance1WithMCP);
      (
        registry as unknown as { skills: Map<string, typeof instance2WithMCP> }
      ).skills.set("skill-2", instance2WithMCP);

      // 卸载第一个 Skill
      await registry.unload("skill-1");

      // 不应该调用 disconnect（因为 skill-2 也在使用）
      expect(mockMCPBridge.disconnect).not.toHaveBeenCalled();

      // 第一个 Skill 应该被移除
      expect(registry.get("skill-1")).toBeUndefined();

      // 第二个 Skill 应该仍然存在
      expect(registry.get("skill-2")).toBeDefined();
    });

    it("应该在卸载 Skill 时正确处理多个 MCP Server", async () => {
      // 创建 mock MCPBridge
      const mockMCPBridge = {
        disconnect: vi.fn().mockResolvedValue(undefined),
      } as unknown as MCPBridge;

      // 使用 mock MCPBridge 创建 registry
      registry = createSkillRegistry({ mcpBridge: mockMCPBridge });

      // 创建带有多个 MCP Server 的 Skill
      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: multi-mcp-skill
name: 多MCP技能
version: "1.0.0"
type: tool
trigger: {}
`,
      );

      const instance = await registry.load(testDir);

      // 添加多个 MCP Server 配置
      const instanceWithMCP = Object.assign({}, instance, {
        mcpConfig: {
          mcpServers: {
            "server-a": {
              command: "node",
              args: ["a.js"],
            },
            "server-b": {
              command: "node",
              args: ["b.js"],
            },
          },
        },
      });

      (
        registry as unknown as { skills: Map<string, typeof instanceWithMCP> }
      ).skills.set("multi-mcp-skill", instanceWithMCP);

      // 卸载 Skill
      await registry.unload("multi-mcp-skill");

      // 应该对每个 server 调用 disconnect
      expect(mockMCPBridge.disconnect).toHaveBeenCalledTimes(2);
      expect(mockMCPBridge.disconnect).toHaveBeenCalledWith("server-a");
      expect(mockMCPBridge.disconnect).toHaveBeenCalledWith("server-b");
    });

    it("应该在没有 MCPBridge 时正常卸载", async () => {
      // 不使用 MCPBridge 创建 registry（默认行为）
      registry = createSkillRegistry();

      await writeFile(
        join(testDir, "skill.yaml"),
        `
id: no-mcp-skill
name: 无MCP技能
version: "1.0.0"
type: knowledge
trigger: {}
`,
      );

      await registry.load(testDir);
      expect(registry.get("no-mcp-skill")).toBeDefined();

      // 卸载应该成功，不抛出错误
      await expect(registry.unload("no-mcp-skill")).resolves.toBeUndefined();
      expect(registry.get("no-mcp-skill")).toBeUndefined();
    });
  });

  // ============================================
  // KURISU-027: 自动注册意图到 LLM 分类器
  // ============================================

  describe('T1.7: SkillRegistry 加载时自动注册意图到 LLM 分类器', () => {
    it('应该在加载 Skill 时自动注册意图', async () => {
      const mockLLMClassifier = {
        registerIntent: vi.fn().mockReturnThis(),
        getIntentCount: vi.fn().mockReturnValue(1),
      };

      registry = createSkillRegistry({
        llmClassifier: mockLLMClassifier as any,
      });

      await writeFile(
        join(testDir, 'skill.yaml'),
        `
id: test-intent-register
name: 测试意图注册
version: "1.0.0"
type: hybrid
trigger:
  keywords:
    - 测试
    - 搜索
  intent:
    - search
    - lookup
`,
      );

      await registry.load(testDir);

      // 应该调用 registerIntent，使用 intent 字段作为 examples
      expect(mockLLMClassifier.registerIntent).toHaveBeenCalledWith({
        type: 'test-intent-register',
        description: '测试意图注册',
        actions: [],
        examples: ['search', 'lookup'],
      });
    });

    it('应该在没有 intent 字段时使用 keywords 作为 examples', async () => {
      const mockLLMClassifier = {
        registerIntent: vi.fn().mockReturnThis(),
        getIntentCount: vi.fn().mockReturnValue(1),
      };

      registry = createSkillRegistry({
        llmClassifier: mockLLMClassifier as any,
      });

      await writeFile(
        join(testDir, 'skill.yaml'),
        `
id: keyword-only-skill
name: 仅关键词
version: "1.0.0"
type: hybrid
trigger:
  keywords:
    - 天气
    - 查询
`,
      );

      await registry.load(testDir);

      expect(mockLLMClassifier.registerIntent).toHaveBeenCalledWith({
        type: 'keyword-only-skill',
        description: '仅关键词',
        actions: [],
        examples: ['天气', '查询'],
      });
    });

    it('应该在没有 llmClassifier 时正常加载（不注册）', async () => {
      // 默认不传 llmClassifier
      registry = createSkillRegistry();

      await writeFile(
        join(testDir, 'skill.yaml'),
        `
id: no-llm-skill
name: 无LLM
version: "1.0.0"
type: knowledge
trigger:
  keywords:
    - 测试
`,
      );

      // 不应该报错
      const instance = await registry.load(testDir);
      expect(instance.config.id).toBe('no-llm-skill');
    });

    it('应该在 trigger 无 keywords 和 intent 时跳过注册', async () => {
      const mockLLMClassifier = {
        registerIntent: vi.fn().mockReturnThis(),
        getIntentCount: vi.fn().mockReturnValue(0),
      };

      registry = createSkillRegistry({
        llmClassifier: mockLLMClassifier as any,
      });

      await writeFile(
        join(testDir, 'skill.yaml'),
        `
id: empty-trigger-skill
name: 空触发器
version: "1.0.0"
type: tool
trigger: {}
`,
      );

      await registry.load(testDir);

      // 没有 examples，不应该注册
      expect(mockLLMClassifier.registerIntent).not.toHaveBeenCalled();
    });
  });

  // NOTE: KURISU-028 Embedding integration was v1 EmbeddingCache behavior,
  // replaced by Phase 3c KnowledgeStore + VectorStore. Tests removed.
});
