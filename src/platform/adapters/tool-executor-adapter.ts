/**
 * ToolExecutorAdapter - ToolRegistry → ToolExecutorPort
 *
 * 适配 Platform 的 ToolRegistry 到 Agent 的 ToolExecutorPort 接口。
 * - sessionId 注入到 ToolCall
 * - 方法重命名: list→getToolDefinitions, executeAll→executeBatch
 * - sync→async 包装 (list, has)
 * - 元工具拦截: isMetaTool → executeMetaTool (KURISU-040)
 *
 * @module platform/adapters/tool-executor-adapter
 */

import type {
  ToolExecutorPort,
  SkillManagerPort,
  SubAgentManagerPort,
} from "../../agent/ports/platform-services.js";
import type { ToolDef, ToolCall, ToolResult } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { MetaToolContext, SessionState } from "../../agent/meta-tools/types.js";
import {
  isMetaTool,
  executeMetaTool,
  getMetaToolDefs,
} from "../../agent/meta-tools/index.js";

// ============================================================================
// Types
// ============================================================================

export interface MetaToolDeps {
  /** 获取/创建 per-session 的 SessionState */
  readonly getSessionState: (sessionId: string) => SessionState;

  /** SkillManagerPort (用于 find-skill / manage-skill) */
  readonly skills: SkillManagerPort;

  /** SubAgentManagerPort (用于 spawn-sub-agent) */
  readonly subAgents: SubAgentManagerPort;

  /** Agent ID (通常是 roleId) */
  readonly agentId: string;

  /** 获取可用模型列表 (用于 spawn-sub-agent 动态枚举) */
  readonly getAvailableModels: () => string[];
}

// ============================================================================
// Adapter
// ============================================================================

export class ToolExecutorAdapter implements ToolExecutorPort {
  private readonly registry: ToolRegistry;
  private readonly metaToolDeps: MetaToolDeps | undefined;

  constructor(registry: ToolRegistry, metaToolDeps?: MetaToolDeps) {
    this.registry = registry;
    this.metaToolDeps = metaToolDeps;
  }

  async execute(
    toolCall: ToolCall,
    sessionId: string,
    _signal?: AbortSignal,
  ): Promise<ToolResult> {
    // 元工具拦截
    if (isMetaTool(toolCall.name) && this.metaToolDeps) {
      const context = this.buildMetaToolContext(sessionId, toolCall);
      const result = await executeMetaTool(toolCall.name, toolCall.arguments as Record<string, unknown>, context);
      if (result) return result;
    }

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
    const registryTools = this.registry.list();

    // 如果配置了元工具，把元工具定义也加入（含动态模型枚举）
    if (this.metaToolDeps) {
      const models = this.metaToolDeps.getAvailableModels();
      return [...registryTools, ...getMetaToolDefs(models)];
    }

    return registryTools;
  }

  isToolAvailable(toolName: string): boolean {
    if (isMetaTool(toolName) && this.metaToolDeps) {
      return true;
    }
    return this.registry.has(toolName);
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private buildMetaToolContext(sessionId: string, _toolCall: ToolCall): MetaToolContext {
    const deps = this.metaToolDeps!;
    return {
      sessionId,
      userId: "unknown",
      agentId: deps.agentId,
      sessionState: deps.getSessionState(sessionId),
      skills: deps.skills,
      subAgents: deps.subAgents,
      getAvailableModels: deps.getAvailableModels,
    };
  }
}
