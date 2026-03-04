/**
 * ValidationService 测试
 * 位置: tests/evolution/validation/validation-service.test.ts
 *
 * TDD: RED → GREEN
 */

import { describe, expect, it, vi } from "vitest";
import { createValidationService } from "../../../src/evolution/validation/validation-service.js";
import type { Mutation, MutationContent, MutationTarget } from "../../../src/evolution/types.js";
import type { TestRunner } from "../../../src/evolution/validation/test-runner.js";

// ============ Helpers ============

function makeMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    id: "test-id-abc",
    type: "knowledge",
    target: { system: "knowledge-store" },
    content: {
      action: "create",
      payload: { text: "Docker 调试技巧" },
      reason: "用户频繁问 Docker 问题",
    },
    source: { type: "reflection", sessionId: "s1" },
    createdAt: new Date(),
    ...overrides,
  };
}

function makePermissionService(decision: "allow" | "confirm" | "deny" = "allow") {
  return {
    check: vi.fn().mockReturnValue(decision),
  };
}

function makeTestRunner(): TestRunner {
  return {
    testCode: vi.fn().mockResolvedValue({ passed: true, summary: "OK" }),
    testSkill: vi.fn().mockResolvedValue({ passed: true, summary: "OK" }),
    testConfig: vi.fn().mockResolvedValue({ passed: true, summary: "OK" }),
  };
}

function makeTracing() {
  return { log: vi.fn() };
}

function makeConfig(overrides = {}) {
  return {
    permissionService: makePermissionService(),
    vectorStore: null,
    embeddingProvider: null,
    testRunner: makeTestRunner(),
    mutationConfig: {
      maxPerSubmit: 10,
      validationTimeoutMs: 30000,
      codeValidationTimeoutMs: 60000,
      logRetentionDays: 90,
      dailyLimit: 100,
      dedupThreshold: 0.85,
      dedupSkipThreshold: 0.95,
    },
    tracing: makeTracing(),
    ...overrides,
  };
}

// ============ Tests ============

describe("ValidationService", () => {
  // --- Permission checks ---

  describe("permission check", () => {
    it("should reject when permission is deny", async () => {
      const config = makeConfig({
        permissionService: makePermissionService("deny"),
      });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(false);
      expect(result.checks.some((c) => c.name === "permission" && !c.passed)).toBe(true);
    });

    it("should pass when permission is allow", async () => {
      const config = makeConfig();
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
      expect(result.checks.some((c) => c.name === "permission" && c.passed)).toBe(true);
    });

    it("should pass when permission is confirm", async () => {
      const config = makeConfig({
        permissionService: makePermissionService("confirm"),
      });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
    });
  });

  // --- Safety zone ---

  describe("safety zone", () => {
    it("should reject mutations targeting identity/ path", async () => {
      const config = makeConfig();
      const service = createValidationService(config);

      const mutation = makeMutation({
        target: { system: "knowledge-store", path: "identity/soul.md" },
      });

      const result = await service.validate(mutation);
      expect(result.passed).toBe(false);
      expect(result.checks.some((c) => c.name === "safety-zone" && !c.passed)).toBe(true);
    });

    it("should allow mutations NOT targeting identity/", async () => {
      const config = makeConfig();
      const service = createValidationService(config);

      const mutation = makeMutation({
        target: { system: "knowledge-store", path: "knowledge/docker.md" },
      });

      const result = await service.validate(mutation);
      expect(result.passed).toBe(true);
    });
  });

  // --- Dedup (with VectorStore) ---

  describe("semantic dedup", () => {
    it("should skip dedup when vectorStore is null", async () => {
      const config = makeConfig({ vectorStore: null, embeddingProvider: null });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
      expect(result.dedup).toBeUndefined();
    });

    it("should skip mutation when similarity > dedupSkipThreshold", async () => {
      const embeddingProvider = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        dimensions: 3,
        modelId: "test",
      };
      const vectorStore = {
        search: vi.fn().mockResolvedValue([
          { id: "existing-1", score: 0.97, payload: {} },
        ]),
      };
      const config = makeConfig({ vectorStore, embeddingProvider });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
      expect(result.dedup?.action).toBe("skip");
      expect(result.dedup?.similarity).toBe(0.97);
    });

    it("should merge when similarity between thresholds", async () => {
      const embeddingProvider = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        dimensions: 3,
        modelId: "test",
      };
      const vectorStore = {
        search: vi.fn().mockResolvedValue([
          { id: "existing-1", score: 0.90, payload: {} },
        ]),
      };
      const config = makeConfig({ vectorStore, embeddingProvider });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
      expect(result.dedup?.action).toBe("merge");
    });

    it("should proceed when similarity < dedupThreshold", async () => {
      const embeddingProvider = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        dimensions: 3,
        modelId: "test",
      };
      const vectorStore = {
        search: vi.fn().mockResolvedValue([
          { id: "existing-1", score: 0.50, payload: {} },
        ]),
      };
      const config = makeConfig({ vectorStore, embeddingProvider });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
      expect(result.dedup?.action).toBe("proceed");
    });

    it("should proceed when no similar items found", async () => {
      const embeddingProvider = {
        embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
        dimensions: 3,
        modelId: "test",
      };
      const vectorStore = {
        search: vi.fn().mockResolvedValue([]),
      };
      const config = makeConfig({ vectorStore, embeddingProvider });
      const service = createValidationService(config);

      const result = await service.validate(makeMutation());
      expect(result.passed).toBe(true);
      expect(result.dedup?.action).toBe("proceed");
    });
  });

  // --- Type-specific validation ---

  describe("type-specific validation", () => {
    it("should call testCode for code mutations", async () => {
      const testRunner = makeTestRunner();
      const config = makeConfig({ testRunner });
      const service = createValidationService(config);

      const mutation = makeMutation({ type: "code", target: { system: "sandbox" } });
      await service.validate(mutation);

      expect(testRunner.testCode).toHaveBeenCalledWith(mutation);
    });

    it("should call testSkill for skill mutations", async () => {
      const testRunner = makeTestRunner();
      const config = makeConfig({ testRunner });
      const service = createValidationService(config);

      const mutation = makeMutation({ type: "skill", target: { system: "skill-manager" } });
      await service.validate(mutation);

      expect(testRunner.testSkill).toHaveBeenCalledWith(mutation);
    });

    it("should call testConfig for config mutations", async () => {
      const testRunner = makeTestRunner();
      const config = makeConfig({ testRunner });
      const service = createValidationService(config);

      const mutation = makeMutation({
        type: "config",
        target: { system: "config-manager" },
      });
      await service.validate(mutation);

      expect(testRunner.testConfig).toHaveBeenCalledWith(mutation);
    });

    it("should fail when testCode fails", async () => {
      const testRunner = makeTestRunner();
      (testRunner.testCode as ReturnType<typeof vi.fn>).mockResolvedValue({
        passed: false,
        summary: "Syntax error",
      });
      const config = makeConfig({ testRunner });
      const service = createValidationService(config);

      const mutation = makeMutation({ type: "code", target: { system: "sandbox" } });
      const result = await service.validate(mutation);

      expect(result.passed).toBe(false);
      expect(result.testResult?.passed).toBe(false);
    });

    it("should skip type test for knowledge (no specific test)", async () => {
      const testRunner = makeTestRunner();
      const config = makeConfig({ testRunner });
      const service = createValidationService(config);

      const mutation = makeMutation({ type: "knowledge" });
      const result = await service.validate(mutation);

      expect(result.passed).toBe(true);
      expect(testRunner.testCode).not.toHaveBeenCalled();
      expect(testRunner.testSkill).not.toHaveBeenCalled();
      expect(testRunner.testConfig).not.toHaveBeenCalled();
    });
  });

  // --- Risk assignment ---

  describe("risk assignment", () => {
    it("should assign risk from DEFAULT_RISK_MATRIX", async () => {
      const config = makeConfig();
      const service = createValidationService(config);

      const result = await service.validate(makeMutation({ type: "knowledge" }));
      expect(result.risk).toBe("low");
    });

    it("should assign forbidden for identity/ path", async () => {
      const config = makeConfig();
      const service = createValidationService(config);

      const mutation = makeMutation({
        target: { system: "knowledge-store", path: "identity/soul.md" },
      });
      const result = await service.validate(mutation);
      expect(result.risk).toBe("forbidden");
    });

    it("should assign correct risk for each type", async () => {
      const config = makeConfig();
      const service = createValidationService(config);

      const types = [
        { type: "knowledge" as const, expected: "low" },
        { type: "anti-pattern" as const, expected: "low" },
        { type: "skill-extension" as const, expected: "medium" },
        { type: "routine" as const, expected: "medium" },
        { type: "skill" as const, expected: "high" },
        { type: "code" as const, expected: "high" },
        { type: "config" as const, expected: "high" },
      ];

      for (const { type, expected } of types) {
        const result = await service.validate(makeMutation({ type }));
        expect(result.risk).toBe(expected);
      }
    });
  });
});
