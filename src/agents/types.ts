/**
 * L3 Agent 编排层 - 类型定义
 *
 * 整合 L2 人设引擎、L4 记忆系统、L5 模型配置
 */

import type { StreamChunk, IModelProvider } from "../config/models";
import type { BuildContext, Message } from "../memory";
import type { PersonaEngine } from "../core/persona";
import type {
  ToolDef,
  ToolCall,
  ToolResult,
  ApprovalState,
} from "../tools/types";

// ============================================
// Agent 角色与意图
// ============================================

/**
 * Agent 角色
 */
export enum AgentRole {
  CONVERSATION = "conversation",
  TASK = "task",
}

/**
 * 意图分类
 */
export enum IntentType {
  CONVERSATION = "conversation",
  TASK = "task",
  UNKNOWN = "unknown",
}

// ============================================
// 路由决策
// ============================================

/**
 * 路由决策结果
 */
export interface RouteDecision {
  /** 识别的意图 */
  readonly intent: IntentType;
  /** 置信度 0-1 */
  readonly confidence: number;
  /** 决策原因 */
  readonly reason: string;
}

// ============================================
// 人设校验结果
// ============================================

/**
 * 人设校验结果（扩展自 PersonaEngine 的 ValidationResult）
 */
export interface PersonaValidation {
  /** 是否通过校验 */
  readonly isValid: boolean;
  /** 违规项列表 */
  readonly violations: readonly string[];
  /** 是否需要重新生成 */
  readonly shouldRegenerate: boolean;
}

// ============================================
// Agent 消息
// ============================================

/**
 * Agent 消息（扩展自基础 Message）
 */
export interface AgentMessage extends Message {
  /** 消息 ID */
  readonly id: string;
  /** 处理该消息的 Agent */
  readonly agent?: AgentRole;
  /** 附加元数据 */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ============================================
// Agent 状态（LangGraph State）
// ============================================

/**
 * Agent 状态
 *
 * 设计原则：
 * - 不可变：所有字段 readonly
 * - 状态变更通过返回新对象
 */
export interface AgentState {
  // 标识
  readonly sessionId: string;
  readonly userId: string;

  // 输入输出
  readonly currentInput: string;
  readonly currentResponse: string | null;

  // 消息历史
  readonly messages: readonly AgentMessage[];

  // 流程控制
  readonly currentAgent: AgentRole | null;
  readonly routeDecision: RouteDecision | null;
  readonly personaValidation: PersonaValidation | null;
  readonly retryCount: number;

  // 上下文
  readonly context: BuildContext | null;

  // === 工具相关 (L6+L7) ===

  /** 激活的 Skill IDs */
  readonly activeSkills: readonly string[];

  /** 可用工具定义 (来自激活的 Skills) */
  readonly availableTools: readonly ToolDef[];

  /** 待执行的工具调用 (LLM 返回的) */
  readonly pendingToolCalls: readonly ToolCall[];

  /** 工具执行结果 */
  readonly toolResults: readonly ToolResult[];

  /** 工具调用迭代次数 (防止无限循环) */
  readonly toolCallIteration: number;

  /** 审批状态 (confirm 级工具需要) */
  readonly approvalState: ApprovalState | null;

  // 元数据
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

// ============================================
// 配置与依赖注入
// ============================================

/**
 * Orchestrator 配置
 */
export interface OrchestratorConfig {
  /** 最大重试次数 */
  readonly maxRetries: number;
  /** 是否启用人设校验 */
  readonly validationEnabled: boolean;
  /** 是否启用人设强化 */
  readonly personaEnforcementEnabled: boolean;
  /** 是否启用流式响应 */
  readonly streamingEnabled: boolean;
  /** 最大上下文消息数 */
  readonly maxContextMessages: number;
}

/**
 * Orchestrator 依赖注入接口
 */
export interface OrchestratorDeps {
  /** 人设引擎 (L2) */
  readonly personaEngine: PersonaEngine;
  /** 记忆引擎 (L4) */
  readonly memoryEngine: MemoryEngineLike;
  /** 模型提供者 (L5) */
  readonly modelProvider: IModelProvider;
}

/**
 * 记忆引擎接口（L4 子集）
 */
export interface MemoryEngineLike {
  hasSession(sessionId: string): boolean;
  createSession(sessionId: string): void;
  buildContext(sessionId: string, input: string): Promise<BuildContext>;
  getRecentMessages(sessionId: string, count: number): Message[];
  addSessionMessage(
    sessionId: string,
    content: string,
    role: "user" | "assistant",
  ): void;
}

// ============================================
// 执行结果
// ============================================

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 是否成功 */
  readonly success: boolean;
  /** 响应内容 */
  readonly response: string;
  /** 上下文信息 */
  readonly context: BuildContext | null;
  /** 人设校验结果 */
  readonly validation: PersonaValidation | null;
  /** 延迟（毫秒） */
  readonly latency: number;
  /** 错误信息 */
  readonly error?: string;
}

/**
 * 流式响应结果
 */
export interface StreamResult {
  /** 流式 chunks */
  readonly chunks: AsyncGenerator<StreamChunk>;
  /** 完整响应 Promise */
  readonly finalResponse: Promise<string>;
}

// ============================================
// 节点依赖接口
// ============================================

/**
 * 上下文构建节点依赖
 */
export interface ContextBuildNodeDeps {
  memoryEngine: MemoryEngineLike;
}

/**
 * 响应生成节点依赖
 */
export interface GenerateNodeDeps {
  modelProvider: IModelProvider;
  personaEngine: PersonaEngine;
  memoryEngine: MemoryEngineLike;
  maxContextMessages: number;
}

/**
 * 人设校验节点依赖
 */
export interface ValidateNodeDeps {
  personaEngine: PersonaEngine;
  maxRetries: number;
}

/**
 * 人设强化节点依赖
 */
export interface EnforceNodeDeps {
  personaEngine: PersonaEngine;
  memoryEngine: MemoryEngineLike;
}

/**
 * 路由节点依赖
 */
export interface RouteNodeDeps {
  // 路由目前不需要外部依赖
}

// ============================================
// 常量与工厂
// ============================================

/**
 * 默认 Orchestrator 配置
 */
export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxRetries: 2,
  validationEnabled: true,
  personaEnforcementEnabled: true,
  streamingEnabled: true,
  maxContextMessages: 10,
};

/**
 * 创建初始状态
 */
export function createInitialState(
  sessionId: string,
  userId: string,
  input: string,
): AgentState {
  const now = Date.now();
  return {
    sessionId,
    userId,
    currentInput: input,
    currentResponse: null,
    messages: [],
    currentAgent: null,
    routeDecision: null,
    personaValidation: null,
    retryCount: 0,
    context: null,
    // 工具相关
    activeSkills: [],
    availableTools: [],
    pendingToolCalls: [],
    toolResults: [],
    toolCallIteration: 0,
    approvalState: null,
    // 元数据
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
}

/**
 * 状态更新辅助函数
 * 返回新状态对象，保持不可变性
 */
export function updateState<T extends AgentState>(
  state: T,
  updates: Partial<T>,
): T {
  return {
    ...state,
    ...updates,
    updatedAt: Date.now(),
  } as T;
}
