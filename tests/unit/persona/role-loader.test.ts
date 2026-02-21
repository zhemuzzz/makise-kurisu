/**
 * RoleLoader 单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  RoleLoader,
  RoleLoadError,
  loadRole,
  tryLoadRole,
} from "../../../src/core/persona/role-loader";
import {
  KURISU_ROLE_ID,
  KURISU_EXPECTED_CATCHPHRASES,
  KURISU_EXPECTED_TENDENCIES,
} from "../../fixtures/soul-fixtures";

describe("RoleLoader", () => {
  let loader: RoleLoader;

  beforeEach(() => {
    loader = new RoleLoader("config/personas");
  });

  describe("load new structure (2.0)", () => {
    it("should load kurisu role successfully", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      expect(config.id).toBe(KURISU_ROLE_ID);
      expect(config.meta.version).toBe("2.0");
    });

    it("should load soul.md content", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      expect(config.soul.rawContent).toContain("我是牧濑红莉栖");
      expect(config.soul.rawContent).toContain("# 存在");
    });

    it("should load persona.yaml with speech patterns", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      expect(config.persona.speech.catchphrases).toContain("哼");
      expect(config.persona.speech.catchphrases).toContain("真是的");
      expect(config.persona.speech.patterns.when_complimented).toBeDefined();
    });

    it("should load lore.md content", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      expect(config.lore.rawContent).toContain("# 世界");
      expect(config.lore.rawContent).toContain("世界线");
    });

    it("should load memories from YAML files", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      expect(config.memories.episodes).toBeInstanceOf(Array);
      expect(config.memories.episodes.length).toBeGreaterThan(0);
      expect(config.memories.relationships).toBeInstanceOf(Array);
      expect(config.memories.relationships.length).toBeGreaterThan(0);
    });

    it("should extract name from soul.md", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      expect(config.meta.name).toBe("牧濑红莉栖");
    });

    it("should load all expected catchphrases", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      for (const phrase of KURISU_EXPECTED_CATCHPHRASES) {
        expect(config.persona.speech.catchphrases).toContain(phrase);
      }
    });

    it("should load all expected behavior tendencies", async () => {
      const config = await loader.load(KURISU_ROLE_ID);

      for (const tendency of KURISU_EXPECTED_TENDENCIES) {
        expect(config.persona.behavior.tendencies).toContain(tendency);
      }
    });
  });

  describe("error handling", () => {
    it("should throw RoleLoadError for non-existent role", async () => {
      await expect(loader.load("non-existent-role")).rejects.toThrow(
        RoleLoadError,
      );
    });

    it("should throw NOT_FOUND error code for non-existent role", async () => {
      try {
        await loader.load("non-existent-role");
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(RoleLoadError);
        expect((error as RoleLoadError).code).toBe("NOT_FOUND");
      }
    });
  });

  describe("tryLoad", () => {
    it("should return success result for existing role", async () => {
      const result = await loader.tryLoad(KURISU_ROLE_ID);

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.config?.id).toBe(KURISU_ROLE_ID);
    });

    it("should return error result for non-existent role", async () => {
      const result = await loader.tryLoad("non-existent-role");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("NOT_FOUND");
    });
  });

  describe("exists", () => {
    it("should return true for existing role", async () => {
      const exists = await loader.exists(KURISU_ROLE_ID);
      expect(exists).toBe(true);
    });

    it("should return false for non-existent role", async () => {
      const exists = await loader.exists("non-existent-role");
      expect(exists).toBe(false);
    });
  });
});

describe("convenience functions", () => {
  describe("loadRole", () => {
    it("should load role using default path", async () => {
      const config = await loadRole(KURISU_ROLE_ID);
      expect(config.id).toBe(KURISU_ROLE_ID);
    });
  });

  describe("tryLoadRole", () => {
    it("should return result object", async () => {
      const result = await tryLoadRole(KURISU_ROLE_ID);
      expect(result.success).toBe(true);
    });
  });
});

describe("RoleLoadError", () => {
  it("should have correct properties", () => {
    const error = new RoleLoadError("Test error", "NOT_FOUND", "/test/path");

    expect(error.message).toBe("Test error");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.path).toBe("/test/path");
    expect(error.name).toBe("RoleLoadError");
  });
});
