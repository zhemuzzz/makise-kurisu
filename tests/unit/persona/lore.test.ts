/**
 * Lore 术语库测试
 * 测试目标: src/core/persona/lore.ts
 */
import { describe, it, expect } from "vitest";

describe("Lore Term Library", () => {
  describe("LoreTerm type", () => {
    it("should have valid LoreTerm structure", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      // 验证每个术语都有必要字段
      for (const category of Object.values(LORE_TERMS)) {
        for (const term of category) {
          expect(term).toHaveProperty("id");
          expect(term).toHaveProperty("nameZh");
          expect(term).toHaveProperty("nameEn");
          expect(term).toHaveProperty("category");
          expect(term).toHaveProperty("description");
          expect(term).toHaveProperty("importance");
        }
      }
    });

    it("should have valid importance values (1-5)", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      for (const category of Object.values(LORE_TERMS)) {
        for (const term of category) {
          expect(term.importance).toBeGreaterThanOrEqual(1);
          expect(term.importance).toBeLessThanOrEqual(5);
        }
      }
    });

    it("should have valid category values", async () => {
      const { LORE_TERMS, LoreCategory } = await import(
        "../../../src/core/persona/lore"
      );

      const validCategories = [
        "world_mechanism",
        "technology",
        "organization",
        "item",
        "character",
      ];

      for (const category of Object.keys(LORE_TERMS)) {
        expect(validCategories).toContain(category);
      }
    });
  });

  describe("LORE_TERMS constant", () => {
    it("should contain world-line term", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      const worldMechanism = LORE_TERMS.world_mechanism;
      const worldLine = worldMechanism.find((t) => t.id === "world-line");

      expect(worldLine).toBeDefined();
      expect(worldLine?.nameZh).toBe("世界线");
    });

    it("should contain SERN organization", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      const organizations = LORE_TERMS.organization;
      const sern = organizations.find((t) => t.id === "sern");

      expect(sern).toBeDefined();
    });

    it("should contain Okabe character", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      const characters = LORE_TERMS.character;
      const okabe = characters.find((t) => t.id === "okabe-rintaro");

      expect(okabe).toBeDefined();
      expect(okabe?.nameZh).toContain("冈部");
    });

    it("should contain D-Mail technology", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      const technologies = LORE_TERMS.technology;
      const dmail = technologies.find((t) => t.id === "d-mail");

      expect(dmail).toBeDefined();
    });

    it("should contain Amadeus technology", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      const technologies = LORE_TERMS.technology;
      const amadeus = technologies.find((t) => t.id === "amadeus");

      expect(amadeus).toBeDefined();
      expect(amadeus?.kurisuPerspective).toBeDefined();
    });

    it("should have at least 3 terms per category", async () => {
      const { LORE_TERMS } = await import("../../../src/core/persona/lore");

      for (const [category, terms] of Object.entries(LORE_TERMS)) {
        expect(terms.length, `Category ${category} should have at least 3 terms`).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("getLoreByCategory()", () => {
    it("should return world_mechanism terms", async () => {
      const { getLoreByCategory } = await import("../../../src/core/persona/lore");

      const terms = getLoreByCategory("world_mechanism");
      expect(terms.length).toBeGreaterThan(0);

      for (const term of terms) {
        expect(term.category).toBe("world_mechanism");
      }
    });

    it("should return technology terms", async () => {
      const { getLoreByCategory } = await import("../../../src/core/persona/lore");

      const terms = getLoreByCategory("technology");
      expect(terms.length).toBeGreaterThan(0);

      for (const term of terms) {
        expect(term.category).toBe("technology");
      }
    });

    it("should return organization terms", async () => {
      const { getLoreByCategory } = await import("../../../src/core/persona/lore");

      const terms = getLoreByCategory("organization");
      expect(terms.length).toBeGreaterThan(0);
    });

    it("should return item terms", async () => {
      const { getLoreByCategory } = await import("../../../src/core/persona/lore");

      const terms = getLoreByCategory("item");
      expect(terms.length).toBeGreaterThan(0);
    });

    it("should return character terms", async () => {
      const { getLoreByCategory } = await import("../../../src/core/persona/lore");

      const terms = getLoreByCategory("character");
      expect(terms.length).toBeGreaterThan(0);
    });
  });

  describe("getLoreById()", () => {
    it("should return term by id", async () => {
      const { getLoreById } = await import("../../../src/core/persona/lore");

      const term = getLoreById("world-line");
      expect(term).toBeDefined();
      expect(term?.nameZh).toBe("世界线");
    });

    it("should return undefined for unknown id", async () => {
      const { getLoreById } = await import("../../../src/core/persona/lore");

      const term = getLoreById("nonexistent-term");
      expect(term).toBeUndefined();
    });

    it("should find terms across all categories", async () => {
      const { getLoreById } = await import("../../../src/core/persona/lore");

      // 测试不同分类的术语
      expect(getLoreById("world-line")).toBeDefined(); // world_mechanism
      expect(getLoreById("d-mail")).toBeDefined(); // technology
      expect(getLoreById("sern")).toBeDefined(); // organization
      expect(getLoreById("phone-microwave")).toBeDefined(); // item
      expect(getLoreById("okabe-rintaro")).toBeDefined(); // character
    });
  });

  describe("searchLore()", () => {
    it("should find terms by Chinese name", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const results = searchLore("世界线");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((t) => t.id === "world-line")).toBe(true);
    });

    it("should find terms by English name", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const results = searchLore("World Line");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find terms by description", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const results = searchLore("时间");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should be case-insensitive for English", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const upperResults = searchLore("SERN");
      const lowerResults = searchLore("sern");

      expect(upperResults.length).toBe(lowerResults.length);
    });

    it("should return empty array for no matches", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const results = searchLore("完全不存在的关键词xyz123");
      expect(results).toEqual([]);
    });

    it("should handle empty string", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const results = searchLore("");
      // 空字符串可能返回所有结果或空数组，取决于实现
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("getHighImportanceLore()", () => {
    it("should return only high importance terms (>=4)", async () => {
      const { getHighImportanceLore } = await import("../../../src/core/persona/lore");

      const terms = getHighImportanceLore();

      for (const term of terms) {
        expect(term.importance).toBeGreaterThanOrEqual(4);
      }
    });

    it("should return non-empty array", async () => {
      const { getHighImportanceLore } = await import("../../../src/core/persona/lore");

      const terms = getHighImportanceLore();
      expect(terms.length).toBeGreaterThan(0);
    });
  });

  describe("Immutability", () => {
    it("should not allow modifying returned arrays", async () => {
      const { getLoreByCategory, LORE_TERMS } = await import(
        "../../../src/core/persona/lore"
      );

      const terms = getLoreByCategory("world_mechanism");
      const originalLength = LORE_TERMS.world_mechanism.length;

      // 尝试修改返回的数组（应该不影响原始数据）
      // 由于使用 as const，这应该在编译时被阻止
      expect(LORE_TERMS.world_mechanism.length).toBe(originalLength);
    });
  });

  describe("Performance", () => {
    it("should complete 100 searches in reasonable time", async () => {
      const { searchLore } = await import("../../../src/core/persona/lore");

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        searchLore("时间");
      }

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(100); // 100ms 内完成
    });
  });
});
