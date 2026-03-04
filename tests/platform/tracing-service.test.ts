/**
 * TracingService 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * TS-1: 事件分级
 * TS-2: 核心接口
 * TS-3: 存储方案（内存缓冲 + SQLite 批量写入）
 * TS-4: stderr 实时输出
 * TS-5: CM-7 集成
 * TS-6: aggregate() + outcome (Phase 5a)
 * CFG-5: Secret 脱敏
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import BetterSqlite3 from "better-sqlite3";

describe("TracingService", () => {
  let tempDir: string;
  let sqlite: InstanceType<typeof BetterSqlite3>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-tracing-test-"));

    // 创建独立 platform SQLite（与 Bootstrap H1 修复一致）
    const { TELEMETRY_SCHEMA } = await import("@/platform/tracing-service");
    const dbDir = join(tempDir, "platform");
    mkdirSync(dbDir, { recursive: true });
    sqlite = new BetterSqlite3(join(dbDir, "tracing.sqlite"));
    sqlite.pragma("journal_mode = WAL");
    sqlite.exec(TELEMETRY_SCHEMA);
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("TS-2: Core Interface", () => {
    it("TS-01: log() 事件写入内存缓冲", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });

      tracing.log({
        level: "info",
        category: "agent",
        event: "react:iteration",
        sessionId: "sess-1",
        timestamp: Date.now(),
      });

      // 内存中应有 1 条，SQLite 还没有（未 flush）
      expect(tracing.bufferSize).toBe(1);

      const rows = sqlite
        .prepare("SELECT * FROM telemetry")
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(0);

      tracing.dispose();
    });

    it("TS-02: flush() 将缓冲写入 SQLite", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });

      tracing.log({
        level: "info",
        category: "tool",
        event: "tool:execute",
        sessionId: "sess-1",
        data: { toolName: "search" },
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT * FROM telemetry")
        .all() as Array<{ event: string; data: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.event).toBe("tool:execute");

      const data = JSON.parse(rows[0]!.data) as { toolName: string };
      expect(data.toolName).toBe("search");

      tracing.dispose();
    });

    it("TS-03: 达到 50 条自动 flush", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        batchSize: 50,
        silentStderr: true,
      });

      // 写入 50 条触发 auto flush
      for (let i = 0; i < 50; i++) {
        tracing.log({
          level: "info",
          category: "agent",
          event: `event-${i}`,
          timestamp: Date.now(),
        });
      }

      const rows = sqlite
        .prepare("SELECT COUNT(*) as count FROM telemetry")
        .get() as { count: number };
      expect(rows.count).toBe(50);
      expect(tracing.bufferSize).toBe(0);

      tracing.dispose();
    });

    it("TS-04: 溢出保护 — >500 条强制 flush", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        batchSize: 1000, // 设置很大不会自动触发
        overflowThreshold: 500,
        silentStderr: true,
      });

      for (let i = 0; i < 501; i++) {
        tracing.log({
          level: "info",
          category: "agent",
          event: `overflow-${i}`,
          timestamp: Date.now(),
        });
      }

      // 溢出 flush 发生后，缓冲中可能还有剩余
      // dispose 会 flush 剩余
      tracing.dispose();

      const rows = sqlite
        .prepare("SELECT COUNT(*) as count FROM telemetry")
        .get() as { count: number };
      expect(rows.count).toBe(501);
    });
  });

  describe("TS-1: Event Levels", () => {
    it("TS-05: DEBUG 事件默认不持久化", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        debugEnabled: false,
        silentStderr: true,
      });

      tracing.log({
        level: "debug",
        category: "context",
        event: "prompt:full",
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT * FROM telemetry")
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(0);

      tracing.dispose();
    });

    it("TS-06: DEBUG 启用时持久化", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        debugEnabled: true,
        silentStderr: true,
      });

      tracing.log({
        level: "debug",
        category: "context",
        event: "prompt:full",
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT * FROM telemetry")
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);

      tracing.dispose();
    });
  });

  describe("TS-2: Query & Summary", () => {
    it("TS-07: query() 按 filter 查询", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const now = Date.now();

      tracing.log({ level: "error", category: "agent", event: "agent:error", sessionId: "s1", timestamp: now });
      tracing.log({ level: "info", category: "tool", event: "tool:exec", sessionId: "s1", timestamp: now + 1 });
      tracing.log({ level: "info", category: "agent", event: "react:done", sessionId: "s2", timestamp: now + 2 });
      tracing.flush();

      // 按 level 查询
      const errors = await tracing.query({ level: "error" });
      expect(errors).toHaveLength(1);
      expect(errors[0]!.event).toBe("agent:error");

      // 按 sessionId 查询
      const s1Events = await tracing.query({ sessionId: "s1" });
      expect(s1Events).toHaveLength(2);

      // 按 category 查询
      const toolEvents = await tracing.query({ category: "tool" });
      expect(toolEvents).toHaveLength(1);

      // limit 限制
      const limited = await tracing.query({ limit: 1 });
      expect(limited).toHaveLength(1);

      tracing.dispose();
    });

    it("TS-08: getSessionSummary() 返回执行摘要", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const startTime = Date.now();

      // 模拟一个 session 的事件
      tracing.log({ level: "info", category: "agent", event: "react:iteration", sessionId: "s1", timestamp: startTime });
      tracing.log({ level: "info", category: "tool", event: "tool:execute", sessionId: "s1", timestamp: startTime + 100 });
      tracing.log({ level: "info", category: "tool", event: "tool:execute", sessionId: "s1", timestamp: startTime + 200 });
      tracing.log({ level: "warn", category: "context", event: "compact:trigger", sessionId: "s1", timestamp: startTime + 300 });
      tracing.log({ level: "error", category: "agent", event: "agent:error", sessionId: "s1", timestamp: startTime + 400 });
      tracing.log({ level: "info", category: "agent", event: "react:iteration", sessionId: "s1", timestamp: startTime + 500 });
      tracing.flush();

      const summary = await tracing.getSessionSummary("s1");
      expect(summary.sessionId).toBe("s1");
      expect(summary.iterations).toBe(2);   // 2 react:iteration
      expect(summary.toolCalls).toBe(2);     // 2 tool:execute
      expect(summary.compactCount).toBe(1);  // 1 compact:trigger
      expect(summary.errors).toBe(1);        // 1 error level
      expect(summary.durationMs).toBeGreaterThanOrEqual(400);

      tracing.dispose();
    });

    it("TS-08b: getSessionSummary() 正确聚合 tokenUsage（M1）", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const startTime = Date.now();

      // 模拟 logMetrics 产生的 metrics:context 事件
      tracing.logMetrics("s1", {
        iteration: 1,
        toolChain: [{ name: "search", durationMs: 100, success: true }],
        tokenUsage: { total: 128000, used: 50000 },
        compactCount: 0,
      });

      tracing.logMetrics("s1", {
        iteration: 2,
        toolChain: [{ name: "code-exec", durationMs: 200, success: true }],
        tokenUsage: { total: 128000, used: 95000 },
        compactCount: 1,
      });

      tracing.flush();

      const summary = await tracing.getSessionSummary("s1");
      // 应使用最后一个 metrics:context 的 tokenUsage
      expect(summary.tokenUsage.total).toBe(128000);
      expect(summary.tokenUsage.used).toBe(95000);

      tracing.dispose();
    });
  });

  describe("TS-5: logMetrics()", () => {
    it("TS-09: logMetrics() 记录 CM-7 指标", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });

      tracing.logMetrics("s1", {
        iteration: 3,
        toolChain: [
          { name: "search", durationMs: 150, success: true },
          { name: "code-exec", durationMs: 2000, success: false },
        ],
        tokenUsage: { total: 128000, used: 95000 },
        compactCount: 1,
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT * FROM telemetry WHERE event = 'metrics:context'")
        .all() as Array<{ data: string; session_id: string }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.session_id).toBe("s1");

      const data = JSON.parse(rows[0]!.data) as {
        iteration: number;
        toolChain: Array<{ name: string }>;
      };
      expect(data.iteration).toBe(3);
      expect(data.toolChain).toHaveLength(2);

      tracing.dispose();
    });
  });

  describe("TS-4: stderr 实时输出", () => {
    it("TS-11: ERROR/WARN 始终输出 stderr", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const tracing = createTracingService({
        sqlite,
        silentStderr: false,
        debugEnabled: false,
      });

      tracing.log({ level: "error", category: "agent", event: "agent:error", timestamp: Date.now() });
      tracing.log({ level: "warn", category: "context", event: "compact:trigger", timestamp: Date.now() });

      expect(stderrSpy).toHaveBeenCalledTimes(2);
      expect(stderrSpy.mock.calls[0]![0]).toContain("ERROR");
      expect(stderrSpy.mock.calls[0]![0]).toContain("agent:error");
      expect(stderrSpy.mock.calls[1]![0]).toContain("WARN");

      tracing.dispose();
    });

    it("TS-12: INFO 默认不输出 stderr（非 debug 模式）", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const tracing = createTracingService({
        sqlite,
        silentStderr: false,
        debugEnabled: false,
      });

      tracing.log({ level: "info", category: "agent", event: "react:iteration", timestamp: Date.now() });

      expect(stderrSpy).not.toHaveBeenCalled();

      tracing.dispose();
    });

    it("TS-13: INFO 在 debug 模式输出 stderr", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const tracing = createTracingService({
        sqlite,
        silentStderr: false,
        debugEnabled: true,
      });

      tracing.log({ level: "info", category: "agent", event: "react:iteration", timestamp: Date.now() });

      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]![0]).toContain("INFO");

      tracing.dispose();
    });

    it("TS-14: silentStderr 禁用所有 stderr 输出", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const tracing = createTracingService({
        sqlite,
        silentStderr: true,
        debugEnabled: true,
      });

      tracing.log({ level: "error", category: "agent", event: "agent:error", timestamp: Date.now() });
      tracing.log({ level: "warn", category: "context", event: "compact:trigger", timestamp: Date.now() });
      tracing.log({ level: "info", category: "agent", event: "react:iteration", timestamp: Date.now() });

      expect(stderrSpy).not.toHaveBeenCalled();

      tracing.dispose();
    });
  });

  describe("CFG-5: Secret 脱敏", () => {
    it("TS-15: secretValues 在 event data 中被替换为 [REDACTED]", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        silentStderr: true,
        secretValues: ["my-secret-api-key-12345"],
      });

      tracing.log({
        level: "info",
        category: "tool",
        event: "tool:execute",
        data: { apiKey: "my-secret-api-key-12345", toolName: "search" },
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT data FROM telemetry")
        .all() as Array<{ data: string }>;

      expect(rows).toHaveLength(1);
      const parsed = JSON.parse(rows[0]!.data) as { apiKey: string; toolName: string };
      expect(parsed.apiKey).toBe("[REDACTED]");
      expect(parsed.toolName).toBe("search");

      tracing.dispose();
    });

    it("TS-16: 短 secret（<4 字符）不匹配（防误匹配）", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        silentStderr: true,
        secretValues: ["abc"], // 太短，不应脱敏
      });

      tracing.log({
        level: "info",
        category: "tool",
        event: "tool:execute",
        data: { note: "contains abc text" },
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT data FROM telemetry")
        .all() as Array<{ data: string }>;
      const parsed = JSON.parse(rows[0]!.data) as { note: string };
      expect(parsed.note).toBe("contains abc text"); // 不应被替换

      tracing.dispose();
    });

    it("TS-17: 无 data 的事件不受脱敏影响", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        silentStderr: true,
        secretValues: ["my-secret-api-key"],
      });

      tracing.log({
        level: "info",
        category: "agent",
        event: "react:iteration",
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT * FROM telemetry")
        .all() as Array<{ data: string | null }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toBeNull();

      tracing.dispose();
    });
  });

  describe("Lifecycle", () => {
    it("TS-10: dispose() flush 剩余缓冲 + 停止定时器", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({
        sqlite,
        flushIntervalMs: 60000, // 很长，不会自动触发
        silentStderr: true,
      });

      tracing.log({
        level: "info",
        category: "agent",
        event: "final-event",
        timestamp: Date.now(),
      });

      // dispose 应该 flush 剩余缓冲
      tracing.dispose();

      const rows = sqlite
        .prepare("SELECT * FROM telemetry WHERE event = 'final-event'")
        .all() as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
    });
  });

  describe("TS-6: Outcome + Aggregate", () => {
    it("TS-20: log() 带 outcome 字段持久化到 SQLite outcome 列", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });

      tracing.log({
        level: "info",
        category: "scheduler",
        event: "scheduler:task_end",
        data: { taskId: "task-1" },
        outcome: { success: true, durationMs: 150 },
        timestamp: Date.now(),
      });

      tracing.flush();

      const rows = sqlite
        .prepare("SELECT outcome FROM telemetry WHERE event = 'scheduler:task_end'")
        .all() as Array<{ outcome: string | null }>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.outcome).not.toBeNull();

      const outcome = JSON.parse(rows[0]!.outcome!) as { success: boolean; durationMs: number };
      expect(outcome.success).toBe(true);
      expect(outcome.durationMs).toBe(150);

      tracing.dispose();
    });

    it("TS-21: query() 返回的 TraceEvent 包含 outcome", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });

      tracing.log({
        level: "info",
        category: "tool",
        event: "tool:execute",
        outcome: { success: false, durationMs: 500, errorMessage: "timeout" },
        timestamp: Date.now(),
      });

      tracing.flush();

      const events = await tracing.query({ category: "tool" });
      expect(events).toHaveLength(1);
      expect(events[0]!.outcome).toBeDefined();
      expect(events[0]!.outcome!.success).toBe(false);
      expect(events[0]!.outcome!.durationMs).toBe(500);
      expect(events[0]!.outcome!.errorMessage).toBe("timeout");

      tracing.dispose();
    });

    it("TS-22: aggregate('skill-classification', '7d') — 计算 accuracy", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const now = Date.now();

      // 3 次分类，2 次成功
      tracing.log({ level: "info", category: "agent", event: "skill:classify", outcome: { success: true }, timestamp: now });
      tracing.log({ level: "info", category: "agent", event: "skill:classify", outcome: { success: true }, timestamp: now + 1 });
      tracing.log({ level: "info", category: "agent", event: "skill:classify", outcome: { success: false }, timestamp: now + 2 });
      tracing.flush();

      const report = await tracing.aggregate("skill-classification", "7d");
      expect(report.dimension).toBe("skill-classification");
      expect(report.period).toBe("7d");
      expect(report.sampleCount).toBe(3);
      expect(report.metrics.accuracy).toBeCloseTo(2 / 3);

      tracing.dispose();
    });

    it("TS-23: aggregate('routine-effectiveness', '7d') — 计算 successRate + avgDurationMs", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const now = Date.now();

      tracing.log({ level: "info", category: "scheduler", event: "scheduler:task_end", outcome: { success: true, durationMs: 100 }, timestamp: now });
      tracing.log({ level: "info", category: "scheduler", event: "scheduler:task_end", outcome: { success: true, durationMs: 200 }, timestamp: now + 1 });
      tracing.log({ level: "warn", category: "scheduler", event: "scheduler:task_end", outcome: { success: false, durationMs: 30000 }, timestamp: now + 2 });
      tracing.flush();

      const report = await tracing.aggregate("routine-effectiveness", "7d");
      expect(report.sampleCount).toBe(3);
      expect(report.metrics.successRate).toBeCloseTo(2 / 3);
      expect(report.metrics.avgDurationMs).toBeCloseTo((100 + 200 + 30000) / 3);

      tracing.dispose();
    });

    it("TS-24: aggregate('tool-reliability', '7d') — 计算 successRate + avgDurationMs", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const now = Date.now();

      tracing.log({ level: "info", category: "tool", event: "tool:execute", outcome: { success: true, durationMs: 50 }, timestamp: now });
      tracing.log({ level: "info", category: "tool", event: "tool:execute", outcome: { success: true, durationMs: 75 }, timestamp: now + 1 });
      tracing.flush();

      const report = await tracing.aggregate("tool-reliability", "7d");
      expect(report.sampleCount).toBe(2);
      expect(report.metrics.successRate).toBe(1);
      expect(report.metrics.avgDurationMs).toBe(62.5);

      tracing.dispose();
    });

    it("TS-25: aggregate() 空数据返回 sampleCount: 0", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });

      const report = await tracing.aggregate("sub-agent-quality", "7d");
      expect(report.sampleCount).toBe(0);
      expect(report.metrics).toEqual({});

      tracing.dispose();
    });

    it("TS-26: aggregate() 时间段过滤 — 只包含 period 内事件", async () => {
      const { createTracingService } = await import(
        "@/platform/tracing-service"
      );

      const tracing = createTracingService({ sqlite, silentStderr: true });
      const now = Date.now();
      const twoDaysAgo = now - 2 * 86_400_000;
      const eightDaysAgo = now - 8 * 86_400_000;

      // 8 天前的事件 — 应被 7d 过滤排除
      tracing.log({ level: "info", category: "tool", event: "tool:execute", outcome: { success: false, durationMs: 999 }, timestamp: eightDaysAgo });
      // 2 天前的事件 — 应包含在 7d 内
      tracing.log({ level: "info", category: "tool", event: "tool:execute", outcome: { success: true, durationMs: 100 }, timestamp: twoDaysAgo });
      tracing.flush();

      const report = await tracing.aggregate("tool-reliability", "7d");
      expect(report.sampleCount).toBe(1);
      expect(report.metrics.successRate).toBe(1);
      expect(report.metrics.avgDurationMs).toBe(100);

      tracing.dispose();
    });

    it("TS-27: migrateTelemetryOutcomeColumn — 幂等添加 outcome 列", async () => {
      const { migrateTelemetryOutcomeColumn } = await import(
        "@/platform/tracing-service"
      );

      // 第一次调用 — outcome 列已存在（TELEMETRY_SCHEMA 已包含），不应报错
      expect(() => migrateTelemetryOutcomeColumn(sqlite)).not.toThrow();

      // 再次调用 — 幂等，不应报错
      expect(() => migrateTelemetryOutcomeColumn(sqlite)).not.toThrow();

      // 验证 outcome 列存在
      const columns = sqlite.pragma("table_info(telemetry)") as Array<{ name: string }>;
      expect(columns.some((c) => c.name === "outcome")).toBe(true);
    });

    it("TS-28: migrateTelemetryOutcomeColumn — 旧 schema 无 outcome 列时添加", async () => {
      const { migrateTelemetryOutcomeColumn } = await import(
        "@/platform/tracing-service"
      );

      // 创建一个无 outcome 列的旧 schema 表
      const BetterSqlite3 = (await import("better-sqlite3")).default;
      const oldDb = new BetterSqlite3(":memory:");
      oldDb.exec(`
        CREATE TABLE telemetry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL,
          category TEXT NOT NULL,
          event TEXT NOT NULL,
          session_id TEXT,
          span_id TEXT,
          parent_id TEXT,
          data TEXT,
          timestamp INTEGER NOT NULL
        )
      `);

      // 调用 migration
      migrateTelemetryOutcomeColumn(oldDb);

      // 验证 outcome 列被添加
      const columns = oldDb.pragma("table_info(telemetry)") as Array<{ name: string }>;
      expect(columns.some((c) => c.name === "outcome")).toBe(true);

      // 验证 event+timestamp 索引存在
      const indexes = oldDb.pragma("index_list(telemetry)") as Array<{ name: string }>;
      expect(indexes.some((i) => i.name === "idx_telemetry_event_ts")).toBe(true);

      oldDb.close();
    });
  });
});
