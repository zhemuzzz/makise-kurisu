/**
 * VectorStore 实现
 * 位置: src/platform/storage/vector-store.ts
 *
 * ST-5: Qdrant 适配器，implements VectorStore 接口
 */

import type { QdrantClient } from "@qdrant/js-client-rest";
import type { VectorStore, VectorFilter, SearchResult } from "./types.js";

// ============ 配置 ============

export interface QdrantVectorStoreConfig {
  readonly client: QdrantClient;
  readonly collectionName: string;
  readonly dimensions: number;
}

// ============ 实现 ============

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly dimensions: number;

  constructor(config: QdrantVectorStoreConfig) {
    this.client = config.client;
    this.collectionName = config.collectionName;
    this.dimensions = config.dimensions;
  }

  async ensureCollection(): Promise<void> {
    const { collections } = await this.client.getCollections();
    const exists = collections.some((c) => c.name === this.collectionName);

    if (!exists) {
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.dimensions, distance: "Cosine" },
      });
    }
  }

  async upsert(
    id: string,
    vector: readonly number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.client.upsert(this.collectionName, {
      points: [{ id, vector: [...vector], payload }],
    });
  }

  async search(
    query: readonly number[],
    filter?: VectorFilter,
    topK: number = 10,
  ): Promise<readonly SearchResult[]> {
    const searchParams: Record<string, unknown> = {
      vector: [...query],
      limit: topK,
    };
    if (filter) {
      searchParams["filter"] = JSON.parse(JSON.stringify(filter));
    }

    const results = await this.client.search(
      this.collectionName,
      searchParams as Parameters<QdrantClient["search"]>[1],
    );

    return results.map((r) => ({
      id: String(r.id),
      score: r.score,
      payload: (r.payload ?? {}),
    }));
  }

  async delete(id: string): Promise<void> {
    await this.client.delete(this.collectionName, {
      points: [id],
    });
  }

  async deleteByFilter(filter: VectorFilter): Promise<number> {
    const mutableFilter = JSON.parse(JSON.stringify(filter)) as Record<string, unknown>;
    await this.client.delete(this.collectionName, {
      filter: mutableFilter as Parameters<QdrantClient["delete"]>[1] extends { filter?: infer F } ? F : never,
    });
    // Qdrant delete doesn't return count
    return 0;
  }
}
