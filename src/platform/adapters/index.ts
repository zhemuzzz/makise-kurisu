/**
 * Platform Adapters Index
 *
 * 导出所有 Adapter + assemblePlatformServices() 工厂函数。
 *
 * Adapter 职责: Bridge Platform 实现 → Agent Port 接口
 * - MemoryAdapter:          HybridMemoryEngine → MemoryPort
 * - TracingAdapter:         TracingService → TracingPort
 * - PermissionAdapter:      PermissionService → PermissionPort
 * - ApprovalAdapter:        ApprovalService → ApprovalPort
 * - ToolExecutorAdapter:    ToolRegistry → ToolExecutorPort
 * - ContextManagerAdapter:  ContextManager → ContextManagerPort
 * - LLMProviderAdapter:     IModelProvider → LLMProviderPort
 * - SkillManagerPort:       直接实现，无需 Adapter
 * - SubAgentManagerPort:    SubAgentManager 直接实现
 *
 * @module platform/adapters
 */

import type { PlatformServices } from "../../agent/ports/platform-services.js";
import type { SkillManagerPort } from "../../agent/ports/platform-services.js";
import type { ContextManagerOptions } from "../context-manager.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { HybridMemoryEngine } from "../memory/hybrid-engine.js";
import type { IModelProvider } from "../models/types.js";
import type { SubAgentManager } from "../sub-agent-manager.js";
import type { TracingService } from "../tracing-service.js";

import { MemoryAdapter } from "./memory-adapter.js";
import { TracingAdapter } from "./tracing-adapter.js";
import { PermissionAdapter } from "./permission-adapter.js";
import { ApprovalAdapter } from "./approval-adapter.js";
import { ToolExecutorAdapter } from "./tool-executor-adapter.js";
import { ContextManagerAdapter } from "./context-manager-adapter.js";
import { LLMProviderAdapter } from "./llm-provider-adapter.js";

// Re-export adapters
export { MemoryAdapter } from "./memory-adapter.js";
export { TracingAdapter } from "./tracing-adapter.js";
export { PermissionAdapter } from "./permission-adapter.js";
export { ApprovalAdapter } from "./approval-adapter.js";
export { ToolExecutorAdapter } from "./tool-executor-adapter.js";
export { ContextManagerAdapter } from "./context-manager-adapter.js";
export { LLMProviderAdapter } from "./llm-provider-adapter.js";

// ============================================================================
// Types
// ============================================================================

/** Platform 依赖 (注入到 assemblePlatformServices) */
export interface PlatformDependencies {
  readonly contextManagerOptions: ContextManagerOptions;
  readonly toolRegistry: ToolRegistry;
  readonly skillManager: SkillManagerPort;
  readonly subAgentManager: SubAgentManager;
  readonly permissionService: {
    check(request: { action: string; subject: string; context?: Record<string, unknown> }): "allow" | "confirm" | "deny";
    getToolAnnotations(toolIds: string[]): Array<{ toolId: string; permission: "allow" | "confirm" | "deny" }>;
  };
  readonly approvalService: {
    requestApproval(request: { subject: string; description?: string; sessionId: string }): {
      approvalId: string;
      result: Promise<{ approved: boolean; userId?: string; timestamp?: number }>;
    };
    handleUserResponse(approvalId: string, approved: boolean): void;
    rejectAllPending(sessionId: string): void;
    readonly pendingCount: number;
  };
  readonly tracingService: TracingService;
  readonly memoryEngine: HybridMemoryEngine;
  readonly modelProvider: IModelProvider;

  /** LLM summarize function for compact (injected to avoid circular dependency) */
  readonly summarizeFn: (text: string) => Promise<string>;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 组装 PlatformServices 聚合接口
 *
 * 创建所有 Adapter，将 Platform 实现桥接到 Agent Port 接口。
 *
 * @param deps - Platform 依赖
 * @returns PlatformServices 聚合接口
 */
export function assemblePlatformServices(
  deps: PlatformDependencies,
): PlatformServices {
  return {
    context: new ContextManagerAdapter(deps.contextManagerOptions, deps.summarizeFn),
    tools: new ToolExecutorAdapter(deps.toolRegistry),
    skills: deps.skillManager,
    subAgents: deps.subAgentManager,
    permission: new PermissionAdapter(deps.permissionService),
    approval: new ApprovalAdapter(deps.approvalService),
    tracing: new TracingAdapter(deps.tracingService),
    memory: new MemoryAdapter(deps.memoryEngine),
    llm: new LLMProviderAdapter(deps.modelProvider),
  };
}
