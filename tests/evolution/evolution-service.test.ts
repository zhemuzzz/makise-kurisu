/**
 * EvolutionService 测试
 * 位置: tests/evolution/evolution-service.test.ts
 *
 * Phase 5e: 编排器 — 路由 routine 到 Agent 后台模式
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createEvolutionService,
  type EvolutionServiceConfig,
} from "../../src/evolution/evolution-service.js";
import type { MutationPipeline } from "../../src/evolution/mutation-pipeline.js";
import type { EvolutionConfig } from "../../src/platform/types/config.js";

// ============ Mocks ============

function makeConfig(overrides: Partial<EvolutionConfig> = {}): EvolutionConfig {
  return {
    enabled: true,
    reflectionDelayMs: 5000,
    reflectionMaxTokens: 4000,
    ...overrides,
  };
}

function makePipeline(): MutationPipeline {
  return {
    submit: vi.fn().mockResolvedValue([]),
    submitCorrection: vi.fn().mockResolvedValue({ status: "applied" }),
    reportUsage: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([]),
    getHealthReport: vi.fn().mockResolvedValue({
      totalMutations: 0,
      todayCount: 0,
      byStatus: { applied: 0, merged: 0, skipped: 0, rejected: 0, pending: 0 },
      byType: {},
    }),
    dispose: vi.fn(),
  };
}

function makeTracing() {
  return { log: vi.fn() };
}

function makeExecuteBackgroundTask() {
  return vi.fn().mockResolvedValue(undefined);
}

function makeServiceConfig(
  overrides: Partial<EvolutionServiceConfig> = {},
): EvolutionServiceConfig {
  return {
    evolutionConfig: makeConfig(),
    pipeline: makePipeline(),
    tracing: makeTracing(),
    executeBackgroundTask: makeExecuteBackgroundTask(),
    ...overrides,
  };
}

// ============ Tests ============

describe("EvolutionService", () => {
  describe("executeRoutine", () => {
    it("should dispatch session-reflect to executeBackgroundTask", async () => {
      const executeBackgroundTask = makeExecuteBackgroundTask();
      const service = createEvolutionService(
        makeServiceConfig({ executeBackgroundTask }),
      );

      await service.executeRoutine("session-reflect", "对话反思");

      expect(executeBackgroundTask).toHaveBeenCalledTimes(1);
      expect(executeBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          routineId: "session-reflect",
          routineName: "对话反思",
        }),
      );
    });

    it("should dispatch daily-learning to executeBackgroundTask", async () => {
      const executeBackgroundTask = makeExecuteBackgroundTask();
      const service = createEvolutionService(
        makeServiceConfig({ executeBackgroundTask }),
      );

      await service.executeRoutine("daily-learning", "每日学习");

      expect(executeBackgroundTask).toHaveBeenCalledTimes(1);
      expect(executeBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          routineId: "daily-learning",
          routineName: "每日学习",
        }),
      );
    });

    it("should dispatch knowledge-consolidation to executeBackgroundTask", async () => {
      const executeBackgroundTask = makeExecuteBackgroundTask();
      const service = createEvolutionService(
        makeServiceConfig({ executeBackgroundTask }),
      );

      await service.executeRoutine("knowledge-consolidation", "知识整理");

      expect(executeBackgroundTask).toHaveBeenCalledTimes(1);
      expect(executeBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          routineId: "knowledge-consolidation",
          routineName: "知识整理",
        }),
      );
    });

    it("should handle unknown routine gracefully", async () => {
      const tracing = makeTracing();
      const service = createEvolutionService(makeServiceConfig({ tracing }));

      await service.executeRoutine("unknown-routine", "未知");

      expect(tracing.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "warn",
          event: "evolution:unknown-routine",
        }),
      );
    });

    it("should not execute when evolution is disabled", async () => {
      const executeBackgroundTask = makeExecuteBackgroundTask();
      const service = createEvolutionService(
        makeServiceConfig({
          evolutionConfig: makeConfig({ enabled: false }),
          executeBackgroundTask,
        }),
      );

      await service.executeRoutine("session-reflect", "对话反思");

      expect(executeBackgroundTask).not.toHaveBeenCalled();
    });

    it("should log error when executeBackgroundTask fails", async () => {
      const executeBackgroundTask = vi.fn().mockRejectedValue(new Error("bg-fail"));
      const tracing = makeTracing();
      const service = createEvolutionService(
        makeServiceConfig({ executeBackgroundTask, tracing }),
      );

      // Should not throw
      await service.executeRoutine("session-reflect", "对话反思");

      expect(tracing.log).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          event: "evolution:routine:error",
        }),
      );
    });

    it("should pass maxTokens from config in task context", async () => {
      const executeBackgroundTask = makeExecuteBackgroundTask();
      const service = createEvolutionService(
        makeServiceConfig({
          evolutionConfig: makeConfig({ reflectionMaxTokens: 8000 }),
          executeBackgroundTask,
        }),
      );

      await service.executeRoutine("session-reflect", "对话反思");

      expect(executeBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 8000 }),
      );
    });
  });

  describe("getStatus", () => {
    it("should return enabled status and pipeline health", async () => {
      const pipeline = makePipeline();
      const service = createEvolutionService(makeServiceConfig({ pipeline }));

      const status = await service.getStatus();

      expect(status.enabled).toBe(true);
      expect(status.health).toBeDefined();
      expect(pipeline.getHealthReport).toHaveBeenCalled();
    });

    it("should return disabled when config says so", async () => {
      const service = createEvolutionService(
        makeServiceConfig({
          evolutionConfig: makeConfig({ enabled: false }),
        }),
      );

      const status = await service.getStatus();
      expect(status.enabled).toBe(false);
    });
  });

  describe("dispose", () => {
    it("should dispose pipeline", () => {
      const pipeline = makePipeline();
      const service = createEvolutionService(makeServiceConfig({ pipeline }));

      service.dispose();

      expect(pipeline.dispose).toHaveBeenCalled();
    });
  });
});
