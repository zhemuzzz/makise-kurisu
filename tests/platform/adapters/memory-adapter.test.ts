/**
 * MemoryAdapter 测试
 *
 * 适配 HybridMemoryEngine → MemoryPort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryAdapter } from "../../../src/platform/adapters/memory-adapter.js";
import type { MemoryPort, MemoryRecallResult } from "../../../src/agent/ports/platform-services.js";
import type { HybridMemoryEngine } from "../../../src/platform/memory/hybrid-engine.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockEngine(): {
  engine: HybridMemoryEngine;
  searchMemory: ReturnType<typeof vi.fn>;
  addMemory: ReturnType<typeof vi.fn>;
} {
  const searchMemory = vi.fn().mockResolvedValue([]);
  const addMemory = vi.fn().mockResolvedValue("mem-1");

  const engine = {
    searchMemory,
    addMemory,
    hasSession: vi.fn().mockReturnValue(true),
    createSession: vi.fn().mockReturnValue("session-1"),
  } as unknown as HybridMemoryEngine;

  return { engine, searchMemory, addMemory };
}

// ============================================================================
// Tests
// ============================================================================

describe("MemoryAdapter", () => {
  let adapter: MemoryPort;
  let searchMemory: ReturnType<typeof vi.fn>;
  let addMemory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockEngine();
    adapter = new MemoryAdapter(mock.engine);
    searchMemory = mock.searchMemory;
    addMemory = mock.addMemory;
  });

  describe("recall", () => {
    it("should delegate to engine.searchMemory with userId as sessionId", async () => {
      searchMemory.mockResolvedValue([]);

      await adapter.recall("test query", "user-123");

      expect(searchMemory).toHaveBeenCalledWith("user-123", "test query", undefined);
    });

    it("should pass limit parameter", async () => {
      searchMemory.mockResolvedValue([]);

      await adapter.recall("test query", "user-123", 5);

      expect(searchMemory).toHaveBeenCalledWith("user-123", "test query", 5);
    });

    it("should map MemorySearchResult to MemoryRecallResult", async () => {
      searchMemory.mockResolvedValue([
        {
          id: "mem-1",
          content: "remembered content",
          score: 0.95,
          metadata: {
            timestamp: 1000,
            importance: 0.8,
            role: "user",
            sessionId: "user-123",
            source: "conversation",
          },
        },
      ]);

      const results = await adapter.recall("test", "user-123");

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        content: "remembered content",
        relevanceScore: 0.95,
        source: "conversation",
        timestamp: 1000,
      });
    });

    it("should use default source when metadata.source is missing", async () => {
      searchMemory.mockResolvedValue([
        {
          id: "mem-2",
          content: "data",
          score: 0.5,
          metadata: {
            timestamp: 2000,
            importance: 0.5,
            role: "assistant",
            sessionId: "user-123",
          },
        },
      ]);

      const results = await adapter.recall("test", "user-123");

      expect(results[0]!.source).toBe("memory");
    });

    it("should return empty array on engine error", async () => {
      searchMemory.mockRejectedValue(new Error("Mem0 unavailable"));

      const results = await adapter.recall("test", "user-123");

      expect(results).toEqual([]);
    });
  });

  describe("store", () => {
    it("should delegate to engine.addMemory with userId as sessionId", async () => {
      await adapter.store("new memory", "user-123");

      expect(addMemory).toHaveBeenCalledWith("user-123", "new memory", undefined);
    });

    it("should pass metadata", async () => {
      const metadata = { topic: "work", importance: 0.9 };
      await adapter.store("new memory", "user-123", metadata);

      expect(addMemory).toHaveBeenCalledWith("user-123", "new memory", metadata);
    });

    it("should not throw on engine error", async () => {
      addMemory.mockRejectedValue(new Error("Storage full"));

      await expect(adapter.store("data", "user-123")).resolves.toBeUndefined();
    });
  });

  describe("implements MemoryPort", () => {
    it("should satisfy the MemoryPort interface", () => {
      expect(typeof adapter.recall).toBe("function");
      expect(typeof adapter.store).toBe("function");
    });
  });
});
