/**
 * ValidationService — 变更提案统一验证入口
 * 位置: src/evolution/validation/validation-service.ts
 *
 * MP-4 Stage 2: 权限 → 安全分区 → 语义去重 → 类型专属测试 → 风险赋值
 */

import type {
  DedupResult,
  Mutation,
  MutationRisk,
  TestResult,
  ValidationCheck,
  ValidationResult,
} from "../types.js";
import { DEFAULT_RISK_MATRIX } from "../types.js";
import type { TestRunner } from "./test-runner.js";
import type { MutationConfig } from "../../platform/types/config.js";

// ============ DI Interfaces ============

export interface ValidationPermissionService {
  check(request: {
    action: string;
    subject: string;
    context?: Record<string, unknown>;
  }): "allow" | "confirm" | "deny";
}

export interface ValidationVectorStore {
  search(
    query: readonly number[],
    filter?: unknown,
    topK?: number,
  ): Promise<readonly { id: string; score: number; payload: Record<string, unknown> }[]>;
}

export interface ValidationEmbeddingProvider {
  embed(text: string): Promise<readonly number[]>;
  readonly dimensions: number;
  readonly modelId: string;
}

export interface ValidationTracing {
  log(event: unknown): void;
}

// ============ Config ============

export interface ValidationServiceConfig {
  readonly permissionService: ValidationPermissionService;
  readonly vectorStore: ValidationVectorStore | null;
  readonly embeddingProvider: ValidationEmbeddingProvider | null;
  readonly testRunner: TestRunner;
  readonly mutationConfig: MutationConfig;
  readonly tracing: ValidationTracing;
  readonly llmMergeFn?: (existing: string, incoming: string) => Promise<string>;
}

// ============ Extended Result (includes risk) ============

export interface ValidatedResult extends ValidationResult {
  readonly risk: MutationRisk;
}

// ============ Interface ============

export interface ValidationService {
  validate(mutation: Mutation): Promise<ValidatedResult>;
}

// ============ Implementation ============

class ValidationServiceImpl implements ValidationService {
  constructor(private readonly config: ValidationServiceConfig) {}

  async validate(mutation: Mutation): Promise<ValidatedResult> {
    const checks: ValidationCheck[] = [];
    // eslint-disable-next-line prefer-const -- reassigned on L97/L107
    let dedup: DedupResult | undefined;
    // eslint-disable-next-line prefer-const -- reassigned on L97/L107
    let testResult: TestResult | undefined;

    // 1. Permission check
    const permissionCheck = this.checkPermission(mutation);
    checks.push(permissionCheck);
    if (!permissionCheck.passed) {
      return this.buildResult(checks, mutation, dedup, testResult);
    }

    // 2. Safety zone check
    const safetyCheck = this.checkSafetyZone(mutation);
    checks.push(safetyCheck);
    if (!safetyCheck.passed) {
      return this.buildResult(checks, mutation, dedup, testResult);
    }

    // 3. Semantic dedup (optional)
    dedup = await this.checkDedup(mutation);
    if (dedup) {
      checks.push({
        name: "dedup",
        passed: true,
        detail: `action=${dedup.action}, similarity=${dedup.similarity}`,
      });
    }

    // 4. Type-specific validation
    testResult = await this.runTypeSpecificTest(mutation);
    if (testResult) {
      checks.push({
        name: "type-test",
        passed: testResult.passed,
        detail: testResult.summary,
      });
      if (!testResult.passed) {
        return this.buildResult(checks, mutation, dedup, testResult);
      }
    }

    return this.buildResult(checks, mutation, dedup, testResult);
  }

  private checkPermission(mutation: Mutation): ValidationCheck {
    const decision = this.config.permissionService.check({
      action: "mutation:submit",
      subject: `${mutation.type}:${mutation.target.system}`,
    });

    if (decision === "deny") {
      return {
        name: "permission",
        passed: false,
        detail: "Permission denied for mutation:submit",
      };
    }

    return {
      name: "permission",
      passed: true,
      detail: `Permission: ${decision}`,
    };
  }

  private checkSafetyZone(mutation: Mutation): ValidationCheck {
    const path = mutation.target.path ?? "";
    if (path.includes("identity/")) {
      return {
        name: "safety-zone",
        passed: false,
        detail: `Forbidden: mutations to identity/ path (${path})`,
      };
    }
    return { name: "safety-zone", passed: true };
  }

  private async checkDedup(mutation: Mutation): Promise<DedupResult | undefined> {
    const { vectorStore, embeddingProvider, mutationConfig } = this.config;
    if (!vectorStore || !embeddingProvider) {
      return undefined;
    }

    try {
      const text = this.extractTextForDedup(mutation);
      const vector = await embeddingProvider.embed(text);
      const results = await vectorStore.search(vector, undefined, 1);

      if (results.length === 0) {
        return { similarIds: [], action: "proceed", similarity: 0 };
      }

      const topMatch = results[0];
      if (!topMatch) {
        return { similarIds: [], action: "proceed", similarity: 0 };
      }
      const similarity = topMatch.score;

      if (similarity > mutationConfig.dedupSkipThreshold) {
        return {
          similarIds: [topMatch.id],
          action: "skip",
          similarity,
        };
      }

      if (similarity > mutationConfig.dedupThreshold) {
        return {
          similarIds: [topMatch.id],
          action: "merge",
          similarity,
        };
      }

      return { similarIds: [], action: "proceed", similarity };
    } catch (error) {
      this.config.tracing.log({
        level: "warn",
        category: "evolution",
        event: "validation:dedup:error",
        data: { mutationId: mutation.id, error: String(error) },
      });
      return undefined;
    }
  }

  private async runTypeSpecificTest(mutation: Mutation): Promise<TestResult | undefined> {
    const { testRunner } = this.config;

    switch (mutation.type) {
      case "code":
        return testRunner.testCode(mutation);
      case "skill":
      case "skill-extension":
        return testRunner.testSkill(mutation);
      case "config":
        return testRunner.testConfig(mutation);
      default:
        return undefined;
    }
  }

  private extractTextForDedup(mutation: Mutation): string {
    const payload = mutation.content.payload;
    if (typeof payload === "string") return payload;
    if (payload && typeof payload === "object" && "text" in payload) {
      return String((payload as { text: unknown }).text);
    }
    return JSON.stringify(payload);
  }

  private buildResult(
    checks: readonly ValidationCheck[],
    mutation: Mutation,
    dedup: DedupResult | undefined,
    testResult: TestResult | undefined,
  ): ValidatedResult {
    const allPassed = checks.every((c) => c.passed);
    const risk = this.assignRisk(mutation, checks);

    const base = { passed: allPassed, checks, risk };

    if (dedup && testResult) {
      return { ...base, dedup, testResult };
    }
    if (dedup) {
      return { ...base, dedup };
    }
    if (testResult) {
      return { ...base, testResult };
    }
    return base;
  }

  private assignRisk(mutation: Mutation, checks: readonly ValidationCheck[]): MutationRisk {
    // Safety zone violation → forbidden
    const safetyFailed = checks.some((c) => c.name === "safety-zone" && !c.passed);
    if (safetyFailed) {
      return "forbidden";
    }

    return DEFAULT_RISK_MATRIX[mutation.type];
  }
}

// ============ Factory ============

export function createValidationService(config: ValidationServiceConfig): ValidationService {
  return new ValidationServiceImpl(config);
}
