/**
 * EmbeddingProvider 实现
 * 位置: src/platform/storage/embedding-provider.ts
 *
 * ST-4: 接口抽象 + ZhipuEmbeddingProvider 实现
 * 复用 zhipu-embedding.ts 的 API 调用模式
 */

import type { EmbeddingProvider } from "./types";

// ============ 配置 ============

export interface ZhipuEmbeddingProviderConfig {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly model?: string;
  readonly timeout?: number;
}

// ============ API 响应类型 ============

interface EmbeddingApiResponse {
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

// ============ 实现 ============

export class ZhipuEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number = 1024;
  readonly modelId: string;

  private readonly config: ZhipuEmbeddingProviderConfig;

  constructor(config: ZhipuEmbeddingProviderConfig) {
    this.config = config;
    this.modelId = config.model ?? "embedding-3";
  }

  async embed(text: string): Promise<readonly number[]> {
    const results = await this.callApi([text]);
    const first = results[0];
    if (!first) {
      throw new Error("Embedding API returned no vectors for input text");
    }
    return first;
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) {
      return [];
    }
    return this.callApi(texts);
  }

  private async callApi(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const response = await fetch(`${this.config.endpoint}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelId,
        input: texts,
      }),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
    });

    if (!response.ok) {
      // Log full error server-side; throw sanitized message to prevent data leakage
      throw new Error(
        `Embedding API error: HTTP ${response.status}`,
      );
    }

    const result = (await response.json()) as EmbeddingApiResponse;
    const sorted = [...result.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }
}
