/**
 * Schema Migration Tests
 *
 * 测试 migrateSkillKnowledgeSchema 幂等迁移函数
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  ROLE_SQLITE_SCHEMA,
  migrateSkillKnowledgeSchema,
} from "../../../src/platform/storage/types";

describe("migrateSkillKnowledgeSchema", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(ROLE_SQLITE_SCHEMA);
  });

  afterEach(() => {
    db.close();
  });

  it("应成功执行迁移", () => {
    expect(() => migrateSkillKnowledgeSchema(db)).not.toThrow();
  });

  it("应为 knowledge_index 添加新列", () => {
    migrateSkillKnowledgeSchema(db);

    // 验证新列存在 — 插入包含新列的行
    const stmt = db.prepare(`
      INSERT INTO knowledge_index (content, source, category, skill_id, tags, effectiveness_score,
        effectiveness_usage_count, sync_status, updated_at, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run("test content", "manual", "pattern", "test-skill", "[]", 0.5, 0, "pending-both", Date.now(), 0);

    const row = db.prepare("SELECT * FROM knowledge_index WHERE content = ?").get("test content") as Record<string, unknown>;
    expect(row["skill_id"]).toBe("test-skill");
    expect(row["tags"]).toBe("[]");
    expect(row["effectiveness_score"]).toBe(0.5);
    expect(row["effectiveness_usage_count"]).toBe(0);
    expect(row["sync_status"]).toBe("pending-both");
    expect(row["archived"]).toBe(0);
  });

  it("应为 skill_registry 添加新列", () => {
    migrateSkillKnowledgeSchema(db);

    // 验证新列存在
    const stmt = db.prepare(`
      INSERT INTO skill_registry (id, name, type, status, category, description, version, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run("test-skill", "Test Skill", "hybrid", "active", "utility", "A test skill", "1.0", 0);

    const row = db.prepare("SELECT * FROM skill_registry WHERE id = ?").get("test-skill") as Record<string, unknown>;
    expect(row["category"]).toBe("utility");
    expect(row["description"]).toBe("A test skill");
    expect(row["version"]).toBe("1.0");
    expect(row["archived"]).toBe(0);
  });

  it("应创建新索引", () => {
    migrateSkillKnowledgeSchema(db);

    // 查询 sqlite_master 验证索引
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((r) => (r as Record<string, string>)["name"]);

    expect(indexes).toContain("idx_knowledge_sync_status");
    expect(indexes).toContain("idx_knowledge_skill_id");
    expect(indexes).toContain("idx_knowledge_archived");
    expect(indexes).toContain("idx_skill_registry_archived");
  });

  it("应为幂等迁移 — 多次执行不报错", () => {
    migrateSkillKnowledgeSchema(db);
    expect(() => migrateSkillKnowledgeSchema(db)).not.toThrow();
    expect(() => migrateSkillKnowledgeSchema(db)).not.toThrow();
  });

  it("迁移后现有数据应保持不变", () => {
    // 先插入数据
    db.prepare(`
      INSERT INTO knowledge_index (content, source, category) VALUES (?, ?, ?)
    `).run("existing knowledge", "reflection", "general");

    db.prepare(`
      INSERT INTO skill_registry (id, name, type) VALUES (?, ?, ?)
    `).run("existing-skill", "Existing", "hybrid");

    // 执行迁移
    migrateSkillKnowledgeSchema(db);

    // 验证现有数据完好
    const knowledge = db.prepare("SELECT * FROM knowledge_index WHERE content = ?").get("existing knowledge") as Record<string, unknown>;
    expect(knowledge["content"]).toBe("existing knowledge");
    expect(knowledge["source"]).toBe("reflection");
    // 新列应有默认值
    expect(knowledge["archived"]).toBe(0);
    expect(knowledge["sync_status"]).toBe("pending-both");

    const skill = db.prepare("SELECT * FROM skill_registry WHERE id = ?").get("existing-skill") as Record<string, unknown>;
    expect(skill["name"]).toBe("Existing");
    expect(skill["archived"]).toBe(0);
  });
});
