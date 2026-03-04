/**
 * MutationPipeline — 4 阶段变异管线
 * 位置: src/evolution/mutation-pipeline.ts
 *
 * MP-1~7: Propose → Validate → Apply → Track
 * 所有 Evolution 产出经由此管线处理
 */

import type {
  AppliedMutation,
  CorrectionSignal,
  Mutation,
  MutationFilter,
  MutationHealthReport,
  MutationResult,
  MutationStatus,
  MutationType,
  UsageSignal,
} from "./types.js";
import {
  generateMutationId,
  MUTATION_LOG_SCHEMA,
} from "./types.js";
import type { ValidatedResult, ValidationService } from "./validation/validation-service.js";
import type { MutationApplicator } from "./applicators/types.js";
import type { MutationConfig } from "../platform/types/config.js";

// ============ DI Interfaces ============

export interface PipelineSqlite {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

export interface PipelineTracing {
  log(event: unknown): void;
}

// ============ Config ============

export interface MutationPipelineConfig {
  readonly sqlite: PipelineSqlite;
  readonly validationService: ValidationService;
  readonly applicators: ReadonlyMap<string, MutationApplicator>;
  readonly tracing: PipelineTracing;
  readonly mutationConfig: MutationConfig;
}

// ============ Interface ============

export interface MutationPipeline {
  submit(mutations: readonly Mutation[]): Promise<readonly MutationResult[]>;
  submitCorrection(correction: CorrectionSignal): Promise<MutationResult>;
  reportUsage(usage: UsageSignal): void;
  getHistory(filter?: MutationFilter): Promise<readonly AppliedMutation[]>;
  getHealthReport(): Promise<MutationHealthReport>;
  dispose(): void;
}

// ============ Implementation ============

class MutationPipelineImpl implements MutationPipeline {
  private readonly insertStmt: ReturnType<PipelineSqlite["prepare"]>;
  private readonly updateUsageStmt: ReturnType<PipelineSqlite["prepare"]>;

  constructor(private readonly config: MutationPipelineConfig) {
    // 幂等迁移
    config.sqlite.exec(MUTATION_LOG_SCHEMA);

    this.insertStmt = config.sqlite.prepare(`
      INSERT OR REPLACE INTO mutation_log
        (id, type, target_system, target_path, action, source_type, source_ref,
         reason, risk, status, merged_into, approval_method,
         retrieval_count, usage_count, positive_signals, negative_signals,
         last_used_at, created_at, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, NULL, ?, ?)
    `);

    this.updateUsageStmt = config.sqlite.prepare(`
      UPDATE mutation_log
      SET retrieval_count = retrieval_count + ?,
          usage_count = usage_count + ?,
          positive_signals = positive_signals + ?,
          last_used_at = ?
      WHERE id = ?
    `);
  }

  // ============ Stage 1: Propose ============

  async submit(mutations: readonly Mutation[]): Promise<readonly MutationResult[]> {
    const { mutationConfig } = this.config;

    // Batch limit check
    if (mutations.length > mutationConfig.maxPerSubmit) {
      throw new Error(
        `Batch size ${mutations.length} exceeds maximum ${mutationConfig.maxPerSubmit}`,
      );
    }

    const results: MutationResult[] = [];
    for (const mutation of mutations) {
      const result = await this.processSingleMutation(mutation);
      results.push(result);
    }
    return results;
  }

  async submitCorrection(correction: CorrectionSignal): Promise<MutationResult> {
    const mutation: Mutation = {
      id: generateMutationId("anti-pattern", { system: "knowledge-store" }, {
        action: "create",
        payload: {
          originalBehavior: correction.originalBehavior,
          correction: correction.correction,
        },
        reason: correction.correction,
      }),
      type: "anti-pattern",
      target: { system: "knowledge-store" },
      content: {
        action: "create",
        payload: {
          text: `不该: ${correction.originalBehavior}\n应该: ${correction.correction}`,
          originalBehavior: correction.originalBehavior,
          correction: correction.correction,
        },
        reason: correction.correction,
      },
      source: {
        type: "user-correction",
        sessionId: correction.sessionId,
        messageId: correction.messageId,
      },
      createdAt: new Date(),
    };

    const [result] = await this.submit([mutation]);
    return result!;
  }

  // ============ Stage 4: Track ============

  reportUsage(usage: UsageSignal): void {
    const now = new Date().toISOString();
    const retrievalDelta = usage.retrieved ? 1 : 0;
    const usageDelta = usage.usedInResponse ? 1 : 0;
    const positiveDelta = usage.usedInResponse ? 1 : 0;

    try {
      this.updateUsageStmt.run(
        retrievalDelta,
        usageDelta,
        positiveDelta,
        now,
        usage.knowledgeId,
      );
    } catch (error) {
      this.config.tracing.log({
        level: "warn",
        category: "evolution",
        event: "pipeline:report-usage:error",
        data: { knowledgeId: usage.knowledgeId, error: String(error) },
      });
    }
  }

  // ============ Queries ============

  async getHistory(filter?: MutationFilter): Promise<readonly AppliedMutation[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.type) {
      conditions.push("type = ?");
      params.push(filter.type);
    }
    if (filter?.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter?.sourceType) {
      conditions.push("source_type = ?");
      params.push(filter.sourceType);
    }
    if (filter?.targetSystem) {
      conditions.push("target_system = ?");
      params.push(filter.targetSystem);
    }
    if (filter?.since) {
      conditions.push("created_at >= ?");
      params.push(filter.since.toISOString());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ? `LIMIT ${filter.limit}` : "LIMIT 100";

    const stmt = this.config.sqlite.prepare(
      `SELECT * FROM mutation_log ${where} ORDER BY created_at DESC ${limit}`,
    );
    const rows = stmt.all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToAppliedMutation(row));
  }

  async getHealthReport(): Promise<MutationHealthReport> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const totalStmt = this.config.sqlite.prepare(
      "SELECT COUNT(*) as count FROM mutation_log",
    );
    const totalRow = totalStmt.get() as { count: number } | undefined;

    const todayStmt = this.config.sqlite.prepare(
      "SELECT COUNT(*) as count FROM mutation_log WHERE created_at >= ?",
    );
    const todayRow = todayStmt.get(todayIso) as { count: number } | undefined;

    const statusStmt = this.config.sqlite.prepare(
      "SELECT status, COUNT(*) as count FROM mutation_log GROUP BY status",
    );
    const statusRows = statusStmt.all() as Array<{ status: string; count: number }>;

    const typeStmt = this.config.sqlite.prepare(
      "SELECT type, COUNT(*) as count FROM mutation_log GROUP BY type",
    );
    const typeRows = typeStmt.all() as Array<{ type: string; count: number }>;

    const pendingStmt = this.config.sqlite.prepare(
      "SELECT MIN(created_at) as oldest FROM mutation_log WHERE status = 'pending'",
    );
    const pendingRow = pendingStmt.get() as { oldest: string | null } | undefined;

    const byStatus: Record<MutationStatus, number> = {
      applied: 0, merged: 0, skipped: 0, rejected: 0, pending: 0,
    };
    for (const row of statusRows) {
      byStatus[row.status as MutationStatus] = row.count;
    }

    const byType: Partial<Record<MutationType, number>> = {};
    for (const row of typeRows) {
      byType[row.type as MutationType] = row.count;
    }

    const base = {
      totalMutations: totalRow?.count ?? 0,
      todayCount: todayRow?.count ?? 0,
      byStatus,
      byType,
    };
    if (pendingRow?.oldest) {
      return { ...base, oldestPending: new Date(pendingRow.oldest) };
    }
    return base;
  }

  dispose(): void {
    this.config.tracing.log({
      level: "info",
      category: "evolution",
      event: "pipeline:disposed",
    });
  }

  // ============ Private ============

  private async processSingleMutation(mutation: Mutation): Promise<MutationResult> {
    // Stage 2: Validate
    const validationResult = await this.config.validationService.validate(mutation);

    // Check validation pass
    if (!validationResult.passed) {
      this.logMutation(mutation, validationResult.risk, "rejected", null);
      return { status: "rejected", reason: this.extractRejectionReason(validationResult) };
    }

    // Check dedup skip
    if (validationResult.dedup?.action === "skip") {
      const similarId = validationResult.dedup.similarIds[0] ?? "";
      this.logMutation(mutation, validationResult.risk, "skipped", null);
      return {
        status: "skipped",
        reason: `Similar to existing (${similarId}, similarity ${validationResult.dedup.similarity})`,
      };
    }

    // Check dedup merge
    if (validationResult.dedup?.action === "merge") {
      const mergedInto = validationResult.dedup.similarIds[0] ?? "";
      this.logMutation(mutation, validationResult.risk, "merged", null, mergedInto);
      return { status: "merged", id: mutation.id, mergedInto };
    }

    // Stage 3: Apply
    return this.applyMutation(mutation, validationResult);
  }

  private async applyMutation(
    mutation: Mutation,
    validationResult: ValidatedResult,
  ): Promise<MutationResult> {
    const applicator = this.config.applicators.get(mutation.target.system);
    if (!applicator) {
      this.logMutation(mutation, validationResult.risk, "rejected", null);
      return {
        status: "rejected",
        reason: `No applicator for target system: ${mutation.target.system}`,
      };
    }

    try {
      const validatedMutation = {
        ...mutation,
        validation: validationResult,
        risk: validationResult.risk,
      };

      const result = await applicator.apply(validatedMutation);

      // Log the mutation
      const status = result.status === "applied" || result.status === "merged"
        ? result.status
        : result.status === "pending-approval"
          ? "pending"
          : "rejected";
      const approvalMethod = validationResult.risk === "low" ? "auto" : null;
      this.logMutation(mutation, validationResult.risk, status, approvalMethod);

      // Track via tracing
      this.config.tracing.log({
        level: "info",
        category: "evolution",
        event: "pipeline:mutation:applied",
        data: {
          mutationId: mutation.id,
          type: mutation.type,
          target: mutation.target.system,
          risk: validationResult.risk,
          result: result.status,
        },
      });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logMutation(mutation, validationResult.risk, "rejected", null);
      this.config.tracing.log({
        level: "error",
        category: "evolution",
        event: "pipeline:apply:error",
        data: { mutationId: mutation.id, error: message },
      });
      return { status: "rejected", reason: `Apply failed: ${message}` };
    }
  }

  private logMutation(
    mutation: Mutation,
    risk: string,
    status: string,
    approvalMethod: string | null,
    mergedInto?: string,
  ): void {
    const now = new Date().toISOString();
    const appliedAt = status === "applied" ? now : null;

    try {
      this.insertStmt.run(
        mutation.id,
        mutation.type,
        mutation.target.system,
        mutation.target.path ?? null,
        mutation.content.action,
        mutation.source.type,
        this.extractSourceRef(mutation),
        mutation.content.reason,
        risk,
        status,
        mergedInto ?? null,
        approvalMethod,
        now,
        appliedAt,
      );
    } catch (error) {
      this.config.tracing.log({
        level: "error",
        category: "evolution",
        event: "pipeline:log:error",
        data: { mutationId: mutation.id, error: String(error) },
      });
    }
  }

  private extractSourceRef(mutation: Mutation): string | null {
    const src = mutation.source;
    switch (src.type) {
      case "reflection":
        return src.sessionId;
      case "active-learning":
        return src.routineId;
      case "user-correction":
        return `${src.sessionId}:${src.messageId}`;
      case "usage-feedback":
        return src.knowledgeId;
      case "system-observation":
        return src.signal;
    }
  }

  private extractRejectionReason(result: ValidatedResult): string {
    const failedCheck = result.checks.find((c) => !c.passed);
    return failedCheck?.detail ?? "Validation failed";
  }

  private rowToAppliedMutation(row: Record<string, unknown>): AppliedMutation {
    return {
      id: String(row["id"]),
      type: String(row["type"]) as MutationType,
      target: row["target_path"]
        ? {
            system: String(row["target_system"]) as AppliedMutation["target"]["system"],
            path: String(row["target_path"]),
          }
        : {
            system: String(row["target_system"]) as AppliedMutation["target"]["system"],
          },
      content: {
        action: String(row["action"]) as AppliedMutation["content"]["action"],
        payload: null,
        reason: String(row["reason"]),
      },
      source: {
        type: String(row["source_type"]) as "reflection",
        sessionId: String(row["source_ref"] ?? ""),
      },
      createdAt: new Date(String(row["created_at"])),
      validation: { passed: true, checks: [] },
      risk: String(row["risk"]) as AppliedMutation["risk"],
      appliedAt: row["applied_at"] ? new Date(String(row["applied_at"])) : new Date(),
      approvalMethod: (String(row["approval_method"] ?? "auto")) as AppliedMutation["approvalMethod"],
      effectiveness: row["last_used_at"]
        ? {
            retrievalCount: Number(row["retrieval_count"] ?? 0),
            usageCount: Number(row["usage_count"] ?? 0),
            positiveSignals: Number(row["positive_signals"] ?? 0),
            negativeSignals: Number(row["negative_signals"] ?? 0),
            lastUsedAt: new Date(String(row["last_used_at"])),
          }
        : {
            retrievalCount: Number(row["retrieval_count"] ?? 0),
            usageCount: Number(row["usage_count"] ?? 0),
            positiveSignals: Number(row["positive_signals"] ?? 0),
            negativeSignals: Number(row["negative_signals"] ?? 0),
          },
    };
  }
}

// ============ Factory ============

export function createMutationPipeline(config: MutationPipelineConfig): MutationPipeline {
  return new MutationPipelineImpl(config);
}
