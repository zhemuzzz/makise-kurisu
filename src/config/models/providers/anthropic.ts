/**
 * Anthropic 兼容 API Provider
 * 位置: src/config/models/providers/anthropic.ts
 *
 * 支持 glm-5 等通过 Anthropic 兼容 API 访问的模型
 */

import type {
  IModel,
  ModelConfig,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from '../types';

/**
 * HTTP 客户端配置
 */
interface HttpClientConfig {
  baseURL: string;
  apiKey?: string;
  timeout?: number;
}

/**
 * 简单 HTTP 客户端（用于 MVP 阶段）
 */
class HttpClient {
  private readonly baseURL: string;
  private readonly apiKey?: string;
  private readonly timeout: number;

  constructor(config: HttpClientConfig) {
    this.baseURL = config.baseURL;
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async *postStream(
    path: string,
    body: Record<string, unknown>
  ): AsyncGenerator<Record<string, unknown>> {
    const response = await fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}),
        'anthropic-version': '2023-06-01',
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
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            yield JSON.parse(data);
          } catch {
            // 忽略解析错误
          }
        }
      }
    }
  }
}

/**
 * Anthropic 兼容模型实现
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
      baseURL: config.endpoint ?? 'https://api.anthropic.com',
      apiKey: config.apiKey,
      timeout: config.timeout,
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (messages.length === 0) {
      throw new Error('Messages cannot be empty');
    }

    const startTime = Date.now();

    // 分离 system 消息
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const response = await this.client.post<{
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    }>('/v1/messages', {
      model: this.config.model ?? this.name,
      messages: chatMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      system: systemMessage?.content,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options?.temperature ?? this.config.defaultTemperature ?? 0.7,
    });

    const textContent = response.content.find((c) => c.type === 'text')?.text ?? '';

    return {
      content: textContent,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      model: this.name,
      latency: Date.now() - startTime,
      finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }

  async *stream(messages: Message[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
    if (messages.length === 0) {
      throw new Error('Messages cannot be empty');
    }

    // 分离 system 消息
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const stream = this.client.postStream('/v1/messages', {
      model: this.config.model ?? this.name,
      messages: chatMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      system: systemMessage?.content,
      max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: options?.temperature ?? this.config.defaultTemperature ?? 0.7,
    });

    for await (const chunk of stream) {
      const chunkType = chunk.type as string;

      if (chunkType === 'content_block_delta') {
        const delta = chunk.delta as { text?: string };
        if (delta.text) {
          yield {
            content: delta.text,
            done: false,
            delta: delta.text,
          };
        }
      } else if (chunkType === 'message_stop') {
        yield { content: '', done: true };
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
    return speedMap[this.config.capabilities?.speed ?? 'medium'];
  }
}

export default AnthropicCompatibleModel;
