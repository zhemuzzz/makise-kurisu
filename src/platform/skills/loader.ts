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
  ToolBinding,
  ToolServerRef,
  VariableContext,
  SkillRequires,
} from "./types";
import type { ToolDef } from "../tools/types";
import type { MCPBridge } from "../tools/mcp-bridge";
import {
  SKILL_CONFIG_FILE,
  DEFAULT_TRIGGER_RULE,
  isToolBindingLegacy,
  isToolServerRef,
  isToolMultiServerRef,
} from "./types";
import { getMCPServerConfigLoader } from "./mcp-server-config";

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
 * 标准化 requires 字段
 *
 * 向后兼容：string[] 格式自动转换为 { skills: string[] }
 */
function normalizeRequires(raw: unknown): SkillRequires {
  // 旧格式：string[]
  if (Array.isArray(raw)) {
    return { skills: raw as string[] };
  }

  // 新格式：SkillRequires 对象
  if (raw && typeof raw === "object") {
    return raw as SkillRequires;
  }

  return {};
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
  if (cfg["requires"] !== undefined) {
    optionalProps["requires"] = normalizeRequires(cfg["requires"]);
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
   * @param variableContext - 变量上下文（可选，KURISU-026: 用于运行时变量替换）
   * @returns Skill 实例
   */
  async load(
    skillPath: string,
    variableContext?: VariableContext,
  ): Promise<SkillInstance> {
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

    if (config.tools) {
      // 根据不同的 ToolBinding 类型加载工具
      const loadResult = await this.loadToolBinding(
        config.tools,
        skillDir,
        variableContext,
      );
      mcpConfig = loadResult.mcpConfig;
      toolDefs = loadResult.toolDefs;
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
   * 加载工具绑定配置
   *
   * 支持三种方式：
   * 1. ToolBindingLegacy: { mcpConfig: "./mcp.json" } - 旧方式
   * 2. ToolServerRef: { server: "filesystem" } - 单 server 引用
   * 3. ToolMultiServerRef: { servers: [...] } - 多 server 引用
   */
  private async loadToolBinding(
    binding: ToolBinding,
    skillDir: string,
    variableContext?: VariableContext,
  ): Promise<{
    mcpConfig: MCPConfig | undefined;
    toolDefs: readonly ToolDef[];
  }> {
    if (isToolBindingLegacy(binding)) {
      return this.loadLegacyBinding(binding, skillDir);
    } else if (isToolServerRef(binding)) {
      return this.loadServerRefBinding(binding, variableContext);
    } else if (isToolMultiServerRef(binding)) {
      return this.loadMultiServerRefBinding(binding, variableContext);
    }

    // 未知的 binding 类型
    console.warn(`Unknown tool binding type: ${JSON.stringify(binding)}`);
    return { mcpConfig: undefined, toolDefs: [] };
  }

  /**
   * 加载旧方式的工具绑定（mcpConfig 文件路径）
   */
  private async loadLegacyBinding(
    binding: {
      readonly mcpConfig: string;
      readonly include?: readonly string[];
      readonly exclude?: readonly string[];
    },
    skillDir: string,
  ): Promise<{
    mcpConfig: MCPConfig | undefined;
    toolDefs: readonly ToolDef[];
  }> {
    const mcpConfig = await loadMCPConfig(skillDir, binding.mcpConfig);

    if (!mcpConfig || !this.mcpBridge) {
      return { mcpConfig, toolDefs: [] };
    }

    // 连接 MCP Server 并获取工具列表
    try {
      await this.mcpBridge.connectFromConfig(mcpConfig);

      const skillServerNames = Object.keys(mcpConfig.mcpServers);
      const toolsPerServer = await Promise.all(
        skillServerNames.map((name) =>
          this.mcpBridge!.listTools(name).catch(() => [] as ToolDef[]),
        ),
      );
      const tools = toolsPerServer.flat();

      const toolDefs = this.filterTools(tools, binding);
      return { mcpConfig, toolDefs };
    } catch (error) {
      console.error(`Failed to load legacy MCP tools:`, error);
      return { mcpConfig, toolDefs: [] };
    }
  }

  /**
   * 加载单 server 引用的工具绑定
   *
   * KURISU-026: 支持 VariableContext，使用 getResolvedServerConfig 替代 getServerConfig
   */
  private async loadServerRefBinding(
    binding: ToolServerRef,
    variableContext?: VariableContext,
  ): Promise<{
    mcpConfig: MCPConfig | undefined;
    toolDefs: readonly ToolDef[];
  }> {
    const loader = getMCPServerConfigLoader();
    // 无 variableContext 时使用默认上下文（process.cwd()），确保运行时变量有有效值
    const effectiveContext: VariableContext = variableContext ?? {
      runtimeVars: { WORKING_DIR: process.cwd() },
    };
    const serverConfig = await loader.getResolvedServerConfig(
      binding.server,
      effectiveContext,
    );

    if (!serverConfig) {
      console.warn(`Server not found in global config: ${binding.server}`);
      return { mcpConfig: undefined, toolDefs: [] };
    }

    const mcpConfig: MCPConfig = {
      mcpServers: { [binding.server]: serverConfig },
    };

    if (!this.mcpBridge) {
      return { mcpConfig, toolDefs: [] };
    }

    // 连接 MCP Server 并获取工具列表
    try {
      await this.mcpBridge.connectFromConfig(mcpConfig);
      const tools = await this.mcpBridge
        .listTools(binding.server)
        .catch(() => [] as ToolDef[]);
      const toolDefs = this.filterTools(tools, binding);
      return { mcpConfig, toolDefs };
    } catch (error) {
      console.error(
        `Failed to load server ref tools for ${binding.server}:`,
        error,
      );
      return { mcpConfig, toolDefs: [] };
    }
  }

  /**
   * 加载多 server 引用的工具绑定
   *
   * KURISU-026: 支持 VariableContext，使用 getResolvedServerConfigs 替代 getServerConfigs
   */
  private async loadMultiServerRefBinding(
    binding: {
      readonly servers: readonly ToolServerRef[];
    },
    variableContext?: VariableContext,
  ): Promise<{
    mcpConfig: MCPConfig | undefined;
    toolDefs: readonly ToolDef[];
  }> {
    const loader = getMCPServerConfigLoader();
    const allServerNames = binding.servers.map((s) => s.server);
    const mcpConfig = variableContext
      ? await loader.getResolvedServerConfigs(allServerNames, variableContext)
      : await loader.getServerConfigs(allServerNames);

    if (Object.keys(mcpConfig.mcpServers).length === 0) {
      console.warn(`No servers found for multi-server binding`);
      return { mcpConfig: undefined, toolDefs: [] };
    }

    if (!this.mcpBridge) {
      return { mcpConfig, toolDefs: [] };
    }

    // 连接所有 MCP Servers 并获取工具列表
    try {
      await this.mcpBridge.connectFromConfig(mcpConfig);

      // 对每个 server 引用，获取并过滤工具
      const allToolDefs: ToolDef[] = [];
      for (const serverRef of binding.servers) {
        const tools = await this.mcpBridge.listTools(serverRef.server).catch(
          () => [] as ToolDef[],
        );
        const filtered = this.filterTools(tools, serverRef);
        allToolDefs.push(...filtered);
      }

      return { mcpConfig, toolDefs: allToolDefs };
    } catch (error) {
      console.error(`Failed to load multi-server tools:`, error);
      return { mcpConfig, toolDefs: [] };
    }
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
