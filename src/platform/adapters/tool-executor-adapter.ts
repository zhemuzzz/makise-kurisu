/**
 * ToolExecutorAdapter - ToolRegistry → ToolExecutorPort
 *
 * 适配 Platform 的 ToolRegistry 到 Agent 的 ToolExecutorPort 接口。
 * - sessionId 注入到 ToolCall
 * - 方法重命名: list→getToolDefinitions, executeAll→executeBatch
 * - sync→async 包装 (list, has)
 *
 * @module platform/adapters/tool-executor-adapter
 */

import type {
  ToolExecutorPort,
} from "../../agent/ports/platform-services.js";
import type { ToolDef, ToolCall, ToolResult } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";

// ============================================================================
// Adapter
// ============================================================================

export class ToolExecutorAdapter implements ToolExecutorPort {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  async execute(
    toolCall: ToolCall,
    sessionId: string,
    _signal?: AbortSignal,
  ): Promise<ToolResult> {
    // Inject sessionId into the ToolCall
    const callWithSession: ToolCall = {
      ...toolCall,
      sessionId,
    };

    return this.registry.execute(callWithSession);
  }

  async executeBatch(
    toolCalls: ToolCall[],
    sessionId: string,
    _signal?: AbortSignal,
  ): Promise<ToolResult[]> {
    // Inject sessionId into all ToolCalls
    const callsWithSession: ToolCall[] = toolCalls.map((call) => ({
      ...call,
      sessionId,
    }));

    return this.registry.executeAll(callsWithSession);
  }

  async getToolDefinitions(_skillIds?: string[]): Promise<ToolDef[]> {
    // TODO: filter by skillIds when Skill→Tool mapping is implemented
    return this.registry.list();
  }

  isToolAvailable(toolName: string): boolean {
    return this.registry.has(toolName);
  }
}
