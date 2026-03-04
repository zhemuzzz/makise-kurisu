/**
 * VectorStore 测试
 * TDD: RED → GREEN → IMPROVE
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Qdrant client
function createMockQdrantClient() {
  const points: Map<string, { id: string; vector: number[]; payload: Record<string, unknown> }> = new Map();

  return {
    getCollections: vi.fn().mockResolvedValue({ collections: [] }),
    createCollection: vi.fn().mockResolvedValue(true),
    upsert: vi.fn().mockImplementation(async (_collectionName: string, args: { points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> }) => {
      for (const point of args.points) {
        points.set(point.id, point);
      }
      return { status: "completed" };
    }),
    search: vi.fn().mockImplementation(async () => {
      return Array.from(points.values()).map((p) => ({
        id: p.id,
        score: 0.95,
        payload: p.payload,
      }));
    }),
    delete: vi.fn().mockResolvedValue({ status: "completed" }),
    _points: points,
  };
}

describe("VectorStore", () => {
  describe("QdrantVectorStore", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("VS-01: upsert + search 基本流程", async () => {
      const mockClient = createMockQdrantClient();

      const { QdrantVectorStore } = await import("@/platform/storage/vector-store");

      const store = new QdrantVectorStore({
        client: mockClient as never,
        collectionName: "test_memories",
        dimensions: 1024,
      });

      await store.ensureCollection();
      await store.upsert("id1", [0.1, 0.2], { content: "hello" });

      expect(mockClient.upsert).toHaveBeenCalledWith("test_memories", {
        points: [{ id: "id1", vector: [0.1, 0.2], payload: { content: "hello" } }],
      });

      const results = await store.search([0.1, 0.2], undefined, 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.score).toBeGreaterThan(0);
    });

    it("VS-02: search with filter", async () => {
      const mockClient = createMockQdrantClient();

      const { QdrantVectorStore } = await import("@/platform/storage/vector-store");

      const store = new QdrantVectorStore({
        client: mockClient as never,
        collectionName: "test_memories",
        dimensions: 1024,
      });

      await store.search(
        [0.1, 0.2],
        { must: [{ key: "user_id", match: { value: "user1" } }] },
        10,
      );

      expect(mockClient.search).toHaveBeenCalledWith(
        "test_memories",
        expect.objectContaining({
          filter: { must: [{ key: "user_id", match: { value: "user1" } }] },
        }),
      );
    });

    it("VS-03: delete by id", async () => {
      const mockClient = createMockQdrantClient();

      const { QdrantVectorStore } = await import("@/platform/storage/vector-store");

      const store = new QdrantVectorStore({
        client: mockClient as never,
        collectionName: "test_memories",
        dimensions: 1024,
      });

      await store.delete("id1");

      expect(mockClient.delete).toHaveBeenCalledWith("test_memories", {
        points: ["id1"],
      });
    });

    it("VS-04: ensureCollection 创建不存在的 collection", async () => {
      const mockClient = createMockQdrantClient();
      mockClient.getCollections.mockResolvedValue({ collections: [] });

      const { QdrantVectorStore } = await import("@/platform/storage/vector-store");

      const store = new QdrantVectorStore({
        client: mockClient as never,
        collectionName: "new_collection",
        dimensions: 1024,
      });

      await store.ensureCollection();

      expect(mockClient.createCollection).toHaveBeenCalledWith("new_collection", {
        vectors: { size: 1024, distance: "Cosine" },
      });
    });

    it("VS-05: ensureCollection 已存在时不重复创建", async () => {
      const mockClient = createMockQdrantClient();
      mockClient.getCollections.mockResolvedValue({
        collections: [{ name: "existing_collection" }],
      });

      const { QdrantVectorStore } = await import("@/platform/storage/vector-store");

      const store = new QdrantVectorStore({
        client: mockClient as never,
        collectionName: "existing_collection",
        dimensions: 1024,
      });

      await store.ensureCollection();

      expect(mockClient.createCollection).not.toHaveBeenCalled();
    });
  });
});
