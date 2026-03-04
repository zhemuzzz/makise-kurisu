/**
 * Evolution 子系统共享类型
 * 位置: src/evolution/types.ts
 *
 * MP-2: 核心数据模型 (Mutation → ValidatedMutation → AppliedMutation)
 * MP-6: mutation_log 表 schema + 迁移
 */

import { createHash } from "node:crypto";

// ============ MutationType ============

export type MutationType =
  | "knowledge"
  | "anti-pattern"
  | "skill"
  | "skill-extension"
  | "routine"
  | "code"
  | "config";

export const MUTATION_TYPES: readonly MutationType[] = [
  "knowledge",
  "anti-pattern",
  "skill",
  "skill-extension",
  "routine",
  "code",
  "config",
] as const;

// ============ MutationTarget ============

export type MutationTargetSystem =
  | "knowledge-store"
  | "skill-manager"
  | "routine-registry"
  | "sandbox"
  | "config-manager";

export interface MutationTarget {
  readonly system: MutationTargetSystem;
  readonly path?: string;
  readonly existingId?: string;
}

// ============ MutationContent ============

export type MutationAction = "create" | "update" | "merge" | "archive" | "delete";

export interface MutationContent {
  readonly action: MutationAction;
  readonly payload: unknown;
  readonly reason: string;
}

// ============ MutationSource ============

export type MutationSource =
  | { readonly type: "reflection"; readonly sessionId: string }
  | { readonly type: "active-learning"; readonly routineId: string }
  | { readonly type: "user-correction"; readonly sessionId: string; readonly messageId: string }
  | { readonly type: "usage-feedback"; readonly knowledgeId: string }
  | { readonly type: "system-observation"; readonly signal: string };

export type MutationSourceType = MutationSource["type"];

// ============ Mutation (Gene) ============

export interface Mutation {
  readonly id: string;
  readonly type: MutationType;
  readonly target: MutationTarget;
  readonly content: MutationContent;
  readonly source: MutationSource;
  readonly createdAt: Date;
}

// ============ ValidationResult ============

export interface ValidationCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

export interface DedupResult {
  readonly similarIds: readonly string[];
  readonly action: "merge" | "skip" | "proceed";
  readonly similarity: number;
}

export interface TestResult {
  readonly passed: boolean;
  readonly summary: string;
  readonly details?: string;
  readonly sandboxLog?: string;
  readonly durationMs?: number;
}

export interface ValidationResult {
  readonly passed: boolean;
  readonly checks: readonly ValidationCheck[];
  readonly dedup?: DedupResult;
  readonly testResult?: TestResult;
}

// ============ Risk ============

export type MutationRisk = "low" | "medium" | "high" | "forbidden";

// ============ ValidatedMutation (Capsule) ============

export interface ValidatedMutation extends Mutation {
  readonly validation: ValidationResult;
  readonly risk: MutationRisk;
}

// ============ MutationStatus ============

export type MutationStatus = "applied" | "merged" | "skipped" | "rejected" | "pending";

// ============ ApprovalMethod ============

export type ApprovalMethod = "auto" | "user-confirmed" | "draft-confirmed";

// ============ EffectivenessScore (Pipeline 专用，比 KnowledgeStore 的更丰富) ============

export interface MutationEffectivenessScore {
  readonly retrievalCount: number;
  readonly usageCount: number;
  readonly positiveSignals: number;
  readonly negativeSignals: number;
  readonly lastUsedAt?: Date;
}

// ============ AppliedMutation (EvolutionEvent) ============

export interface AppliedMutation extends ValidatedMutation {
  readonly appliedAt: Date;
  readonly approvalMethod: ApprovalMethod;
  readonly effectiveness?: MutationEffectivenessScore;
}

// ============ MutationResult ============

export type MutationResult =
  | { readonly status: "applied"; readonly id: string; readonly action: string }
  | { readonly status: "merged"; readonly id: string; readonly mergedInto: string }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "pending-approval"; readonly approvalId: string }
  | { readonly status: "rejected"; readonly reason: string };

// ============ CorrectionSignal ============

export interface CorrectionSignal {
  readonly sessionId: string;
  readonly messageId: string;
  readonly originalBehavior: string;
  readonly correction: string;
  readonly relatedKnowledgeIds?: readonly string[];
}

// ============ UsageSignal ============

export interface UsageSignal {
  readonly knowledgeId: string;
  readonly sessionId: string;
  readonly retrieved: boolean;
  readonly usedInResponse: boolean;
}

// ============ MutationFilter ============

export interface MutationFilter {
  readonly type?: MutationType;
  readonly status?: MutationStatus;
  readonly sourceType?: MutationSourceType;
  readonly targetSystem?: MutationTargetSystem;
  readonly since?: Date;
  readonly limit?: number;
}

// ============ MutationHealthReport ============

export interface MutationHealthReport {
  readonly totalMutations: number;
  readonly todayCount: number;
  readonly byStatus: Readonly<Record<MutationStatus, number>>;
  readonly byType: Readonly<Partial<Record<MutationType, number>>>;
  readonly oldestPending?: Date;
}

// ============ Default Risk Matrix (MP-4) ============

export const DEFAULT_RISK_MATRIX: Readonly<Record<MutationType, MutationRisk>> = Object.freeze({
  "knowledge": "low",
  "anti-pattern": "low",
  "skill-extension": "medium",
  "routine": "medium",
  "skill": "high",
  "code": "high",
  "config": "high",
});

// ============ ID Generation ============

/**
 * 生成 content-addressable mutation ID (SHA-256)
 *
 * 使用 type + target.system + action + payload 的 JSON 序列化内容
 * 确保相同内容产生相同 ID（幂等）
 */
export function generateMutationId(
  type: MutationType,
  target: MutationTarget,
  content: MutationContent,
): string {
  const input = JSON.stringify({
    type,
    system: target.system,
    action: content.action,
    payload: content.payload,
  });
  return createHash("sha256").update(input).digest("hex");
}

// ============ Type Guards ============

export function isMutationType(value: unknown): value is MutationType {
  return typeof value === "string" && MUTATION_TYPES.includes(value as MutationType);
}

export function isMutationRisk(value: unknown): value is MutationRisk {
  return typeof value === "string" && ["low", "medium", "high", "forbidden"].includes(value);
}

export function isMutationStatus(value: unknown): value is MutationStatus {
  return (
    typeof value === "string" &&
    ["applied", "merged", "skipped", "rejected", "pending"].includes(value)
  );
}

export function isMutationSourceType(value: unknown): value is MutationSourceType {
  return (
    typeof value === "string" &&
    [
      "reflection",
      "active-learning",
      "user-correction",
      "usage-feedback",
      "system-observation",
    ].includes(value)
  );
}

// ============ mutation_log Schema + Migration (MP-6) ============

/**
 * mutation_log 表 DDL — CREATE TABLE IF NOT EXISTS + 4 索引
 */
export const MUTATION_LOG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mutation_log (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    target_system TEXT NOT NULL,
    target_path TEXT,
    action TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_ref TEXT,
    reason TEXT NOT NULL,
    risk TEXT NOT NULL,
    status TEXT NOT NULL,
    merged_into TEXT,
    approval_method TEXT,
    retrieval_count INTEGER DEFAULT 0,
    usage_count INTEGER DEFAULT 0,
    positive_signals INTEGER DEFAULT 0,
    negative_signals INTEGER DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    applied_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_mutation_log_type ON mutation_log(type);
  CREATE INDEX IF NOT EXISTS idx_mutation_log_status ON mutation_log(status);
  CREATE INDEX IF NOT EXISTS idx_mutation_log_created_at ON mutation_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_mutation_log_target_system ON mutation_log(target_system);
`;

/**
 * 幂等迁移：创建 mutation_log 表（如不存在）
 *
 * 同 migrateSkillKnowledgeSchema 模式，使用 CREATE TABLE IF NOT EXISTS
 *
 * @param db - better-sqlite3 Database 实例
 */
export function migrateMutationLogSchema(db: {
  exec(sql: string): void;
}): void {
  db.exec(MUTATION_LOG_SCHEMA);
}

// ============ SQLite Row Mapping ============

export interface MutationLogRow {
  readonly id: string;
  readonly type: string;
  readonly target_system: string;
  readonly target_path: string | null;
  readonly action: string;
  readonly source_type: string;
  readonly source_ref: string | null;
  readonly reason: string;
  readonly risk: string;
  readonly status: string;
  readonly merged_into: string | null;
  readonly approval_method: string | null;
  readonly retrieval_count: number;
  readonly usage_count: number;
  readonly positive_signals: number;
  readonly negative_signals: number;
  readonly last_used_at: string | null;
  readonly created_at: string;
  readonly applied_at: string | null;
}
