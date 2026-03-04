/**
 * KnowledgeStore 实现
 *
 * @module platform/skills/knowledge-store
 * @description 知识管理 — SQLite + Qdrant + FS 三写一致性 (KS-6)
 *
 * 设计来源:
 * - knowledge-store.md (KS-1~KS-6)
 * - skill-system.md D15 (manage-skill 知识管理)
 */

import type { VectorStore, EmbeddingProvider } from "../storage/types.js";
import type {
  KnowledgeEntry,
  KnowledgeCategory,
  KnowledgeSource,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  KnowledgeFilter,
  KnowledgeStats,
  EffectivenessScore,
  SyncStatus,
} from "./knowledge-types.js";
import {
  KNOWLEDGE_CAPACITY_DEFAULT,
  KNOWLEDGE_CATEGORIES,
} from "./knowledge-types.js";

// ============================================================================
// Interface
// ============================================================================

/**
 * KnowledgeStore 配置
 */
export interface KnowledgeStoreConfig {
  /** SQLite database (better-sqlite3) */
  readonly sqlite: SqliteDb;
  /** Qdrant vector store (nullable — 降级到 SQLite LIKE) */
  readonly vectorStore: VectorStore | null;
  /** Embedding provider (nullable — 降级到 SQLite LIKE) */
  readonly embeddingProvider: EmbeddingProvider | null;
  /** 知识文件目录 */
  readonly knowledgeDir: string;
  /** 容量上限 */
  readonly capacity?: number;
  /** 单条最大 Token 数 */
  readonly maxTokensPerEntry?: number;
}

/**
 * 最小 SQLite 接口 (better-sqlite3 兼容)
 */
interface SqliteDb {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

interface SqliteStatement {
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
}

/**
 * KnowledgeStore 写入选项
 */
export interface KnowledgeWriteOptions {
  readonly content: string;
  readonly source: KnowledgeSource;
  readonly category: KnowledgeCategory;
  readonly skillId?: string;
  readonly tags?: readonly string[];
}

/**
 * IKnowledgeStore — 知识管理接口
 */
export interface IKnowledgeStore {
  write(options: KnowledgeWriteOptions): Promise<KnowledgeEntry>;
  search(options: KnowledgeSearchOptions): Promise<readonly KnowledgeSearchResult[]>;
  searchBySkill(skillId: string): Promise<readonly KnowledgeSearchResult[]>;
  getById(id: number): Promise<KnowledgeEntry | null>;
  list(filter: KnowledgeFilter): Promise<readonly KnowledgeEntry[]>;
  delete(id: number): Promise<void>;
  archive(id: number): Promise<void>;
  updateEffectiveness(id: number, effectiveness: Partial<EffectivenessScore>): Promise<void>;
  runCompensation(): Promise<number>;
  getStats(): Promise<KnowledgeStats>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * 工厂函数
 */
export function createKnowledgeStore(config: KnowledgeStoreConfig): IKnowledgeStore {
  const capacity = config.capacity ?? KNOWLEDGE_CAPACITY_DEFAULT;
  const db = config.sqlite;
  const vectorStore = config.vectorStore;
  const embeddingProvider = config.embeddingProvider;

  // ---- helpers ----

  /** Escape LIKE wildcards (%, _, \) to prevent unintended pattern matching */
  function escapeLikeWildcards(s: string): string {
    return s.replace(/[%_\\]/g, "\\$&");
  }

  function buildEffectiveness(row: Record<string, unknown>): EffectivenessScore {
    const base: EffectivenessScore = {
      score: (row["effectiveness_score"] as number) ?? 0.5,
      usageCount: (row["effectiveness_usage_count"] as number) ?? 0,
    };
    const lastUsedAt = row["effectiveness_last_used_at"] as number | null;
    const feedback = row["effectiveness_feedback"] as "positive" | "negative" | "neutral" | null;
    if (lastUsedAt && feedback) {
      return { ...base, lastUsedAt, feedback };
    }
    if (lastUsedAt) {
      return { ...base, lastUsedAt };
    }
    if (feedback) {
      return { ...base, feedback };
    }
    return base;
  }

  function rowToEntry(row: Record<string, unknown>): KnowledgeEntry {
    const skillId = row["skill_id"] as string | null;

    return {
      id: row["id"] as number,
      content: row["content"] as string,
      source: row["source"] as KnowledgeSource,
      category: row["category"] as KnowledgeCategory,
      ...(skillId ? { skillId } : {}),
      tags: parseTags(row["tags"] as string | null),
      effectiveness: buildEffectiveness(row),
      syncStatus: (row["sync_status"] as SyncStatus) ?? "pending-both",
      createdAt: (row["created_at"] as number) ?? 0,
      updatedAt: (row["updated_at"] as number) ?? 0,
      archived: (row["archived"] as number) === 1,
    };
  }

  function parseTags(raw: string | null): readonly string[] {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
    } catch {
      return [];
    }
  }

  function getActiveCount(): number {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_index WHERE archived = 0").get() as { cnt: number };
    return row.cnt;
  }

  // ---- write ----

  async function write(options: KnowledgeWriteOptions): Promise<KnowledgeEntry> {
    // 容量检查
    if (getActiveCount() >= capacity) {
      throw new Error(`KnowledgeStore capacity exceeded (max: ${capacity})`);
    }

    const now = Math.floor(Date.now() / 1000);
    const tagsJson = JSON.stringify(options.tags ?? []);

    const result = db.prepare(`
      INSERT INTO knowledge_index (content, source, category, skill_id, tags,
        effectiveness_score, effectiveness_usage_count, sync_status, created_at, updated_at, archived)
      VALUES (?, ?, ?, ?, ?, 0.5, 0, 'pending-both', ?, ?, 0)
    `).run(
      options.content,
      options.source,
      options.category,
      options.skillId ?? null,
      tagsJson,
      now,
      now,
    );

    const id = Number(result.lastInsertRowid);

    // 异步向量写入 (fire and forget)
    if (vectorStore && embeddingProvider) {
      void (async () => {
        try {
          const vector = await embeddingProvider.embed(options.content);
          await vectorStore.upsert(String(id), vector, {
            category: options.category,
            source: options.source,
            skillId: options.skillId ?? "",
          });
          // 更新 sync_status
          db.prepare("UPDATE knowledge_index SET sync_status = 'synced' WHERE id = ?").run(id);
        } catch (err) {
          // 保持 pending-both，等 runCompensation 重试
          console.warn(`[KnowledgeStore] Vector upsert failed for id=${id}:`, err);
        }
      })();
    }

    const row = db.prepare("SELECT * FROM knowledge_index WHERE id = ?").get(id) as Record<string, unknown>;
    return rowToEntry(row);
  }

  // ---- search ----

  async function search(options: KnowledgeSearchOptions): Promise<readonly KnowledgeSearchResult[]> {
    const includeArchived = options.includeArchived ?? false;
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;

    // 语义搜索路径
    if (vectorStore && embeddingProvider) {
      const queryVector = await embeddingProvider.embed(options.query);
      const vectorResults = await vectorStore.search(queryVector, undefined, limit);

      if (vectorResults.length > 0) {
        const results: KnowledgeSearchResult[] = [];
        for (const vr of vectorResults) {
          if (vr.score < minScore) continue;
          const row = db.prepare("SELECT * FROM knowledge_index WHERE id = ?").get(Number(vr.id)) as Record<string, unknown> | undefined;
          if (!row) continue;
          if (!includeArchived && (row["archived"] as number) === 1) continue;
          if (options.category && row["category"] !== options.category) continue;
          if (options.skillId && row["skill_id"] !== options.skillId) continue;

          results.push({
            entry: rowToEntry(row),
            relevanceScore: vr.score,
          });
        }
        return results;
      }
    }

    // SQLite LIKE 降级
    return searchByLike(options, includeArchived, limit);
  }

  function searchByLike(
    options: KnowledgeSearchOptions,
    includeArchived: boolean,
    limit: number,
  ): readonly KnowledgeSearchResult[] {
    const conditions: string[] = ["content LIKE ? ESCAPE '\\'"];
    const params: unknown[] = [`%${escapeLikeWildcards(options.query)}%`];

    if (!includeArchived) {
      conditions.push("archived = 0");
    }
    if (options.category) {
      conditions.push("category = ?");
      params.push(options.category);
    }
    if (options.skillId) {
      conditions.push("skill_id = ?");
      params.push(options.skillId);
    }

    const sql = `SELECT * FROM knowledge_index WHERE ${conditions.join(" AND ")} LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      entry: rowToEntry(row),
      relevanceScore: 0.5, // LIKE 搜索无真实相关性分数
    }));
  }

  // ---- searchBySkill ----

  async function searchBySkill(skillId: string): Promise<readonly KnowledgeSearchResult[]> {
    const rows = db
      .prepare("SELECT * FROM knowledge_index WHERE skill_id = ? AND archived = 0")
      .all(skillId) as Record<string, unknown>[];

    return rows.map((row) => ({
      entry: rowToEntry(row),
      relevanceScore: 1.0,
    }));
  }

  // ---- getById ----

  async function getById(id: number): Promise<KnowledgeEntry | null> {
    const row = db.prepare("SELECT * FROM knowledge_index WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : null;
  }

  // ---- list ----

  async function list(filter: KnowledgeFilter): Promise<readonly KnowledgeEntry[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!filter.includeArchived) {
      conditions.push("archived = 0");
    }
    if (filter.category) {
      conditions.push("category = ?");
      params.push(filter.category);
    }
    if (filter.source) {
      conditions.push("source = ?");
      params.push(filter.source);
    }
    if (filter.skillId) {
      conditions.push("skill_id = ?");
      params.push(filter.skillId);
    }
    if (filter.syncStatus) {
      conditions.push("sync_status = ?");
      params.push(filter.syncStatus);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    let sql = `SELECT * FROM knowledge_index ${where} ORDER BY id ASC`;

    if (filter.limit !== null && filter.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(filter.limit);
    }
    if (filter.offset !== null && filter.offset !== undefined) {
      if (filter.limit === null || filter.limit === undefined) {
        sql += ` LIMIT -1`;
      }
      sql += ` OFFSET ?`;
      params.push(filter.offset);
    }

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToEntry);
  }

  // ---- delete ----

  async function del(id: number): Promise<void> {
    db.prepare("DELETE FROM knowledge_index WHERE id = ?").run(id);
    if (vectorStore) {
      try {
        await vectorStore.delete(String(id));
      } catch {
        // best effort
      }
    }
  }

  // ---- archive ----

  async function archive(id: number): Promise<void> {
    db.prepare("UPDATE knowledge_index SET archived = 1 WHERE id = ?").run(id);
    if (vectorStore) {
      try {
        await vectorStore.delete(String(id));
      } catch {
        // best effort
      }
    }
  }

  // ---- updateEffectiveness ----

  async function updateEffectiveness(
    id: number,
    effectiveness: Partial<EffectivenessScore>,
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (effectiveness.score !== null && effectiveness.score !== undefined) {
      sets.push("effectiveness_score = ?");
      params.push(effectiveness.score);
    }
    if (effectiveness.usageCount !== null && effectiveness.usageCount !== undefined) {
      sets.push("effectiveness_usage_count = ?");
      params.push(effectiveness.usageCount);
    }
    if (effectiveness.lastUsedAt !== null && effectiveness.lastUsedAt !== undefined) {
      sets.push("effectiveness_last_used_at = ?");
      params.push(effectiveness.lastUsedAt);
    }
    if (effectiveness.feedback !== null && effectiveness.feedback !== undefined) {
      sets.push("effectiveness_feedback = ?");
      params.push(effectiveness.feedback);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = ?");
    params.push(Math.floor(Date.now() / 1000));
    params.push(id);

    db.prepare(`UPDATE knowledge_index SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  }

  // ---- runCompensation ----

  async function runCompensation(): Promise<number> {
    if (!vectorStore || !embeddingProvider) return 0;

    const pending = db
      .prepare("SELECT * FROM knowledge_index WHERE sync_status IN ('pending-both', 'pending-vector') AND archived = 0")
      .all() as Record<string, unknown>[];

    let count = 0;
    for (const row of pending) {
      try {
        const vector = await embeddingProvider.embed(row["content"] as string);
        await vectorStore.upsert(String(row["id"]), vector, {
          category: row["category"],
          source: row["source"],
          skillId: row["skill_id"] ?? "",
        });
        db.prepare("UPDATE knowledge_index SET sync_status = 'synced' WHERE id = ?").run(row["id"]);
        count++;
      } catch {
        // 下次再试
      }
    }

    return count;
  }

  // ---- getStats ----

  async function getStats(): Promise<KnowledgeStats> {
    const totalRow = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_index WHERE archived = 0").get() as { cnt: number };
    const archivedRow = db.prepare("SELECT COUNT(*) as cnt FROM knowledge_index WHERE archived = 1").get() as { cnt: number };

    const byCategory: Record<string, number> = {};
    for (const cat of KNOWLEDGE_CATEGORIES) {
      const row = db
        .prepare("SELECT COUNT(*) as cnt FROM knowledge_index WHERE category = ? AND archived = 0")
        .get(cat) as { cnt: number };
      byCategory[cat] = row.cnt;
    }

    const bySyncStatus: Record<string, number> = {};
    for (const status of ["synced", "pending-vector", "pending-file", "pending-both"] as const) {
      const row = db
        .prepare("SELECT COUNT(*) as cnt FROM knowledge_index WHERE sync_status = ? AND archived = 0")
        .get(status) as { cnt: number };
      bySyncStatus[status] = row.cnt;
    }

    const total = totalRow.cnt;
    return {
      totalEntries: total,
      archivedEntries: archivedRow.cnt,
      byCategory: byCategory as KnowledgeStats["byCategory"],
      bySyncStatus: bySyncStatus as KnowledgeStats["bySyncStatus"],
      capacity,
      utilizationRate: capacity > 0 ? total / capacity : 0,
    };
  }

  return {
    write,
    search,
    searchBySkill,
    getById,
    list,
    delete: del,
    archive,
    updateEffectiveness,
    runCompensation,
    getStats,
  };
}
