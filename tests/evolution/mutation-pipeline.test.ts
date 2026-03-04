/**
 * MutationPipeline 测试
 * 位置: tests/evolution/mutation-pipeline.test.ts
 *
 * TDD: RED → GREEN
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createMutationPipeline,
  type MutationPipelineConfig,
} from "../../src/evolution/mutation-pipeline.js";
import type {
  Mutation,
  MutationLogRow,
} from "../../src/evolution/types.js";
import type { ValidatedResult } from "../../src/evolution/validation/validation-service.js";
import type { MutationApplicator } from "../../src/evolution/applicators/types.js";

// ============ Helpers ============

function makeMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    id: "test-id",
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

function makeValidatedResult(overrides: Partial<ValidatedResult> = {}): ValidatedResult {
  return {
    passed: true,
    checks: [{ name: "permission", passed: true }],
    risk: "low",
    ...overrides,
  };
}

// In-memory SQLite mock
function makeSqlite() {
  const rows: MutationLogRow[] = [];
  return {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue({
      run: vi.fn((...args: unknown[]) => {
        // Simplified: just track that run was called
      }),
      get: vi.fn((id: string) => rows.find((r) => r.id === id)),
      all: vi.fn((..._args: unknown[]) => [...rows]),
    }),
    _rows: rows,
    _addRow(row: MutationLogRow) {
      rows.push(row);
    },
  };
}

function makeValidationService(result?: ValidatedResult) {
  return {
    validate: vi.fn().mockResolvedValue(result ?? makeValidatedResult()),
  };
}

function makeApplicator(
  targetSystem: string,
  result = { status: "applied" as const, id: "app-1", action: "create" },
): MutationApplicator {
  return {
    targetSystem,
    apply: vi.fn().mockResolvedValue(result),
  };
}

function makeTracing() {
  return { log: vi.fn() };
}

function makeConfig(overrides: Partial<MutationPipelineConfig> = {}): MutationPipelineConfig {
  const knowledgeApplicator = makeApplicator("knowledge-store");
  return {
    sqlite: makeSqlite(),
    validationService: makeValidationService(),
    applicators: new Map([["knowledge-store", knowledgeApplicator]]),
    tracing: makeTracing(),
    mutationConfig: {
      maxPerSubmit: 10,
      validationTimeoutMs: 30000,
      codeValidationTimeoutMs: 60000,
      logRetentionDays: 90,
      dailyLimit: 100,
      dedupThreshold: 0.85,
      dedupSkipThreshold: 0.95,
    },
    ...overrides,
  };
}

// ============ Tests ============

describe("MutationPipeline", () => {
  describe("submit", () => {
    it("should call migrateMutationLogSchema on creation", () => {
      const config = makeConfig();
      createMutationPipeline(config);
      expect(config.sqlite.exec).toHaveBeenCalled();
    });

    it("should validate and apply a single mutation", async () => {
      const config = makeConfig();
      const pipeline = createMutationPipeline(config);

      const results = await pipeline.submit([makeMutation()]);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("applied");
      expect(config.validationService.validate).toHaveBeenCalledTimes(1);
    });

    it("should reject when validation fails", async () => {
      const config = makeConfig({
        validationService: makeValidationService(
          makeValidatedResult({ passed: false, risk: "forbidden" }),
        ),
      });
      const pipeline = createMutationPipeline(config);

      const results = await pipeline.submit([makeMutation()]);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("rejected");
    });

    it("should skip when dedup action is skip", async () => {
      const config = makeConfig({
        validationService: makeValidationService(
          makeValidatedResult({
            dedup: { similarIds: ["existing"], action: "skip", similarity: 0.97 },
          }),
        ),
      });
      const pipeline = createMutationPipeline(config);

      const results = await pipeline.submit([makeMutation()]);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("skipped");
    });

    it("should reject batch exceeding maxPerSubmit", async () => {
      const config = makeConfig({
        mutationConfig: {
          maxPerSubmit: 2,
          validationTimeoutMs: 30000,
          codeValidationTimeoutMs: 60000,
          logRetentionDays: 90,
          dailyLimit: 100,
          dedupThreshold: 0.85,
          dedupSkipThreshold: 0.95,
        },
      });
      const pipeline = createMutationPipeline(config);

      const mutations = [makeMutation(), makeMutation(), makeMutation()];
      await expect(pipeline.submit(mutations)).rejects.toThrow("exceeds maximum");
    });

    it("should handle multiple mutations in batch", async () => {
      const config = makeConfig();
      const pipeline = createMutationPipeline(config);

      const mutations = [
        makeMutation({ id: "m1" }),
        makeMutation({ id: "m2" }),
      ];
      const results = await pipeline.submit(mutations);
      expect(results).toHaveLength(2);
    });

    it("should log mutation to SQLite", async () => {
      const sqlite = makeSqlite();
      const config = makeConfig({ sqlite });
      const pipeline = createMutationPipeline(config);

      await pipeline.submit([makeMutation()]);
      // prepare().run should have been called to insert the row
      expect(sqlite.prepare).toHaveBeenCalled();
    });

    it("should handle missing applicator gracefully", async () => {
      const config = makeConfig({
        applicators: new Map(), // no applicators
      });
      const pipeline = createMutationPipeline(config);

      const results = await pipeline.submit([makeMutation()]);
      expect(results).toHaveLength(1);
      expect(results[0]!.status).toBe("rejected");
    });

    it("should handle forbidden risk as rejection", async () => {
      const config = makeConfig({
        validationService: makeValidationService(
          makeValidatedResult({ passed: false, risk: "forbidden" }),
        ),
      });
      const pipeline = createMutationPipeline(config);

      const results = await pipeline.submit([makeMutation()]);
      expect(results[0]!.status).toBe("rejected");
    });
  });

  describe("submitCorrection", () => {
    it("should convert correction to anti-pattern mutation", async () => {
      const config = makeConfig();
      const pipeline = createMutationPipeline(config);

      const result = await pipeline.submitCorrection({
        sessionId: "s1",
        messageId: "m1",
        originalBehavior: "给了通用建议",
        correction: "应该给具体命令",
      });

      expect(result.status).toBe("applied");
      // validation should have been called with anti-pattern type
      expect(config.validationService.validate).toHaveBeenCalledWith(
        expect.objectContaining({ type: "anti-pattern" }),
      );
    });
  });

  describe("reportUsage", () => {
    it("should update mutation_log counters via SQL", () => {
      const sqlite = makeSqlite();
      const config = makeConfig({ sqlite });
      const pipeline = createMutationPipeline(config);

      pipeline.reportUsage({
        knowledgeId: "k-1",
        sessionId: "s-1",
        retrieved: true,
        usedInResponse: true,
      });

      // Should have called prepare for the UPDATE
      expect(sqlite.prepare).toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("should return mutation history", async () => {
      const sqlite = makeSqlite();
      const config = makeConfig({ sqlite });
      const pipeline = createMutationPipeline(config);

      const history = await pipeline.getHistory();
      expect(Array.isArray(history)).toBe(true);
    });

    it("should filter by type", async () => {
      const sqlite = makeSqlite();
      const config = makeConfig({ sqlite });
      const pipeline = createMutationPipeline(config);

      await pipeline.getHistory({ type: "knowledge" });
      expect(sqlite.prepare).toHaveBeenCalled();
    });
  });

  describe("getHealthReport", () => {
    it("should return health report structure", async () => {
      const sqlite = makeSqlite();
      const config = makeConfig({ sqlite });
      const pipeline = createMutationPipeline(config);

      const report = await pipeline.getHealthReport();
      expect(report).toHaveProperty("totalMutations");
      expect(report).toHaveProperty("todayCount");
      expect(report).toHaveProperty("byStatus");
      expect(report).toHaveProperty("byType");
    });
  });

  describe("dispose", () => {
    it("should be callable without error", () => {
      const config = makeConfig();
      const pipeline = createMutationPipeline(config);
      expect(() => pipeline.dispose()).not.toThrow();
    });
  });
});
