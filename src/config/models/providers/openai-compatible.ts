/**
 * OpenAI 兼容 API Provider
 * 位置: src/config/models/providers/openai-compatible.ts
 *
 * 支持 OpenAI 格式的 API（如 minimax、deepseek 等）
 */

import type {
  IModel,
  ModelConfig,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from "../types";

/**
 * HTTP 客户端配置（用于赋值时，允许显式 undefined）
 */
type HttpClientConfigInput = {
  baseURL: string;
  apiKey?: string | undefined;
  timeout?: number | undefined;
};

/**
 * 简单 HTTP 客户端
 */
class HttpClient {
  private readonly baseURL: string;
  private readonly apiKey?: string | undefined;
  private readonly timeout: number;

  constructor(config: HttpClientConfigInput) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey ?? undefined;
    this.timeout = config.timeout ?? 30000;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
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
        Authorization: `Bearer ${this.apiKey}`,
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
            console.debug(
              "[OpenAIClient] Failed to parse SSE data:",
              data.substring(0, 100),
              parseError,
            );
          }
        }
      }
    }
  }
}

/**
 * OpenAI 兼容模型实现
 */
export class OpenAICompatibleModel implements IModel {
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
      baseURL: config.endpoint ?? "https://api.openai.com",
      apiKey: config.apiKey ?? undefined,
      timeout: config.timeout ?? undefined,
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

    // 转换消息格式为 OpenAI 格式
    const openaiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const response = await this.client.post<{
      choices: Array<{
        message: { content: string };
        finish_reason: string;
      }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    }>("/v1/chat/completions", {
      model: this.config.model ?? this.name,
      messages: openaiMessages,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature:
        options?.temperature ?? this.config.defaultTemperature ?? 0.7,
    });

    const content = response.choices[0]?.message?.content ?? "";

    return {
      content,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens:
          (response.usage?.prompt_tokens ?? 0) +
          (response.usage?.completion_tokens ?? 0),
      },
      model: this.name,
      latency: Date.now() - startTime,
      finishReason:
        response.choices[0]?.finish_reason === "stop" ? "stop" : "length",
    };
  }

  async *stream(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    if (messages.length === 0) {
      throw new Error("Messages cannot be empty");
    }

    const openaiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const stream = this.client.postStream("/v1/chat/completions", {
      model: this.config.model ?? this.name,
      messages: openaiMessages,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature:
        options?.temperature ?? this.config.defaultTemperature ?? 0.7,
    });

    for await (const chunk of stream) {
      const choices = chunk["choices"] as
        | Array<{ delta?: { content?: string }; finish_reason?: string }>
        | undefined;

      if (choices?.[0]) {
        const delta = choices[0].delta?.content;
        const finishReason = choices[0].finish_reason;

        if (delta) {
          yield {
            content: delta,
            done: false,
            delta,
          };
        }

        if (finishReason) {
          yield { content: "", done: true };
        }
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

export default OpenAICompatibleModel;
