/**
 * MCP Connection Management
 *
 * Handles connection lifecycle for MCP servers (stdio and HTTP transports)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { filterSensitiveEnvVars } from "./executors/security.js";
import type {
  MCPServerConfig,
  MCPStdioServerConfig,
  MCPHttpServerConfig,
} from "../skills/types.js";
import { withTimeout } from "../utils/timeout.js";
import type { MCPConnectionStatus } from "./mcp-auto-reconnect.js";

/** Commands that should never be allowed as MCP server commands */
const DANGEROUS_MCP_COMMANDS: readonly string[] = [
  "rm", "del", "format", "mkfs", "dd", "shutdown", "reboot",
  "halt", "init", "kill", "killall", "pkill",
];

/** Known-safe commands commonly used for MCP servers */
const ALLOWED_MCP_COMMANDS: readonly string[] = [
  "node", "npx", "python", "python3", "pip", "pipx",
  "uvx", "uv", "docker", "deno", "bun",
];

/**
 * MCP 客户端连接信息
 */
export interface MCPConnection {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  status: MCPConnectionStatus;
  config: MCPServerConfig;
  error?: string;
}

/**
 * 类型守卫：判断是否为 HTTP 类型配置
 */
export function isHttpConfig(config: MCPServerConfig): config is MCPHttpServerConfig {
  return "type" in config && (config as unknown as Record<string, unknown>)["type"] === "http";
}

/**
 * 类型守卫：判断是否为 Stdio 类型配置
 */
export function isStdioConfig(
  config: MCPServerConfig,
): config is MCPStdioServerConfig {
  return "command" in config;
}

/**
 * Connection manager configuration
 */
export interface ConnectionManagerConfig {
  connectionTimeout: number;
  reconnectMaxRetries: number;
  reconnectDelay: number;
}

/**
 * MCP Connection Manager
 *
 * Handles connection lifecycle: connect, disconnect, reconnect
 */
export class MCPConnectionManager {
  constructor(private readonly config: ConnectionManagerConfig) {}

  /**
   * 连接到 MCP Server（支持 stdio 和 HTTP 两种传输）
   */
  async connect(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<{ client: Client; transport: StdioClientTransport | StreamableHTTPClientTransport }> {
    // 根据配置类型选择传输方式
    if (isHttpConfig(serverConfig)) {
      return this.connectHttp(serverName, serverConfig);
    }

    return this.connectStdio(serverName, serverConfig);
  }

  /**
   * 通过 stdio 传输连接 MCP Server
   */
  private async connectStdio(
    serverName: string,
    serverConfig: MCPStdioServerConfig,
  ): Promise<{ client: Client; transport: StdioClientTransport }> {
    // 运行时命令安全验证
    const commandLower = serverConfig.command.toLowerCase();

    // 检查是否在危险命令黑名单中
    const isDangerous = DANGEROUS_MCP_COMMANDS.some(
      (c) => c.toLowerCase() === commandLower,
    );
    if (isDangerous) {
      throw new Error(
        `Security: Refusing to connect to MCP server "${serverName}" with dangerous command "${serverConfig.command}". ` +
          `This command could be used to execute arbitrary code.`,
      );
    }

    // 检查命令是否在白名单中或看起来安全
    const isAllowed = ALLOWED_MCP_COMMANDS.some(
      (c) => c.toLowerCase() === commandLower,
    );
    if (!isAllowed) {
      console.warn(
        `Warning: MCP server "${serverName}" uses non-whitelisted command "${serverConfig.command}". ` +
          `Ensure this is from a trusted source.`,
      );
    }

    // 创建传输层 — 只传递白名单环境变量给子进程
    const baseEnv = filterSensitiveEnvVars(
      process.env as Record<string, string>,
      "permissive",
    );
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args ? [...serverConfig.args] : [],
      env: serverConfig.env
        ? ({ ...baseEnv, ...serverConfig.env } as Record<string, string>)
        : baseEnv,
      ...(serverConfig.cwd ? { cwd: serverConfig.cwd } : {}),
    });

    // 创建客户端
    const client = new Client(
      { name: "kurisu-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await withTimeout(
      client.connect(transport as Transport),
      this.config.connectionTimeout,
      `Connection to ${serverName}`,
    );

    return { client, transport };
  }

  /**
   * 通过 HTTP 传输连接 MCP Server（Streamable HTTP）
   */
  private async connectHttp(
    serverName: string,
    serverConfig: MCPHttpServerConfig,
  ): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    const transport = new StreamableHTTPClientTransport(
      new URL(serverConfig.url),
    );

    const client = new Client(
      { name: "kurisu-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await withTimeout(
      client.connect(transport as Transport),
      this.config.connectionTimeout,
      `Connection to ${serverName}`,
    );

    return { client, transport };
  }

  /**
   * 断开连接
   */
  async disconnect(client: Client): Promise<void> {
    // 防御性检查：确保 client 有 close 方法
    if (typeof client.close === "function") {
      await client.close();
    }
  }

  /**
   * 检查配置是否变化
   */
  configChanged(
    oldConfig: MCPServerConfig,
    newConfig: MCPServerConfig,
  ): boolean {
    // 类型不同（stdio vs http）
    const oldIsHttp = isHttpConfig(oldConfig);
    const newIsHttp = isHttpConfig(newConfig);
    if (oldIsHttp !== newIsHttp) return true;

    // HTTP 类型比较 URL
    if (oldIsHttp && newIsHttp) {
      return oldConfig.url !== newConfig.url;
    }

    // Stdio 类型比较命令、参数、环境变量
    if (isStdioConfig(oldConfig) && isStdioConfig(newConfig)) {
      if (oldConfig.command !== newConfig.command) return true;

      const oldArgs = oldConfig.args ?? [];
      const newArgs = newConfig.args ?? [];
      if (
        oldArgs.length !== newArgs.length ||
        oldArgs.some((a, i) => a !== newArgs[i])
      ) {
        return true;
      }

      const oldEnv = oldConfig.env ?? {};
      const newEnv = newConfig.env ?? {};
      const oldKeys = Object.keys(oldEnv);
      const newKeys = Object.keys(newEnv);
      if (oldKeys.length !== newKeys.length) return true;
      for (const [key, value] of Object.entries(newEnv)) {
        if (oldEnv[key] !== value) return true;
      }
    }

    return false;
  }
}
