/**
 * Skill Loader
 *
 * 负责从文件系统加载 skill.yaml 和 mcp.json 配置
 */

import { parse as parseYaml } from "yaml";
import { readFile, access } from "fs/promises";
import { join, dirname } from "path";
import type {
  SkillConfig,
  SkillInstance,
  MCPConfig,
  SkillActivationStatus,
  TriggerRule,
} from "./types";
import type { ToolDef } from "../tools/types";
import type { MCPBridge } from "../tools/mcp-bridge";
import { SKILL_CONFIG_FILE, DEFAULT_TRIGGER_RULE } from "./types";

/**
 * Skill 加载配置
 */
export interface SkillLoaderConfig {
  /** MCP Bridge 实例（用于加载工具） */
  mcpBridge?: MCPBridge;
}

/**
 * Skill 验证错误
 */
export class SkillLoadError extends Error {
  constructor(
    public readonly skillPath: string,
    public readonly reason: string,
  ) {
    super(`Failed to load skill from ${skillPath}: ${reason}`);
    this.name = "SkillLoadError";
  }
}

/**
 * 验证 Skill 配置完整性
 */
function validateSkillConfig(config: unknown, skillPath: string): SkillConfig {
  if (!config || typeof config !== "object") {
    throw new SkillLoadError(skillPath, "Invalid config: not an object");
  }

  const cfg = config as Record<string, unknown>;

  // 必填字段
  if (typeof cfg["id"] !== "string" || !cfg["id"]) {
    throw new SkillLoadError(skillPath, "Missing required field: id");
  }
  if (typeof cfg["name"] !== "string" || !cfg["name"]) {
    throw new SkillLoadError(skillPath, "Missing required field: name");
  }
  if (typeof cfg["version"] !== "string" || !cfg["version"]) {
    throw new SkillLoadError(skillPath, "Missing required field: version");
  }
  if (
    cfg["type"] !== "knowledge" &&
    cfg["type"] !== "tool" &&
    cfg["type"] !== "hybrid"
  ) {
    throw new SkillLoadError(
      skillPath,
      `Invalid type: ${String(cfg["type"])}, must be knowledge/tool/hybrid`,
    );
  }

  // 触发规则
  const trigger: TriggerRule = {
    ...DEFAULT_TRIGGER_RULE,
    ...(cfg["trigger"] as TriggerRule | undefined),
  };

  // 构建完整的 SkillConfig
  // 使用 Object.assign 避免 readonly 属性赋值问题
  // 类型已通过上方验证，TypeScript 自动 narrowing
  const baseConfig = {
    id: cfg["id"],
    name: cfg["name"],
    version: cfg["version"],
    type: cfg["type"],
    trigger,
  };

  // 构建可选属性对象
  const optionalProps: Record<string, unknown> = {};
  if (cfg["context"] !== undefined) {
    optionalProps["context"] = cfg["context"];
  }
  if (cfg["examples"] !== undefined) {
    optionalProps["examples"] = cfg["examples"];
  }
  if (cfg["tools"] !== undefined) {
    optionalProps["tools"] = cfg["tools"];
  }
  if (cfg["metadata"] !== undefined) {
    optionalProps["metadata"] = cfg["metadata"];
  }

  return Object.assign({}, baseConfig, optionalProps) as SkillConfig;
}

/**
 * 加载 MCP 配置
 */
async function loadMCPConfig(
  skillDir: string,
  mcpConfigPath: string,
): Promise<MCPConfig | undefined> {
  // 解析相对路径
  const fullPath = mcpConfigPath.startsWith("./")
    ? join(skillDir, mcpConfigPath)
    : mcpConfigPath;

  try {
    await access(fullPath);
  } catch {
    return undefined;
  }

  const content = await readFile(fullPath, "utf-8");
  const config = JSON.parse(content) as MCPConfig;

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    throw new Error(`Invalid MCP config: missing mcpServers`);
  }

  return config;
}

/**
 * Skill Loader
 *
 * 负责从目录加载 skill.yaml 并解析为 SkillInstance
 */
export class SkillLoader {
  private readonly mcpBridge: MCPBridge | undefined;

  constructor(config: SkillLoaderConfig = {}) {
    // 明确类型以避免 exactOptionalPropertyTypes 问题
    this.mcpBridge =
      config.mcpBridge === undefined ? undefined : config.mcpBridge;
  }

  /**
   * 加载 Skill
   *
   * @param skillPath - skill.yaml 文件路径或包含 skill.yaml 的目录
   * @returns Skill 实例
   */
  async load(skillPath: string): Promise<SkillInstance> {
    // 判断是文件还是目录
    let skillDir: string;
    let configFile: string;

    if (skillPath.endsWith(".yaml") || skillPath.endsWith(".yml")) {
      // 文件路径
      configFile = skillPath;
      skillDir = dirname(skillPath);
    } else {
      // 目录路径
      skillDir = skillPath;
      configFile = join(skillPath, SKILL_CONFIG_FILE);
    }

    // 读取 skill.yaml
    let yamlContent: string;
    try {
      yamlContent = await readFile(configFile, "utf-8");
    } catch (error) {
      throw new SkillLoadError(
        skillPath,
        `Cannot read ${SKILL_CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 解析 YAML
    let rawConfig: unknown;
    try {
      rawConfig = parseYaml(yamlContent);
    } catch (error) {
      throw new SkillLoadError(
        skillPath,
        `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 验证配置
    const config = validateSkillConfig(rawConfig, skillPath);

    // 加载 MCP 配置（如果有）
    let mcpConfig: MCPConfig | undefined;
    let toolDefs: readonly ToolDef[] = [];

    if (config.tools?.mcpConfig) {
      mcpConfig = await loadMCPConfig(skillDir, config.tools.mcpConfig);

      if (mcpConfig && this.mcpBridge) {
        // 连接 MCP Server 并获取工具列表
        try {
          await this.mcpBridge.connectFromConfig(mcpConfig);
          const tools = await this.mcpBridge.listAllTools();

          // 应用 include/exclude 过滤
          toolDefs = this.filterTools(tools, config.tools);
        } catch (error) {
          console.error(
            `Failed to load MCP tools for skill ${config.id}:`,
            error,
          );
        }
      }
    }

    const instance: SkillInstance = {
      config,
      toolDefs,
      status: "inactive" as SkillActivationStatus,
      loadedAt: Date.now(),
      ...(mcpConfig !== undefined && { mcpConfig }),
    };

    return instance;
  }

  /**
   * 过滤工具列表
   */
  private filterTools(
    tools: ToolDef[],
    binding: { include?: readonly string[]; exclude?: readonly string[] },
  ): readonly ToolDef[] {
    let filtered = tools;

    // 应用 include
    if (binding.include && binding.include.length > 0) {
      const includeSet = new Set(binding.include);
      filtered = filtered.filter((t) => includeSet.has(t.name));
    }

    // 应用 exclude
    if (binding.exclude && binding.exclude.length > 0) {
      const excludeSet = new Set(binding.exclude);
      filtered = filtered.filter((t) => !excludeSet.has(t.name));
    }

    return filtered;
  }

  /**
   * 检查 Skill 目录是否存在
   */
  async exists(skillPath: string): Promise<boolean> {
    const skillDir = skillPath.endsWith(".yaml")
      ? dirname(skillPath)
      : skillPath;
    const configFile = join(skillDir, SKILL_CONFIG_FILE);

    try {
      await access(configFile);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * 创建 Skill Loader 实例
 */
export function createSkillLoader(config?: SkillLoaderConfig): SkillLoader {
  return new SkillLoader(config);
}
