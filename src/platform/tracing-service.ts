/**
 * TracingService 实现
 * 位置: src/platform/tracing-service.ts
 *
 * TS-1: 事件分级
 * TS-2: 核心接口 (log, logMetrics, query, getSessionSummary)
 * TS-3: 内存缓冲 + SQLite 批量写入
 * TS-4: stderr 实时输出
 * TS-5: CM-7 集成
 * TS-6: aggregate() — 聚合质量指标 (Phase 5a)
 */

import type Database from "better-sqlite3";

// ============ 类型 ============

export type TraceLevel = "error" | "warn" | "info" | "debug";

export type TraceCategory =
  | "agent"
  | "context"
  | "tool"
  | "memory"
  | "knowledge"
  | "ile"
  | "gateway"
  | "scheduler";

export interface TraceOutcome {
  readonly success: boolean;
  readonly durationMs?: number;
  readonly errorMessage?: string;
}

export interface TraceEvent {
  readonly level: TraceLevel;
  readonly category: TraceCategory;
  readonly event: string;
  readonly sessionId?: string;
  readonly spanId?: string;
  readonly parentId?: string;
  readonly data?: Record<string, unknown>;
  readonly outcome?: TraceOutcome;
  readonly timestamp: number;
}

export interface TraceFilter {
  readonly level?: TraceLevel;
  readonly category?: TraceCategory;
  readonly sessionId?: string;
  readonly since?: number;
  readonly limit?: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly compactCount: number;
  readonly tokenUsage: { readonly total: number; readonly used: number };
  readonly errors: number;
  readonly durationMs: number;
}

export interface ContextMetrics {
  readonly iteration: number;
  readonly toolChain: readonly {
    readonly name: string;
    readonly durationMs: number;
    readonly success: boolean;
  }[];
  readonly tokenUsage: { readonly total: number; readonly used: number };
  readonly compactCount: number;
}

// ============ TS-6: Aggregate 类型 ============

export type AggregateDimension =
  | "skill-classification"
  | "routine-effectiveness"
  | "tool-reliability"
  | "token-estimation"
  | "sub-agent-quality"
  | "mutation-effectiveness";

export type AggregatePeriod = "1d" | "7d" | "30d";

export interface AggregateReport {
  readonly dimension: AggregateDimension;
  readonly period: AggregatePeriod;
  readonly sampleCount: number;
  readonly metrics: Record<string, number>;
}

export interface TracingService {
  log(event: TraceEvent): void;
  logMetrics(sessionId: string, metrics: ContextMetrics): void;
  query(filter: TraceFilter): Promise<readonly TraceEvent[]>;
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  aggregate(dimension: AggregateDimension, period: AggregatePeriod): Promise<AggregateReport>;
  flush(): void;
  dispose(): void;
  readonly bufferSize: number;
}

// ============ 配置 ============

export interface TracingServiceConfig {
  readonly sqlite: Database.Database;
  readonly batchSize?: number;
  readonly overflowThreshold?: number;
  readonly flushIntervalMs?: number;
  readonly debugEnabled?: boolean;
  /** 已知 secret 值，log 时自动替换为 [REDACTED] (CFG-5) */
  readonly secretValues?: readonly string[];
  /** 禁用 stderr 输出（测试用） */
  readonly silentStderr?: boolean;
}

// ============ Telemetry 表 Schema ============

export const TELEMETRY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    event TEXT NOT NULL,
    session_id TEXT,
    span_id TEXT,
    parent_id TEXT,
    data TEXT,
    outcome TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry(session_id);
  CREATE INDEX IF NOT EXISTS idx_telemetry_level ON telemetry(level, timestamp);
  CREATE INDEX IF NOT EXISTS idx_telemetry_category ON telemetry(category, timestamp);
  CREATE INDEX IF NOT EXISTS idx_telemetry_event_ts ON telemetry(event, timestamp);
`;

// ============ 实现 ============

class TracingServiceImpl implements TracingService {
  private readonly sqlite: Database.Database;
  private readonly batchSize: number;
  private readonly overflowThreshold: number;
  private readonly debugEnabled: boolean;
  private readonly secretPatterns: readonly RegExp[];
  private readonly silentStderr: boolean;
  private buffer: TraceEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  private readonly insertStmt: Database.Statement;

  constructor(config: TracingServiceConfig) {
    this.sqlite = config.sqlite;
    this.batchSize = config.batchSize ?? 50;
    this.overflowThreshold = config.overflowThreshold ?? 500;
    this.debugEnabled = config.debugEnabled ?? false;
    this.silentStderr = config.silentStderr ?? false;

    // CFG-5: 构建 secret 匹配模式（仅包含非空值）
    this.secretPatterns = (config.secretValues ?? [])
      .filter((v) => v.length >= 4) // 过短的值可能误匹配
      .map((v) => new RegExp(escapeRegExp(v), "g"));

    this.insertStmt = this.sqlite.prepare(
      `INSERT INTO telemetry (level, category, event, session_id, span_id, parent_id, data, outcome, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const flushIntervalMs = config.flushIntervalMs ?? 5000;
    this.flushTimer = setInterval(() => this.flush(), flushIntervalMs);
    // Don't block Node exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  log(event: TraceEvent): void {
    // TS-4: stderr 实时输出
    this.emitStderr(event);

    // DEBUG 级别仅在启用时持久化
    if (event.level === "debug" && !this.debugEnabled) {
      return;
    }

    // CFG-5: 脱敏 data 中的 secret 值
    const sanitized = this.secretPatterns.length > 0
      ? this.redactEvent(event)
      : event;

    this.buffer.push(sanitized);

    // batch 到达阈值或溢出保护 — 立即 flush
    if (this.buffer.length >= this.batchSize || this.buffer.length >= this.overflowThreshold) {
      this.flush();
    }
  }

  logMetrics(sessionId: string, metrics: ContextMetrics): void {
    this.log({
      level: "info",
      category: "context",
      event: "metrics:context",
      sessionId,
      data: {
        iteration: metrics.iteration,
        toolChain: [...metrics.toolChain],
        tokenUsage: { ...metrics.tokenUsage },
        compactCount: metrics.compactCount,
      },
      timestamp: Date.now(),
    });
  }

  flush(): void {
    if (this.buffer.length === 0) return;

    const eventsToFlush = this.buffer;
    this.buffer = [];

    const insertMany = this.sqlite.transaction(
      (events: readonly TraceEvent[]) => {
        for (const e of events) {
          this.insertStmt.run(
            e.level,
            e.category,
            e.event,
            e.sessionId ?? null,
            e.spanId ?? null,
            e.parentId ?? null,
            e.data ? JSON.stringify(e.data) : null,
            e.outcome ? JSON.stringify(e.outcome) : null,
            e.timestamp,
          );
        }
      },
    );

    insertMany(eventsToFlush);
  }

  async query(filter: TraceFilter): Promise<readonly TraceEvent[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.level) {
      conditions.push("level = ?");
      params.push(filter.level);
    }
    if (filter.category) {
      conditions.push("category = ?");
      params.push(filter.category);
    }
    if (filter.sessionId) {
      conditions.push("session_id = ?");
      params.push(filter.sessionId);
    }
    if (filter.since) {
      conditions.push("timestamp >= ?");
      params.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 100;

    const sql = `SELECT level, category, event, session_id, span_id, parent_id, data, outcome, timestamp
                 FROM telemetry ${where}
                 ORDER BY timestamp ASC
                 LIMIT ?`;
    params.push(limit);

    const rows = this.sqlite.prepare(sql).all(...params) as Array<{
      level: TraceLevel;
      category: TraceCategory;
      event: string;
      session_id: string | null;
      span_id: string | null;
      parent_id: string | null;
      data: string | null;
      outcome: string | null;
      timestamp: number;
    }>;

    return rows.map((r) => ({
      level: r.level,
      category: r.category,
      event: r.event,
      ...(r.session_id ? { sessionId: r.session_id } : {}),
      ...(r.span_id ? { spanId: r.span_id } : {}),
      ...(r.parent_id ? { parentId: r.parent_id } : {}),
      ...(r.data ? { data: JSON.parse(r.data) as Record<string, unknown> } : {}),
      ...(r.outcome ? { outcome: JSON.parse(r.outcome) as TraceOutcome } : {}),
      timestamp: r.timestamp,
    }));
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    // M1: 同时查询 event 计数和 metrics 中的 tokenUsage
    const rows = this.sqlite
      .prepare(
        `SELECT level, event, data, timestamp FROM telemetry WHERE session_id = ? ORDER BY timestamp ASC`,
      )
      .all(sessionId) as Array<{
      level: TraceLevel;
      event: string;
      data: string | null;
      timestamp: number;
    }>;

    let iterations = 0;
    let toolCalls = 0;
    let compactCount = 0;
    let errors = 0;
    let minTs = Infinity;
    let maxTs = 0;
    let lastTokenTotal = 0;
    let lastTokenUsed = 0;

    for (const row of rows) {
      if (row.event === "react:iteration") iterations++;
      if (row.event === "tool:execute") toolCalls++;
      if (row.event === "compact:trigger") compactCount++;
      if (row.level === "error") errors++;
      if (row.timestamp < minTs) minTs = row.timestamp;
      if (row.timestamp > maxTs) maxTs = row.timestamp;

      // 从 metrics:context 事件中提取最新的 tokenUsage
      if (row.event === "metrics:context" && row.data) {
        const parsed = JSON.parse(row.data) as { tokenUsage?: { total?: number; used?: number } };
        if (parsed.tokenUsage) {
          lastTokenTotal = parsed.tokenUsage.total ?? 0;
          lastTokenUsed = parsed.tokenUsage.used ?? 0;
        }
      }
    }

    return {
      sessionId,
      iterations,
      toolCalls,
      compactCount,
      tokenUsage: { total: lastTokenTotal, used: lastTokenUsed },
      errors,
      durationMs: rows.length > 0 ? maxTs - minTs : 0,
    };
  }

  async aggregate(
    dimension: AggregateDimension,
    period: AggregatePeriod,
  ): Promise<AggregateReport> {
    const periodMs = PERIOD_TO_MS[period];
    const since = Date.now() - periodMs;
    const eventName = DIMENSION_TO_EVENT[dimension];

    const rows = this.sqlite
      .prepare(
        `SELECT outcome FROM telemetry
         WHERE event = ? AND timestamp >= ? AND outcome IS NOT NULL`,
      )
      .all(eventName, since) as Array<{ outcome: string }>;

    if (rows.length === 0) {
      return { dimension, period, sampleCount: 0, metrics: {} };
    }

    const outcomes = rows.map(
      (r) => JSON.parse(r.outcome) as TraceOutcome & Record<string, unknown>,
    );

    const metrics = computeMetrics(dimension, outcomes);

    return { dimension, period, sampleCount: rows.length, metrics };
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // ============ Private ============

  /** TS-4: stderr 实时输出 */
  private emitStderr(event: TraceEvent): void {
    if (this.silentStderr) return;

    const shouldOutput =
      event.level === "error" ||
      event.level === "warn" ||
      (event.level === "info" && this.debugEnabled) ||
      (event.level === "debug" && this.debugEnabled);

    if (!shouldOutput) return;

    const ts = new Date(event.timestamp).toISOString().slice(11, 23);
    const lvl = event.level.toUpperCase().padEnd(5);
    const prefix = `[${ts}] ${lvl} [${event.category}]`;
    const msg = event.sessionId
      ? `${prefix} ${event.event} (session: ${event.sessionId})`
      : `${prefix} ${event.event}`;

    process.stderr.write(msg + "\n");
  }

  /** CFG-5: 脱敏 event data 中的 secret 值 */
  private redactEvent(event: TraceEvent): TraceEvent {
    if (!event.data) return event;

    const dataStr = JSON.stringify(event.data);
    let redacted = dataStr;
    for (const pattern of this.secretPatterns) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      redacted = redacted.replace(pattern, "[REDACTED]");
    }

    if (redacted === dataStr) return event;

    return {
      ...event,
      data: JSON.parse(redacted) as Record<string, unknown>,
    };
  }
}

// ============ 工具函数 ============

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============ TS-6: Aggregate 常量 + 计算 ============

const PERIOD_TO_MS: Record<AggregatePeriod, number> = {
  "1d": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

const DIMENSION_TO_EVENT: Record<AggregateDimension, string> = {
  "skill-classification": "skill:classify",
  "routine-effectiveness": "scheduler:task_end",
  "tool-reliability": "tool:execute",
  "token-estimation": "context:estimate",
  "sub-agent-quality": "subagent:complete",
  "mutation-effectiveness": "mutation:applied",
};

function computeMetrics(
  dimension: AggregateDimension,
  outcomes: ReadonlyArray<TraceOutcome & Record<string, unknown>>,
): Record<string, number> {
  if (dimension === "skill-classification") {
    const matched = outcomes.filter((o) => o.success).length;
    return { accuracy: matched / outcomes.length };
  }

  if (dimension === "token-estimation") {
    const deviations = outcomes
      .map((o) => (typeof o["deviation"] === "number" ? o["deviation"] : 0));
    const avg = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
    return { avgDeviation: avg };
  }

  // Default: successRate + avgDurationMs
  const successes = outcomes.filter((o) => o.success).length;
  const durations = outcomes
    .filter((o) => typeof o.durationMs === "number")
    .map((o) => o.durationMs as number);
  const avgDurationMs = durations.length > 0
    ? durations.reduce((sum, d) => sum + d, 0) / durations.length
    : 0;

  return {
    successRate: successes / outcomes.length,
    avgDurationMs,
  };
}

// ============ Migration ============

/** 幂等添加 outcome 列（旧数据库兼容） */
export function migrateTelemetryOutcomeColumn(db: Database.Database): void {
  const columns = db.pragma("table_info(telemetry)") as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "outcome")) {
    db.exec("ALTER TABLE telemetry ADD COLUMN outcome TEXT");
  }
  // 确保 event+timestamp 索引存在
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_telemetry_event_ts ON telemetry(event, timestamp)",
  );
}

// ============ 工厂函数 ============

export function createTracingService(
  config: TracingServiceConfig,
): TracingService {
  return new TracingServiceImpl(config);
}
