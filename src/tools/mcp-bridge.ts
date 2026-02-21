/**
 * MCP 客户端桥接层
 *
 * 管理 MCP Server 连接池，提供工具发现和调用能力
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDef } from "./types";
import type { MCPServerConfig, MCPConfig } from "../skills/types";

/**
 * JSON Schema 类型（简化版）
 */
type JSONSchema = Record<string, unknown>;

/**
 * MCP 工具列表结果 Schema（简化版）
 */
interface MCPTool {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
}

interface MCPListToolsResult {
  tools: MCPTool[];
  nextCursor?: string;
}

interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

/**
 * MCP 客户端连接状态
 */
type MCPConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * MCP 客户端连接信息
 */
interface MCPConnection {
  client: Client;
  transport: StdioClientTransport;
  status: MCPConnectionStatus;
  error?: string;
}

/**
 * MCP 桥接配置
 */
export interface MCPBridgeConfig {
  /** 连接超时（毫秒） */
  connectionTimeout?: number;
  /** 工具调用超时（毫秒） */
  toolCallTimeout?: number;
}

/**
 * MCP 客户端桥接层
 *
 * 负责:
 * 1. 管理 MCP Server 连接池
 * 2. 发现工具列表
 * 3. 调用工具
 */
export class MCPBridge {
  private connections: Map<string, MCPConnection> = new Map();

  constructor(_config: MCPBridgeConfig = {}) {
    // Configuration is currently unused but kept for future use
  }

  /**
   * 连接到 MCP Server
   */
  async connect(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<Client> {
    // 已连接则返回
    const existing = this.connections.get(serverName);
    if (existing && existing.status === "connected") {
      return existing.client;
    }

    // 创建传输层
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args ? [...serverConfig.args] : [],
      env: serverConfig.env
        ? ({ ...process.env, ...serverConfig.env } as Record<string, string>)
        : (process.env as Record<string, string>),
    });

    // 创建客户端
    const client = new Client(
      { name: "kurisu-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );

    // 记录连接状态
    this.connections.set(serverName, {
      client,
      transport,
      status: "connecting",
    });

    try {
      // 连接
      await client.connect(transport);

      // 更新状态
      const conn = this.connections.get(serverName);
      if (conn) {
        conn.status = "connected";
      }

      return client;
    } catch (error) {
      // 更新错误状态
      const conn = this.connections.get(serverName);
      if (conn) {
        conn.status = "error";
        conn.error = error instanceof Error ? error.message : String(error);
      }
      throw error;
    }
  }

  /**
   * 从 MCP 配置连接所有 Servers
   */
  async connectFromConfig(config: MCPConfig): Promise<void> {
    const promises = Object.entries(config.mcpServers).map(
      async ([name, serverConfig]) => {
        try {
          await this.connect(name, serverConfig);
        } catch (error) {
          console.error(`Failed to connect to MCP server ${name}:`, error);
        }
      },
    );
    await Promise.all(promises);
  }

  /**
   * 断开指定 Server
   */
  async disconnect(serverName: string): Promise<void> {
    const conn = this.connections.get(serverName);
    if (!conn) return;

    try {
      await conn.client.close();
    } finally {
      this.connections.delete(serverName);
    }
  }

  /**
   * 断开所有 Servers
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((name) =>
      this.disconnect(name),
    );
    await Promise.all(promises);
  }

  /**
   * 获取 Server 的所有工具
   */
  async listTools(serverName: string): Promise<ToolDef[]> {
    const conn = this.connections.get(serverName);
    if (!conn || conn.status !== "connected") {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    try {
      // 调用 tools/list - 使用 any 绕过 Zod schema 要求
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (conn.client as any).request({
        method: "tools/list",
        params: {},
      })) as MCPListToolsResult;

      // 转换为 ToolDef
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? `Tool: ${tool.name}`,
        inputSchema: tool.inputSchema as unknown as ToolDef["inputSchema"],
        permission: "safe" as const, // 默认 safe，由 PermissionChecker 覆盖
        source: {
          type: "mcp" as const,
          serverName,
        },
      }));
    } catch (error) {
      console.error(`Failed to list tools from ${serverName}:`, error);
      return [];
    }
  }

  /**
   * 获取所有已连接 Server 的工具
   */
  async listAllTools(): Promise<ToolDef[]> {
    const promises = Array.from(this.connections.keys())
      .filter((name) => this.connections.get(name)?.status === "connected")
      .map((name) => this.listTools(name));

    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * 调用工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const conn = this.connections.get(serverName);
    if (!conn || conn.status !== "connected") {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    try {
      // 使用 any 绕过 Zod schema 要求
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (conn.client as any).request({
        method: "tools/call",
        params: { name: toolName, arguments: args },
      })) as MCPToolCallResult;

      // 提取内容
      if (result.isError) {
        throw new Error(
          `Tool execution error: ${result.content.map((c) => c.text).join("\n")}`,
        );
      }

      // 返回内容
      return result.content.map((c) => c.text ?? c.data).join("\n");
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(serverName: string): MCPConnectionStatus | undefined {
    return this.connections.get(serverName)?.status;
  }

  /**
   * 获取所有连接状态
   */
  getAllStatus(): Map<string, MCPConnectionStatus> {
    const status = new Map<string, MCPConnectionStatus>();
    for (const [name, conn] of this.connections) {
      status.set(name, conn.status);
    }
    return status;
  }

  /**
   * 查找工具所在的 Server
   */
  findToolServer(_toolName: string): string | undefined {
    // 遍历所有连接的工具（需要缓存或实时查询）
    // 这里简化实现，由 ToolRegistry 维护映射
    return undefined;
  }
}

/**
 * 创建 MCP Bridge 实例
 */
export function createMCPBridge(config?: MCPBridgeConfig): MCPBridge {
  return new MCPBridge(config);
}
