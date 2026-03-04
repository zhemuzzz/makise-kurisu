/**
 * RoleDataStore 工厂
 * 位置: src/platform/storage/role-data-store-factory.ts
 *
 * 创建并初始化 RoleDataStore 实例
 * - 创建目录结构
 * - 初始化 SQLite + 建表
 * - 可选初始化 Qdrant collections
 */

import { mkdirSync } from "fs";
import { join } from "path";
import BetterSqlite3 from "better-sqlite3";
import { ROLE_SQLITE_SCHEMA } from "./types.js";
import type { VectorStore } from "./types.js";
import { RoleDataStore } from "./role-data-store.js";
import type { RoleFiles } from "./role-data-store.js";

// ============ 工厂配置 ============

export interface CreateRoleDataStoreOptions {
  readonly roleId: string;
  readonly dataDir: string;
  readonly embeddingDimensions: number;
  /** 跳过 Qdrant 初始化（测试用） */
  readonly skipQdrant?: boolean;
  readonly qdrantHost?: string;
  readonly qdrantPort?: number;
  readonly qdrantApiKey?: string;
}

// ============ 工厂函数 ============

const ROLE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

export async function createRoleDataStore(
  options: CreateRoleDataStoreOptions,
): Promise<RoleDataStore> {
  const { roleId, dataDir } = options;

  // Validate roleId to prevent path traversal and collection injection
  if (!ROLE_ID_PATTERN.test(roleId)) {
    throw new Error(
      `Invalid roleId: "${roleId}". Must be 1-64 alphanumeric/hyphen/underscore characters.`,
    );
  }

  // 1. 创建目录结构
  const roleRoot = join(dataDir, "roles", roleId);
  const dirs: RoleFiles = {
    identityDir: join(roleRoot, "identity"),
    skillsDir: join(roleRoot, "skills"),
    knowledgeDir: join(roleRoot, "knowledge"),
    stateDir: join(roleRoot, "state"),
  };
  const dbDir = join(roleRoot, "db");

  mkdirSync(dirs.identityDir, { recursive: true });
  mkdirSync(dirs.skillsDir, { recursive: true });
  mkdirSync(dirs.knowledgeDir, { recursive: true });
  mkdirSync(dirs.stateDir, { recursive: true });
  mkdirSync(dbDir, { recursive: true });

  // 2. 初始化 SQLite
  const dbPath = join(dbDir, "store.sqlite");
  const sqlite = new BetterSqlite3(dbPath);

  // WAL 模式 + 建表
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(ROLE_SQLITE_SCHEMA);

  // 3. 可选初始化 Qdrant
  let vectors: {
    readonly memories: VectorStore;
    readonly knowledge: VectorStore;
  } | null = null;

  if (!options.skipQdrant) {
    const { QdrantClient } = await import("@qdrant/js-client-rest");
    const { QdrantVectorStore } = await import("./vector-store.js");

    const clientConfig: Record<string, unknown> = {
      host: options.qdrantHost ?? "localhost",
      port: options.qdrantPort ?? 6333,
    };
    if (options.qdrantApiKey) {
      clientConfig["apiKey"] = options.qdrantApiKey;
    }
    const client = new QdrantClient(clientConfig as ConstructorParameters<typeof QdrantClient>[0]);

    const memoriesStore = new QdrantVectorStore({
      client,
      collectionName: `${roleId}_memories`,
      dimensions: options.embeddingDimensions,
    });

    const knowledgeStore = new QdrantVectorStore({
      client,
      collectionName: `${roleId}_knowledge`,
      dimensions: options.embeddingDimensions,
    });

    await memoriesStore.ensureCollection();
    await knowledgeStore.ensureCollection();

    vectors = { memories: memoriesStore, knowledge: knowledgeStore };
  }

  return new RoleDataStore(roleId, sqlite, vectors, dirs);
}
