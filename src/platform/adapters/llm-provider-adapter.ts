/**
 * LLMProviderAdapter - IModelProvider + IModel → LLMProviderPort
 *
 * 适配 Platform 的 IModelProvider 到 Agent 的 LLMProviderPort 接口。
 * - LLMMessage ↔ Message 格式转换
 * - ToolDef → OpenAIToolDefinition 转换
 * - LLMToolCall ↔ ToolCall 转换
 * - chat() → AsyncGenerator 包装 (MVP: 非真流式)
 *
 * @module platform/adapters/llm-provider-adapter
 */

import type {
  LLMProviderPort,
  LLMCallConfig,
  LLMStreamChunk,
} from "../../agent/ports/platform-services.js";
import type { LLMMessage, LLMResponse } from "../../agent/types.js";
import type { ToolDef, ToolCall } from "../../platform/tools/types.js";
import type {
  IModelProvider,
  Message,
  ChatResponse,
  LLMToolCall,
  OpenAIToolDefinition,
} from "../models/types.js";
import type { TracingServiceLike } from "../gateway/types.js";

// ============================================================================
// Adapter
// ============================================================================

export class LLMProviderAdapter implements LLMProviderPort {
  private readonly provider: IModelProvider;
  private readonly tracing: TracingServiceLike | undefined;

  constructor(provider: IModelProvider, tracing?: TracingServiceLike) {
    this.provider = provider;
    this.tracing = tracing;
  }

  // --------------------------------------------------------------------------
  // stream: LLMMessage[] → Message[], chat() → AsyncGenerator
  // --------------------------------------------------------------------------

  async *stream(
    messages: LLMMessage[],
    tools: ToolDef[],
    config: LLMCallConfig,
    _signal?: AbortSignal,
  ): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
    const model = this.provider.get(config.modelId);

    // Convert types
    const platformMessages = messages.map(convertLLMMessageToMessage);
    const platformTools = tools.map(convertToolDefToOpenAI);

    // Build chat options
    const options = {
      ...(config.temperature !== undefined
        ? { temperature: config.temperature }
        : {}),
      ...(config.maxTokens !== undefined
        ? { maxTokens: config.maxTokens }
        : {}),
      ...(config.topP !== undefined ? { topP: config.topP } : {}),
      ...(config.stopSequences !== undefined
        ? { stopSequences: config.stopSequences }
        : {}),
      ...(platformTools.length > 0 ? { tools: platformTools } : {}),
    };

    // Call chat() for complete response (MVP: non-streaming)
    const llmStartTime = Date.now();
    this.tracing?.log({
      level: "debug",
      category: "agent",
      event: "llm:call_start",
      data: {
        modelId: config.modelId,
        messageCount: messages.length,
        toolCount: tools.length,
      },
      timestamp: llmStartTime,
    });

    let chatResponse: ChatResponse;
    try {
      chatResponse = await model.chat(platformMessages, options);
    } catch (error) {
      const durationMs = Date.now() - llmStartTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = classifyLLMError(error);
      this.tracing?.log({
        level: "error",
        category: "agent",
        event: "llm:call_error",
        errorCode,
        data: { modelId: config.modelId, error: errorMessage, durationMs },
        timestamp: Date.now(),
      });
      throw error;
    }

    const llmDurationMs = Date.now() - llmStartTime;
    this.tracing?.log({
      level: "info",
      category: "agent",
      event: "llm:call_complete",
      data: {
        modelId: config.modelId,
        durationMs: llmDurationMs,
        promptTokens: chatResponse.usage.promptTokens,
        completionTokens: chatResponse.usage.completionTokens,
        totalTokens: chatResponse.usage.totalTokens,
        finishReason: chatResponse.finishReason,
        hasToolCalls: (chatResponse.toolCalls?.length ?? 0) > 0,
      },
      timestamp: Date.now(),
    });

    // Yield content as a single chunk
    if (chatResponse.content.length > 0) {
      yield {
        delta: chatResponse.content,
        finishReason: (chatResponse.finishReason === "error" ? "stop" : chatResponse.finishReason) ?? "stop",
      };
    }

    // Yield tool calls chunk if present
    if (chatResponse.toolCalls && chatResponse.toolCalls.length > 0) {
      yield {
        delta: "",
        toolCalls: chatResponse.toolCalls.map(convertLLMToolCallToToolCall),
        finishReason: "tool_calls",
      };
    }

    // Return final LLMResponse
    return convertChatResponseToLLMResponse(chatResponse);
  }

  // --------------------------------------------------------------------------
  // getAvailableModels
  // --------------------------------------------------------------------------

  getAvailableModels(): string[] {
    return this.provider.listModels().map((m) => m.name);
  }

  // --------------------------------------------------------------------------
  // isModelAvailable
  // --------------------------------------------------------------------------

  isModelAvailable(modelId: string): boolean {
    try {
      this.provider.get(modelId);
      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * LLMMessage (Agent) → Message (Platform)
 */
function convertLLMMessageToMessage(msg: LLMMessage): Message {
  switch (msg.role) {
    case "system":
      return { role: "system", content: msg.content };

    case "user":
      return { role: "user", content: msg.content };

    case "assistant": {
      const toolCalls = msg.toolCalls?.map(convertToolCallToLLMToolCall);
      return {
        role: "assistant",
        content: msg.content,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    }

    case "tool":
      return {
        role: "tool",
        tool_call_id: msg.toolCallId ?? "",
        content: msg.content,
      };
  }
}

/**
 * ToolCall (Agent) → LLMToolCall (Platform)
 */
function convertToolCallToLLMToolCall(tc: ToolCall): LLMToolCall {
  return {
    id: tc.id,
    type: "function",
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    },
  };
}

/**
 * LLMToolCall (Platform) → ToolCall (Agent)
 */
function convertLLMToolCallToToolCall(tc: LLMToolCall): ToolCall {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
  } catch {
    args = {};
  }

  return {
    id: tc.id,
    name: tc.function.name,
    arguments: args,
  };
}

/**
 * ToolDef → OpenAIToolDefinition
 */
function convertToolDefToOpenAI(def: ToolDef): OpenAIToolDefinition {
  return {
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema as unknown as Record<string, unknown>,
    },
  };
}

/**
 * LLM 错误分类 — 从错误消息推断 KurisuErrorType
 */
function classifyLLMError(error: unknown): string {
  if (!(error instanceof Error)) return "llm_error";
  const msg = error.message.toLowerCase();
  if (msg.includes("rate") || msg.includes("429") || msg.includes("quota")) {
    return "rate_limit_error";
  }
  if (msg.includes("timeout") || msg.includes("econnrefused") || msg.includes("network") || msg.includes("fetch")) {
    return "network_error";
  }
  if (msg.includes("not found") || msg.includes("does not exist") || msg.includes("unavailable")) {
    return "model_unavailable";
  }
  if (msg.includes("context") || msg.includes("token") || msg.includes("length")) {
    return "context_overflow";
  }
  return "llm_error";
}

/**
 * ChatResponse (Platform) → LLMResponse (Agent)
 */
function convertChatResponseToLLMResponse(
  response: ChatResponse,
): LLMResponse {
  const toolCalls = response.toolCalls?.map(convertLLMToolCallToToolCall);

  return {
    content: response.content,
    finishReason: response.finishReason ?? "stop",
    usage: {
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
    },
    ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
  };
}
