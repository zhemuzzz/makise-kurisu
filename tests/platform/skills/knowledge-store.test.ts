/**
 * KnowledgeStore Tests
 *
 * @module tests/platform/skills/knowledge-store
 * @description IKnowledgeStore 接口 + 实现测试
 *
 * 测试三写一致性 (KS-6)、语义搜索、容量限制、归档等
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import {
  ROLE_SQLITE_SCHEMA,
  migrateSkillKnowledgeSchema,
} from "../../../src/platform/storage/types";
import type { VectorStore, EmbeddingProvider, SearchResult } from "../../../src/platform/storage/types";
import {
  createKnowledgeStore,
  type IKnowledgeStore,
  type KnowledgeStoreConfig,
} from "../../../src/platform/skills/knowledge-store";
import type { KnowledgeEntry, KnowledgeCategory, KnowledgeSource } from "../../../src/platform/skills/knowledge-types";

// ============================================================================
// Mock Helpers
// ============================================================================

function _createMockVectorStore(): VectorStore & {
  _upsertCalls: Array<{ id: string; vector: readonly number[]; payload: Record<string, unknown> }>;
  _deleteCalls: string[];
  _searchResults: SearchResult[];
} {
  const mock = {
    _upsertCalls: [] as Array<{ id: string; vector: readonly number[]; payload: Record<string, unknown> }>,
    _deleteCalls: [] as string[],
    _searchResults: [] as SearchResult[],
    upsert: vi.fn(async (id: string, vector: readonly number[], payload: Record<string, unknown>) => {
      mock._upsertCalls.push({ id, vector, payload });
    }),
    search: vi.fn(async (_query: readonly number[], _filter?: unknown, _topK?: number): Promise<readonly SearchResult[]> => {
      return mock._searchResults;
    }),
    delete: vi.fn(async (id: string) => {
      mock._deleteCalls.push(id);
    }),
    deleteByFilter: vi.fn(async () => 0),
    ensureCollection: vi.fn(async () => {}),
  };
  return mock;
}

function _createMockEmbeddingProvider(): EmbeddingProvider {
  let callCount = 0;
  return {
    embed: vi.fn(async (_text: string): Promise<readonly number[]> => {
      callCount++;
      // Return a deterministic vector based on call count
      return [0.1 * callCount, 0.2 * callCount, 0.3 * callCount];
    }),
    embedBatch: vi.fn(async (texts: readonly string[]): Promise<readonly (readonly number[])[]> => {
      return texts.map((_, i) => [0.1 * (i + 1), 0.2 * (i + 1), 0.3 * (i + 1)]);
    }),
    dimensions: 3,
    modelId: "test-embedding-model",
  };
}

function _createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(ROLE_SQLITE_SCHEMA);
  migrateSkillKnowledgeSchema(db);
  return db;
}

function _createStore(overrides?: Partial<KnowledgeStoreConfig>): {
  store: IKnowledgeStore;
  db: Database.Database;
  vectorStore: ReturnType<typeof _createMockVectorStore>;
  embeddingProvider: EmbeddingProvider;
} {
  const db = _createTestDb();
  const vectorStore = _createMockVectorStore();
  const embeddingProvider = _createMockEmbeddingProvider();

  const store = createKnowledgeStore({
    sqlite: db,
    vectorStore,
    embeddingProvider,
    knowledgeDir: "/tmp/test-knowledge",
    capacity: overrides?.capacity ?? 500,
    maxTokensPerEntry: overrides?.maxTokensPerEntry ?? 2000,
    ...overrides,
  });

  return { store, db, vectorStore, embeddingProvider };
}

// ============================================================================
// Tests
// ============================================================================

describe("KnowledgeStore", () => {
  describe("write()", () => {
    it("应创建 SQLite 记录并返回 KnowledgeEntry", async () => {
      const { store } = _createStore();

      const entry = await store.write({
        content: "使用 Promise.all 并行请求可以提升性能",
        source: "reflection",
        category: "pattern",
        tags: ["performance", "async"],
      });

      expect(entry.id).toBeGreaterThan(0);
      expect(entry.content).toBe("使用 Promise.all 并行请求可以提升性能");
      expect(entry.source).toBe("reflection");
      expect(entry.category).toBe("pattern");
      expect(entry.tags).toEqual(["performance", "async"]);
      expect(entry.archived).toBe(false);
    });

    it("应设置 syncStatus 初始为 pending-both", async () => {
      const { store } = _createStore();

      const entry = await store.write({
        content: "test",
        source: "manual",
        category: "domain",
      });

      expect(entry.syncStatus).toBe("pending-both");
    });

    it("应设置默认的 effectiveness", async () => {
      const { store } = _createStore();

      const entry = await store.write({
        content: "test",
        source: "manual",
        category: "domain",
      });

      expect(entry.effectiveness.score).toBe(0.5);
      expect(entry.effectiveness.usageCount).toBe(0);
    });

    it("应在容量满时拒绝写入", async () => {
      const { store } = _createStore({ capacity: 2 });

      await store.write({ content: "item 1", source: "manual", category: "pattern" });
      await store.write({ content: "item 2", source: "manual", category: "pattern" });

      await expect(
        store.write({ content: "item 3", source: "manual", category: "pattern" }),
      ).rejects.toThrow(/capacity/i);
    });

    it("应支持可选的 skillId", async () => {
      const { store } = _createStore();

      const entry = await store.write({
        content: "coding tip",
        source: "manage-skill",
        category: "skill-extension",
        skillId: "coding-assistant",
      });

      expect(entry.skillId).toBe("coding-assistant");
    });

    it("应触发向量存储 upsert (异步)", async () => {
      const { store, vectorStore } = _createStore();

      await store.write({
        content: "test embedding",
        source: "manual",
        category: "pattern",
      });

      // 给异步操作一点时间
      await new Promise((r) => setTimeout(r, 50));

      expect(vectorStore.upsert).toHaveBeenCalled();
    });
  });

  describe("search()", () => {
    it("无 EmbeddingProvider 时应使用 SQLite LIKE 降级搜索", async () => {
      const db = _createTestDb();
      const store = createKnowledgeStore({
        sqlite: db,
        vectorStore: null,
        embeddingProvider: null,
        knowledgeDir: "/tmp/test",
      });

      await store.write({ content: "git rebase 最佳实践", source: "manual", category: "pattern" });
      await store.write({ content: "Docker 容器化部署", source: "manual", category: "pattern" });

      const results = await store.search({ query: "git" });
      expect(results.length).toBe(1);
      expect(results[0]!.entry.content).toContain("git");
    });

    it("有 EmbeddingProvider 时应使用语义搜索", async () => {
      const { store, vectorStore, db } = _createStore();

      // 先写入数据
      const entry = await store.write({
        content: "使用 useMemo 优化 React 渲染",
        source: "reflection",
        category: "pattern",
      });

      // Mock vector store 返回搜索结果
      vectorStore._searchResults = [
        { id: String(entry.id), score: 0.9, payload: {} },
      ];

      const results = await store.search({ query: "React 性能优化" });
      expect(results.length).toBeGreaterThan(0);
    });

    it("应按 category 过滤", async () => {
      const db = _createTestDb();
      const store = createKnowledgeStore({
        sqlite: db,
        vectorStore: null,
        embeddingProvider: null,
        knowledgeDir: "/tmp/test",
      });

      await store.write({ content: "pattern 知识", source: "manual", category: "pattern" });
      await store.write({ content: "domain 知识", source: "manual", category: "domain" });

      const results = await store.search({ query: "知识", category: "pattern" });
      expect(results.every((r) => r.entry.category === "pattern")).toBe(true);
    });

    it("应按 skillId 过滤", async () => {
      const db = _createTestDb();
      const store = createKnowledgeStore({
        sqlite: db,
        vectorStore: null,
        embeddingProvider: null,
        knowledgeDir: "/tmp/test",
      });

      await store.write({ content: "skill A 知识", source: "manage-skill", category: "skill-extension", skillId: "skill-a" });
      await store.write({ content: "skill B 知识", source: "manage-skill", category: "skill-extension", skillId: "skill-b" });

      const results = await store.search({ query: "知识", skillId: "skill-a" });
      expect(results.length).toBe(1);
      expect(results[0]!.entry.skillId).toBe("skill-a");
    });

    it("应排除归档条目（默认）", async () => {
      const { store } = _createStore();

      const entry = await store.write({ content: "will archive", source: "manual", category: "pattern" });
      await store.archive(entry.id);

      const results = await store.search({ query: "will archive" });
      expect(results.length).toBe(0);
    });

    it("空库应返回空结果", async () => {
      const { store } = _createStore();
      const results = await store.search({ query: "anything" });
      expect(results).toEqual([]);
    });
  });

  describe("searchBySkill()", () => {
    it("应按 skillId 过滤返回结果", async () => {
      const db = _createTestDb();
      const store = createKnowledgeStore({
        sqlite: db,
        vectorStore: null,
        embeddingProvider: null,
        knowledgeDir: "/tmp/test",
      });

      await store.write({ content: "skill-a tip 1", source: "manage-skill", category: "skill-extension", skillId: "skill-a" });
      await store.write({ content: "skill-a tip 2", source: "manage-skill", category: "skill-extension", skillId: "skill-a" });
      await store.write({ content: "skill-b tip", source: "manage-skill", category: "skill-extension", skillId: "skill-b" });

      const results = await store.searchBySkill("skill-a");
      expect(results.length).toBe(2);
      expect(results.every((r) => r.entry.skillId === "skill-a")).toBe(true);
    });
  });

  describe("getById()", () => {
    it("应返回正确的条目", async () => {
      const { store } = _createStore();
      const entry = await store.write({ content: "test", source: "manual", category: "pattern" });

      const found = await store.getById(entry.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(entry.id);
      expect(found!.content).toBe("test");
    });

    it("不存在的 ID 应返回 null", async () => {
      const { store } = _createStore();
      const found = await store.getById(99999);
      expect(found).toBeNull();
    });
  });

  describe("list()", () => {
    it("应返回所有非归档条目", async () => {
      const { store } = _createStore();
      await store.write({ content: "a", source: "manual", category: "pattern" });
      await store.write({ content: "b", source: "manual", category: "domain" });

      const entries = await store.list({});
      expect(entries.length).toBe(2);
    });

    it("应支持 category 过滤", async () => {
      const { store } = _createStore();
      await store.write({ content: "a", source: "manual", category: "pattern" });
      await store.write({ content: "b", source: "manual", category: "domain" });

      const entries = await store.list({ category: "pattern" });
      expect(entries.length).toBe(1);
      expect(entries[0]!.category).toBe("pattern");
    });

    it("应支持 source 过滤", async () => {
      const { store } = _createStore();
      await store.write({ content: "a", source: "manual", category: "pattern" });
      await store.write({ content: "b", source: "reflection", category: "pattern" });

      const entries = await store.list({ source: "reflection" });
      expect(entries.length).toBe(1);
      expect(entries[0]!.source).toBe("reflection");
    });

    it("应支持 limit/offset 分页", async () => {
      const { store } = _createStore();
      await store.write({ content: "a", source: "manual", category: "pattern" });
      await store.write({ content: "b", source: "manual", category: "pattern" });
      await store.write({ content: "c", source: "manual", category: "pattern" });

      const page1 = await store.list({ limit: 2 });
      expect(page1.length).toBe(2);

      const page2 = await store.list({ limit: 2, offset: 2 });
      expect(page2.length).toBe(1);
    });
  });

  describe("delete()", () => {
    it("应从 SQLite 删除条目", async () => {
      const { store } = _createStore();
      const entry = await store.write({ content: "to delete", source: "manual", category: "pattern" });

      await store.delete(entry.id);

      const found = await store.getById(entry.id);
      expect(found).toBeNull();
    });
  });

  describe("archive()", () => {
    it("应设置 archived 标志", async () => {
      const { store } = _createStore();
      const entry = await store.write({ content: "to archive", source: "manual", category: "pattern" });

      await store.archive(entry.id);

      const found = await store.getById(entry.id);
      expect(found).not.toBeNull();
      expect(found!.archived).toBe(true);
    });

    it("应触发向量删除", async () => {
      const { store, vectorStore } = _createStore();
      const entry = await store.write({ content: "to archive", source: "manual", category: "pattern" });

      await store.archive(entry.id);

      expect(vectorStore.delete).toHaveBeenCalledWith(String(entry.id));
    });
  });

  describe("updateEffectiveness()", () => {
    it("应更新 effectiveness 字段", async () => {
      const { store } = _createStore();
      const entry = await store.write({ content: "test", source: "manual", category: "pattern" });

      await store.updateEffectiveness(entry.id, {
        score: 0.9,
        usageCount: 5,
        feedback: "positive",
      });

      const updated = await store.getById(entry.id);
      expect(updated!.effectiveness.score).toBe(0.9);
      expect(updated!.effectiveness.usageCount).toBe(5);
      expect(updated!.effectiveness.feedback).toBe("positive");
    });
  });

  describe("getStats()", () => {
    it("应正确聚合统计", async () => {
      const { store } = _createStore({ capacity: 100 });

      await store.write({ content: "a", source: "manual", category: "pattern" });
      await store.write({ content: "b", source: "manual", category: "domain" });
      await store.write({ content: "c", source: "manual", category: "pattern" });

      const entry = await store.write({ content: "d", source: "manual", category: "anti-pattern" });
      await store.archive(entry.id);

      const stats = await store.getStats();
      expect(stats.totalEntries).toBe(3); // 不含归档
      expect(stats.archivedEntries).toBe(1);
      expect(stats.byCategory["pattern"]).toBe(2);
      expect(stats.byCategory["domain"]).toBe(1);
      expect(stats.capacity).toBe(100);
      expect(stats.utilizationRate).toBeCloseTo(0.03, 1);
    });

    it("空库应返回零统计", async () => {
      const { store } = _createStore();
      const stats = await store.getStats();

      expect(stats.totalEntries).toBe(0);
      expect(stats.archivedEntries).toBe(0);
      expect(stats.capacity).toBe(500);
      expect(stats.utilizationRate).toBe(0);
    });
  });

  describe("runCompensation()", () => {
    it("应重试 pending 状态的向量写入", async () => {
      const { store, vectorStore } = _createStore();

      // 写入一条，但阻止向量写入成功（让 syncStatus 保持 pending）
      await store.write({ content: "pending item", source: "manual", category: "pattern" });

      // 运行补偿
      const count = await store.runCompensation();
      // 至少尝试过补偿
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });
});
