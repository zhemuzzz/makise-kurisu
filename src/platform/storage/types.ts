/**
 * 存储层类型定义
 * 位置: src/platform/storage/types.ts
 *
 * ST-4: EmbeddingProvider 接口
 * ST-5: VectorStore + RoleDataStore 接口
 */

// ============ VectorStore (ST-5) ============

export interface SearchResult {
  readonly id: string;
  readonly score: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface VectorFilter {
  readonly must?: readonly VectorFilterCondition[];
  readonly should?: readonly VectorFilterCondition[];
  readonly must_not?: readonly VectorFilterCondition[];
}

export interface VectorFilterCondition {
  readonly key: string;
  readonly match?: { readonly value: string | number | boolean };
  readonly range?: {
    readonly gte?: number;
    readonly lte?: number;
    readonly gt?: number;
    readonly lt?: number;
  };
}

export interface VectorStore {
  upsert(id: string, vector: readonly number[], payload: Record<string, unknown>): Promise<void>;
  search(query: readonly number[], filter?: VectorFilter, topK?: number): Promise<readonly SearchResult[]>;
  delete(id: string): Promise<void>;
  deleteByFilter(filter: VectorFilter): Promise<number>;
  ensureCollection(): Promise<void>;
}

// ============ EmbeddingProvider (ST-4) ============

export interface EmbeddingProvider {
  embed(text: string): Promise<readonly number[]>;
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
  readonly dimensions: number;
  readonly modelId: string;
}

// ============ RoleDataStore (ST-5) ============

export interface RoleDataStoreConfig {
  readonly roleId: string;
  readonly dataDir: string;
  readonly qdrantHost?: string;
  readonly qdrantPort?: number;
  readonly qdrantApiKey?: string;
  readonly embeddingDimensions: number;
}

export interface RoleDirectories {
  readonly root: string;
  readonly identity: string;
  readonly skills: string;
  readonly knowledge: string;
  readonly state: string;
  readonly db: string;
}

/**
 * SQLite 表 schema（per-role, ST-2）
 */
export const ROLE_SQLITE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    user_id TEXT NOT NULL,
    importance REAL DEFAULT 0.5,
    session_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    messages TEXT NOT NULL DEFAULT '[]',
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    stage TEXT NOT NULL DEFAULT 'stranger',
    trust REAL NOT NULL DEFAULT 0.0,
    familiarity REAL NOT NULL DEFAULT 0.0,
    history TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS mood_projections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL UNIQUE,
    pleasure REAL NOT NULL DEFAULT 0.0,
    arousal REAL NOT NULL DEFAULT 0.0,
    dominance REAL NOT NULL DEFAULT 0.0,
    last_interaction INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS skill_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'hybrid',
    status TEXT NOT NULL DEFAULT 'active',
    registered_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS knowledge_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    event TEXT NOT NULL,
    session_id TEXT,
    span_id TEXT,
    parent_id TEXT,
    data TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
  CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry(session_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_level ON telemetry(level, timestamp);
  CREATE INDEX IF NOT EXISTS idx_telemetry_category ON telemetry(category, timestamp);
  CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_index(category);
`;

// ============ Schema Migration (Phase 3c) ============

/**
 * 幂等迁移：为 knowledge_index 和 skill_registry 添加 Phase 3c 所需的新列和索引
 *
 * 使用 ALTER TABLE ADD COLUMN（列不存在时添加，已存在时静默跳过）。
 * SQLite 3.35+ 不支持 IF NOT EXISTS 语法，所以通过 try/catch 实现幂等。
 *
 * @param db - better-sqlite3 Database 实例
 */
export function migrateSkillKnowledgeSchema(db: {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown };
  pragma(sql: string): unknown[];
}): void {
  // --- knowledge_index 新列 ---
  const knowledgeColumns: readonly [string, string][] = [
    ["skill_id", "TEXT"],
    ["tags", "TEXT NOT NULL DEFAULT '[]'"],
    ["effectiveness_score", "REAL NOT NULL DEFAULT 0.5"],
    ["effectiveness_usage_count", "INTEGER NOT NULL DEFAULT 0"],
    ["effectiveness_last_used_at", "INTEGER"],
    ["effectiveness_feedback", "TEXT"],
    ["sync_status", "TEXT NOT NULL DEFAULT 'pending-both'"],
    ["updated_at", "INTEGER NOT NULL DEFAULT 0"],
    ["archived", "INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [col, def] of knowledgeColumns) {
    safeAddColumn(db, "knowledge_index", col, def);
  }

  // --- skill_registry 新列 ---
  const skillColumns: readonly [string, string][] = [
    ["category", "TEXT NOT NULL DEFAULT ''"],
    ["description", "TEXT NOT NULL DEFAULT ''"],
    ["version", "TEXT NOT NULL DEFAULT '1.0'"],
    ["archived", "INTEGER NOT NULL DEFAULT 0"],
    ["archived_at", "INTEGER"],
    ["archived_reason", "TEXT"],
  ];

  for (const [col, def] of skillColumns) {
    safeAddColumn(db, "skill_registry", col, def);
  }

  // --- 新索引 (CREATE INDEX IF NOT EXISTS 是安全的) ---
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_sync_status ON knowledge_index(sync_status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_skill_id ON knowledge_index(skill_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_archived ON knowledge_index(archived);
    CREATE INDEX IF NOT EXISTS idx_skill_registry_archived ON skill_registry(archived);
  `);
}

/**
 * 安全添加列 — 列已存在时静默跳过
 */
function safeAddColumn(
  db: { exec(sql: string): void; pragma(sql: string): unknown[] },
  table: string,
  column: string,
  definition: string,
): void {
  // 检查列是否已存在
  const columns = db.pragma(`table_info(${table})`) as readonly { name: string }[];
  const exists = columns.some((c) => c.name === column);
  if (exists) return;

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
