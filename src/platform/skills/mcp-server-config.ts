/**
 * Global MCP Server Configuration Loader
 *
 * 加载 config/mcp-servers.yaml 中定义的全局 MCP Server 配置
 * 支持：
 * 1. 单例模式（全局只加载一次）
 * 2. 两阶段变量替换：
 *    - Stage 1（load 时）：替换静态环境变量（跳过运行时变量）
 *    - Stage 2（resolveForSession 时）：替换运行时变量（WORKING_DIR、SESSION_ID）
 * 3. Server 配置查询
 */

import { parse as parseYaml } from "yaml";
import { readFile, access } from "fs/promises";
import type {
  MCPServerConfig,
  MCPStdioServerConfig,
  MCPConfig,
  VariableContext,
} from "./types.js";

/**
 * 全局 MCP Servers 配置文件格式
 */
export interface GlobalMCPServersConfig {
  readonly servers: Record<string, MCPServerConfig>;
}

/**
 * 默认配置文件路径（相对于项目根目录）
 */
const DEFAULT_CONFIG_PATH = "config/mcp-servers.yaml";

/**
 * 运行时变量白名单
 *
 * 这些变量在 Stage 1（全局加载）时被跳过，
 * 在 Stage 2（按会话解析）时才替换
 */
const RUNTIME_VARIABLES = new Set(["WORKING_DIR", "SESSION_ID"]);

/**
 * 全局 MCP Server 配置加载器
 *
 * 单例模式，全局只加载一次
 */
export class MCPServerConfigLoader {
  private static instance: MCPServerConfigLoader | undefined;
  private config: GlobalMCPServersConfig | undefined;
  private readonly configPath: string;

  private constructor(configPath: string) {
    this.configPath = configPath;
  }

  /**
   * 获取单例实例
   *
   * @param configPath - 配置文件路径（默认 config/mcp-servers.yaml）
   */
  static getInstance(configPath?: string): MCPServerConfigLoader {
    // 如果提供了不同的路径，重新创建实例
    if (
      !MCPServerConfigLoader.instance ||
      (configPath && configPath !== MCPServerConfigLoader.instance.configPath)
    ) {
      MCPServerConfigLoader.instance = new MCPServerConfigLoader(
        configPath ?? DEFAULT_CONFIG_PATH,
      );
    }
    return MCPServerConfigLoader.instance;
  }

  /**
   * 重置单例（用于测试）
   */
  static resetInstance(): void {
    MCPServerConfigLoader.instance = undefined;
  }

  /**
   * 加载配置文件（Stage 1：替换静态环境变量，保留运行时变量）
   */
  async load(): Promise<GlobalMCPServersConfig> {
    if (this.config) {
      return this.config;
    }

    // 检查文件是否存在
    try {
      await access(this.configPath);
    } catch {
      // 文件不存在，返回空配置
      this.config = { servers: {} };
      return this.config;
    }

    // 读取文件
    const content = await readFile(this.configPath, "utf-8");
    const rawConfig = parseYaml(content) as unknown;

    // 验证配置格式
    if (!rawConfig || typeof rawConfig !== "object") {
      throw new Error(`Invalid MCP servers config: not an object`);
    }

    const cfg = rawConfig as Record<string, unknown>;
    if (!cfg["servers"] || typeof cfg["servers"] !== "object") {
      throw new Error(`Invalid MCP servers config: missing servers field`);
    }

    // Stage 1: 替换静态环境变量（跳过 RUNTIME_VARIABLES）
    const servers = this.processServerConfigs(
      cfg["servers"] as Record<string, MCPServerConfig>,
    );

    this.config = { servers };
    return this.config;
  }

  /**
   * 获取指定 server 的配置（Stage 1 缓存版本，含运行时变量占位符）
   *
   * @param serverName - Server 名称
   * @returns Server 配置，不存在则返回 undefined
   */
  async getServerConfig(
    serverName: string,
  ): Promise<MCPServerConfig | undefined> {
    const config = await this.load();
    return config.servers[serverName];
  }

  /**
   * 获取指定 server 的配置（Stage 2：解析运行时变量后）
   *
   * @param serverName Server 名称
   * @param context 变量上下文（含运行时变量）
   */
  async getResolvedServerConfig(
    serverName: string,
    context: VariableContext,
  ): Promise<MCPServerConfig | undefined> {
    const config = await this.getServerConfig(serverName);
    if (!config) {
      return undefined;
    }
    return this.resolveRuntimeVars(config, context);
  }

  /**
   * 获取多个 server 的配置（Stage 1 缓存版本）
   *
   * @param serverNames - Server 名称列表
   * @returns MCPConfig 格式的配置（用于 MCPBridge.connectFromConfig）
   */
  async getServerConfigs(serverNames: readonly string[]): Promise<MCPConfig> {
    const config = await this.load();
    const mcpServers: Record<string, MCPServerConfig> = {};

    for (const name of serverNames) {
      const serverConfig = config.servers[name];
      if (serverConfig) {
        mcpServers[name] = serverConfig;
      }
    }

    return { mcpServers };
  }

  /**
   * 获取多个 server 的配置（Stage 2：解析运行时变量后）
   */
  async getResolvedServerConfigs(
    serverNames: readonly string[],
    context: VariableContext,
  ): Promise<MCPConfig> {
    const configs = await this.getServerConfigs(serverNames);
    const mcpServers: Record<string, MCPServerConfig> = {};

    for (const [name, config] of Object.entries(configs.mcpServers)) {
      mcpServers[name] = this.resolveRuntimeVars(config, context);
    }

    return { mcpServers };
  }

  /**
   * 获取受工作目录影响的 server 名称列表
   *
   * 扫描每个 server 的 args、cwd、env 字段，
   * 检查是否包含 ${WORKING_DIR} 变量
   */
  async getWorkDirDependentServers(): Promise<string[]> {
    const config = await this.load();
    const dependent: string[] = [];

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      if (this.containsVariable(serverConfig, "WORKING_DIR")) {
        dependent.push(name);
      }
    }

    return dependent;
  }

  /**
   * 列出所有可用的 server 名称
   */
  async listServerNames(): Promise<string[]> {
    const config = await this.load();
    return Object.keys(config.servers);
  }

  /**
   * 重新加载配置（用于热更新）
   */
  async reload(): Promise<GlobalMCPServersConfig> {
    this.config = undefined;
    return this.load();
  }

  // ============================================
  // Stage 1: 静态环境变量替换
  // ============================================

  /**
   * 处理所有 server 配置的 Stage 1 变量替换
   *
   * 替换 args、cwd、env 中的静态环境变量，跳过运行时变量
   */
  private processServerConfigs(
    servers: Record<string, MCPServerConfig>,
  ): Record<string, MCPServerConfig> {
    const result: Record<string, MCPServerConfig> = {};

    for (const [name, serverConfig] of Object.entries(servers)) {
      result[name] = this.processServerConfig(serverConfig);
    }

    return result;
  }

  /**
   * 处理单个 server 配置的 Stage 1 变量替换
   */
  private processServerConfig(config: MCPServerConfig): MCPServerConfig {
    // HTTP 类型无需变量替换，直接返回
    if ("type" in config && config.type === "http") {
      return config;
    }

    const stdioConfig = config as MCPStdioServerConfig;
    return {
      command: stdioConfig.command,
      ...(stdioConfig.args
        ? { args: stdioConfig.args.map((a) => this.replaceStaticVars(a)) }
        : {}),
      ...(stdioConfig.cwd
        ? { cwd: this.replaceStaticVars(stdioConfig.cwd) }
        : {}),
      ...(stdioConfig.env
        ? { env: this.replaceStaticVarsInRecord(stdioConfig.env) }
        : {}),
    };
  }

  /**
   * 替换静态环境变量（跳过运行时变量）
   */
  private replaceStaticVars(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
      // 跳过运行时变量
      if (RUNTIME_VARIABLES.has(varName)) {
        return match;
      }

      const envValue = process.env[varName];
      if (envValue === undefined) {
        console.warn(
          `Environment variable ${varName} not found, keeping placeholder`,
        );
        return match;
      }
      return envValue;
    });
  }

  /**
   * 处理 Record 中的静态环境变量
   */
  private replaceStaticVarsInRecord(
    record: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(record)) {
      result[key] = this.replaceStaticVars(value);
    }
    return result;
  }

  // ============================================
  // Stage 2: 运行时变量替换
  // ============================================

  /**
   * 解析运行时变量（Stage 2）
   *
   * 替换 RUNTIME_VARIABLES 中的变量，使用 VariableContext 提供的值
   */
  private resolveRuntimeVars(
    config: MCPServerConfig,
    context: VariableContext,
  ): MCPServerConfig {
    // HTTP 类型无需变量替换
    if ("type" in config && config.type === "http") {
      return config;
    }

    const stdioConfig = config as MCPStdioServerConfig;
    const vars = context.runtimeVars ?? {};

    const replaceRuntime = (value: string): string =>
      value.replace(/\$\{([^}]+)\}/g, (match, varName: string) => {
        if (RUNTIME_VARIABLES.has(varName) && vars[varName] !== undefined) {
          return vars[varName];
        }
        return match;
      });

    return {
      command: stdioConfig.command,
      ...(stdioConfig.args
        ? { args: stdioConfig.args.map(replaceRuntime) }
        : {}),
      ...(stdioConfig.cwd ? { cwd: replaceRuntime(stdioConfig.cwd) } : {}),
      ...(stdioConfig.env
        ? {
            env: Object.fromEntries(
              Object.entries(stdioConfig.env).map(([k, v]) => [
                k,
                replaceRuntime(v),
              ]),
            ),
          }
        : {}),
    };
  }

  // ============================================
  // 辅助方法
  // ============================================

  /**
   * 检查 server 配置是否包含指定变量
   */
  private containsVariable(
    config: MCPServerConfig,
    varName: string,
  ): boolean {
    // HTTP 类型不包含运行时变量
    if ("type" in config && config.type === "http") {
      return false;
    }

    const stdioConfig = config as MCPStdioServerConfig;
    const pattern = `\${${varName}}`;

    // 检查 args
    if (stdioConfig.args?.some((a) => a.includes(pattern))) {
      return true;
    }

    // 检查 cwd
    if (stdioConfig.cwd?.includes(pattern)) {
      return true;
    }

    // 检查 env
    if (stdioConfig.env) {
      for (const value of Object.values(stdioConfig.env)) {
        if (value.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }
}

/**
 * 获取全局 MCP Server 配置加载器实例
 */
export function getMCPServerConfigLoader(
  configPath?: string,
): MCPServerConfigLoader {
  return MCPServerConfigLoader.getInstance(configPath);
}

/**
 * 便捷函数：获取指定 server 的配置
 */
export async function getMCPServerConfig(
  serverName: string,
): Promise<MCPServerConfig | undefined> {
  const loader = getMCPServerConfigLoader();
  return loader.getServerConfig(serverName);
}

/**
 * 便捷函数：获取多个 server 的配置
 */
export async function getMCPServerConfigs(
  serverNames: readonly string[],
): Promise<MCPConfig> {
  const loader = getMCPServerConfigLoader();
  return loader.getServerConfigs(serverNames);
}
