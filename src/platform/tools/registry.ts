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
// KURISU-019: 跨平台执行器
import type { ToolExecutor as CrossPlatformExecutor } from "./executors/types";
import { createExecutor } from "./executors/factory";
import { getRecommendedWorkDir } from "./executors/platform";
import { buildSafeCommand } from "./executors/security";

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
  /** 沙箱执行器（用于 confirm 级工具）- 旧接口，保留向后兼容 */
  sandboxExecutor?: SandboxExecutor;
  /** 跨平台执行器（KURISU-019，推荐） */
  crossPlatformExecutor?: CrossPlatformExecutor;
  /** 是否启用沙箱（默认 true） */
  sandboxEnabled?: boolean;
  /** 会话工作目录管理器（KURISU-020） */
  sessionWorkDirManager?: {
    getWorkingDir(sessionId: string): string;
  };
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
  /** 跨平台执行器（KURISU-019） */
  private crossPlatformExecutor: CrossPlatformExecutor | undefined;
  private sandboxEnabled: boolean;
  /** 会话工作目录管理器（KURISU-020） */
  private sessionWorkDirManager:
    | { getWorkingDir(sessionId: string): string }
    | undefined;

  constructor(config: ToolRegistryConfig = {}) {
    this.mcpBridge = config.mcpBridge;
    this.permissionChecker = config.permissionChecker;
    this.sandboxExecutor = config.sandboxExecutor;
    this.crossPlatformExecutor = config.crossPlatformExecutor;
    this.sandboxEnabled = config.sandboxEnabled ?? true;
    this.sessionWorkDirManager = config.sessionWorkDirManager;
  }

  /**
   * 设置跨平台执行器
   */
  setCrossPlatformExecutor(executor: CrossPlatformExecutor): void {
    this.crossPlatformExecutor = executor;
  }

  /**
   * 获取跨平台执行器
   */
  getCrossPlatformExecutor(): CrossPlatformExecutor | undefined {
    return this.crossPlatformExecutor;
  }

  /**
   * 初始化跨平台执行器（异步）
   *
   * 如果没有手动设置执行器，会自动创建
   */
  async initializeCrossPlatformExecutor(): Promise<void> {
    if (this.crossPlatformExecutor) {
      return;
    }

    try {
      const result = await createExecutor();
      this.crossPlatformExecutor = result.executor;
    } catch (error) {
      console.warn("Failed to initialize cross-platform executor:", error);
    }
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

      // 1. confirm 级工具 + 启用沙箱 → 优先使用跨平台执行器（KURISU-019）
      if (useSandbox && this.crossPlatformExecutor) {
        const result = await this.executeWithCrossPlatformExecutor(call);
        output = result;
        sandboxed = true;
      }
      // 2. confirm 级工具 + 启用沙箱 + 有旧沙箱执行器 → 向后兼容
      else if (useSandbox && this.sandboxExecutor) {
        const sandboxResult = await this.executeInSandbox(call);
        output = sandboxResult;
        sandboxed = true;
      }
      // 3. 优先使用自定义执行器
      else if (registration.executor) {
        output = await registration.executor(call.arguments);
      }
      // 4. 使用 MCP 桥接
      else if (
        registration.mcpServerName &&
        this.mcpBridge &&
        registration.def.source.type === "mcp"
      ) {
        // KURISU-029: MCP 工具调用 + 连接失败自动重连重试
        output = await this.callMCPToolWithRetry(
          registration.mcpServerName,
          call.name,
          call.arguments,
        );
      }
      // 5. 无执行器
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
   * 使用跨平台执行器执行工具调用（KURISU-019）
   *
   * 将工具调用转换为 shell 命令在执行器中执行
   */
  private async executeWithCrossPlatformExecutor(
    call: ToolCall,
  ): Promise<unknown> {
    if (!this.crossPlatformExecutor) {
      throw new Error("Cross-platform executor not configured");
    }

    // 使用安全的命令构建方式（防止命令注入）
    const { command, error } = buildSafeCommand(call.name, call.arguments);
    if (error) {
      throw new Error(`Invalid tool call: ${error}`);
    }

    // KURISU-020: 获取会话工作目录
    const workingDir = this.getWorkingDir(call.sessionId);

    const result = await this.crossPlatformExecutor.execute(command, {
      permission: this.getPermission(call.name),
      networkAccess: false,
      timeout: this.getToolTimeout(call.name),
      workingDir,
      approved: true, // 到这里说明已经通过审批
    });

    if (result.timedOut) {
      throw new Error(`Tool execution timed out after ${result.latency}ms`);
    }

    if (!result.success) {
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
   * 在沙箱中执行工具调用
   *
   * 将工具调用转换为 shell 命令在沙箱中执行
   */
  private async executeInSandbox(call: ToolCall): Promise<unknown> {
    if (!this.sandboxExecutor) {
      throw new Error("SandboxExecutor not configured");
    }

    // 使用安全的命令构建方式（防止命令注入）
    const { command, error } = buildSafeCommand(call.name, call.arguments);
    if (error) {
      throw new Error(`Invalid tool call: ${error}`);
    }

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
   * 获取工作目录（KURISU-020）
   *
   * 优先使用会话工作目录，否则使用默认目录
   */
  private getWorkingDir(sessionId?: string): string {
    if (sessionId && this.sessionWorkDirManager) {
      return this.sessionWorkDirManager.getWorkingDir(sessionId);
    }
    return getRecommendedWorkDir();
  }

  /**
   * 设置会话工作目录管理器（KURISU-020）
   */
  setSessionWorkDirManager(manager: {
    getWorkingDir(sessionId: string): string;
  }): void {
    this.sessionWorkDirManager = manager;
  }

  /**
   * MCP 工具调用 + 连接失败自动重连重试（KURISU-029）
   *
   * 如果 callTool 因连接断开失败，自动重连后重试一次
   */
  private async callMCPToolWithRetry(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.mcpBridge) {
      throw new Error("MCPBridge not configured");
    }

    try {
      return await this.mcpBridge.callTool(serverName, toolName, args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isConnectionError = message.includes("MCP server not connected");

      if (!isConnectionError) {
        throw error;
      }

      // 连接失败 → 重连后重试一次
      await this.mcpBridge.reconnect(serverName);
      return await this.mcpBridge.callTool(serverName, toolName, args);
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
