/**
 * 工具注册表
 *
 * 管理所有可用工具的注册、查询、执行
 */

import type {
  ToolDef,
  ToolCall,
  ToolResult,
  PermissionLevel,
  OpenAIToolDefinition,
} from "./types";
import { ToolNotFoundError } from "./types";
import type { MCPBridge } from "./mcp-bridge";
import type { PermissionChecker } from "./permission";

/**
 * 工具执行器
 */
export type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * 工具注册项
 */
interface ToolRegistration {
  def: ToolDef;
  executor: ToolExecutor | undefined;
  mcpServerName: string | undefined;
}

/**
 * 工具注册表配置
 */
export interface ToolRegistryConfig {
  /** MCP 桥接 */
  mcpBridge?: MCPBridge;
  /** 权限检查器 */
  permissionChecker?: PermissionChecker;
}

/**
 * 工具注册表
 *
 * 负责:
 * 1. 注册/注销工具
 * 2. 查询工具定义
 * 3. 执行工具调用
 */
export class ToolRegistry {
  private tools: Map<string, ToolRegistration> = new Map();
  private mcpBridge: MCPBridge | undefined;
  private permissionChecker: PermissionChecker | undefined;

  constructor(config: ToolRegistryConfig = {}) {
    this.mcpBridge = config.mcpBridge;
    this.permissionChecker = config.permissionChecker;
  }

  /**
   * 注册工具
   */
  register(tool: ToolDef, executor?: ToolExecutor): void {
    this.tools.set(tool.name, {
      def: tool,
      executor,
      mcpServerName:
        tool.source.type === "mcp" ? tool.source.serverName : undefined,
    });
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: ToolDef[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 注销工具
   */
  unregister(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  /**
   * 获取工具定义
   */
  get(toolName: string): ToolDef | undefined {
    return this.tools.get(toolName)?.def;
  }

  /**
   * 检查工具是否存在
   */
  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * 获取所有工具定义
   */
  list(): ToolDef[] {
    return Array.from(this.tools.values()).map((r) => r.def);
  }

  /**
   * 获取所有工具名称
   */
  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 获取工具权限级别
   */
  getPermission(toolName: string): PermissionLevel {
    const tool = this.get(toolName);
    if (!tool) return "deny";

    // 使用 PermissionChecker 覆盖
    if (this.permissionChecker) {
      return this.permissionChecker.getPermission(toolName);
    }

    return tool.permission;
  }

  /**
   * 转换为 OpenAI 工具定义格式
   */
  toOpenAIFormat(tools?: string[]): OpenAIToolDefinition[] {
    const targetTools = tools
      ? (tools.map((name) => this.get(name)).filter(Boolean) as ToolDef[])
      : this.list();

    return targetTools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * 执行工具调用
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    const registration = this.tools.get(call.name);

    if (!registration) {
      throw new ToolNotFoundError(call.name);
    }

    const startTime = Date.now();

    try {
      let output: unknown;

      // 1. 优先使用自定义执行器
      if (registration.executor) {
        output = await registration.executor(call.arguments);
      }
      // 2. 使用 MCP 桥接
      else if (
        registration.mcpServerName &&
        this.mcpBridge &&
        registration.def.source.type === "mcp"
      ) {
        output = await this.mcpBridge.callTool(
          registration.mcpServerName,
          call.name,
          call.arguments,
        );
      }
      // 3. 无执行器
      else {
        throw new Error(`No executor for tool: ${call.name}`);
      }

      return {
        callId: call.id,
        toolName: call.name,
        success: true,
        output,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        callId: call.id,
        toolName: call.name,
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * 批量执行工具调用
   */
  async executeAll(calls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(calls.map((call) => this.execute(call)));
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * 从 MCP 加载工具
   */
  async loadFromMCP(serverName: string): Promise<number> {
    if (!this.mcpBridge) {
      throw new Error("MCPBridge not configured");
    }

    const tools = await this.mcpBridge.listTools(serverName);

    for (const tool of tools) {
      this.register(tool);
    }

    return tools.length;
  }
}

/**
 * 创建工具注册表
 */
export function createToolRegistry(config?: ToolRegistryConfig): ToolRegistry {
  return new ToolRegistry(config);
}
