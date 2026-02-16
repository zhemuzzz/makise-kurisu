/**
 * L3 Agent 编排层 - LangGraph 状态定义
 *
 * 定义状态通道（channels）和 reducer 函数
 */

import type {
  AgentState,
  AgentMessage,
  RouteDecision,
  PersonaValidation,
} from "./types";
import type { BuildContext } from "../memory";
import { AgentRole, IntentType } from "./types";

// ============================================
// 状态通道定义
// ============================================

/**
 * 状态通道类型
 */
export interface StateChannel<T> {
  /** Reducer 函数：合并旧值和新值 */
  value: (x: T | undefined, y: T) => T;
  /** 默认值工厂 */
  default?: () => T;
}

/**
 * Agent 状态通道
 *
 * LangGraph 使用 channels 来定义状态如何更新
 * - value: reducer 函数，定义如何合并状态
 * - default: 初始值工厂
 */
export const agentStateChannels = {
  // 标识（不可变）
  sessionId: {
    value: (_: string | undefined, y: string) => y,
    default: () => "",
  },
  userId: {
    value: (_: string | undefined, y: string) => y,
    default: () => "",
  },

  // 输入输出（覆盖）
  currentInput: {
    value: (_: string | undefined, y: string) => y,
    default: () => "",
  },
  currentResponse: {
    value: (_: string | null | undefined, y: string | null) => y,
    default: () => null as string | null,
  },

  // 消息历史（累加）
  messages: {
    value: (
      x: readonly AgentMessage[] | undefined,
      y: readonly AgentMessage[],
    ) => [...(x ?? []), ...y] as readonly AgentMessage[],
    default: () => [] as readonly AgentMessage[],
  },

  // 流程控制（覆盖）
  currentAgent: {
    value: (_: AgentRole | null | undefined, y: AgentRole | null) => y,
    default: () => null as AgentRole | null,
  },
  routeDecision: {
    value: (_: RouteDecision | null | undefined, y: RouteDecision | null) => y,
    default: () => null as RouteDecision | null,
  },
  personaValidation: {
    value: (
      _: PersonaValidation | null | undefined,
      y: PersonaValidation | null,
    ) => y,
    default: () => null as PersonaValidation | null,
  },
  retryCount: {
    value: (_: number | undefined, y: number) => y,
    default: () => 0,
  },

  // 上下文（覆盖）
  context: {
    value: (_: BuildContext | null | undefined, y: BuildContext | null) => y,
    default: () => null as BuildContext | null,
  },

  // 元数据
  createdAt: {
    value: (_: number | undefined, y: number) => y,
    default: () => Date.now(),
  },
  updatedAt: {
    value: (_: number | undefined, y: number) => y,
    default: () => Date.now(),
  },
  metadata: {
    value: (
      _: Readonly<Record<string, unknown>> | undefined,
      y: Readonly<Record<string, unknown>>,
    ) => y,
    default: () => ({}) as Readonly<Record<string, unknown>>,
  },
};

// ============================================
// 状态辅助函数
// ============================================

/**
 * 检查是否需要重试生成
 */
export function needsRetry(state: AgentState): boolean {
  const maxRetries =
    (state.metadata as { maxRetries?: number })?.maxRetries ?? 2;
  return (
    state.personaValidation?.shouldRegenerate === true &&
    state.retryCount < maxRetries
  );
}

/**
 * 检查是否已完成
 */
export function isComplete(state: AgentState): boolean {
  return (
    state.currentResponse !== null &&
    (state.personaValidation?.isValid === true || state.retryCount >= 2)
  );
}

/**
 * 获取下一个节点（用于条件路由）
 */
export function getNextNode(state: AgentState): string {
  // 有错误时结束
  if ((state.metadata as { error?: string })?.error) {
    return "end";
  }

  // 需要重试
  if (needsRetry(state)) {
    return state.currentAgent === AgentRole.TASK ? "task" : "conversation";
  }

  // 完成
  if (isComplete(state)) {
    return "end";
  }

  // 默认继续
  return "continue";
}

/**
 * 根据意图路由到对应 Agent
 */
export function routeByIntent(state: AgentState): string {
  const intent = state.routeDecision?.intent ?? IntentType.UNKNOWN;

  switch (intent) {
    case IntentType.TASK:
      return "task";
    case IntentType.CONVERSATION:
    default:
      return "conversation";
  }
}

// ============================================
// 导出类型
// ============================================

// StateChannel is defined above with export keyword
