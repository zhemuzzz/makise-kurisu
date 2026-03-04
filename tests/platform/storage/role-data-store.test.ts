/**
 * RoleDataStore 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * ST-2: Per-role 分库
 * ST-5: RoleDataStore 统一访问
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("RoleDataStore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-rds-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("ST-2: Per-role Directory Structure", () => {
    it("RDS-01: 初始化创建正确的目录结构", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const store = await createRoleDataStore({
        roleId: "kurisu",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      expect(existsSync(join(tempDir, "roles", "kurisu", "identity"))).toBe(true);
      expect(existsSync(join(tempDir, "roles", "kurisu", "skills"))).toBe(true);
      expect(existsSync(join(tempDir, "roles", "kurisu", "knowledge"))).toBe(true);
      expect(existsSync(join(tempDir, "roles", "kurisu", "state"))).toBe(true);
      expect(existsSync(join(tempDir, "roles", "kurisu", "db"))).toBe(true);

      store.close();
    });

    it("RDS-02: SQLite 数据库正确初始化", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const store = await createRoleDataStore({
        roleId: "kurisu",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      // 验证 SQLite 文件存在
      expect(existsSync(join(tempDir, "roles", "kurisu", "db", "store.sqlite"))).toBe(true);

      // 验证表已创建
      const tables = store.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>;

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain("memories");
      expect(tableNames).toContain("sessions");
      expect(tableNames).toContain("relationships");
      expect(tableNames).toContain("mood_projections");
      expect(tableNames).toContain("skill_registry");
      expect(tableNames).toContain("knowledge_index");
      expect(tableNames).toContain("telemetry");

      store.close();
    });
  });

  describe("ST-5: Data Access", () => {
    it("RDS-03: SQLite 基本 CRUD 操作", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const store = await createRoleDataStore({
        roleId: "kurisu",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      // Insert
      store.sqlite
        .prepare("INSERT INTO memories (content, user_id, importance) VALUES (?, ?, ?)")
        .run("用户喜欢 TypeScript", "user1", 0.8);

      // Query
      const rows = store.sqlite
        .prepare("SELECT * FROM memories WHERE user_id = ?")
        .all("user1") as Array<{ content: string; user_id: string; importance: number }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.content).toBe("用户喜欢 TypeScript");
      expect(rows[0]!.importance).toBe(0.8);

      store.close();
    });

    it("RDS-04: roleId 属性正确", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const store = await createRoleDataStore({
        roleId: "xiaoxue",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      expect(store.roleId).toBe("xiaoxue");

      store.close();
    });

    it("RDS-05: files 路径正确", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const store = await createRoleDataStore({
        roleId: "kurisu",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      expect(store.files.identityDir).toBe(join(tempDir, "roles", "kurisu", "identity"));
      expect(store.files.skillsDir).toBe(join(tempDir, "roles", "kurisu", "skills"));
      expect(store.files.knowledgeDir).toBe(join(tempDir, "roles", "kurisu", "knowledge"));
      expect(store.files.stateDir).toBe(join(tempDir, "roles", "kurisu", "state"));

      store.close();
    });
  });

  describe("Role Isolation", () => {
    it("RDS-06: 不同角色数据库完全隔离", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const storeA = await createRoleDataStore({
        roleId: "roleA",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      const storeB = await createRoleDataStore({
        roleId: "roleB",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      // roleA 写入
      storeA.sqlite
        .prepare("INSERT INTO memories (content, user_id) VALUES (?, ?)")
        .run("roleA memory", "user1");

      // roleB 不应该看到 roleA 的数据
      const rowsB = storeB.sqlite
        .prepare("SELECT * FROM memories")
        .all() as Array<{ content: string }>;
      expect(rowsB).toHaveLength(0);

      // roleA 确认自己的数据在
      const rowsA = storeA.sqlite
        .prepare("SELECT * FROM memories")
        .all() as Array<{ content: string }>;
      expect(rowsA).toHaveLength(1);

      storeA.close();
      storeB.close();
    });
  });

  describe("Input Validation (M5)", () => {
    it("RDS-08: 非法 roleId 被拒绝（路径遍历防护）", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      // 路径遍历
      await expect(
        createRoleDataStore({
          roleId: "../etc/passwd",
          dataDir: tempDir,
          embeddingDimensions: 1024,
          skipQdrant: true,
        }),
      ).rejects.toThrow("Invalid roleId");

      // 空字符串
      await expect(
        createRoleDataStore({
          roleId: "",
          dataDir: tempDir,
          embeddingDimensions: 1024,
          skipQdrant: true,
        }),
      ).rejects.toThrow("Invalid roleId");

      // 特殊字符
      await expect(
        createRoleDataStore({
          roleId: "role; DROP TABLE",
          dataDir: tempDir,
          embeddingDimensions: 1024,
          skipQdrant: true,
        }),
      ).rejects.toThrow("Invalid roleId");
    });

    it("RDS-09: 合法 roleId 格式被接受", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      // 字母+数字+连字符+下划线
      const store = await createRoleDataStore({
        roleId: "kurisu_v2-test",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      expect(store.roleId).toBe("kurisu_v2-test");
      store.close();
    });
  });

  describe("Role Lifecycle", () => {
    it("RDS-07: close() 正确关闭 SQLite 连接", async () => {
      const { createRoleDataStore } = await import(
        "@/platform/storage/role-data-store-factory"
      );

      const store = await createRoleDataStore({
        roleId: "kurisu",
        dataDir: tempDir,
        embeddingDimensions: 1024,
        skipQdrant: true,
      });

      store.close();

      // 关闭后操作应该抛错
      expect(() =>
        store.sqlite.prepare("SELECT 1").get(),
      ).toThrow();
    });
  });
});
