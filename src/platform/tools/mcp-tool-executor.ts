/**
 * MCP Tool Execution
 *
 * Handles tool discovery and execution for MCP servers
 */

import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ListToolsResultSchema,
  CompatibilityCallToolResultSchema,
  type ListToolsResult,
  type CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { withTimeout } from "../utils/timeout.js";
import type { ToolDef } from "./types.js";

/**
 * Tool executor configuration
 */
export interface ToolExecutorConfig {
  toolCallTimeout: number;
}

/**
 * MCP Tool Executor
 *
 * Handles tool discovery and execution
 */
export class MCPToolExecutor {
  constructor(private readonly config: ToolExecutorConfig) {}

  /**
   * 获取 Server 的所有工具
   */
  async listTools(client: Client, serverName: string): Promise<ToolDef[]> {
    try {
      // 使用 MCP SDK 的 ListToolsResultSchema 验证响应
      const result: ListToolsResult = await client.request(
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
   * 调用工具
   */
  async callTool(
    client: Client,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    // 使用 MCP SDK 的 CompatibilityCallToolResultSchema 验证响应（带超时）
    const result = (await withTimeout(
      client.request(
        { method: "tools/call", params: { name: toolName, arguments: args } },
        CompatibilityCallToolResultSchema,
      ),
      this.config.toolCallTimeout,
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
}
