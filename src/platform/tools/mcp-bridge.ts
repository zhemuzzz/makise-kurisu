/**
 * MCP 客户端桥接层
 *
 * 管理 MCP Server 连接池，提供工具发现和调用能力
 *
 * KURISU-018 Phase 3: 添加热重连功能
 * KURISU-029: 进程管理优化 — 健康检查 + 自动恢复 + 优雅退出
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { filterSensitiveEnvVars } from "./executors/security.js";
import {
  ListToolsResultSchema,
  CompatibilityCallToolResultSchema,
  type ListToolsResult,
  type CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { EventEmitter } from "events";
import type { ToolDef } from "./types";
import type {
  MCPServerConfig,
  MCPStdioServerConfig,
  MCPHttpServerConfig,
  MCPConfig,
} from "../skills/types";
import { withTimeout } from "../utils/timeout";
import {
  MCPAutoReconnect,
  type MCPConnectionStatus,
} from "./mcp-auto-reconnect";

// --- Inlined from deleted src/evolution/types (KURISU-035) ---
/** Event emitted when MCP tools change */
export interface ToolsChangedEvent {
  readonly type: "added" | "removed" | "updated";
  readonly serverName: string;
  readonly tools: readonly ToolDef[];
  readonly timestamp: number;
}

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
// --- End inlined definitions ---

/**
 * MCP 客户端连接信息
 */
interface MCPConnection {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  status: MCPConnectionStatus;
  config: MCPServerConfig;
  error?: string;
}

/**
 * 类型守卫：判断是否为 HTTP 类型配置
 */
function isHttpConfig(config: MCPServerConfig): config is MCPHttpServerConfig {
  return "type" in config && (config as unknown as Record<string, unknown>)["type"] === "http";
}

/**
 * 类型守卫：判断是否为 Stdio 类型配置
 */
function isStdioConfig(
  config: MCPServerConfig,
): config is MCPStdioServerConfig {
  return "command" in config;
}

/**
 * KURISU-029: MCPBridge 事件类型
 */
export interface MCPBridgeEvents {
  readonly connectionLost: {
    readonly serverName: string;
    readonly reason: "process_exit" | "error" | "timeout";
  };
  readonly connectionRestored: {
    readonly serverName: string;
    readonly attempt: number;
  };
  readonly healthCheckFailed: {
    readonly serverName: string;
    readonly error: string;
  };
}

/**
 * MCP 桥接配置
 */
export interface MCPBridgeConfig {
  /** 连接超时（毫秒），默认 10000 */
  connectionTimeout?: number;
  /** 工具调用超时（毫秒），默认 30000 */
  toolCallTimeout?: number;
  /** 热重连最大重试次数，默认 3 */
  reconnectMaxRetries?: number;
  /** 热重连延迟（毫秒），默认 1000 */
  reconnectDelay?: number;
  /** KURISU-029: 启用自动重连（默认 true） */
  autoReconnect?: boolean;
  /** KURISU-029: 自动重连最大次数（默认 3） */
  autoReconnectMaxRetries?: number;
  /** KURISU-029: 重连延迟基数 ms（默认 1000，指数退避） */
  autoReconnectBaseDelay?: number;
  /** KURISU-029: 重连延迟上限 ms（默认 30000） */
  autoReconnectMaxDelay?: number;
}

/** 默认超时配置 */
const DEFAULT_CONNECTION_TIMEOUT = 10000; // 10s
const DEFAULT_TOOL_CALL_TIMEOUT = 30000; // 30s
const DEFAULT_RECONNECT_MAX_RETRIES = 3;
const DEFAULT_RECONNECT_DELAY = 1000; // 1s
const DEFAULT_AUTO_RECONNECT_BASE_DELAY = 1000;
const DEFAULT_AUTO_RECONNECT_MAX_DELAY = 30000;

/**
 * MCP 客户端桥接层
 *
 * 负责:
 * 1. 管理 MCP Server 连接池
 * 2. 发现工具列表
 * 3. 调用工具
 * 4. 热重连支持（KURISU-018 Phase 3）
 * 5. 进程管理（KURISU-029: Transport 事件监听 + 自动重连 + 优雅退出）
 */
export class MCPBridge extends EventEmitter {
  private connections: Map<string, MCPConnection> = new Map();
  private readonly connectionTimeout: number;
  private readonly toolCallTimeout: number;
  private readonly reconnectMaxRetries: number;
  private readonly reconnectDelay: number;

  /** KURISU-029: 自动重连配置 */
  private readonly autoReconnect: boolean;

  /** KURISU-029: 自动重连管理器 */
  private readonly autoReconnectManager: MCPAutoReconnect;

  /** 工具变更事件发射器 */
  private toolsChangedEmitter: EventEmitter;

  constructor(config: MCPBridgeConfig = {}) {
    super();
    this.connectionTimeout =
      config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT;
    this.toolCallTimeout = config.toolCallTimeout ?? DEFAULT_TOOL_CALL_TIMEOUT;
    this.reconnectMaxRetries =
      config.reconnectMaxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES;
    this.reconnectDelay = config.reconnectDelay ?? DEFAULT_RECONNECT_DELAY;
    this.autoReconnect = config.autoReconnect ?? true;
    this.autoReconnectManager = new MCPAutoReconnect(
      {
        maxRetries:
          config.autoReconnectMaxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES,
        baseDelay:
          config.autoReconnectBaseDelay ?? DEFAULT_AUTO_RECONNECT_BASE_DELAY,
        maxDelay:
          config.autoReconnectMaxDelay ?? DEFAULT_AUTO_RECONNECT_MAX_DELAY,
      },
      {
        getConnectionForReconnect: (serverName) => {
          const conn = this.connections.get(serverName);
          if (!conn) return undefined;
          return { status: conn.status, config: conn.config };
        },
        setConnectionStatus: (serverName, status, error) => {
          this.updateConnection(serverName, {
            status,
            ...(error !== undefined && { error }),
          });
        },
        reconnect: (serverName, cfg) => this.reconnect(serverName, cfg),
        emitConnectionRestored: (serverName, attempt) => {
          this.emit("connectionRestored", { serverName, attempt });
        },
      },
    );
    this.toolsChangedEmitter = new EventEmitter();
  }

  /**
   * 连接到 MCP Server（支持 stdio 和 HTTP 两种传输）
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
  ): Promise<Client> {
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

    // 记录连接状态
    this.connections.set(serverName, {
      client,
      transport,
      status: "connecting",
      config: serverConfig,
    });

    try {
      await withTimeout(
        client.connect(transport as Transport),
        this.connectionTimeout,
        `Connection to ${serverName}`,
      );

      this.updateConnection(serverName, { status: "connected" });

      // KURISU-029: 绑定 transport 事件（崩溃检测，仅 stdio）
      this.bindTransportEvents(serverName, transport);

      return client;
    } catch (error) {
      this.updateConnection(serverName, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 通过 HTTP 传输连接 MCP Server（Streamable HTTP）
   */
  private async connectHttp(
    serverName: string,
    serverConfig: MCPHttpServerConfig,
  ): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(
      new URL(serverConfig.url),
    );

    const client = new Client(
      { name: "kurisu-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );

    this.connections.set(serverName, {
      client,
      transport,
      status: "connecting",
      config: serverConfig,
    });

    try {
      await withTimeout(
        client.connect(transport as Transport),
        this.connectionTimeout,
        `Connection to ${serverName}`,
      );

      this.updateConnection(serverName, { status: "connected" });

      return client;
    } catch (error) {
      this.updateConnection(serverName, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 不可变更新连接状态
   *
   * 遵循 immutability 原则：创建新对象替代原对象，不直接修改属性
   */
  private updateConnection(
    serverName: string,
    updates: Partial<Pick<MCPConnection, "status" | "error">>,
  ): void {
    const conn = this.connections.get(serverName);
    if (!conn) return;
    this.connections.set(serverName, { ...conn, ...updates });
  }

  // ============================================
  // KURISU-029: Transport 事件监听 + 崩溃检测
  // ============================================

  /**
   * 绑定 Transport 事件（onclose / onerror）
   *
   * 当 MCP Server 进程退出或管道断开时自动更新连接状态
   */
  private bindTransportEvents(
    serverName: string,
    transport: StdioClientTransport | StreamableHTTPClientTransport,
  ): void {
    transport.onclose = () => {
      this.handleTransportClose(serverName);
    };

    transport.onerror = (error: Error) => {
      this.handleTransportError(serverName, error);
    };
  }

  /**
   * 处理 Transport 关闭事件（进程退出）
   */
  private handleTransportClose(serverName: string): void {
    const conn = this.connections.get(serverName);
    if (
      !conn ||
      conn.status === "disconnected" ||
      conn.status === "reconnecting"
    )
      return;

    // 不可变更新状态
    this.updateConnection(serverName, {
      status: "error",
      error: "Process exited unexpectedly",
    });

    // 发射事件
    this.emit("connectionLost", {
      serverName,
      reason: "process_exit" as const,
    });

    // Phase 2: 触发自动重连
    if (this.autoReconnect) {
      this.autoReconnectManager.schedule(serverName);
    }
  }

  /**
   * 处理 Transport 错误事件
   */
  private handleTransportError(serverName: string, error: Error): void {
    const conn = this.connections.get(serverName);
    if (
      !conn ||
      conn.status === "disconnected" ||
      conn.status === "reconnecting"
    )
      return;

    // 不可变更新状态
    this.updateConnection(serverName, {
      status: "error",
      error: error.message,
    });

    // 发射事件
    this.emit("connectionLost", {
      serverName,
      reason: "error" as const,
    });

    // Phase 2: 触发自动重连
    if (this.autoReconnect) {
      this.autoReconnectManager.schedule(serverName);
    }
  }

  /**
   * 从 MCP 配置连接所有 Servers
   */
  async connectFromConfig(config: MCPConfig): Promise<void> {
    const promises = Object.entries(config.mcpServers).map(
      async ([name, serverConfig]) => {
        // §3.4 连接池：已连接则跳过（避免不必要的函数调用）
        const existing = this.connections.get(name);
        if (existing && existing.status === "connected") {
          return;
        }
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

    // KURISU-029: 先标记为 disconnected，防止 transport close 事件触发误报
    this.updateConnection(serverName, { status: "disconnected" });

    try {
      await conn.client.close();
    } finally {
      this.connections.delete(serverName);
    }
  }

  /**
   * 断开所有 Servers
   *
   * KURISU-029: 增强为并行断开 + 超时保护 + 取消重连任务
   */
  async disconnectAll(timeout: number = 5000): Promise<void> {
    // 取消所有进行中的重连任务
    this.autoReconnectManager.cancelAll();

    const serverNames = Array.from(this.connections.keys());
    if (serverNames.length === 0) return;

    // 并行断开所有连接，带超时保护
    await withTimeout(
      Promise.allSettled(serverNames.map((name) => this.disconnect(name))),
      timeout,
      "MCPBridge.disconnectAll",
    ).catch(() => {
      // 超时后强制清理
      this.connections.clear();
    });
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
      // 使用 MCP SDK 的 ListToolsResultSchema 验证响应
      const result: ListToolsResult = await conn.client.request(
        { method: "tools/list", params: {} },
        ListToolsResultSchema,
      );

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

    // 使用 MCP SDK 的 CompatibilityCallToolResultSchema 验证响应（带超时）
    const result = (await withTimeout(
      conn.client.request(
        { method: "tools/call", params: { name: toolName, arguments: args } },
        CompatibilityCallToolResultSchema,
      ),
      this.toolCallTimeout,
      `Tool call ${toolName}`,
    )) as CompatibilityCallToolResult;

    // 处理错误
    if (result.isError) {
      // 兼容新旧两种格式
      /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
      const errorContent =
        "content" in result
          ? (result as unknown as { content: Array<{ text?: string }> }).content
              .map((c) => c.text ?? "")
              .join("\n")
          : "Unknown error";
      /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
      throw new Error(`Tool execution error: ${errorContent}`);
    }

    // 兼容新旧两种格式返回内容
    if ("content" in result) {
      /* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
      return (
        result as unknown as {
          content: Array<{ text?: string; data?: string }>;
        }
      ).content
        .map((c) => c.text ?? c.data ?? "")
        .join("\n");
      /* eslint-enable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
    }

    // 旧格式：直接返回 toolResult
    /* eslint-disable-next-line @typescript-eslint/no-unsafe-return */
    return (result as { toolResult: unknown }).toolResult;
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
   * KURISU-029: 获取连接对象（供 HealthChecker 使用）
   */
  getConnection(
    serverName: string,
  ): { client: Client; status: MCPConnectionStatus } | undefined {
    const conn = this.connections.get(serverName);
    if (!conn) return undefined;
    return { client: conn.client, status: conn.status };
  }

  /**
   * KURISU-029: 获取所有已连接的 Server 名称
   */
  getConnectedServerNames(): readonly string[] {
    return Array.from(this.connections.entries())
      .filter(([, conn]) => conn.status === "connected")
      .map(([name]) => name);
  }

  // ============================================
  // KURISU-018 Phase 3: 热重连支持
  // ============================================

  /**
   * 热重连：断开旧连接，建立新连接
   *
   * @param serverName Server 名称
   * @param config 新的 Server 配置（可选，不传则使用现有配置）
   * @returns 连接成功的 Client
   */
  async reconnect(
    serverName: string,
    config?: MCPServerConfig,
  ): Promise<Client> {
    const existing = this.connections.get(serverName);
    const newConfig = config ?? existing?.config;

    if (!newConfig) {
      throw new Error(`No config available for reconnect: ${serverName}`);
    }

    // 更新状态为重连中
    if (existing) {
      this.updateConnection(serverName, { status: "reconnecting" });
    }

    // 断开旧连接
    try {
      await this.disconnect(serverName);
    } catch {
      // 忽略断开错误
    }

    // 重试连接
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.reconnectMaxRetries; attempt++) {
      try {
        const client = await this.connect(serverName, newConfig);

        // 发出工具变更事件
        this.emitToolsChanged("updated", serverName);

        return client;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // 等待后重试
        if (attempt < this.reconnectMaxRetries) {
          await this.delay(this.reconnectDelay);
        }
      }
    }

    // 重连失败，更新状态
    this.updateConnection(serverName, {
      status: "error",
      ...(lastError?.message !== undefined && { error: lastError.message }),
    });

    throw new Error(
      `Reconnect failed after ${this.reconnectMaxRetries} attempts: ${serverName}`,
    );
  }

  /**
   * 重新加载配置：比较新旧配置，只重连变化的部分
   *
   * @param newConfig 新的 MCP 配置
   */
  async reloadConfig(newConfig: MCPConfig): Promise<void> {
    const newServers = newConfig.mcpServers ?? {};
    const currentServers = new Map<string, MCPConnection>();

    // 收集当前连接
    for (const [name, conn] of this.connections) {
      currentServers.set(name, conn);
    }

    const added: string[] = [];
    const removed: string[] = [];
    const updated: string[] = [];

    // 检测新增和更新
    for (const [name, config] of Object.entries(newServers)) {
      const existing = currentServers.get(name);

      if (!existing) {
        // 新增 Server
        added.push(name);
      } else if (this.configChanged(existing.config, config)) {
        // 配置变化，需要重连
        updated.push(name);
      }
      // 配置相同，无需处理
    }

    // 检测移除
    for (const name of currentServers.keys()) {
      if (!newServers[name]) {
        removed.push(name);
      }
    }

    // 断开已移除的 Server
    for (const name of removed) {
      await this.disconnect(name);
      this.emitToolsChanged("removed", name);
    }

    // 连接新增的 Server
    for (const name of added) {
      const serverConfig = newServers[name];
      if (serverConfig) {
        try {
          await this.connect(name, serverConfig);
          this.emitToolsChanged("added", name);
        } catch (error) {
          console.error(`Failed to connect new server ${name}:`, error);
        }
      }
    }

    // 重连配置变化的 Server
    for (const name of updated) {
      try {
        await this.reconnect(name, newServers[name]);
      } catch (error) {
        console.error(`Failed to reconnect server ${name}:`, error);
      }
    }
  }

  /**
   * 检查配置是否变化
   */
  private configChanged(
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

  /**
   * 发出工具变更事件
   */
  private emitToolsChanged(
    type: ToolsChangedEvent["type"],
    serverName: string,
  ): void {
    const event: ToolsChangedEvent = {
      type,
      serverName,
      tools: [], // 工具列表由 ToolRegistry 在监听时查询
      timestamp: Date.now(),
    };

    this.toolsChangedEmitter.emit("toolsChanged", event);
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 注册工具变更监听器
   */
  onToolsChanged(listener: (event: ToolsChangedEvent) => void): () => void {
    this.toolsChangedEmitter.on("toolsChanged", listener);

    // 返回取消监听函数
    return () => {
      this.toolsChangedEmitter.off("toolsChanged", listener);
    };
  }

  /**
   * 移除工具变更监听器
   */
  offToolsChanged(listener: (event: ToolsChangedEvent) => void): void {
    this.toolsChangedEmitter.off("toolsChanged", listener);
  }

  /**
   * 获取所有已连接的 Server 配置
   */
  getConnectedConfigs(): Map<string, MCPServerConfig> {
    const configs = new Map<string, MCPServerConfig>();
    for (const [name, conn] of this.connections) {
      if (conn.status === "connected") {
        configs.set(name, conn.config);
      }
    }
    return configs;
  }
}

/**
 * 创建 MCP Bridge 实例
 */
export function createMCPBridge(config?: MCPBridgeConfig): MCPBridge {
  return new MCPBridge(config);
}
