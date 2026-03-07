/**
 * Platform Services Port 接口定义
 *
 * @module agent/ports/platform-services
 * @description Agent 侧定义的 Port 接口，Platform 负责实现 Adapter
 *
 * 设计原则:
 * - Port 接口定义权归 Agent 侧 (D1)
 * - Agent 仅依赖自己定义的 Port 接口，不依赖 Platform 具体实现
 * - 接口变更由 Agent 侧发起，Platform 侧跟进实现
 *
 * @see platform-execution.md 第九节 (D1, D2)
 */

import type {
  AgentConfig,
  AgentInput,
  AgentStats,
  ConversationTurn,
  LLMMessage,
  LLMResponse,
} from "../types.js";
import type {
  ToolDef,
  ToolCall,
  ToolResult,
} from "../../platform/tools/types.js";

// ============================================================================
// ContextManagerPort - 上下文管理
// ============================================================================

/**
 * 上下文管理 Port
 *
 * 负责: Prompt 组装 + Token 预算 + 9 级优先队列 + 输出处理 + Compact
 *
 * @see context-manager.md CM-1~CM-7
 */
export interface ContextManagerPort {
  /**
   * 组装 Prompt
   *
   * 按优先级组装各个上下文片段，返回 LLM 可用的消息格式
   *
   * @param input - Agent 输入
   * @param config - Agent 配置
   * @returns 组装后的 LLM 消息列表
   */
  assemblePrompt(input: AgentInput, config: AgentConfig): Promise<LLMMessage[]>;

  /**
   * 检查 Token 预算
   *
   * @param messages - 当前消息列表
   * @returns 预算检查结果
   */
  checkBudget(messages: LLMMessage[]): BudgetCheckResult;

  /**
   * 处理 LLM 输出
   *
   * - 剥离 <thinking> 标签
   * - 提取 emotion_tags
   * - 处理工具结果截断
   *
   * @param rawOutput - LLM 原始输出
   * @returns 处理后的输出
   */
  processLLMOutput(rawOutput: string): ProcessedOutput;

  /**
   * 处理工具结果
   *
   * - Shell 输出 tail-preserve
   * - 默认输出 head-preserve
   *
   * @param result - 工具执行结果
   * @param toolName - 工具名称
   * @param maxLength - 最大长度
   * @returns 处理后的结果文本
   */
  processToolResult(
    result: ToolResult,
    toolName: string,
    maxLength?: number,
  ): string;

  /**
   * 执行 Compact
   *
   * 当 Token 预算不足时，压缩历史对话
   *
   * @param messages - 当前消息列表
   * @param preservedIds - 需要保留的消息 ID
   * @returns Compact 后的消息列表
   */
  compact(
    messages: LLMMessage[],
    preservedIds?: string[],
  ): Promise<CompactResult>;

  /**
   * 获取上下文统计
   */
  getStats(): ContextStats;
}

/**
 * Token 预算检查结果
 */
export interface BudgetCheckResult {
  /** 是否在预算内 */
  readonly withinBudget: boolean;

  /** 当前 token 数量 */
  readonly currentTokens: number;

  /** 预算上限 */
  readonly maxTokens: number;

  /** 剩余 token */
  readonly remainingTokens: number;

  /** 是否需要 compact */
  readonly shouldCompact: boolean;

  /** 是否需要降级 */
  readonly shouldDegrade: boolean;

  /** 裁剪建议 */
  readonly trimSuggestions?: readonly TrimSuggestion[];
}

/**
 * 裁剪建议
 */
export interface TrimSuggestion {
  readonly priority: number;
  readonly category: string;
  readonly suggestedAction: "reduce" | "remove";
  readonly estimatedSavings: number;
}

/**
 * 处理后的输出
 */
export interface ProcessedOutput {
  /** 用户可见内容 */
  readonly visibleContent: string;

  /** 思考内容 (写入 debug 日志) */
  readonly thinkingContent?: string;

  /** 情绪标签 */
  readonly emotionTags?: string[];

  /** 是否被截断 */
  readonly truncated: boolean;
}

/**
 * Compact 结果
 */
export interface CompactResult {
  /** Compact 后的消息列表 */
  readonly messages: LLMMessage[];

  /** 压缩前 token 数 */
  readonly tokensBefore: number;

  /** 压缩后 token 数 */
  readonly tokensAfter: number;

  /** 是否成功 */
  readonly success: boolean;

  /** Compact 摘要 (替换历史) */
  readonly summary?: string;
}

/**
 * 上下文统计
 */
export interface ContextStats {
  /** 总 token 数 */
  readonly totalTokens: number;

  /** 各优先级 token 分布 */
  readonly priorityDistribution: Record<number, number>;

  /** Compact 次数 */
  readonly compactCount: number;

  /** 最后一次 compact 时间 */
  readonly lastCompactTime?: number;
}

// ============================================================================
// ToolExecutorPort - 工具执行
// ============================================================================

/**
 * 工具执行 Port
 *
 * 负责: 工具沙箱执行 + 权限校验 + 超时处理
 *
 * @see platform-execution.md 第四节
 */
export interface ToolExecutorPort {
  /**
   * 执行工具
   *
   * @param toolCall - 工具调用
   * @param sessionId - 会话 ID
   * @param signal - Abort 信号
   * @returns 执行结果
   */
  execute(
    toolCall: ToolCall,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ToolResult>;

  /**
   * 批量执行工具
   *
   * @param toolCalls - 工具调用列表
   * @param sessionId - 会话 ID
   * @param signal - Abort 信号
   * @returns 执行结果列表
   */
  executeBatch(
    toolCalls: ToolCall[],
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ToolResult[]>;

  /**
   * 获取工具定义列表
   *
   * @param skillIds - Skill ID 列表 (可选，不传则返回所有)
   * @returns 工具定义列表
   */
  getToolDefinitions(skillIds?: string[]): Promise<ToolDef[]>;

  /**
   * 检查工具是否可用
   *
   * @param toolName - 工具名称
   * @returns 是否可用
   */
  isToolAvailable(toolName: string): boolean;
}

// ============================================================================
// SkillManagerPort - Skill 管理
// ============================================================================

/**
 * Skill 管理 Port
 *
 * 负责: Skill 注册/搜索/激活/分层注入
 *
 * @see skill-system.md D7, D14, D15
 */
export interface SkillManagerPort {
  /**
   * 搜索 Skill
   *
   * @param query - 搜索查询
   * @param limit - 返回数量限制
   * @returns 匹配的 Skill 列表
   */
  findSkill(query: string, limit?: number): Promise<SkillSearchResult[]>;

  /**
   * 获取激活的 Skills
   *
   * @param sessionId - 会话 ID
   * @returns 激活的 Skill 列表
   */
  getActiveSkills(sessionId: string): Promise<SkillActivation[]>;

  /**
   * 激活 Skill
   *
   * @param skillId - Skill ID
   * @param sessionId - 会话 ID
   * @param injectionLevel - 注入级别
   * @returns 激活结果
   */
  activate(
    skillId: string,
    sessionId: string,
    injectionLevel: "full" | "tools-only",
  ): Promise<SkillActivation>;

  /**
   * 归档 Skill
   *
   * @param skillId - Skill ID
   * @param reason - 归档原因
   * @returns 是否成功
   */
  archive(skillId: string, reason: string): Promise<boolean>;

  /**
   * 创建 Skill 草稿
   *
   * @param draft - Skill 草稿
   * @returns 草稿 ID
   */
  createDraft(draft: SkillDraft): Promise<string>;

  /**
   * 确认 Skill 草稿
   *
   * @param draftId - 草稿 ID
   * @returns 是否成功
   */
  confirmDraft(draftId: string): Promise<boolean>;

  /**
   * 获取 Skill 声明的默认模型
   *
   * @param skillId - Skill ID
   * @returns 模型名称（skill.yaml 中声明），无声明时返回 undefined
   */
  getSkillModel?(skillId: string): string | undefined;
}

/**
 * Skill 搜索结果
 */
export interface SkillSearchResult {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly status: "active" | "archived";
  readonly relevanceScore: number;
}

/**
 * Skill 激活状态
 */
export interface SkillActivation {
  readonly id: string;
  readonly name: string;
  readonly injectionLevel: "full" | "tools-only";
  readonly activatedAt: number;
}

/**
 * Skill 草稿
 */
export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly knowledge?: string;
  readonly tools?: Record<string, unknown>;
  readonly examples?: Array<{ user: string; assistant: string }>;
}

// ============================================================================
// SubAgentManagerPort - Sub-Agent 管理
// ============================================================================

/**
 * Sub-Agent 管理 Port
 *
 * 负责: Sub-Agent 生命周期管理 + 人设隔离 + 权限继承
 *
 * @see sub-agent.md SA-1~SA-11
 */
export interface SubAgentManagerPort {
  /**
   * 创建 Sub-Agent
   *
   * @param config - Sub-Agent 配置
   * @returns Sub-Agent ID
   */
  spawn(config: SubAgentConfig): Promise<string>;

  /**
   * 等待 Sub-Agent 完成
   *
   * @param subAgentId - Sub-Agent ID
   * @param signal - Abort 信号
   * @returns Sub-Agent 执行结果
   */
  awaitResult(
    subAgentId: string,
    signal?: AbortSignal,
  ): Promise<SubAgentResult>;

  /**
   * 中止 Sub-Agent
   *
   * @param subAgentId - Sub-Agent ID
   * @returns 是否成功
   */
  abort(subAgentId: string): Promise<boolean>;

  /**
   * 获取活跃 Sub-Agent 数量
   *
   * @param sessionId - 会话 ID
   * @returns 数量
   */
  getActiveCount(sessionId: string): number;

  /**
   * 获取 Sub-Agent 状态
   *
   * @param subAgentId - Sub-Agent ID
   * @returns 状态
   */
  getStatus(subAgentId: string): SubAgentStatus;
}

/**
 * Sub-Agent 配置
 */
export interface SubAgentConfig {
  /** 父 Agent ID */
  readonly parentAgentId: string;

  /** 会话 ID */
  readonly sessionId: string;

  /** 任务目标 */
  readonly taskGoal: string;

  /** 上下文切片 (5-10 轮对话) */
  readonly contextSlice: ConversationTurn[];

  /** 分配的 Skills */
  readonly skillIds: string[];

  /** 最大迭代次数 (默认 15) */
  readonly maxIterations?: number;

  /** 超时时间 (毫秒, 默认 60000) */
  readonly timeout?: number;

  /** 返回格式 */
  readonly returnFormat: "structured" | "natural";

  /** 指定模型 ID（可选，覆盖 skill 默认） */
  readonly modelId?: string;
}

/**
 * Sub-Agent 执行结果
 */
export interface SubAgentResult {
  readonly subAgentId: string;
  readonly success: boolean;
  readonly result: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly stats: AgentStats;
}

/**
 * Sub-Agent 状态
 */
export type SubAgentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "aborted";

// ============================================================================
// PermissionPort - 权限检查
// ============================================================================

/**
 * 权限检查 Port
 *
 * 负责: 统一权限判定 + 工具权限标注
 *
 * @see permission-service.md PS-1~PS-4
 */
export interface PermissionPort {
  /**
   * 检查工具权限
   *
   * @param toolName - 工具名称
   * @param args - 工具参数
   * @param sessionId - 会话 ID
   * @returns 权限检查结果
   */
  check(
    toolName: string,
    args: unknown,
    sessionId: string,
  ): Promise<PermissionResult>;

  /**
   * 获取工具权限标注
   *
   * 用于注入 Prompt，让 Agent 知道哪些工具需要确认
   *
   * @param toolName - 工具名称
   * @returns 权限标注
   */
  getToolAnnotation(toolName: string): ToolPermissionAnnotation;

  /**
   * 批量获取工具权限标注
   *
   * @param toolNames - 工具名称列表
   * @returns 权限标注映射
   */
  getToolAnnotations(
    toolNames: string[],
  ): Record<string, ToolPermissionAnnotation>;
}

/**
 * 权限检查结果
 */
export interface PermissionResult {
  /** 权限级别 */
  readonly level: "allow" | "confirm" | "deny";

  /** 是否允许执行 */
  readonly allowed: boolean;

  /** 是否需要用户确认 */
  readonly requiresConfirmation: boolean;

  /** 拒绝原因 (deny 时) */
  readonly reason?: string;

  /** 权限说明 */
  readonly note?: string;
}

/**
 * 工具权限标注
 */
export interface ToolPermissionAnnotation {
  /** 工具名称 */
  readonly toolName: string;

  /** 权限级别 */
  readonly level: "safe" | "confirm" | "deny";

  /** 权限说明 */
  readonly note?: string;

  /** 风险描述 (confirm 时) */
  readonly riskDescription?: string;
}

// ============================================================================
// ApprovalPort - 用户确认
// ============================================================================

/**
 * 用户确认 Port
 *
 * 负责: confirm 流程的 suspend-confirm-resume
 *
 * @see permission-service.md PS-3
 */
export interface ApprovalPort {
  /**
   * 请求用户确认
   *
   * 暂停当前 ReAct 循环，等待用户确认
   *
   * @param request - 确认请求
   * @returns 确认请求 ID
   */
  requestApproval(request: ApprovalRequest): Promise<string>;

  /**
   * 等待用户响应
   *
   * @param approvalId - 确认请求 ID
   * @param signal - Abort 信号
   * @returns 用户响应
   */
  awaitResponse(
    approvalId: string,
    signal?: AbortSignal,
  ): Promise<ApprovalResponse>;

  /**
   * 处理用户响应
   *
   * 由 Gateway 调用，当用户回复确认/拒绝消息时
   *
   * @param approvalId - 确认请求 ID
   * @param response - 用户响应
   */
  handleUserResponse(approvalId: string, response: UserApprovalAction): void;

  /**
   * 拒绝所有待处理的确认请求
   *
   * 会话结束或 Abort 时调用
   *
   * @param sessionId - 会话 ID
   */
  rejectAllPending(sessionId: string): void;

  /**
   * 获取待处理的确认请求数量
   *
   * @param sessionId - 会话 ID
   * @returns 数量
   */
  getPendingCount(sessionId: string): number;
}

/**
 * 确认请求
 */
export interface ApprovalRequest {
  readonly sessionId: string;
  readonly toolName: string;
  readonly args: unknown;
  readonly reason: string;
  readonly riskDescription?: string;
  readonly timeout?: number;
}

/**
 * 确认响应
 */
export interface ApprovalResponse {
  readonly approvalId: string;
  readonly action: UserApprovalAction;
  readonly userMessage?: string;
}

/**
 * 用户确认动作
 */
export type UserApprovalAction = "approve" | "reject" | "timeout";

// ============================================================================
// TracingPort - 可观测性
// ============================================================================

/**
 * 可观测性 Port
 *
 * 负责: 事件日志 + 指标上报
 *
 * @see tracing-service.md TS-1~TS-6
 */
export interface TracingPort {
  /**
   * 记录事件
   *
   * @param event - 事件
   */
  log(event: TracingEvent): void;

  /**
   * 记录指标
   *
   * @param name - 指标名称
   * @param value - 指标值
   * @param tags - 标签
   */
  logMetric(name: string, value: number, tags?: Record<string, string>): void;

  /**
   * 开始 Span
   *
   * @param name - Span 名称
   * @param parentId - 父 Span ID
   * @returns Span ID
   */
  startSpan(name: string, parentId?: string): string;

  /**
   * 结束 Span
   *
   * @param spanId - Span ID
   */
  endSpan(spanId: string): void;
}

/**
 * 追踪事件
 */
export interface TracingEvent {
  readonly type: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly data?: Record<string, unknown>;
  readonly level?: "debug" | "info" | "warn" | "error";
}

// ============================================================================
// MemoryPort - 记忆管理
// ============================================================================

/**
 * 记忆管理 Port
 *
 * 负责: 记忆召回 + 记忆写入
 */
export interface MemoryPort {
  /**
   * 召回相关记忆
   *
   * @param query - 查询
   * @param userId - 用户 ID
   * @param limit - 返回数量限制
   * @returns 记忆片段列表
   */
  recall(
    query: string,
    userId: string,
    limit?: number,
  ): Promise<MemoryRecallResult[]>;

  /**
   * 写入记忆
   *
   * @param content - 记忆内容
   * @param userId - 用户 ID
   * @param metadata - 元数据
   */
  store(
    content: string,
    userId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * 记忆召回结果
 */
export interface MemoryRecallResult {
  readonly content: string;
  readonly relevanceScore: number;
  readonly source: string;
  readonly timestamp: number;
}

// ============================================================================
// LLMProviderPort - LLM 调用
// ============================================================================

/**
 * LLM 提供者 Port
 *
 * 负责: LLM 调用 + 流式输出
 */
export interface LLMProviderPort {
  /**
   * 流式调用 LLM
   *
   * @param messages - 消息列表
   * @param tools - 工具定义
   * @param config - 调用配置
   * @param signal - Abort 信号
   * @returns 流式响应
   */
  stream(
    messages: LLMMessage[],
    tools: ToolDef[],
    config: LLMCallConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown>;

  /**
   * 获取可用模型列表
   */
  getAvailableModels(): string[];

  /**
   * 检查模型是否可用
   */
  isModelAvailable(modelId: string): boolean;
}

/**
 * LLM 调用配置
 */
export interface LLMCallConfig {
  readonly modelId: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly topP?: number;
  readonly stopSequences?: string[];
}

/**
 * LLM 流式块
 */
export interface LLMStreamChunk {
  readonly delta: string;
  readonly toolCalls?: Partial<ToolCall>[];
  readonly finishReason?: "stop" | "tool_calls" | "length";
}

// ============================================================================
// PlatformServices - 聚合接口
// ============================================================================

/**
 * Platform Services 聚合接口
 *
 * Agent 通过此接口访问所有 Platform 服务
 * 构造器注入: `new Agent(identity, services: PlatformServices)`
 *
 * @see platform-execution.md D2
 */
export interface PlatformServices {
  readonly context: ContextManagerPort;
  readonly tools: ToolExecutorPort;
  readonly skills: SkillManagerPort;
  readonly subAgents: SubAgentManagerPort;
  readonly permission: PermissionPort;
  readonly approval: ApprovalPort;
  readonly tracing: TracingPort;
  readonly memory: MemoryPort;
  readonly llm: LLMProviderPort;
}
