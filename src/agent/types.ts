/**
 * Agent Core 类型定义
 *
 * @module agent/types
 * @description Agent 核心类型：Identity, AgentEvent, AgentConfig, AgentInput, AgentResult
 *
 * 设计结论来源:
 * - agent-core.md: D1~D6, D13, D19/BG-1
 * - react-engineering.md: C1~C4
 * - context-manager.md: CM-1~CM-7
 */

import type { ToolDef, ToolCall, ToolResult } from "../platform/tools/types.js";

// ============================================================================
// Identity - Agent 不可变身份
// ============================================================================

/**
 * Agent 身份定义
 *
 * Identity 是 Agent 的固有属性，部署时确定，运行时不可变。
 * Platform 仅负责注入，无权修改。
 *
 * Token 预算: ~1600 tokens (固定注入，绝不裁剪)
 * - soul: ~800 tokens
 * - persona: ~400 tokens
 * - loreCore: ~300 tokens
 * - mentalModel: ~80 tokens (由 ILE 动态生成)
 *
 * @see agent-core.md 第五节
 */
export interface Identity {
  /** 角色 ID (目录名) */
  readonly roleId: string;

  /** 灵魂层：第一人称散文，定义"我是谁"——信念、价值观、内心独白 */
  readonly soul: string;

  /** 表现层：结构化数据，定义"我如何表达"——口癖、语气、情境反应模式 */
  readonly persona: PersonaConfig;

  /** 世界观核心摘要 (从 lore.md <!-- core --> 提取) */
  readonly loreCore: string;
}

/**
 * Persona 配置结构
 */
export interface PersonaConfig {
  /** 角色名称 */
  readonly name: string;

  /** 角色描述 */
  readonly description?: string;

  /** 口癖列表 */
  readonly catchphrases?: readonly string[];

  /** 语气风格 */
  readonly tone?: string;

  /** 情境反应模式 */
  readonly reactions?: Record<string, string>;

  /** 其他自定义属性 */
  readonly [key: string]: unknown;
}

// ============================================================================
// AgentEvent - 流式事件类型 (C3-1)
// ============================================================================

/**
 * Agent 事件类型枚举
 *
 * @see react-engineering.md C3-1
 */
export type AgentEventType =
  | "text_delta"
  | "tool_start"
  | "tool_end"
  | "error"
  | "status"
  | "complete";

/**
 * Agent 事件基类
 */
export interface AgentEventBase {
  /** 事件类型 */
  readonly type: AgentEventType;

  /** 时间戳 (毫秒) */
  readonly timestamp: number;
}

/**
 * 文本增量事件
 *
 * ContextManager 处理后的用户可见内容
 */
export interface TextDeltaEvent extends AgentEventBase {
  readonly type: "text_delta";
  /** 增量文本内容 */
  readonly content: string;
}

/**
 * 工具开始事件
 *
 * Platform 开始执行工具前触发
 */
export interface ToolStartEvent extends AgentEventBase {
  readonly type: "tool_start";
  /** 工具名称 */
  readonly toolName: string;
  /** 工具参数 */
  readonly args: unknown;
}

/**
 * 工具结束事件
 *
 * 工具执行完成后触发
 */
export interface ToolEndEvent extends AgentEventBase {
  readonly type: "tool_end";
  /** 工具名称 */
  readonly toolName: string;
  /** 执行结果摘要 */
  readonly result: ToolResultBrief;
}

/**
 * 工具结果摘要
 */
export interface ToolResultBrief {
  /** 是否成功 */
  readonly success: boolean;
  /** 错误码 (失败时) */
  readonly errorCode?: string;
  /** 错误消息 (失败时) */
  readonly errorMessage?: string;
}

/**
 * 错误事件
 *
 * 仅在 SYSTEM_ERROR 时 yield
 * TOOL_ERROR 是 ReAct 正常部分，不触发此事件
 */
export interface ErrorEvent extends AgentEventBase {
  readonly type: "error";
  /** 错误码 */
  readonly code: string;
  /** 错误消息 */
  readonly message: string;
}

/**
 * 状态事件
 *
 * 非内容性状态变化
 */
export interface StatusEvent extends AgentEventBase {
  readonly type: "status";
  /** 状态消息 */
  readonly message: string;
  /** 状态详情 */
  readonly details?: Record<string, unknown>;
}

/**
 * 完成事件
 *
 * ReAct 循环结束时触发
 */
export interface CompleteEvent extends AgentEventBase {
  readonly type: "complete";
  /** 情绪标签 (从 LLM 输出末尾提取) */
  readonly emotionTags?: string[];
  /** 最终响应文本 */
  readonly finalResponse: string;
  /** 工具调用记录 */
  readonly toolCalls: readonly ToolCallRecord[];
  /** 是否降级 */
  readonly degraded: boolean;
  /** 降级原因 */
  readonly degradationReason?: string;
}

/**
 * 工具调用记录
 */
export interface ToolCallRecord {
  /** 工具名称 */
  readonly toolName: string;
  /** 调用参数 */
  readonly args: unknown;
  /** 执行结果 */
  readonly result: ToolResult;
  /** 执行时长 (毫秒) */
  readonly duration: number;
}

/**
 * Agent 事件联合类型
 */
export type AgentEvent =
  | TextDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | ErrorEvent
  | StatusEvent
  | CompleteEvent;

// ============================================================================
// AgentConfig - Agent 配置
// ============================================================================

/**
 * Agent 运行模式
 *
 * @see agent-core.md D19/BG-1
 */
export type AgentMode = "conversation" | "background";

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** 运行模式 */
  readonly mode: AgentMode;

  /** 最大迭代次数 (Main Agent: 25, Sub-Agent: 15) */
  readonly maxIterations: number;

  /** 超时时间 (毫秒) */
  readonly timeout: number;

  /** 会话 ID */
  readonly sessionId: string;

  /** 用户 ID */
  readonly userId: string;

  /** 是否为 Sub-Agent */
  readonly isSubAgent: boolean;

  /** 父 Agent ID (Sub-Agent 时) */
  readonly parentAgentId?: string;

  /** 是否启用调试模式 */
  readonly debugEnabled: boolean;
}

/**
 * 默认 Agent 配置
 */
export const DEFAULT_AGENT_CONFIG: Partial<AgentConfig> = {
  mode: "conversation",
  maxIterations: 25,
  timeout: 120000, // 2 分钟
  isSubAgent: false,
  debugEnabled: false,
} as const;

// ============================================================================
// AgentInput - Agent 输入
// ============================================================================

/**
 * Agent 输入
 */
export interface AgentInput {
  /** 用户消息 */
  readonly userMessage: string;

  /** 预激活的 Skills (由 Platform 意图分类决定) */
  readonly activatedSkills: readonly ActivatedSkill[];

  /** 召回的记忆片段 */
  readonly recalledMemories: readonly MemoryFragment[];

  /** 对话历史 (精简后) */
  readonly conversationHistory: readonly ConversationTurn[];

  /** Mental Model 快照 (由 ILE 生成) */
  readonly mentalModel: MentalModelSnapshot;

  /** 当前 todo 状态 (由 manage-todo 维护) */
  readonly todoState?: TodoState;

  /** 任务目标 (后台模式) */
  readonly taskGoal?: string;
}

/**
 * 激活的 Skill
 */
export interface ActivatedSkill {
  /** Skill ID */
  readonly id: string;

  /** Skill 名称 */
  readonly name: string;

  /** 注入级别: full (Top-1) | tools-only (Top 2-3) */
  readonly injectionLevel: "full" | "tools-only";

  /** 知识内容 (full 级别) */
  readonly knowledge?: string;

  /** 示例 (full 级别) */
  readonly examples?: readonly SkillExample[];

  /** 工具定义 */
  readonly tools: readonly ToolDef[];
}

/**
 * Skill 示例
 */
export interface SkillExample {
  readonly user: string;
  readonly assistant: string;
}

/**
 * 记忆片段
 */
export interface MemoryFragment {
  /** 内容 */
  readonly content: string;

  /** 相关性分数 */
  readonly relevanceScore: number;

  /** 来源 */
  readonly source: string;

  /** 时间戳 */
  readonly timestamp: number;
}

/**
 * 对话轮次
 */
export interface ConversationTurn {
  /** 角色: user | assistant | system */
  readonly role: "user" | "assistant" | "system";

  /** 内容 */
  readonly content: string;

  /** 时间戳 */
  readonly timestamp: number;

  /** 工具调用 (assistant 时) */
  readonly toolCalls?: readonly ToolCall[];

  /** 工具结果 (system 时) */
  readonly toolResults?: readonly ToolResult[];
}

/**
 * Mental Model 快照
 *
 * 由 Inner Life Engine 动态生成
 *
 * @see persona-inner-life.md
 */
export interface MentalModelSnapshot {
  /** 心境 (PAD 向量) */
  readonly mood: {
    readonly pleasure: number; // -1 到 1
    readonly arousal: number; // -1 到 1
    readonly dominance: number; // -1 到 1
  };

  /** 活跃情绪标签 */
  readonly activeEmotions: readonly string[];

  /** 关系阶段 (1-5) */
  readonly relationshipStage: number;

  /** 关系描述 */
  readonly relationshipDescription: string;

  /** 格式化文本 (直接注入 prompt) */
  readonly formattedText: string;
}

/**
 * Todo 状态
 *
 * @see meta-tools.md 第二节
 */
export interface TodoState {
  /** Todo 列表 */
  readonly todos: readonly TodoItem[];

  /** 格式化文本 (直接注入 prompt) */
  readonly formattedText: string;
}

/**
 * Todo 项
 */
export interface TodoItem {
  readonly id: string;
  readonly content: string;
  readonly status: "pending" | "in_progress" | "completed" | "cancelled";
}

// ============================================================================
// AgentResult - Agent 执行结果
// ============================================================================

/**
 * Agent 执行结果
 */
export interface AgentResult {
  /** 最终响应文本 */
  readonly finalResponse: string;

  /** 情绪标签 */
  readonly emotionTags: string[];

  /** 工具调用记录 */
  readonly toolCalls: readonly ToolCallRecord[];

  /** 是否成功完成 */
  readonly success: boolean;

  /** 是否被中断 */
  readonly aborted: boolean;

  /** 是否降级 */
  readonly degraded: boolean;

  /** 降级原因 */
  readonly degradationReason?: string;

  /** 错误信息 (失败时) */
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };

  /** 执行统计 */
  readonly stats: AgentStats;
}

/**
 * Agent 执行统计
 */
export interface AgentStats {
  /** 总迭代次数 */
  readonly iterations: number;

  /** 工具调用次数 */
  readonly toolCallCount: number;

  /** 总 token 使用量 */
  readonly totalTokens: number;

  /** 输入 token */
  readonly inputTokens: number;

  /** 输出 token */
  readonly outputTokens: number;

  /** 执行时长 (毫秒) */
  readonly duration: number;

  /** Compact 次数 */
  readonly compactCount: number;
}

// ============================================================================
// 错误类型 (C1-1)
// ============================================================================

/**
 * 错误分类
 *
 * @see react-engineering.md C1-1
 */
export type ErrorClassification =
  | "TOOL_ERROR"
  | "TRANSIENT"
  | "SYSTEM_ERROR"
  | "PERMISSION_DENIED"
  | "USER_REJECTED";

/**
 * 错误码枚举
 */
export const ErrorCode = {
  // TOOL_ERROR
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  TIMEOUT: "TIMEOUT",
  INVALID_PARAMS: "INVALID_PARAMS",

  // TRANSIENT
  NETWORK_ERROR: "NETWORK_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  MCP_CONNECTION_LOST: "MCP_CONNECTION_LOST",

  // SYSTEM_ERROR
  LLM_ERROR: "LLM_ERROR",
  CONTEXT_OVERFLOW: "CONTEXT_OVERFLOW",
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",

  // PERMISSION
  PERMISSION_DENIED: "PERMISSION_DENIED",
  USER_REJECTED: "USER_REJECTED",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ============================================================================
// 降级模板 (C1-2)
// ============================================================================

/**
 * 降级场景
 *
 * @see react-engineering.md C1-2
 */
export type DegradationScenario =
  | "max_iterations"
  | "token_budget_exhausted"
  | "system_error";

/**
 * 降级模板
 */
export interface DegradationTemplate {
  /** 场景 */
  readonly scenario: DegradationScenario;

  /** 模板文本 (由 PersonaWrapper 处理) */
  readonly template: string;
}

/**
 * 默认降级模板
 */
export const DEFAULT_DEGRADATION_TEMPLATES: readonly DegradationTemplate[] = [
  {
    scenario: "max_iterations",
    template:
      "抱歉，这个任务有点复杂，我暂时没法完全完成。让我先总结一下目前的进展...",
  },
  {
    scenario: "token_budget_exhausted",
    template:
      "唔...要处理的内容有点多，我的脑子有点转不过来了。能不能把问题简化一下？",
  },
  {
    scenario: "system_error",
    template: "出了点技术问题，我需要休息一下。稍后再试试？",
  },
] as const;

// ============================================================================
// 辅助函数类型
// ============================================================================

/**
 * LLM 消息格式
 */
export interface LLMMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolCallId?: string;
}

/**
 * LLM 响应格式
 */
export interface LLMResponse {
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly finishReason: "stop" | "tool_calls" | "length" | "error";
  readonly usage: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
}

/**
 * Abort 信号处理器
 */
export interface AbortHandler {
  readonly signal: AbortSignal;
  readonly isAborted: () => boolean;
  readonly checkAborted: () => void;
}

/**
 * 创建 Abort 处理器
 */
export function createAbortHandler(signal?: AbortSignal): AbortHandler {
  const internalSignal = signal ?? new AbortController().signal;
  return {
    signal: internalSignal,
    isAborted: () => internalSignal.aborted,
    checkAborted: () => {
      if (internalSignal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
    },
  };
}
