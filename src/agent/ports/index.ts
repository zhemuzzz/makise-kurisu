/**
 * Agent Ports 模块导出
 *
 * @module agent/ports
 */

export type {
  // 聚合接口
  PlatformServices,
  // ContextManager
  ContextManagerPort,
  BudgetCheckResult,
  TrimSuggestion,
  ProcessedOutput,
  CompactResult,
  ContextStats,
  // ToolExecutor
  ToolExecutorPort,
  // SkillManager
  SkillManagerPort,
  SkillSearchResult,
  SkillActivation,
  SkillDraft,
  // SubAgentManager
  SubAgentManagerPort,
  SubAgentConfig,
  SubAgentResult,
  SubAgentStatus,
  // Permission
  PermissionPort,
  PermissionResult,
  ToolPermissionAnnotation,
  // Approval
  ApprovalPort,
  ApprovalRequest,
  ApprovalResponse,
  UserApprovalAction,
  // Tracing
  TracingPort,
  TracingEvent,
  // Memory
  MemoryPort,
  MemoryRecallResult,
  // LLM
  LLMProviderPort,
  LLMCallConfig,
  LLMStreamChunk,
} from "./platform-services.js";
