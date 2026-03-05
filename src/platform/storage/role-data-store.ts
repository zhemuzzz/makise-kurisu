/**
 * RoleDataStore — Per-role 统一数据访问
 * 位置: src/platform/storage/role-data-store.ts
 *
 * ST-2: Per-role 分库
 * ST-5: 统一访问层
 *
 * 每个角色一个实例，完全隔离
 */

import type Database from "better-sqlite3";
import type { VectorStore } from "./types.js";

// ============ 类型 ============

export interface RoleFiles {
  readonly identityDir: string;
  readonly skillsDir: string;
  readonly knowledgeDir: string;
  readonly stateDir: string;
}

// ============ RoleDataStore ============

export class RoleDataStore {
  readonly roleId: string;
  readonly sqlite: Database.Database;
  readonly vectors: {
    readonly memories: VectorStore;
    readonly knowledge: VectorStore;
  } | null;
  readonly files: RoleFiles;

  constructor(
    roleId: string,
    sqlite: Database.Database,
    vectors: { readonly memories: VectorStore; readonly knowledge: VectorStore } | null,
    files: RoleFiles,
  ) {
    this.roleId = roleId;
    this.sqlite = sqlite;
    this.vectors = vectors;
    this.files = files;
  }

  close(): void {
    this.sqlite.close();
  }
}
