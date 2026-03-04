/**
 * Knowledge Types Tests
 *
 * 类型守卫、常量、工厂函数测试
 */

import { describe, it, expect } from "vitest";
import {
  KNOWLEDGE_CAPACITY_DEFAULT,
  KNOWLEDGE_MAX_TOKENS_DEFAULT,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_SOURCES,
  SYNC_STATUSES,
  isKnowledgeCategory,
  isKnowledgeSource,
  isSyncStatus,
  isValidEffectivenessScore,
  createDefaultEffectiveness,
} from "../../../src/platform/skills/knowledge-types";
import type {
  KnowledgeCategory,
  KnowledgeSource,
  SyncStatus,
  KnowledgeEntry,
  KnowledgeSearchOptions,
  KnowledgeStats,
  EffectivenessScore,
} from "../../../src/platform/skills/knowledge-types";

describe("Knowledge Types", () => {
  // ========================================================================
  // 常量
  // ========================================================================

  describe("Constants", () => {
    it("KNOWLEDGE_CAPACITY_DEFAULT 应为 500", () => {
      expect(KNOWLEDGE_CAPACITY_DEFAULT).toBe(500);
    });

    it("KNOWLEDGE_MAX_TOKENS_DEFAULT 应为 2000", () => {
      expect(KNOWLEDGE_MAX_TOKENS_DEFAULT).toBe(2000);
    });

    it("KNOWLEDGE_CATEGORIES 应包含 4 个分类", () => {
      expect(KNOWLEDGE_CATEGORIES).toHaveLength(4);
      expect(KNOWLEDGE_CATEGORIES).toContain("pattern");
      expect(KNOWLEDGE_CATEGORIES).toContain("domain");
      expect(KNOWLEDGE_CATEGORIES).toContain("skill-extension");
      expect(KNOWLEDGE_CATEGORIES).toContain("anti-pattern");
    });

    it("KNOWLEDGE_SOURCES 应包含 5 个来源", () => {
      expect(KNOWLEDGE_SOURCES).toHaveLength(5);
      expect(KNOWLEDGE_SOURCES).toContain("reflection");
      expect(KNOWLEDGE_SOURCES).toContain("active-learning");
      expect(KNOWLEDGE_SOURCES).toContain("manage-skill");
      expect(KNOWLEDGE_SOURCES).toContain("manual");
      expect(KNOWLEDGE_SOURCES).toContain("user-correction");
    });

    it("SYNC_STATUSES 应包含 4 个状态", () => {
      expect(SYNC_STATUSES).toHaveLength(4);
      expect(SYNC_STATUSES).toContain("synced");
      expect(SYNC_STATUSES).toContain("pending-vector");
      expect(SYNC_STATUSES).toContain("pending-file");
      expect(SYNC_STATUSES).toContain("pending-both");
    });
  });

  // ========================================================================
  // 类型守卫
  // ========================================================================

  describe("isKnowledgeCategory", () => {
    it("应接受有效分类", () => {
      for (const cat of KNOWLEDGE_CATEGORIES) {
        expect(isKnowledgeCategory(cat)).toBe(true);
      }
    });

    it("应拒绝无效字符串", () => {
      expect(isKnowledgeCategory("invalid")).toBe(false);
      expect(isKnowledgeCategory("general")).toBe(false);
      expect(isKnowledgeCategory("")).toBe(false);
    });

    it("应拒绝非字符串类型", () => {
      expect(isKnowledgeCategory(123)).toBe(false);
      expect(isKnowledgeCategory(null)).toBe(false);
      expect(isKnowledgeCategory(undefined)).toBe(false);
      expect(isKnowledgeCategory({})).toBe(false);
    });
  });

  describe("isKnowledgeSource", () => {
    it("应接受有效来源", () => {
      for (const src of KNOWLEDGE_SOURCES) {
        expect(isKnowledgeSource(src)).toBe(true);
      }
    });

    it("应拒绝无效字符串", () => {
      expect(isKnowledgeSource("invalid")).toBe(false);
      expect(isKnowledgeSource("auto")).toBe(false);
    });

    it("应拒绝非字符串类型", () => {
      expect(isKnowledgeSource(42)).toBe(false);
      expect(isKnowledgeSource(null)).toBe(false);
    });
  });

  describe("isSyncStatus", () => {
    it("应接受有效同步状态", () => {
      for (const status of SYNC_STATUSES) {
        expect(isSyncStatus(status)).toBe(true);
      }
    });

    it("应拒绝无效字符串", () => {
      expect(isSyncStatus("unknown")).toBe(false);
      expect(isSyncStatus("pending")).toBe(false);
    });

    it("应拒绝非字符串类型", () => {
      expect(isSyncStatus(0)).toBe(false);
      expect(isSyncStatus(true)).toBe(false);
    });
  });

  describe("isValidEffectivenessScore", () => {
    it("应接受有效的 EffectivenessScore", () => {
      expect(
        isValidEffectivenessScore({ score: 0.5, usageCount: 10 }),
      ).toBe(true);
      expect(
        isValidEffectivenessScore({ score: 0, usageCount: 0 }),
      ).toBe(true);
      expect(
        isValidEffectivenessScore({ score: 1, usageCount: 100 }),
      ).toBe(true);
    });

    it("应接受带可选字段的 EffectivenessScore", () => {
      expect(
        isValidEffectivenessScore({
          score: 0.8,
          usageCount: 5,
          lastUsedAt: Date.now(),
          feedback: "positive",
        }),
      ).toBe(true);
    });

    it("应拒绝 score 越界", () => {
      expect(
        isValidEffectivenessScore({ score: -0.1, usageCount: 0 }),
      ).toBe(false);
      expect(
        isValidEffectivenessScore({ score: 1.1, usageCount: 0 }),
      ).toBe(false);
    });

    it("应拒绝 usageCount 为负数", () => {
      expect(
        isValidEffectivenessScore({ score: 0.5, usageCount: -1 }),
      ).toBe(false);
    });

    it("应拒绝 usageCount 为小数", () => {
      expect(
        isValidEffectivenessScore({ score: 0.5, usageCount: 1.5 }),
      ).toBe(false);
    });

    it("应拒绝非对象类型", () => {
      expect(isValidEffectivenessScore(null)).toBe(false);
      expect(isValidEffectivenessScore(undefined)).toBe(false);
      expect(isValidEffectivenessScore("string")).toBe(false);
      expect(isValidEffectivenessScore(42)).toBe(false);
    });

    it("应拒绝缺少必要字段", () => {
      expect(isValidEffectivenessScore({ score: 0.5 })).toBe(false);
      expect(isValidEffectivenessScore({ usageCount: 0 })).toBe(false);
      expect(isValidEffectivenessScore({})).toBe(false);
    });
  });

  // ========================================================================
  // 工厂函数
  // ========================================================================

  describe("createDefaultEffectiveness", () => {
    it("应返回默认 EffectivenessScore", () => {
      const result = createDefaultEffectiveness();
      expect(result.score).toBe(0.5);
      expect(result.usageCount).toBe(0);
      expect(result.lastUsedAt).toBeUndefined();
      expect(result.feedback).toBeUndefined();
    });

    it("应通过 isValidEffectivenessScore 校验", () => {
      const result = createDefaultEffectiveness();
      expect(isValidEffectivenessScore(result)).toBe(true);
    });
  });

  // ========================================================================
  // 类型结构验证 (编译时类型检查 + 运行时结构)
  // ========================================================================

  describe("Type Structure", () => {
    it("KnowledgeEntry 应包含所有必要字段", () => {
      const entry: KnowledgeEntry = {
        id: 1,
        content: "测试知识",
        source: "manual",
        category: "pattern",
        tags: ["test"],
        effectiveness: { score: 0.5, usageCount: 0 },
        syncStatus: "synced",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archived: false,
      };

      expect(entry.id).toBe(1);
      expect(entry.content).toBe("测试知识");
      expect(entry.source).toBe("manual");
      expect(entry.category).toBe("pattern");
      expect(entry.tags).toEqual(["test"]);
      expect(entry.archived).toBe(false);
    });

    it("KnowledgeEntry 支持可选的 skillId", () => {
      const entry: KnowledgeEntry = {
        id: 2,
        content: "Skill 相关知识",
        source: "manage-skill",
        category: "skill-extension",
        skillId: "coding-assistant",
        tags: ["coding"],
        effectiveness: { score: 0.7, usageCount: 3 },
        syncStatus: "pending-both",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archived: false,
      };

      expect(entry.skillId).toBe("coding-assistant");
    });

    it("KnowledgeSearchOptions 应支持所有过滤维度", () => {
      const options: KnowledgeSearchOptions = {
        query: "如何使用 git",
        category: "pattern",
        skillId: "git-tools",
        minScore: 0.5,
        limit: 10,
        includeArchived: false,
      };

      expect(options.query).toBe("如何使用 git");
      expect(options.category).toBe("pattern");
      expect(options.limit).toBe(10);
    });

    it("KnowledgeStats 应包含完整统计", () => {
      const stats: KnowledgeStats = {
        totalEntries: 100,
        archivedEntries: 10,
        byCategory: {
          pattern: 40,
          domain: 30,
          "skill-extension": 20,
          "anti-pattern": 10,
        },
        bySyncStatus: {
          synced: 85,
          "pending-vector": 5,
          "pending-file": 5,
          "pending-both": 5,
        },
        capacity: 500,
        utilizationRate: 0.2,
      };

      expect(stats.totalEntries).toBe(100);
      expect(stats.byCategory["pattern"]).toBe(40);
      expect(stats.bySyncStatus["synced"]).toBe(85);
      expect(stats.utilizationRate).toBe(0.2);
    });
  });
});
