/**
 * ReAct 循环实现
 *
 * @module agent/react-loop
 * @description 实现 ReAct (Reasoning + Acting) 循环
 *
 * 设计来源:
 * - agent-core.md: D1~D6
 * - react-engineering.md: C1~C4
 * - context-manager.md: CM-1~CM-7
 */

import type {
  AgentConfig,
  AgentEvent,
  AgentStats,
  DegradationScenario,
  LLMMessage,
  LLMResponse,
  ToolCallRecord,
} from "./types.js";
import { ErrorCode, type ErrorCodeType } from "./types.js";
import type { PlatformServices } from "./ports/platform-services.js";
import type { ToolCall, ToolResult, ToolDef } from "../platform/tools/types.js";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * ReAct 循环状态
 */
export interface ReactLoopState {
  /** 当前迭代次数 */
  iterations: number;

  /** 累积的文本内容 */
  accumulatedContent: string;

  /** 工具调用记录 */
  toolCalls: ToolCallRecord[];

  /** 是否已降级 */
  degraded: boolean;

  /** 降级原因 */
  degradationReason?: string;

  /** Compact 次数 */
  compactCount: number;

  /** TRANSIENT 错误重试次数 */
  transientRetryCount: number;

  /** Token 统计 */
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };

  /** 开始时间 */
  startTime: number;
}

/**
 * ReAct 循环选项
 */
export interface ReactLoopOptions {
  /** Agent 配置 */
  config: AgentConfig;

  /** 初始消息列表 */
  messages: LLMMessage[];

  /** 工具定义 */
  tools: ToolDef[];

  /** Platform Services */
  services: PlatformServices;

  /** Abort 信号 */
  signal?: AbortSignal;

  /** 迭代回调 (用于调试) */
  onIteration?: (state: ReactLoopState) => void;
}

/**
 * ReAct 循环结果
 */
export interface ReactLoopResult {
  /** 最终响应文本 */
  finalResponse: string;

  /** 情绪标签 */
  emotionTags: string[];

  /** 工具调用记录 */
  toolCalls: ToolCallRecord[];

  /** 是否成功完成 */
  success: boolean;

  /** 是否被中断 */
  aborted: boolean;

  /** 是否降级 */
  degraded: boolean;

  /** 降级原因 */
  degradationReason?: string;

  /** 统计信息 */
  stats: AgentStats;
}

// ============================================================================
// 常量
// ============================================================================

/** 最大 Compact 次数 */
const MAX_COMPACT_COUNT = 2;

/** TRANSIENT 错误重试间隔 (ms) */
const TRANSIENT_RETRY_DELAY = 2000;

/** TRANSIENT 错误最大重试次数 (C1-1: 重试 1 次) */
const MAX_TRANSIENT_RETRIES = 1;

/** 会话模式 LLM temperature */
const CONVERSATION_TEMPERATURE = 0.7;

/** 后台模式 LLM temperature */
const BACKGROUND_TEMPERATURE = 0.3;

/** 默认最大 token 数 */
const DEFAULT_MAX_TOKENS = 4096;

/** 降级响应最大 token 数 */
const DEGRADATION_MAX_TOKENS = 1024;

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建事件
 */
function createEvent<T extends AgentEvent["type"]>(
  type: T,
  data: Omit<Extract<AgentEvent, { type: T }>, "type" | "timestamp">,
): Extract<AgentEvent, { type: T }> {
  return {
    type,
    timestamp: Date.now(),
    ...data,
  } as Extract<AgentEvent, { type: T }>;
}

/**
 * 创建初始状态
 */
function createInitialState(): ReactLoopState {
  return {
    iterations: 0,
    accumulatedContent: "",
    toolCalls: [],
    degraded: false,
    compactCount: 0,
    transientRetryCount: 0,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    startTime: Date.now(),
  };
}

/**
 * 检查是否被中断
 */
function checkAborted(signal?: AbortSignal): boolean {
  return signal?.aborted ?? false;
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 分类错误
 */
function classifyError(error: unknown): {
  classification: "TOOL_ERROR" | "TRANSIENT" | "SYSTEM_ERROR";
  code: ErrorCodeType;
  message: string;
} {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // TRANSIENT: 网络错误
    if (
      message.includes("network") ||
      message.includes("timeout") ||
      message.includes("econnrefused") ||
      message.includes("econnreset")
    ) {
      return {
        classification: "TRANSIENT",
        code: ErrorCode.NETWORK_ERROR,
        message: error.message,
      };
    }

    // TRANSIENT: 速率限制
    if (message.includes("rate limit") || message.includes("429")) {
      return {
        classification: "TRANSIENT",
        code: ErrorCode.RATE_LIMITED,
        message: error.message,
      };
    }

    // SYSTEM_ERROR: LLM 错误
    if (
      message.includes("llm") ||
      message.includes("api error") ||
      message.includes("model")
    ) {
      return {
        classification: "SYSTEM_ERROR",
        code: ErrorCode.LLM_ERROR,
        message: error.message,
      };
    }

    // 默认: SYSTEM_ERROR (H7 fix: 避免注入没有对应 assistant tool_call 的 tool 消息)
    return {
      classification: "SYSTEM_ERROR",
      code: ErrorCode.EXECUTION_FAILED,
      message: error.message,
    };
  }

  return {
    classification: "SYSTEM_ERROR",
    code: ErrorCode.EXECUTION_FAILED,
    message: String(error),
  };
}

// ============================================================================
// 主函数
// ============================================================================

/**
 * ReAct 循环实现
 *
 * 执行流程:
 * 1. 检查中断和预算
 * 2. 调用 LLM 流式
 * 3. 收集文本和工具调用
 * 4. 执行工具（如有）
 * 5. 注入结果，继续循环
 * 6. 重复直到完成或达到限制
 *
 * @yields AgentEvent 事件流
 * @returns ReactLoopResult 最终结果
 */
export async function* reactLoop(
  options: ReactLoopOptions,
): AsyncGenerator<AgentEvent, ReactLoopResult, unknown> {
  const { config, messages, tools, services, signal, onIteration } = options;

  const state = createInitialState();

  // 主循环
  while (state.iterations < config.maxIterations) {
    // 检查中断
    if (checkAborted(signal)) {
      yield createEvent("status", { message: "canceled" });
      return {
        finalResponse: state.accumulatedContent,
        emotionTags: [],
        toolCalls: state.toolCalls,
        success: false,
        aborted: true,
        degraded: state.degraded,
        stats: buildStats(state),
      };
    }

    // 检查 Token 预算
    const budget = services.context.checkBudget(messages);

    if (budget.shouldDegrade) {
      // 降级路径
      const result = await handleDegradation(
        "token_budget_exhausted",
        state,
        messages,
        services,
        signal,
      );
      if (result.event) yield result.event;
      return result.result;
    }

    if (budget.shouldCompact && state.compactCount < MAX_COMPACT_COUNT) {
      // Compact
      yield createEvent("status", { message: "compacting context" });
      const compactResult = await services.context.compact(messages);
      // NOTE: We intentionally mutate the messages array in place.
      // This is acceptable because the array is created fresh in preProcess
      // and only used within this reactLoop scope.
      // Using splice to replace contents is more explicit than length=0 + push.
      messages.splice(0, messages.length, ...compactResult.messages);
      state.compactCount++;

      if (!compactResult.success) {
        // Compact 失败，尝试降级
        const result = await handleDegradation(
          "token_budget_exhausted",
          state,
          messages,
          services,
          signal,
        );
        if (result.event) yield result.event;
        return result.result;
      }

      continue;
    }

    // LLM 调用
    let llmResponse: LLMResponse | null = null;
    let pendingToolCalls: ToolCall[] = [];
    let iterationContent = "";

    try {
      const stream = services.llm.stream(
        messages,
        tools,
        {
          modelId: "default",
          temperature: config.mode === "conversation" ? CONVERSATION_TEMPERATURE : BACKGROUND_TEMPERATURE,
          maxTokens: DEFAULT_MAX_TOKENS,
        },
        signal,
      );

      // 手动迭代捕获 generator return value (C1 fix)
      let streamIter = await stream.next();
      while (!streamIter.done) {
        const chunk = streamIter.value;

        // 检查中断
        if (checkAborted(signal)) {
          yield createEvent("status", { message: "canceled" });
          return {
            finalResponse: state.accumulatedContent + iterationContent,
            emotionTags: [],
            toolCalls: state.toolCalls,
            success: false,
            aborted: true,
            degraded: state.degraded,
            stats: buildStats(state),
          };
        }

        if (chunk.delta) {
          iterationContent += chunk.delta;
          yield createEvent("text_delta", { content: chunk.delta });
        }

        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            if (tc.id && tc.name && tc.arguments) {
              pendingToolCalls.push({
                id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
              });
            }
          }
        }

        streamIter = await stream.next();
      }

      // streamIter.done === true → value 是 generator return value
      llmResponse = streamIter.value ?? null;
      if (llmResponse) {
        state.tokenUsage.inputTokens += llmResponse.usage?.promptTokens ?? 0;
        state.tokenUsage.outputTokens +=
          llmResponse.usage?.completionTokens ?? 0;
        state.tokenUsage.totalTokens += llmResponse.usage?.totalTokens ?? 0;
      }
    } catch (error) {
      const classified = classifyError(error);

      if (classified.classification === "TRANSIENT") {
        state.transientRetryCount++;

        if (state.transientRetryCount > MAX_TRANSIENT_RETRIES) {
          // 超过重试上限，升级为 SYSTEM_ERROR (H1 fix)
          services.tracing.log({
            type: "transient_retry_exhausted",
            sessionId: config.sessionId,
            level: "error",
            data: { retries: state.transientRetryCount, message: classified.message },
          });

          yield createEvent("error", {
            code: classified.code,
            message: "Service temporarily unavailable after retries",
          });

          return {
            finalResponse: "",
            emotionTags: [],
            toolCalls: state.toolCalls,
            success: false,
            aborted: false,
            degraded: true,
            degradationReason: "system_error",
            stats: buildStats(state),
          };
        }

        yield createEvent("status", {
          message: "transient error, retrying",
          details: { error: classified.message, retry: state.transientRetryCount },
        });
        await delay(TRANSIENT_RETRY_DELAY);
        continue;
      }

      if (classified.classification === "SYSTEM_ERROR") {
        // SYSTEM_ERROR: 不写入 history，直接降级
        services.tracing.log({
          type: "system_error",
          sessionId: config.sessionId,
          level: "error",
          data: { code: classified.code, message: classified.message },
        });

        // H10: 日志记录完整错误，事件返回脱敏消息
        yield createEvent("error", {
          code: classified.code,
          message: "Internal system error",
        });

        return {
          finalResponse: "",
          emotionTags: [],
          toolCalls: state.toolCalls,
          success: false,
          aborted: false,
          degraded: true,
          degradationReason: "system_error",
          stats: buildStats(state),
        };
      }

      // TOOL_ERROR: 注入错误消息，让 LLM 处理
      messages.push({
        role: "tool",
        content: JSON.stringify({
          success: false,
          error: {
            code: classified.code,
            message: classified.message,
          },
        }),
        toolCallId: "error",
      });
      continue;
    }

    // 累积内容
    state.accumulatedContent += iterationContent;

    // 没有工具调用 → 完成
    if (pendingToolCalls.length === 0) {
      break;
    }

    // 执行工具
    let batchCancelled = false;
    for (const toolCall of pendingToolCalls) {
      // H3: 取消同批次剩余工具
      if (batchCancelled) {
        messages.push({
          role: "tool",
          content: JSON.stringify({ success: false, error: "Cancelled: batch permission denied" }),
          toolCallId: toolCall.id,
        });
        yield createEvent("tool_end", {
          toolName: toolCall.name,
          result: { success: false, errorCode: "PERMISSION_DENIED", errorMessage: "Batch cancelled" },
        });
        continue;
      }

      yield createEvent("tool_start", {
        toolName: toolCall.name,
        args: toolCall.arguments,
      });

      const startTime = Date.now();
      let result: ToolResult;

      try {
        // 权限检查
        const permission = await services.permission.check(
          toolCall.name,
          toolCall.arguments,
          config.sessionId,
        );

        // TODO(H5): 后台模式权限策略 — 不同任务类型需要不同权限级别，
        // 需要与 Scheduler/Background System 联动设计，留到 Background System 阶段实现

        if (permission.level === "deny") {
          batchCancelled = true;
          result = {
            callId: toolCall.id,
            toolName: toolCall.name,
            success: false,
            output: null,
            error: permission.reason ?? "Permission denied",
            latency: 0,
          };
        } else if (permission.level === "confirm") {
          // 用户确认流程
          const approvalId = await services.approval.requestApproval({
            sessionId: config.sessionId,
            toolName: toolCall.name,
            args: toolCall.arguments,
            reason: `需要确认才能执行 ${toolCall.name}`,
            ...(permission.note ? { riskDescription: permission.note } : {}),
          });

          const approval = await services.approval.awaitResponse(
            approvalId,
            signal,
          );

          if (approval.action !== "approve") {
            batchCancelled = true;
            const errorMsg =
              approval.action === "timeout"
                ? "Confirmation timeout"
                : "User rejected";
            result = {
              callId: toolCall.id,
              toolName: toolCall.name,
              success: false,
              output: null,
              error: errorMsg,
              latency: 0,
            };
          } else {
            // 用户确认后执行
            result = await services.tools.execute(
              toolCall,
              config.sessionId,
              signal,
            );
          }
        } else {
          // safe: 直接执行
          result = await services.tools.execute(
            toolCall,
            config.sessionId,
            signal,
          );
        }
      } catch (error) {
        const classified = classifyError(error);
        result = {
          callId: toolCall.id,
          toolName: toolCall.name,
          success: false,
          output: null,
          error: classified.message,
          latency: 0,
        };
      }

      const duration = Date.now() - startTime;

      // 记录工具调用
      state.toolCalls.push({
        toolName: toolCall.name,
        args: toolCall.arguments,
        result,
        duration,
      });

      // 处理工具结果（PersonaWrapper 视角转换）
      const processedContent = services.context.processToolResult(
        result,
        toolCall.name,
      );

      yield createEvent("tool_end", {
        toolName: toolCall.name,
        result: result.success
          ? { success: true }
          : {
              success: false,
              errorCode: "EXECUTION_FAILED",
              errorMessage: result.error ?? "Execution failed",
            },
      });

      // 注入工具结果到 messages
      messages.push({
        role: "tool",
        content: processedContent,
        toolCallId: toolCall.id,
      });
    }

    // 增加迭代计数
    state.iterations++;

    // 回调
    onIteration?.(state);

    // 检查是否达到迭代限制
    if (state.iterations >= config.maxIterations) {
      const result = await handleDegradation(
        "max_iterations",
        state,
        messages,
        services,
        signal,
      );
      if (result.event) yield result.event;
      return result.result;
    }
  }

  // 处理最终输出
  const processed = services.context.processLLMOutput(state.accumulatedContent);

  const finalResult: ReactLoopResult = {
    finalResponse: processed.visibleContent,
    emotionTags: processed.emotionTags ?? [],
    toolCalls: state.toolCalls,
    success: true,
    aborted: false,
    degraded: state.degraded,
    stats: buildStats(state),
  };

  // Yield complete event (H2: 完成信号)
  yield createEvent("complete", {
    emotionTags: finalResult.emotionTags,
    finalResponse: finalResult.finalResponse,
    toolCalls: finalResult.toolCalls,
    degraded: finalResult.degraded,
  });

  return finalResult;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 构建统计信息
 */
function buildStats(state: ReactLoopState): AgentStats {
  return {
    iterations: state.iterations,
    toolCallCount: state.toolCalls.length,
    totalTokens: state.tokenUsage.totalTokens,
    inputTokens: state.tokenUsage.inputTokens,
    outputTokens: state.tokenUsage.outputTokens,
    duration: Date.now() - state.startTime,
    compactCount: state.compactCount,
  };
}

/**
 * 处理降级
 */
async function handleDegradation(
  scenario: DegradationScenario,
  state: ReactLoopState,
  messages: LLMMessage[],
  services: PlatformServices,
  signal?: AbortSignal,
): Promise<{ event?: AgentEvent; result: ReactLoopResult }> {
  state.degraded = true;
  state.degradationReason = scenario;

  services.tracing.log({
    type: "degradation",
    level: "warn",
    data: { scenario, iterations: state.iterations },
  });

  // 尝试让 LLM 生成降级响应
  if (scenario !== "system_error") {
    try {
      // 追加降级指令
      const degradedMessages = [...messages];
      degradedMessages.push({
        role: "system",
        content:
          "你已达到工具调用上限或 token 预算耗尽。请基于已有结果总结进展并建议如何继续。保持角色人设。",
      });

      const stream = services.llm.stream(
        degradedMessages,
        [],
        { modelId: "default", temperature: CONVERSATION_TEMPERATURE, maxTokens: DEGRADATION_MAX_TOKENS },
        signal,
      );

      let degradedContent = "";
      for await (const chunk of stream) {
        if (chunk.delta) {
          degradedContent += chunk.delta;
        }
      }

      const processed = services.context.processLLMOutput(degradedContent);

      return {
        event: createEvent("status", { message: `degraded: ${scenario}` }),
        result: {
          finalResponse: processed.visibleContent,
          emotionTags: processed.emotionTags ?? [],
          toolCalls: state.toolCalls,
          success: true,
          aborted: false,
          degraded: true,
          degradationReason: scenario,
          stats: buildStats(state),
        },
      };
    } catch (degradeError) {
      // M15: 降级 LLM 调用失败，记录到 tracing 后回退静态模板
      services.tracing.log({
        type: "degradation_llm_failed",
        level: "warn",
        data: {
          scenario,
          error: degradeError instanceof Error ? degradeError.message : String(degradeError),
        },
      });
    }
  }

  // 静态降级模板
  const templates: Record<DegradationScenario, string> = {
    max_iterations:
      "抱歉，这个任务有点复杂，我暂时没法完全完成。让我先总结一下目前的进展...",
    token_budget_exhausted:
      "唔...要处理的内容有点多，我的脑子有点转不过来了。能不能把问题简化一下？",
    system_error: "出了点技术问题，我需要休息一下。稍后再试试？",
  };

  return {
    event: createEvent("status", { message: `degraded: ${scenario}` }),
    result: {
      finalResponse: templates[scenario],
      emotionTags: [],
      toolCalls: state.toolCalls,
      success: false,
      aborted: false,
      degraded: true,
      degradationReason: scenario,
      stats: buildStats(state),
    },
  };
}

// ============================================================================
// 导出
// ============================================================================

export { createInitialState, checkAborted, classifyError, buildStats };
