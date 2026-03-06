/**
 * Agent Core 实现
 *
 * @module agent/agent
 * @description Agent 核心：Pipeline + ReAct 循环 + 双模式运行
 *
 * 设计来源:
 * - agent-core.md: D1~D6, D13, D19/BG-1
 * - react-engineering.md: C1~C4
 * - platform-execution.md: D1, D2, D9
 */

import type {
  AgentConfig,
  AgentEvent,
  AgentInput,
  AgentResult,
  AgentStats,
  Identity,
  LLMMessage,
} from "./types.js";
import { DEFAULT_AGENT_CONFIG } from "./types.js";
import type { PlatformServices } from "./ports/platform-services.js";
import type { ToolDef } from "../platform/tools/types.js";
import { reactLoop } from "./react-loop.js";

// ============================================================================
// Agent 类
// ============================================================================

/**
 * Agent 核心类
 *
 * 职责:
 * - 持有不可变的 Identity
 * - 通过 Platform Services 访问基础设施
 * - 执行 Pipeline (PreProcess → ReAct → PostProcess)
 * - 支持双模式运行 (会话 / 后台)
 *
 * @example
 * ```typescript
 * const services: PlatformServices = {
 *   context: new ContextManagerAdapter(config),
 *   tools: new ToolExecutorAdapter(sandbox),
 *   // ...
 * };
 *
 * const agent = new Agent(identity, services);
 *
 * // 会话模式
 * const events = agent.execute(input, config);
 * for await (const event of events) {
 *   // 处理事件
 * }
 * ```
 */
export class Agent {
  // ============================================================================
  // 属性
  // ============================================================================

  /** Agent 身份 (不可变) */
  readonly #identity: Identity;

  /** Platform Services */
  readonly #services: PlatformServices;

  /** 会话处理锁 */
  readonly #sessionLocks: Map<string, Promise<void>> = new Map();

  /** 消息队列 */
  readonly #messageQueues: Map<string, PendingMessage[]> = new Map();

  /** 最大队列长度 */
  readonly #maxQueueSize = 3;

  // ============================================================================
  // 构造器
  // ============================================================================

  /**
   * 创建 Agent 实例
   *
   * @param identity - Agent 身份 (不可变)
   * @param services - Platform Services
   */
  constructor(identity: Identity, services: PlatformServices) {
    this.#identity = identity;
    this.#services = services;

    // 记录 Agent 创建
    this.#services.tracing.log({
      type: "agent_created",
      data: { roleId: identity.roleId },
    });
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 获取 Agent 身份
   */
  get identity(): Identity {
    return this.#identity;
  }

  /**
   * 执行 Agent
   *
   * @param input - Agent 输入
   * @param config - Agent 配置
   * @returns AgentEvent 流
   */
  async *execute(
    input: AgentInput,
    config: AgentConfig,
  ): AsyncGenerator<AgentEvent, AgentResult, unknown> {
    const fullConfig = this.#mergeConfig(config);
    const { sessionId } = fullConfig;

    // 检查处理锁 — 如果被占用，排队后立即返回 (C3 fix: 避免双重执行)
    if (this.#sessionLocks.has(sessionId)) {
      this.#queueMessage(input, fullConfig);

      this.#services.tracing.log({
        type: "message_queued",
        sessionId,
        data: { queueSize: this.#messageQueues.get(sessionId)?.length ?? 0 },
      });

      yield {
        type: "status",
        timestamp: Date.now(),
        message: "queued",
      } as AgentEvent;

      return {
        finalResponse: "",
        emotionTags: [],
        toolCalls: [],
        success: false,
        aborted: false,
        degraded: false,
        stats: this.#emptyStats(),
      };
    }

    // 创建处理锁 - 立即设置，避免竞态窗口
    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });
    this.#sessionLocks.set(sessionId, lockPromise);

    try {
      // 执行 Pipeline
      const result = yield* this.#executePipeline(input, fullConfig);
      return result;
    } finally {
      // 释放锁
      resolveLock!();
      this.#sessionLocks.delete(sessionId);

      // 处理队列中的下一条消息
      this.#processQueue(sessionId);
    }
  }

  /**
   * 中止 Agent 执行
   *
   * @param sessionId - 会话 ID
   */
  abort(sessionId: string): void {
    // 拒绝所有待处理的确认请求
    this.#services.approval.rejectAllPending(sessionId);

    // 清理该会话的消息队列 (防止泄露)
    this.#messageQueues.delete(sessionId);

    // 中止所有活跃的 Sub-Agent
    // (SubAgentManagerPort 会处理)

    this.#services.tracing.log({
      type: "agent_aborted",
      sessionId,
    });
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 合并配置
   */
  #mergeConfig(config: AgentConfig): AgentConfig {
    return {
      ...DEFAULT_AGENT_CONFIG,
      ...config,
    } as AgentConfig;
  }

  /**
   * 执行 Pipeline
   */
  async *#executePipeline(
    input: AgentInput,
    config: AgentConfig,
  ): AsyncGenerator<AgentEvent, AgentResult, unknown> {
    const { sessionId } = config;

    // 记录开始
    this.#services.tracing.log({
      type: "pipeline_start",
      sessionId,
      data: { mode: config.mode },
    });

    try {
      // ========== PreProcess ==========
      const preProcessResult = await this.#preProcess(input, config);

      // ========== H4: Timeout Signal ==========
      const timeoutSignal = AbortSignal.timeout(config.timeout);

      // ========== ReAct Loop ==========
      const reactGenerator = reactLoop({
        config,
        messages: preProcessResult.messages,
        tools: preProcessResult.tools,
        services: this.#services,
        signal: timeoutSignal,
        onIteration: (state) => {
          this.#services.tracing.logMetric(
            "react_iteration",
            state.iterations,
            { sessionId },
          );
        },
      });

      // 手动迭代捕获 generator return value (C1 fix)
      let finalResult: AgentResult | null = null;

      let iter = await reactGenerator.next();
      while (!iter.done) {
        yield iter.value;
        iter = await reactGenerator.next();
      }
      finalResult = iter.value ?? null;

      if (!finalResult) {
        throw new Error("ReAct loop did not return a result");
      }

      // ========== PostProcess ==========
      await this.#postProcess(finalResult, input, config);

      // 记录完成
      this.#services.tracing.log({
        type: "pipeline_complete",
        sessionId,
        data: {
          success: finalResult.success,
          degraded: finalResult.degraded,
          iterations: finalResult.stats.iterations,
        },
      });

      return finalResult;
    } catch (error) {
      // 系统级错误
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.#services.tracing.log({
        type: "pipeline_error",
        sessionId,
        level: "error",
        data: { error: errorMessage },
      });

      yield {
        type: "error",
        timestamp: Date.now(),
        code: "SYSTEM_ERROR",
        message: "Internal system error",  // H10: 脱敏，完整错误已记录到 tracing
      };

      return {
        finalResponse: "",
        emotionTags: [],
        toolCalls: [],
        success: false,
        aborted: false,
        degraded: true,
        degradationReason: "system_error",
        stats: this.#emptyStats(),
      };
    }
  }

  /**
   * PreProcess: 前处理
   *
   * 职责:
   * 1. 组装 Prompt
   * 2. 检查 Token 预算
   * 3. 获取工具定义
   * 4. 创建 AbortController
   */
  async #preProcess(
    input: AgentInput,
    config: AgentConfig,
  ): Promise<{
    messages: LLMMessage[];
    tools: ToolDef[];
  }> {
    const { sessionId } = config;

    // 1. 组装 Prompt
    const messages = await this.#services.context.assemblePrompt(input, config);

    // 2. 获取激活的 Skills 的工具定义
    const activeSkills = await this.#services.skills.getActiveSkills(sessionId);
    const skillIds = activeSkills.map((s) => s.id);
    const tools = await this.#services.tools.getToolDefinitions(skillIds);

    // 3. 记录
    this.#services.tracing.log({
      type: "preprocess_complete",
      sessionId,
      data: {
        messageCount: messages.length,
        toolCount: tools.length,
        skillCount: activeSkills.length,
      },
    });

    return {
      messages,
      tools,
    };
  }

  /**
   * PostProcess: 后处理
   *
   * 职责:
   * 1. 记录事件 (无需处理 emotion，已在 reactLoop 中处理)
   * 2. 写入记忆
   * 3. 更新 Session 状态
   */
  async #postProcess(
    result: AgentResult,
    input: AgentInput,
    config: AgentConfig,
  ): Promise<void> {
    const { sessionId, userId } = config;

    // 1. 记忆写入
    if (result.success && result.finalResponse) {
      // 记录用户消息
      await this.#services.memory.store(input.userMessage, userId, {
        type: "user_message",
      });

      // 记录角色回复 (附带 emotion_tags 供记忆检索时使用)
      const assistantMeta: Record<string, unknown> = {
        type: "assistant_response",
        roleId: this.#identity.roleId,
      };
      if (result.emotionTags.length > 0) {
        assistantMeta["emotionTags"] = [...result.emotionTags];
      }
      await this.#services.memory.store(
        result.finalResponse,
        userId,
        assistantMeta,
      );
    }

    // 2. 更新 Session 状态
    // (SessionManager 通过事件监听处理)

    // 3. 记录统计
    this.#services.tracing.logMetric("total_tokens", result.stats.totalTokens, {
      sessionId,
    });
    this.#services.tracing.logMetric(
      "response_time_ms",
      result.stats.duration,
      { sessionId },
    );

    // 4. 记录完成
    this.#services.tracing.log({
      type: "postprocess_complete",
      sessionId,
      data: {
        emotionTags: result.emotionTags,
        toolCallCount: result.toolCalls.length,
      },
    });
  }

  /**
   * 消息入队
   */
  #queueMessage(input: AgentInput, config: AgentConfig): boolean {
    const { sessionId } = config;

    if (!this.#messageQueues.has(sessionId)) {
      this.#messageQueues.set(sessionId, []);
    }

    const queue = this.#messageQueues.get(sessionId)!;

    if (queue.length >= this.#maxQueueSize) {
      // 丢弃最早的
      queue.shift();
    }

    queue.push({ input, config });
    return true;
  }

  /**
   * 处理队列
   */
  #processQueue(sessionId: string): void {
    const queue = this.#messageQueues.get(sessionId);
    if (!queue || queue.length === 0) {
      // 清理空队列，防止 Map 泄露 (B1 fix)
      this.#messageQueues.delete(sessionId);
      return;
    }

    const { input, config } = queue.shift()!;

    // 清理空队列 (B1 fix)
    if (queue.length === 0) {
      this.#messageQueues.delete(sessionId);
    }

    // 异步处理下一条消息 (手动迭代避免 C1 bug)
    void (async () => {
      try {
        const gen = this.execute(input, config);
        let iter = await gen.next();
        while (!iter.done) {
          // H8 fix: Forward queued message events through tracing
          const event = iter.value;
          this.#services.tracing.log({
            type: "queued_event",
            sessionId,
            data: { eventType: event.type },
          });
          iter = await gen.next();
        }

        // Log queued message result
        const result: AgentResult | undefined = iter.value;
        if (result) {
          this.#services.tracing.log({
            type: "queued_message_completed",
            sessionId,
            data: {
              success: result.success,
              hasResponse: result.finalResponse.length > 0,
            },
          });
        }
      } catch (error) {
        this.#services.tracing.log({
          type: "queue_processing_error",
          sessionId,
          level: "error",
          data: { error: String(error) },
        });
      }
    })();
  }

  /**
   * 空统计
   */
  #emptyStats(): AgentStats {
    return {
      iterations: 0,
      toolCallCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      duration: 0,
      compactCount: 0,
    };
  }
}

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 待处理消息
 */
interface PendingMessage {
  input: AgentInput;
  config: AgentConfig;
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Agent 实例
 *
 * @param identity - Agent 身份
 * @param services - Platform Services
 * @returns Agent 实例
 */
export function createAgent(
  identity: Identity,
  services: PlatformServices,
): Agent {
  return new Agent(identity, services);
}
