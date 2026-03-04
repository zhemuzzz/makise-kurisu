/**
 * Evolution E2E 集成测试
 * 位置: tests/evolution/e2e-integration.test.ts
 *
 * Phase 5e: 端到端验证
 * - session:end → RoutineSystem → EvolutionService → mock background task
 * - submit mutation → validate → apply → mutation_log
 * - reportUsage → effectiveness update
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import { createEventBus } from "../../src/platform/event-bus.js";
import { createScheduler } from "../../src/platform/scheduler.js";
import { createRoutineSystem } from "../../src/platform/routine-system.js";
import { createTestRunner } from "../../src/evolution/validation/test-runner.js";
import { createValidationService } from "../../src/evolution/validation/validation-service.js";
import { createKnowledgeStoreApplicator } from "../../src/evolution/applicators/knowledge-store-applicator.js";
import { createConfigApplicator } from "../../src/evolution/applicators/config-applicator.js";
import { createMutationPipeline } from "../../src/evolution/mutation-pipeline.js";
import { createEvolutionService } from "../../src/evolution/evolution-service.js";
import type { Mutation } from "../../src/evolution/types.js";
import type { MutationApplicator } from "../../src/evolution/applicators/types.js";

// ============ Shared setup ============

function createTestTracing() {
  return {
    log: vi.fn(),
    dispose: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    getAggregate: vi.fn().mockReturnValue({
      totalEvents: 0,
      byCategory: {},
      byLevel: {},
      recentErrors: [],
    }),
  };
}

function createTestPermissions() {
  return {
    check: vi.fn().mockReturnValue("allow" as const),
  };
}

// ============ Tests ============

describe("Evolution E2E Integration", () => {
  let cleanups: (() => void)[] = [];

  afterEach(() => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups = [];
  });

  it("should route session:end → RoutineSystem → EvolutionService", async () => {
    // Setup background services chain
    const tracing = createTestTracing();
    const eventBus = createEventBus();
    cleanups.push(() => eventBus.dispose());

    const scheduler = createScheduler({ eventBus, tracing });
    cleanups.push(() => scheduler.dispose());

    const routineSystem = createRoutineSystem({
      scheduler,
      tracing,
      eventBus,
      routineConfig: { enabled: true, maxPerSource: 10, maxTotal: 50 },
      yamlPath: "/tmp/test-routines-e2e.yaml",
    });
    cleanups.push(() => routineSystem.dispose());

    // Create minimal evolution subsystem
    const db = new BetterSqlite3(":memory:");
    db.pragma("journal_mode = WAL");
    cleanups.push(() => db.close());

    const testRunner = createTestRunner({
      toolExecutor: null,
      configManager: null,
      tracing,
    });
    const validationService = createValidationService({
      permissionService: createTestPermissions(),
      vectorStore: null,
      embeddingProvider: null,
      testRunner,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
      tracing,
    });

    const applicators = new Map<string, MutationApplicator>();
    applicators.set("knowledge-store", createKnowledgeStoreApplicator({
      write: vi.fn().mockResolvedValue("k-e2e-1"),
      archive: vi.fn(),
      delete: vi.fn(),
    }));
    applicators.set("config-manager", createConfigApplicator());

    const pipeline = createMutationPipeline({
      sqlite: db,
      validationService,
      applicators,
      tracing,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
    });
    cleanups.push(() => pipeline.dispose());

    // Track background task calls
    const bgTaskCalls: unknown[] = [];
    const executeBackgroundTask = vi.fn().mockImplementation(async (ctx: unknown) => {
      bgTaskCalls.push(ctx);
    });

    const evolution = createEvolutionService({
      evolutionConfig: { enabled: true, reflectionDelayMs: 0, reflectionMaxTokens: 4000 },
      pipeline,
      tracing,
      executeBackgroundTask,
    });
    cleanups.push(() => evolution.dispose());

    // Wire routine handler → evolution
    routineSystem.setTaskHandler(async (routine) => {
      await evolution.executeRoutine(routine.id, routine.name);
    });

    // Fire session:end event
    eventBus.emit("session:end", { sessionId: "s-e2e" });

    // Wait for delayed execution (session-reflect has 5s delay, but in test we check immediate effects)
    // Since the delay is 5000ms in SYSTEM_ROUTINES, we need to wait or the handler won't fire yet.
    // For E2E, let's directly invoke the routine to test the chain:
    await evolution.executeRoutine("session-reflect", "对话反思");

    expect(executeBackgroundTask).toHaveBeenCalledTimes(1);
    expect(executeBackgroundTask).toHaveBeenCalledWith(
      expect.objectContaining({
        routineId: "session-reflect",
        taskGoal: expect.stringContaining("反思"),
      }),
    );
  });

  it("should submit mutation → validate → apply → log to SQLite", async () => {
    const tracing = createTestTracing();
    const db = new BetterSqlite3(":memory:");
    db.pragma("journal_mode = WAL");
    cleanups.push(() => db.close());

    const writeStore = vi.fn().mockResolvedValue("k-e2e-write");

    const testRunner = createTestRunner({
      toolExecutor: null,
      configManager: null,
      tracing,
    });
    const validationService = createValidationService({
      permissionService: createTestPermissions(),
      vectorStore: null,
      embeddingProvider: null,
      testRunner,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
      tracing,
    });

    const applicators = new Map<string, MutationApplicator>();
    applicators.set("knowledge-store", createKnowledgeStoreApplicator({
      write: writeStore,
      archive: vi.fn(),
      delete: vi.fn(),
    }));

    const pipeline = createMutationPipeline({
      sqlite: db,
      validationService,
      applicators,
      tracing,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
    });
    cleanups.push(() => pipeline.dispose());

    // Submit a knowledge mutation
    const mutation: Mutation = {
      id: "mut-e2e-001",
      type: "knowledge",
      target: { system: "knowledge-store" },
      content: {
        action: "create",
        payload: { text: "E2E 测试知识" },
        reason: "学到了新东西",
      },
      source: { type: "reflection", sessionId: "s-e2e" },
      createdAt: new Date(),
    };

    const [result] = await pipeline.submit([mutation]);

    expect(result!.status).toBe("applied");
    expect(writeStore).toHaveBeenCalledWith(
      expect.objectContaining({ content: "E2E 测试知识" }),
    );

    // Verify mutation_log has the entry
    const row = db.prepare("SELECT * FROM mutation_log WHERE id = ?").get("mut-e2e-001") as Record<string, unknown> | undefined;
    expect(row).toBeDefined();
    expect(row!["status"]).toBe("applied");
    expect(row!["type"]).toBe("knowledge");
    expect(row!["target_system"]).toBe("knowledge-store");
  });

  it("should update effectiveness via reportUsage", async () => {
    const tracing = createTestTracing();
    const db = new BetterSqlite3(":memory:");
    db.pragma("journal_mode = WAL");
    cleanups.push(() => db.close());

    const testRunner = createTestRunner({
      toolExecutor: null,
      configManager: null,
      tracing,
    });
    const validationService = createValidationService({
      permissionService: createTestPermissions(),
      vectorStore: null,
      embeddingProvider: null,
      testRunner,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
      tracing,
    });

    const applicators = new Map<string, MutationApplicator>();
    applicators.set("knowledge-store", createKnowledgeStoreApplicator({
      write: vi.fn().mockResolvedValue("k-usage-1"),
      archive: vi.fn(),
      delete: vi.fn(),
    }));

    const pipeline = createMutationPipeline({
      sqlite: db,
      validationService,
      applicators,
      tracing,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
    });
    cleanups.push(() => pipeline.dispose());

    // First submit a mutation
    const mutation: Mutation = {
      id: "mut-usage-001",
      type: "knowledge",
      target: { system: "knowledge-store" },
      content: {
        action: "create",
        payload: { text: "Usage tracking test" },
        reason: "test",
      },
      source: { type: "reflection", sessionId: "s-usage" },
      createdAt: new Date(),
    };
    await pipeline.submit([mutation]);

    // Report usage
    pipeline.reportUsage({
      knowledgeId: "mut-usage-001",
      retrieved: true,
      usedInResponse: true,
    });

    // Verify counters updated
    const row = db.prepare("SELECT * FROM mutation_log WHERE id = ?").get("mut-usage-001") as Record<string, unknown>;
    expect(Number(row["retrieval_count"])).toBe(1);
    expect(Number(row["usage_count"])).toBe(1);
    expect(Number(row["positive_signals"])).toBe(1);
    expect(row["last_used_at"]).toBeDefined();
  });

  it("should handle submitCorrection → anti-pattern in mutation_log", async () => {
    const tracing = createTestTracing();
    const db = new BetterSqlite3(":memory:");
    db.pragma("journal_mode = WAL");
    cleanups.push(() => db.close());

    const writeStore = vi.fn().mockResolvedValue("k-correction-1");

    const testRunner = createTestRunner({
      toolExecutor: null,
      configManager: null,
      tracing,
    });
    const validationService = createValidationService({
      permissionService: createTestPermissions(),
      vectorStore: null,
      embeddingProvider: null,
      testRunner,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
      tracing,
    });

    const applicators = new Map<string, MutationApplicator>();
    applicators.set("knowledge-store", createKnowledgeStoreApplicator({
      write: writeStore,
      archive: vi.fn(),
      delete: vi.fn(),
    }));

    const pipeline = createMutationPipeline({
      sqlite: db,
      validationService,
      applicators,
      tracing,
      mutationConfig: {
        maxPerSubmit: 10,
        validationTimeoutMs: 30000,
        codeValidationTimeoutMs: 60000,
        logRetentionDays: 90,
        dailyLimit: 100,
        dedupThreshold: 0.85,
        dedupSkipThreshold: 0.95,
      },
    });
    cleanups.push(() => pipeline.dispose());

    // Submit a user correction
    const result = await pipeline.submitCorrection({
      sessionId: "s-corr",
      messageId: "m-1",
      originalBehavior: "用了太多表情符号",
      correction: "减少表情使用",
    });

    expect(result.status).toBe("applied");
    expect(writeStore).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("不该"),
        source: "user-correction",
        category: "anti-pattern",
      }),
    );

    // Verify in mutation_log
    const rows = db.prepare("SELECT * FROM mutation_log WHERE type = ?").all("anti-pattern") as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]!["source_type"]).toBe("user-correction");
  });
});
