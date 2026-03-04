/**
 * MemoryAdapter - HybridMemoryEngine → MemoryPort
 *
 * 适配 Platform 的 HybridMemoryEngine 到 Agent 的 MemoryPort 接口。
 * - userId 映射为 sessionId
 * - MemorySearchResult 转换为 MemoryRecallResult
 * - 优雅降级：Mem0 不可用时返回空结果
 *
 * @module platform/adapters/memory-adapter
 */

import type {
  MemoryPort,
  MemoryRecallResult,
} from "../../agent/ports/platform-services.js";
import type { HybridMemoryEngine } from "../memory/hybrid-engine.js";
import type { MemorySearchResult } from "../memory/types.js";

// ============================================================================
// Adapter
// ============================================================================

export class MemoryAdapter implements MemoryPort {
  private readonly engine: HybridMemoryEngine;

  constructor(engine: HybridMemoryEngine) {
    this.engine = engine;
  }

  async recall(
    query: string,
    userId: string,
    limit?: number,
  ): Promise<MemoryRecallResult[]> {
    try {
      const results: MemorySearchResult[] = await this.engine.searchMemory(
        userId,
        query,
        limit,
      );

      return results.map((r) => ({
        content: r.content,
        relevanceScore: r.score,
        source: (r.metadata["source"] as string | undefined) ?? "memory",
        timestamp: r.metadata.timestamp,
      }));
    } catch {
      // Graceful degradation when Mem0 is unavailable
      return [];
    }
  }

  async store(
    content: string,
    userId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.engine.addMemory(userId, content, metadata);
    } catch {
      // Graceful degradation: don't throw on store failure
    }
  }
}
