/**
 * Anthropic 兼容 API Provider
 * 位置: src/config/models/providers/anthropic.ts
 *
 * 支持 glm-5 等通过 Anthropic 兼容 API 访问的模型
 * 支持 tool_use（Function Calling）
 */

import type {
  IModel,
  ModelConfig,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  OpenAIToolDefinition,
  LLMToolCall,
} from "../types.js";

// ============================================
// Anthropic API 类型
// ============================================

/** Anthropic 工具定义格式 */
interface AnthropicToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/** Anthropic 消息内容块 */
type AnthropicContentBlock =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly type: "tool_result";
      readonly tool_use_id: string;
      readonly content: string;
    };

/** Anthropic 消息格式 */
interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: string | readonly AnthropicContentBlock[];
}

/** Anthropic tool_choice 格式 */
type AnthropicToolChoice =
  | { readonly type: "auto" }
  | { readonly type: "any" }
  | { readonly type: "tool"; readonly name: string };

/** Anthropic API 响应 */
interface AnthropicAPIResponse {
  readonly content: readonly AnthropicContentBlock[];
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
  };
  readonly stop_reason: string;
}

// ============================================
// 格式转换工具函数
// ============================================

/**
 * OpenAI 工具格式 → Anthropic 工具格式
 */
function convertToolsToAnthropic(
  tools: readonly OpenAIToolDefinition[],
): AnthropicToolDef[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

/**
 * 转换 toolChoice：OpenAI 格式 → Anthropic 格式
 */
function convertToolChoice(
  choice: "auto" | "required" | undefined,
): AnthropicToolChoice {
  if (choice === "required") {
    return { type: "any" };
  }
  return { type: "auto" };
}

/**
 * 转换内部 Message[] → Anthropic 消息格式
 *
 * 处理：
 * 1. assistant + tool_calls → content 包含 tool_use blocks
 * 2. role:"tool" → 合并为 user message 的 tool_result blocks
 * 3. 连续的 tool result 合并到同一个 user message
 */
function convertMessagesToAnthropic(
  messages: readonly Message[],
): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    if (msg.role === "system") {
      // system 消息单独处理，不放入 messages
      continue;
    }

    if (msg.role === "assistant") {
      // 构建 assistant 消息的 content blocks
      const contentBlocks: AnthropicContentBlock[] = [];

      // 添加文本部分（即使为空也需要至少一个 text block，除非有 tool_use）
      if (msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }

      // 如果有 tool_calls，转换为 tool_use blocks
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          let parsedInput: Record<string, unknown>;
          try {
            parsedInput = JSON.parse(tc.function.arguments) as Record<
              string,
              unknown
            >;
          } catch {
            throw new Error(
              `Invalid JSON in tool_call arguments for "${tc.function.name}" (id: ${tc.id}): ${tc.function.arguments.substring(0, 100)}`,
            );
          }
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: parsedInput,
          });
        }
      }

      // 如果有 content blocks 使用数组格式，否则用字符串
      if (contentBlocks.length > 1 || msg.tool_calls?.length) {
        result.push({ role: "assistant", content: contentBlocks });
      } else if (msg.content) {
        result.push({ role: "assistant", content: msg.content });
      } else {
        // Anthropic API 拒绝空字符串 content，用空格占位
        result.push({ role: "assistant", content: " " });
      }
      continue;
    }

    if (msg.role === "tool") {
      // tool result → 合并为 user message 的 tool_result blocks
      const toolResultBlocks: AnthropicContentBlock[] = [
        {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        },
      ];

      // 向后看，合并连续的 tool results
      let j = i + 1;
      while (j < messages.length && messages[j]!.role === "tool") {
        const nextTool = messages[j] as {
          role: "tool";
          tool_call_id: string;
          content: string;
        };
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: nextTool.tool_call_id,
          content: nextTool.content,
        });
        j++;
      }

      result.push({ role: "user", content: toolResultBlocks });
      // 跳过已合并的 tool results（循环会 i++，所以 -1）
      i = j - 1;
      continue;
    }

    // user 消息
    result.push({ role: "user", content: msg.content });
  }

  return result;
}

/**
 * 从 Anthropic 响应中提取 tool_use blocks → LLMToolCall[]
 */
function extractToolCalls(
  content: readonly AnthropicContentBlock[],
): LLMToolCall[] {
  const toolCalls: LLMToolCall[] = [];

  for (const block of content) {
    if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  return toolCalls;
}

// ============================================
// HTTP 客户端
// ============================================

/**
 * HTTP 客户端配置
 */
interface HttpClientConfig {
  baseURL: string;
  apiKey?: string | undefined;
  authType?: "x-api-key" | "bearer" | undefined;
  timeout?: number | undefined;
}

/**
 * 简单 HTTP 客户端（用于 MVP 阶段）
 */
class HttpClient {
  private readonly baseURL: string;
  private readonly apiKey: string | undefined;
  private readonly authType: "x-api-key" | "bearer";
  private readonly timeout: number;

  constructor(config: HttpClientConfig) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey;
    this.authType = config.authType ?? "x-api-key";
    this.timeout = config.timeout ?? 30000;
  }

  private getAuthHeader(): Record<string, string> {
    if (!this.apiKey) return {};
    if (this.authType === "bearer") {
      return { Authorization: `Bearer ${this.apiKey}` };
    }
    return { "x-api-key": this.apiKey };
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeader(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async *postStream(
    path: string,
    body: Record<string, unknown>,
  ): AsyncGenerator<Record<string, unknown>> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.getAuthHeader(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            yield JSON.parse(data);
          } catch (parseError) {
            // 记录解析错误用于调试，但不中断流处理
            console.debug(
              "[AnthropicClient] Failed to parse SSE data:",
              data.substring(0, 100),
              parseError,
            );
          }
        }
      }
    }
  }
}

// ============================================
// Anthropic 兼容模型实现
// ============================================

/**
 * Anthropic 兼容模型实现
 *
 * 支持：
 * - 基础对话（text content blocks）
 * - 工具调用（tool_use / tool_result content blocks）
 * - 流式输出（SSE）
 */
export class AnthropicCompatibleModel implements IModel {
  readonly name: string;
  readonly type: string;
  readonly provider: string;

  private readonly config: ModelConfig;
  private readonly client: HttpClient;

  constructor(config: ModelConfig) {
    this.name = config.name;
    this.type = config.type;
    this.provider = config.provider;
    this.config = config;
    this.client = new HttpClient({
      baseURL: config.endpoint ?? "https://api.anthropic.com",
      apiKey: config.apiKey,
      authType: config.authType,
      timeout: config.timeout,
    });
  }

  async chat(
    messages: Message[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    if (messages.length === 0) {
      throw new Error("Messages cannot be empty");
    }

    const startTime = Date.now();

    // 分离 system 消息
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    // 转换消息格式（处理 tool_calls 和 tool_result）
    const anthropicMessages = convertMessagesToAnthropic(chatMessages);

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: this.config.model ?? this.name,
      messages: anthropicMessages,
      system: systemMessage?.content,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature:
        options?.temperature ?? this.config.defaultTemperature ?? 0.7,
    };

    // 添加 tools（如果提供）
    if (options?.tools && options.tools.length > 0) {
      requestBody["tools"] = convertToolsToAnthropic(options.tools);
      requestBody["tool_choice"] = convertToolChoice(options.toolChoice);
    }

    const response =
      await this.client.post<AnthropicAPIResponse>("/v1/messages", requestBody);

    // 提取文本内容
    const textContent =
      response.content.find((c) => c.type === "text")?.text ?? "";

    // 提取工具调用
    const toolCalls = extractToolCalls(response.content);

    // 解析 stop_reason
    let finishReason: ChatResponse["finishReason"] = "stop";
    if (response.stop_reason === "tool_use") {
      finishReason = "tool_calls";
    } else if (response.stop_reason === "max_tokens") {
      finishReason = "length";
    } else if (response.stop_reason !== "end_turn") {
      finishReason = "length";
    }

    return {
      content: textContent,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
      model: this.name,
      latency: Date.now() - startTime,
      finishReason,
      // 只有当有 tool_calls 时才添加
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }

  async *stream(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    if (messages.length === 0) {
      throw new Error("Messages cannot be empty");
    }

    // 分离 system 消息
    const systemMessage = messages.find((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");

    // 转换消息格式
    const anthropicMessages = convertMessagesToAnthropic(chatMessages);

    // ⚠ stream() 不支持返回 tool_use 事件（StreamChunk 类型无 toolCalls 字段）
    // 工具调用场景应使用 chat()（generate 节点已使用 chat）
    if (options?.tools?.length) {
      console.warn(
        "[AnthropicCompatibleModel] stream() with tools: tool_use events will be silently dropped. Use chat() for tool calling.",
      );
    }

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: this.config.model ?? this.name,
      messages: anthropicMessages,
      system: systemMessage?.content,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature:
        options?.temperature ?? this.config.defaultTemperature ?? 0.7,
    };

    // 添加 tools（如果提供）
    if (options?.tools && options.tools.length > 0) {
      requestBody["tools"] = convertToolsToAnthropic(options.tools);
      requestBody["tool_choice"] = convertToolChoice(options.toolChoice);
    }

    const stream = this.client.postStream("/v1/messages", requestBody);

    for await (const chunk of stream) {
      const chunkType = chunk["type"] as string;

      if (chunkType === "content_block_delta") {
        const delta = chunk["delta"] as {
          type?: string;
          text?: string;
          partial_json?: string;
        };
        // 只输出 text_delta，忽略 input_json_delta（工具参数流）
        if (delta.text) {
          yield {
            content: delta.text,
            done: false,
            delta: delta.text,
          };
        }
      } else if (chunkType === "message_stop") {
        yield { content: "", done: true };
      }
    }
  }

  supportsStreaming(): boolean {
    return this.config.capabilities?.supportsStreaming ?? true;
  }

  supportsVision(): boolean {
    return this.config.capabilities?.supportsVision ?? false;
  }

  supportsFunctionCalling(): boolean {
    return this.config.capabilities?.supportsFunctionCalling ?? true;
  }

  estimateCost(tokens: number): number {
    const costPerMillion = this.config.costPerMillionTokens ?? 0;
    return (tokens / 1_000_000) * costPerMillion;
  }

  getAverageLatency(): number {
    const speedMap: Record<string, number> = {
      slow: 2000,
      medium: 1000,
      fast: 500,
    };
    const speed = this.config.capabilities?.speed ?? "medium";
    return speedMap[speed] ?? 1000;
  }
}

// 导出工具函数（用于测试）
export {
  convertToolsToAnthropic,
  convertToolChoice,
  convertMessagesToAnthropic,
  extractToolCalls,
};

export default AnthropicCompatibleModel;
