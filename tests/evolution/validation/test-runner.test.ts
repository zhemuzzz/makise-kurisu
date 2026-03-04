/**
 * TestRunner 测试
 * 位置: tests/evolution/validation/test-runner.test.ts
 *
 * TDD: RED → GREEN
 */

import { describe, expect, it, vi } from "vitest";
import { createTestRunner } from "../../../src/evolution/validation/test-runner.js";
import type { Mutation } from "../../../src/evolution/types.js";

// ============ Helpers ============

function makeMutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    id: "test-id",
    type: "code",
    target: { system: "sandbox" },
    content: {
      action: "create",
      payload: { code: "console.log('hello')" },
      reason: "test",
    },
    source: { type: "reflection", sessionId: "s1" },
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTracing() {
  return { log: vi.fn() };
}

// ============ Tests ============

describe("TestRunner", () => {
  describe("testCode", () => {
    it("should skip when toolExecutor is null", async () => {
      const runner = createTestRunner({
        toolExecutor: null,
        configManager: null,
        tracing: makeTracing(),
      });

      const result = await runner.testCode(makeMutation({ type: "code" }));
      expect(result.passed).toBe(true);
      expect(result.summary).toContain("Skipped");
    });

    it("should pass when toolExecutor succeeds", async () => {
      const toolExecutor = {
        execute: vi.fn().mockResolvedValue({
          success: true,
          output: "All tests passed",
          exitCode: 0,
        }),
      };
      const runner = createTestRunner({
        toolExecutor,
        configManager: null,
        tracing: makeTracing(),
      });

      const result = await runner.testCode(makeMutation({ type: "code" }));
      expect(result.passed).toBe(true);
      expect(toolExecutor.execute).toHaveBeenCalled();
    });

    it("should fail when toolExecutor returns failure", async () => {
      const toolExecutor = {
        execute: vi.fn().mockResolvedValue({
          success: false,
          output: "Syntax error at line 3",
          exitCode: 1,
        }),
      };
      const runner = createTestRunner({
        toolExecutor,
        configManager: null,
        tracing: makeTracing(),
      });

      const result = await runner.testCode(makeMutation({ type: "code" }));
      expect(result.passed).toBe(false);
      expect(result.summary).toContain("failed");
    });
  });

  describe("testSkill", () => {
    it("should skip when toolExecutor is null", async () => {
      const runner = createTestRunner({
        toolExecutor: null,
        configManager: null,
        tracing: makeTracing(),
      });

      const result = await runner.testSkill(
        makeMutation({ type: "skill", target: { system: "skill-manager" } }),
      );
      expect(result.passed).toBe(true);
      expect(result.summary).toContain("Skipped");
    });

    it("should pass when health check succeeds", async () => {
      const toolExecutor = {
        healthCheck: vi.fn().mockResolvedValue(true),
      };
      const runner = createTestRunner({
        toolExecutor,
        configManager: null,
        tracing: makeTracing(),
      });

      const result = await runner.testSkill(
        makeMutation({ type: "skill", target: { system: "skill-manager" } }),
      );
      expect(result.passed).toBe(true);
    });
  });

  describe("testConfig", () => {
    it("should skip when configManager is null", async () => {
      const runner = createTestRunner({
        toolExecutor: null,
        configManager: null,
        tracing: makeTracing(),
      });

      const result = await runner.testConfig(
        makeMutation({ type: "config", target: { system: "config-manager" } }),
      );
      expect(result.passed).toBe(true);
      expect(result.summary).toContain("Skipped");
    });

    it("should pass when schema validates", async () => {
      const configManager = {
        validatePartial: vi.fn().mockReturnValue({ success: true }),
      };
      const runner = createTestRunner({
        toolExecutor: null,
        configManager,
        tracing: makeTracing(),
      });

      const result = await runner.testConfig(
        makeMutation({
          type: "config",
          target: { system: "config-manager" },
          content: {
            action: "update",
            payload: { context: { safetyMargin: 0.3 } },
            reason: "test",
          },
        }),
      );
      expect(result.passed).toBe(true);
    });

    it("should fail when schema rejects", async () => {
      const configManager = {
        validatePartial: vi.fn().mockReturnValue({
          success: false,
          error: { issues: [{ message: "Invalid value" }] },
        }),
      };
      const runner = createTestRunner({
        toolExecutor: null,
        configManager,
        tracing: makeTracing(),
      });

      const result = await runner.testConfig(
        makeMutation({
          type: "config",
          target: { system: "config-manager" },
          content: {
            action: "update",
            payload: { context: { safetyMargin: -1 } },
            reason: "test",
          },
        }),
      );
      expect(result.passed).toBe(false);
    });
  });
});
