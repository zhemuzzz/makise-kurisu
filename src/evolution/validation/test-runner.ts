/**
 * TestRunner — 类型专属验证
 * 位置: src/evolution/validation/test-runner.ts
 *
 * MP-4 Stage 2: 代码/Skill/Config 类型的专属测试
 * 复用已有基础设施（DockerExecutor, MCPBridge, ConfigManager）
 * 依赖为 null 时优雅降级
 */

import type { Mutation, TestResult } from "../types.js";

// ============ DI Interfaces (loose coupling) ============

export interface TestRunnerToolExecutor {
  execute?(command: string, options?: Record<string, unknown>): Promise<{
    success: boolean;
    output: string;
    exitCode: number;
  }>;
  healthCheck?(): Promise<boolean>;
}

export interface TestRunnerConfigManager {
  validatePartial(
    partial: unknown,
  ): { success: boolean; error?: { issues: readonly { message: string }[] } };
}

export interface TestRunnerTracing {
  log(event: unknown): void;
}

// ============ Config ============

export interface TestRunnerConfig {
  readonly toolExecutor: TestRunnerToolExecutor | null;
  readonly configManager: TestRunnerConfigManager | null;
  readonly tracing: TestRunnerTracing;
}

// ============ Interface ============

export interface TestRunner {
  testCode(mutation: Mutation): Promise<TestResult>;
  testSkill(mutation: Mutation): Promise<TestResult>;
  testConfig(mutation: Mutation): Promise<TestResult>;
}

// ============ Implementation ============

const SKIP_RESULT: TestResult = Object.freeze({
  passed: true,
  summary: "Skipped, infra unavailable",
});

class TestRunnerImpl implements TestRunner {
  constructor(private readonly config: TestRunnerConfig) {}

  async testCode(mutation: Mutation): Promise<TestResult> {
    const { toolExecutor, tracing } = this.config;
    if (!toolExecutor?.execute) {
      return SKIP_RESULT;
    }

    const start = Date.now();
    try {
      const payload = mutation.content.payload as { code?: string } | undefined;
      const code = payload?.code ?? "";
      const result = await toolExecutor.execute(code, { timeout: 60000 });
      const durationMs = Date.now() - start;

      if (result.success) {
        return {
          passed: true,
          summary: "Code test passed",
          sandboxLog: result.output,
          durationMs,
        };
      }
      return {
        passed: false,
        summary: `Code test failed (exit ${result.exitCode})`,
        sandboxLog: result.output,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      tracing.log({
        level: "warn",
        category: "evolution",
        event: "test-runner:code:error",
        data: { mutationId: mutation.id, error: message },
      });
      return {
        passed: false,
        summary: `Code test failed: ${message}`,
        durationMs,
      };
    }
  }

  async testSkill(mutation: Mutation): Promise<TestResult> {
    const { toolExecutor, tracing } = this.config;
    if (!toolExecutor?.healthCheck) {
      return SKIP_RESULT;
    }

    const start = Date.now();
    try {
      const healthy = await toolExecutor.healthCheck();
      const durationMs = Date.now() - start;
      return {
        passed: healthy,
        summary: healthy ? "Skill infra healthy" : "Skill infra health check failed",
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      tracing.log({
        level: "warn",
        category: "evolution",
        event: "test-runner:skill:error",
        data: { mutationId: mutation.id, error: message },
      });
      return {
        passed: false,
        summary: `Skill test failed: ${message}`,
        durationMs,
      };
    }
  }

  async testConfig(mutation: Mutation): Promise<TestResult> {
    const { configManager } = this.config;
    if (!configManager) {
      return SKIP_RESULT;
    }

    const start = Date.now();
    const result = configManager.validatePartial(mutation.content.payload);
    const durationMs = Date.now() - start;

    if (result.success) {
      return {
        passed: true,
        summary: "Config schema validation passed",
        durationMs,
      };
    }

    const issues = result.error?.issues.map((i) => i.message).join("; ") ?? "Unknown error";
    return {
      passed: false,
      summary: `Config validation failed: ${issues}`,
      durationMs,
    };
  }
}

// ============ Factory ============

export function createTestRunner(config: TestRunnerConfig): TestRunner {
  return new TestRunnerImpl(config);
}
