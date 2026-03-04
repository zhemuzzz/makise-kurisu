/**
 * Zhipu Embedding 模型实现
 *
 * KURISU-028: 基于 Zhipu embedding-3 API 的向量化模型
 *
 * API: POST /api/paas/v4/embeddings
 * 请求: { model: "embedding-3", input: string[] }
 * 响应: { data: [{ embedding: number[] }] }
 */

import type {
  IModel,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from "./types";

// ============================================
// 配置
// ============================================

export interface ZhipuEmbeddingConfig {
  /** API Key */
  readonly apiKey: string;
  /** API 端点 */
  readonly endpoint: string;
  /** 模型名称（默认 embedding-3） */
  readonly model?: string;
  /** 超时时间（毫秒，默认 30000） */
  readonly timeout?: number;
}

// ============================================
// 响应类型
// ============================================

interface ZhipuEmbeddingResponse {
  readonly data: readonly {
    readonly embedding: readonly number[];
    readonly index: number;
  }[];
  readonly model: string;
  readonly usage: {
    readonly prompt_tokens: number;
    readonly total_tokens: number;
  };
}

// ============================================
// 实现
// ============================================

class ZhipuEmbeddingModel implements IModel {
  readonly name: string;
  readonly type: string = "api";
  readonly provider: string = "zhipu";

  private readonly config: ZhipuEmbeddingConfig;

  constructor(config: ZhipuEmbeddingConfig) {
    this.config = config;
    this.name = config.model ?? "embedding-3";
  }

  /**
   * 文本向量化
   *
   * @param texts - 输入文本列表
   * @returns 向量列表（与输入顺序一致）
   */
  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) {
      throw new Error("Input texts must not be empty");
    }

    const response = await fetch(`${this.config.endpoint}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model ?? "embedding-3",
        input: texts,
      }),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Embedding API error: ${response.status} - ${errorText}`,
      );
    }

    const result = (await response.json()) as ZhipuEmbeddingResponse;

    // 按 index 排序确保顺序一致
    const sorted = [...result.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  // ============================================
  // IModel 必须方法（Embedding 模型不支持对话）
  // ============================================

  async chat(_messages: Message[], _options?: ChatOptions): Promise<ChatResponse> {
    throw new Error("Embedding model does not support chat");
  }

  // eslint-disable-next-line require-yield
  async *stream(
    _messages: Message[],
    _options?: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    throw new Error("Embedding model does not support streaming");
  }

  supportsStreaming(): boolean {
    return false;
  }

  supportsVision(): boolean {
    return false;
  }

  supportsFunctionCalling(): boolean {
    return false;
  }

  estimateCost(tokens: number): number {
    // embedding-3: ~0.5 元/百万 tokens
    return (tokens / 1_000_000) * 0.5;
  }

  getAverageLatency(): number {
    return 100; // ~100ms
  }
}

// ============================================
// 工厂函数
// ============================================

/**
 * 创建 Zhipu Embedding 模型实例
 */
export function createZhipuEmbeddingModel(
  config: ZhipuEmbeddingConfig,
): IModel & { embed: (texts: readonly string[]) => Promise<readonly (readonly number[])[]> } {
  return new ZhipuEmbeddingModel(config);
}
