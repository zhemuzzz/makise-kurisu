/**
 * L3 Agent 编排层
 *
 * 整合 L2 人设引擎 + L4 记忆系统 + L5 模型配置
 * 提供统一的对话处理入口
 */

// Types
export {
  AgentRole,
  IntentType,
  type AgentState,
  type AgentMessage,
  type RouteDecision,
  type PersonaValidation,
  type OrchestratorConfig,
  type OrchestratorDeps,
  type AgentResult,
  type StreamResult,
  type MemoryEngineLike,
  type ContextBuildNodeDeps,
  type GenerateNodeDeps,
  type ValidateNodeDeps,
  type EnforceNodeDeps,
  type RouteNodeDeps,
  DEFAULT_ORCHESTRATOR_CONFIG,
  createInitialState,
  updateState,
} from './types';

// Errors
export {
  AgentError,
  OrchestratorError,
  RouteError,
  AgentExecutionError,
  MaxRetriesExceededError,
  PersonaValidationError,
  ContextBuildError,
  ModelInvocationError,
} from './errors';

// State
export {
  agentStateChannels,
  needsRetry,
  isComplete,
  getNextNode,
  routeByIntent,
} from './state';

// Nodes
export {
  createContextBuildNode,
  contextBuildNode,
  createRouteNode,
  routeNode,
  createGenerateNode,
  generateNode,
  createValidateNode,
  validateNode,
  createEnforceNode,
  enforceNode,
} from './nodes';

// Routers
export {
  intentRouter,
  validationRouter,
  shouldRegenerate,
} from './routers';

// Workflow
export { createAgentWorkflow } from './workflow';

// Orchestrator
export { AgentOrchestrator } from './orchestrator';
