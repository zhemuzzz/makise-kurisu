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
import type { SandboxExecutor } from "./sandbox";
import { shouldUseSandbox } from "./sandbox";

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
  /** 沙箱执行器（用于 confirm 级工具） */
  sandboxExecutor?: SandboxExecutor;
  /** 是否启用沙箱（默认 true） */
  sandboxEnabled?: boolean;
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
  private sandboxExecutor: SandboxExecutor | undefined;
  private sandboxEnabled: boolean;

  constructor(config: ToolRegistryConfig = {}) {
    this.mcpBridge = config.mcpBridge;
    this.permissionChecker = config.permissionChecker;
    this.sandboxExecutor = config.sandboxExecutor;
    this.sandboxEnabled = config.sandboxEnabled ?? true;
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
    const permission = this.getPermission(call.name);

    // 检查是否需要在沙箱中执行
    const useSandbox = shouldUseSandbox(permission, this.sandboxEnabled);

    try {
      let output: unknown;
      let sandboxed = false;

      // 1. confirm 级工具 + 启用沙箱 + 有沙箱执行器 → 沙箱执行
      if (useSandbox && this.sandboxExecutor) {
        const sandboxResult = await this.executeInSandbox(call);
        output = sandboxResult;
        sandboxed = true;
      }
      // 2. 优先使用自定义执行器
      else if (registration.executor) {
        output = await registration.executor(call.arguments);
      }
      // 3. 使用 MCP 桥接
      else if (
        registration.mcpServerName &&
        this.mcpBridge &&
        registration.def.source.type === "mcp"
      ) {
        // 条件已确保 this.mcpBridge 非空
        output = await this.mcpBridge.callTool(
          registration.mcpServerName,
          call.name,
          call.arguments,
        );
      }
      // 4. 无执行器
      else {
        throw new Error(`No executor for tool: ${call.name}`);
      }

      return {
        callId: call.id,
        toolName: call.name,
        success: true,
        output,
        latency: Date.now() - startTime,
        sandboxed,
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
   * 在沙箱中执行工具调用
   *
   * 将工具调用转换为 shell 命令在沙箱中执行
   */
  private async executeInSandbox(call: ToolCall): Promise<unknown> {
    if (!this.sandboxExecutor) {
      throw new Error("SandboxExecutor not configured");
    }

    // 将工具参数转换为 JSON 字符串传递给命令
    const argsJson = JSON.stringify(call.arguments);

    // 构建执行命令（假设工具在沙箱中以 CLI 形式存在）
    // 实际实现可能需要根据具体工具调整
    const command = `${call.name} '${argsJson}'`;

    const result = await this.sandboxExecutor.execute({
      command,
      timeout: this.getToolTimeout(call.name),
    });

    if (result.timedOut) {
      throw new Error(`Tool execution timed out after ${result.latency}ms`);
    }

    if (result.exitCode !== 0) {
      throw new Error(
        `Tool execution failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // 尝试解析 JSON 输出
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return JSON.parse(result.stdout);
    } catch {
      // 如果不是 JSON，返回原始输出
      return result.stdout;
    }
  }

  /**
   * 获取工具超时时间
   */
  private getToolTimeout(toolName: string): number {
    const tool = this.get(toolName);
    return tool?.timeout ?? 30000;
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
