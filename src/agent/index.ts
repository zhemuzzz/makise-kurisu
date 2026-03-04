/**
 * Agent Core 模块
 *
 * @module agent
 * @description Agent 核心：Pipeline + ReAct 循环 + 双模式运行
 *
 * 架构设计见: ./ARCHITECTURE.md
 */

// 类型定义
export type {
  // Identity
  Identity,
  PersonaConfig,
  // AgentEvent
  AgentEventType,
  AgentEventBase,
  AgentEvent,
  TextDeltaEvent,
  ToolStartEvent,
  ToolEndEvent,
  ToolResultBrief,
  ErrorEvent,
  StatusEvent,
  CompleteEvent,
  ToolCallRecord,
  // AgentConfig
  AgentMode,
  AgentConfig,
  // AgentInput
  AgentInput,
  ActivatedSkill,
  SkillExample,
  MemoryFragment,
  ConversationTurn,
  MentalModelSnapshot,
  TodoState,
  TodoItem,
  // AgentResult
  AgentResult,
  AgentStats,
  // Error
  ErrorClassification,
  ErrorCodeType,
  // Degradation
  DegradationScenario,
  DegradationTemplate,
  // LLM
  LLMMessage,
  LLMResponse,
  AbortHandler,
} from "./types.js";

export {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_DEGRADATION_TEMPLATES,
  ErrorCode,
  createAbortHandler,
} from "./types.js";

// Port 接口
export type {
  PlatformServices,
  ContextManagerPort,
  BudgetCheckResult,
  ProcessedOutput,
  CompactResult,
  ContextStats,
  ToolExecutorPort,
  SkillManagerPort,
  SkillSearchResult,
  SkillActivation,
  SkillDraft,
  SubAgentManagerPort,
  SubAgentConfig,
  SubAgentResult,
  SubAgentStatus,
  PermissionPort,
  PermissionResult,
  ToolPermissionAnnotation,
  ApprovalPort,
  ApprovalRequest,
  ApprovalResponse,
  UserApprovalAction,
  TracingPort,
  TracingEvent,
  MemoryPort,
  MemoryRecallResult,
  LLMProviderPort,
  LLMCallConfig,
  LLMStreamChunk,
} from "./ports/index.js";

// Agent Core
export { Agent, createAgent } from "./agent.js";

// ReAct Loop
export {
  reactLoop,
  createInitialState,
  checkAborted,
  classifyError,
  buildStats,
  type ReactLoopState,
  type ReactLoopOptions,
  type ReactLoopResult,
} from "./react-loop.js";
