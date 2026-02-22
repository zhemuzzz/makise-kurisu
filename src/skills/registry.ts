/**
 * Skill Registry
 *
 * Skill 注册表，管理已加载的 Skills
 */

import { readdir } from "fs/promises";
import { join } from "path";
import type {
  SkillInstance,
  IntentMatchResult,
  ISkillRegistry,
  SkillActivationStatus,
} from "./types";
import type { ToolDef } from "../tools/types";
import type { MCPBridge } from "../tools/mcp-bridge";
import { SkillLoader, createSkillLoader } from "./loader";
import {
  KnowledgeInjector,
  createKnowledgeInjector,
} from "./knowledge-injector";

/**
 * Skill Registry 配置
 */
export interface SkillRegistryConfig {
  /** MCP Bridge 实例 */
  mcpBridge?: MCPBridge;
  /** Skills 目录路径 */
  skillsDir?: string;
}

/**
 * Skill Registry
 *
 * 实现 ISkillRegistry 接口，提供：
 * - Skill 加载/卸载
 * - 意图匹配
 * - Skill 激活
 * - 工具聚合
 */
export class SkillRegistry implements ISkillRegistry {
  private skills: Map<string, SkillInstance> = new Map();
  private loader: SkillLoader;
  private injector: KnowledgeInjector;

  constructor(config: SkillRegistryConfig = {}) {
    this.loader = createSkillLoader(
      config.mcpBridge ? { mcpBridge: config.mcpBridge } : undefined,
    );
    this.injector = createKnowledgeInjector();
  }

  /**
   * 加载 Skill
   */
  async load(skillPath: string): Promise<SkillInstance> {
    const instance = await this.loader.load(skillPath);

    // 检查是否已存在
    if (this.skills.has(instance.config.id)) {
      console.warn(`Skill ${instance.config.id} already loaded, replacing`);
    }

    this.skills.set(instance.config.id, instance);
    return instance;
  }

  /**
   * 从目录加载所有 Skills
   */
  async loadFromDirectory(skillsDir: string): Promise<SkillInstance[]> {
    let entries: string[];
    try {
      entries = await readdir(skillsDir);
    } catch {
      console.warn(`Skills directory not found: ${skillsDir}`);
      return [];
    }

    const loaded: SkillInstance[] = [];

    for (const entry of entries) {
      const skillPath = join(skillsDir, entry);
      try {
        const instance = await this.load(skillPath);
        loaded.push(instance);
      } catch (error) {
        console.error(`Failed to load skill ${entry}:`, error);
      }
    }

    return loaded;
  }

  /**
   * 卸载 Skill
   */
  async unload(skillId: string): Promise<void> {
    const instance = this.skills.get(skillId);
    if (!instance) return;

    // TODO: 断开 MCP 连接（如果有）

    this.skills.delete(skillId);
  }

  /**
   * 获取 Skill
   */
  get(skillId: string): SkillInstance | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 列出所有 Skills
   */
  list(): readonly SkillInstance[] {
    return Array.from(this.skills.values());
  }

  /**
   * 匹配意图
   */
  matchIntent(input: string): IntentMatchResult[] {
    const results: IntentMatchResult[] = [];

    for (const skill of this.list()) {
      const result = this.matchSkillInput(input, skill);
      if (result) {
        results.push(result);
      }
    }

    // 按置信度降序排序
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 匹配用户输入与单个 Skill
   */
  private matchSkillInput(
    input: string,
    skill: SkillInstance,
  ): IntentMatchResult | null {
    const trigger = skill.config.trigger;
    const normalizedInput = input.toLowerCase();

    // 1. 关键词匹配
    if (trigger.keywords) {
      for (const keyword of trigger.keywords) {
        if (normalizedInput.includes(keyword.toLowerCase())) {
          return {
            skillId: skill.config.id,
            confidence: 0.7,
            reason: "keyword",
            matched: keyword,
          };
        }
      }
    }

    // 2. 意图匹配
    if (trigger.intent) {
      for (const intent of trigger.intent) {
        if (normalizedInput.includes(intent.toLowerCase())) {
          return {
            skillId: skill.config.id,
            confidence: 0.8,
            reason: "intent",
            matched: intent,
          };
        }
      }
    }

    // 3. 正则匹配
    if (trigger.patterns) {
      for (const pattern of trigger.patterns) {
        try {
          const regex = new RegExp(pattern, "i");
          if (regex.test(input)) {
            return {
              skillId: skill.config.id,
              confidence: 0.9,
              reason: "pattern",
              matched: pattern,
            };
          }
        } catch {
          // 无效正则，跳过
        }
      }
    }

    return null;
  }

  /**
   * 激活 Skills
   */
  async activate(skillIds: readonly string[]): Promise<void> {
    for (const skillId of skillIds) {
      const instance = this.skills.get(skillId);
      if (!instance) {
        console.warn(`Skill not found: ${skillId}`);
        continue;
      }

      // 更新状态
      const activatedInstance: SkillInstance = {
        ...instance,
        status: "active" as SkillActivationStatus,
      };
      this.skills.set(skillId, activatedInstance);
    }
  }

  /**
   * 停用 Skills
   */
  async deactivate(skillIds: readonly string[]): Promise<void> {
    for (const skillId of skillIds) {
      const instance = this.skills.get(skillId);
      if (!instance) continue;

      const deactivatedInstance: SkillInstance = {
        ...instance,
        status: "inactive" as SkillActivationStatus,
      };
      this.skills.set(skillId, deactivatedInstance);
    }
  }

  /**
   * 获取激活的 Skills
   */
  getActiveSkills(): readonly SkillInstance[] {
    return this.list().filter((s) => s.status === "active");
  }

  /**
   * 获取所有可用工具
   */
  getAvailableTools(): readonly ToolDef[] {
    const tools: ToolDef[] = [];
    const seenTools = new Set<string>();

    for (const skill of this.getActiveSkills()) {
      for (const tool of skill.toolDefs) {
        if (!seenTools.has(tool.name)) {
          seenTools.add(tool.name);
          tools.push(tool);
        }
      }
    }

    return tools;
  }

  /**
   * 构建知识注入内容
   */
  buildKnowledgeInjection(): string {
    return this.injector.inject(this.getActiveSkills());
  }

  /**
   * 构建工具定义（用于 function calling）
   */
  buildToolDefinitions(): readonly {
    name: string;
    description: string;
    parameters: unknown;
  }[] {
    return this.injector.buildToolDefinitions(this.getActiveSkills());
  }
}

/**
 * 创建 Skill Registry 实例
 */
export function createSkillRegistry(
  config?: SkillRegistryConfig,
): SkillRegistry {
  return new SkillRegistry(config ?? {});
}
