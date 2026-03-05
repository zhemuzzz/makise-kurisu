/**
 * Skill Registry
 *
 * Skill 注册表，管理已加载的 Skills
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import type {
  SkillInstance,
  IntentMatchResult,
  ISkillRegistry,
  SkillActivationStatus,
  VariableContext,
  SkillRequires,
} from "./types.js";
import type { ToolDef } from "../tools/types.js";
import type { MCPBridge } from "../tools/mcp-bridge.js";
import type { ISkillIntentClassifier } from "./intent-classifier.js";
import type { IModel } from "../models/types.js";
import { SkillLoader, createSkillLoader } from "./loader.js";
import {
  KnowledgeInjector,
  createKnowledgeInjector,
} from "./knowledge-injector.js";
import { SKILL_MAX_RETRIES, SKILL_RETRY_BASE_DELAY_MS } from "./types.js";
// TODO: KURISU-035 Phase 3+ — IntentMatcher and EmbeddingCache will be reimplemented

/**
 * Skill Registry 配置
 */
export interface SkillRegistryConfig {
  /** MCP Bridge 实例 */
  mcpBridge?: MCPBridge;
  /** Skills 目录路径 */
  skillsDir?: string;
  /** LLM 意图分类器（可选，Skill 加载时自动注册意图） */
  llmClassifier?: ISkillIntentClassifier;
  /** Embedding 模型（可选，启用语义匹配） */
  embeddingModel?: IModel;
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
  private mcpBridge: MCPBridge | undefined;
  private llmClassifier: ISkillIntentClassifier | undefined;

  constructor(config: SkillRegistryConfig = {}) {
    if (config.mcpBridge) {
      this.mcpBridge = config.mcpBridge;
    }
    if (config.llmClassifier) {
      this.llmClassifier = config.llmClassifier;
    }

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

    // Note: 意图分类器通过 ISkillRegistry 引用直接读取 Skills，无需单独注册

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
   *
   * 当 Skill 被卸载时，会检查其使用的 MCP Server：
   * - 如果没有其他 Skill 也在使用该 MCP Server，则断开连接
   * - 如果有其他 Skill 也在使用，则保持连接
   */
  async unload(skillId: string): Promise<void> {
    const instance = this.skills.get(skillId);
    if (!instance) return;

    // 断开此 Skill 的 MCP 连接（如果没有其他 Skill 也在用）
    if (instance.mcpConfig && this.mcpBridge) {
      for (const serverName of Object.keys(instance.mcpConfig.mcpServers)) {
        // 检查是否有其他 Skill 也在使用这个 MCP Server
        const otherUsers = this.list().filter(
          (s) => s.config.id !== skillId && s.mcpConfig?.mcpServers[serverName],
        );

        // 只有当没有其他 Skill 使用时才断开连接
        if (otherUsers.length === 0) {
          await this.mcpBridge.disconnect(serverName);
        }
      }
    }

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
   *
   * 2 级分类:
   * - L1: 命令匹配 (trigger.commands)
   * - L2: LLM 分类 (通过 llmClassifier，如果配置了)
   *
   * KURISU-039 Phase 2: 实现 2 级意图分类
   */
  matchIntent(input: string): IntentMatchResult[] {
    const results: IntentMatchResult[] = [];
    const normalizedInput = input.toLowerCase().trim();

    // L1: 命令匹配 (trigger.commands)
    for (const skill of this.list()) {
      const commands = skill.config.trigger.commands ?? [];
      for (const command of commands) {
        if (normalizedInput.startsWith(command.toLowerCase())) {
          results.push({
            skillId: skill.config.id,
            confidence: 0.95, // 命令匹配高置信度
            reason: "command",
            matched: command,
          });
          break; // 每个 Skill 只匹配一次
        }
      }
    }

    // L2: LLM 分类 (如果配置了 llmClassifier 且 L1 未匹配)
    if (results.length === 0 && this.llmClassifier) {
      const llmResult = this.llmClassifier.classify(input);
      // 将 SkillMatch 转换为 IntentMatchResult
      for (const match of llmResult.matches) {
        if (match.confidence > 0.6) {
          const base = {
            skillId: match.skillId,
            confidence: match.confidence,
            reason: (match.reason === "command" ? "command" : "intent") as IntentMatchResult["reason"],
          };
          const result: IntentMatchResult = match.matched
            ? { ...base, matched: match.matched }
            : base;
          results.push(result);
        }
      }
    }

    // 按置信度排序
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 激活 Skills
   *
   * 激活前检查环境依赖（bins/env/os gate）
   */
  async activate(skillIds: readonly string[]): Promise<void> {
    for (const skillId of skillIds) {
      const instance = this.skills.get(skillId);
      if (!instance) {
        console.warn(`Skill not found: ${skillId}`);
        continue;
      }

      // 检查环境依赖 gate
      const gateResult = checkGate(instance.config.requires);
      if (!gateResult.passed) {
        const errorInstance: SkillInstance = {
          ...instance,
          status: "error" as SkillActivationStatus,
          error: `Gate check failed: ${gateResult.reason}`,
        };
        this.skills.set(skillId, errorInstance);
        console.warn(
          `Skill ${skillId} gate check failed: ${gateResult.reason}`,
        );
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
   * 重试处于 error 状态的 Skill
   *
   * 最多重试 SKILL_MAX_RETRIES 次，指数退避
   * @returns 重试成功的 Skill ID 列表
   */
  async retryErrorSkills(): Promise<readonly string[]> {
    const retried: string[] = [];
    const now = Date.now();

    for (const [skillId, instance] of this.skills) {
      if (instance.status !== "error") continue;

      const retryCount = instance.retryCount ?? 0;
      if (retryCount >= SKILL_MAX_RETRIES) continue;

      // 指数退避检查
      const lastErrorAt = instance.lastErrorAt ?? 0;
      const delayMs = SKILL_RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
      if (now - lastErrorAt < delayMs) continue;

      // 重置为 inactive 并增加重试计数
      const { error: _, ...restInstance } = instance;
      const resetInstance: SkillInstance = {
        ...restInstance,
        status: "inactive" as SkillActivationStatus,
        retryCount: retryCount + 1,
        lastErrorAt: now,
      };
      this.skills.set(skillId, resetInstance);

      // 尝试重新激活
      await this.activate([skillId]);

      const updated = this.skills.get(skillId);
      if (updated?.status === "active") {
        retried.push(skillId);
      }
    }

    return retried;
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
   * 确保 Skill 的 MCP 工具已使用正确的变量上下文连接
   *
   * KURISU-026: 当会话有自定义工作目录时，确保 Skill 引用的 MCP Server
   * 使用解析后的配置（包含正确的 ${WORKING_DIR}）进行连接。
   *
   * 注意：对于已通过 MCPWorkDirSync 重启的 Server，此方法是无操作（幂等）。
   * 主要用于 Skill 首次激活时，确保新连接的 Server 使用正确的工作目录。
   *
   * @param skillId - Skill ID
   * @param context - 变量上下文
   */
  async ensureToolsLoaded(
    skillId: string,
    _context: VariableContext,
  ): Promise<void> {
    const instance = this.skills.get(skillId);
    if (!instance) return;

    // 只有有 MCP 配置的 Skill 需要处理
    if (!instance.mcpConfig || !this.mcpBridge) return;

    // 通过 MCPBridge.connectFromConfig 重新连接
    // connectFromConfig 内部有连接池检查，已连接的 Server 会跳过
    try {
      await this.mcpBridge.connectFromConfig(instance.mcpConfig);
    } catch {
      // 连接失败时保持现有状态不变
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

// ============================================
// Gate Checking
// ============================================

interface GateResult {
  readonly passed: boolean;
  readonly reason?: string;
}

/**
 * 检查 Skill 环境依赖 gate
 *
 * 检查顺序：os → bins → env
 */
function checkGate(requires?: SkillRequires): GateResult {
  if (!requires) return { passed: true };

  // OS gate
  if (requires.os && requires.os.length > 0) {
    if (!requires.os.includes(process.platform)) {
      return {
        passed: false,
        reason: `OS not supported: ${process.platform}, requires: ${requires.os.join(", ")}`,
      };
    }
  }

  // Bins gate — all must exist in PATH
  if (requires.bins && requires.bins.length > 0) {
    for (const bin of requires.bins) {
      if (!isBinAvailable(bin)) {
        return {
          passed: false,
          reason: `Required binary not found in PATH: ${bin}`,
        };
      }
    }
  }

  // Env gate — all must be defined
  if (requires.env && requires.env.length > 0) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        return {
          passed: false,
          reason: `Required environment variable not set: ${envVar}`,
        };
      }
    }
  }

  return { passed: true };
}

/**
 * 检查可执行文件是否在 PATH 中
 */
function isBinAvailable(bin: string): boolean {
  try {
    const cmd = process.platform === "win32" ? `where ${bin}` : `which ${bin}`;
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
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
