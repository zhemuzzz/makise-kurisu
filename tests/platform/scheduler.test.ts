/**
 * Scheduler 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * SC-1: 任务类型 (Interval / Cron / Event-Triggered)
 * SC-2: 核心接口
 * SC-3: Heartbeat 主动消息（由 RoutineSystem 驱动，Scheduler 只负责触发）
 * SC-4: EventBus 集成
 * SC-5: 错误处理 + 执行追踪（TracingService）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import BetterSqlite3 from "better-sqlite3";

/** 等待一小段时间让异步队列处理 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Scheduler", () => {
  let tempDir: string;
  let sqlite: InstanceType<typeof BetterSqlite3>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-scheduler-test-"));
    const dbDir = join(tempDir, "platform");
    mkdirSync(dbDir, { recursive: true });

    const { TELEMETRY_SCHEMA } = await import("@/platform/tracing-service");
    sqlite = new BetterSqlite3(join(dbDir, "tracing.sqlite"));
    sqlite.pragma("journal_mode = WAL");
    sqlite.exec(TELEMETRY_SCHEMA);
    // TS-6 outcome 列（新 schema 已包含，但 migration 确保兼容）
    const columns = sqlite.pragma("table_info(telemetry)") as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "outcome")) {
      sqlite.exec("ALTER TABLE telemetry ADD COLUMN outcome TEXT");
    }
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("SC-1: Interval Tasks", () => {
    it("SC-01: registerInterval — handler 周期执行", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      scheduler.registerInterval({
        id: "test-interval",
        name: "Test Interval",
        intervalMs: 50,
        handler,
      });

      await delay(160);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it("SC-02: registerInterval runOnStart: true — 立即执行", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      scheduler.registerInterval({
        id: "test-run-on-start",
        name: "Run On Start",
        intervalMs: 10000, // 很长间隔，不会自然触发
        handler,
        runOnStart: true,
      });

      // 等串行队列处理
      await delay(50);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("SC-1: Cron Tasks", () => {
    it("SC-03: registerCron — croner 注册 + 触发", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      // 每秒执行一次
      scheduler.registerCron({
        id: "test-cron",
        name: "Test Cron",
        cron: "* * * * * *",
        handler,
      });

      await delay(1500);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("SC-1: Event-Triggered Tasks", () => {
    it("SC-04: registerEventTask — EventBus 事件触发执行", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      scheduler.registerEventTask({
        id: "test-event",
        name: "Test Event",
        event: "session:end",
        handler,
      });

      eventBus.emit("session:end", { sessionId: "sess-1" });
      await delay(50);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith({ sessionId: "sess-1" });
    });

    it("SC-05: registerEventTask delayMs — 延迟后执行", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      scheduler.registerEventTask({
        id: "test-delayed-event",
        name: "Delayed Event",
        event: "reply:sent",
        delayMs: 100,
        handler,
      });

      eventBus.emit("reply:sent", { content: "hello" });

      // 立即检查 — 不应该被调用
      await delay(30);
      expect(handler).not.toHaveBeenCalled();

      // 等 delay 过去
      await delay(120);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("SC-2: Task Lifecycle", () => {
    it("SC-06: cancel(taskId) — 停止执行", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      scheduler.registerInterval({
        id: "cancel-me",
        name: "Cancel Me",
        intervalMs: 30,
        handler,
      });

      await delay(80);
      const callsBefore = handler.mock.calls.length;
      expect(callsBefore).toBeGreaterThanOrEqual(1);

      scheduler.cancel("cancel-me");
      handler.mockClear();

      await delay(100);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler).not.toHaveBeenCalled();
    });

    it("SC-07: pause/resume — 暂停期间跳过，恢复后继续", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});
      scheduler.registerInterval({
        id: "pause-test",
        name: "Pause Test",
        intervalMs: 30,
        handler,
      });

      await delay(80);
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);

      scheduler.pause("pause-test");
      handler.mockClear();

      await delay(100);
      expect(handler).not.toHaveBeenCalled();

      scheduler.resume("pause-test");
      await delay(80);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it("SC-08: getStatus() — 返回所有任务及状态", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      scheduler.registerInterval({
        id: "int-1",
        name: "Interval One",
        intervalMs: 10000,
        handler: async () => {},
      });
      scheduler.registerCron({
        id: "cron-1",
        name: "Cron One",
        cron: "0 6 * * *",
        handler: async () => {},
      });
      scheduler.registerEventTask({
        id: "evt-1",
        name: "Event One",
        event: "session:end",
        handler: async () => {},
      });

      const status = scheduler.getStatus();
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      expect(status.tasks).toHaveLength(3);
      expect(status.tasks.map((t) => t.id).sort()).toEqual(["cron-1", "evt-1", "int-1"]);
      expect(status.tasks.every((t) => t.state === "active")).toBe(true);
    });
  });

  describe("SC-5: Execution Behavior", () => {
    it("SC-09: 串行执行 — 两个任务不重叠", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const timestamps: Array<{ task: string; phase: string; time: number }> = [];

      scheduler.registerInterval({
        id: "slow-task",
        name: "Slow Task",
        intervalMs: 10000,
        runOnStart: true,
        handler: async () => {
          timestamps.push({ task: "slow", phase: "start", time: Date.now() });
          await delay(80);
          timestamps.push({ task: "slow", phase: "end", time: Date.now() });
        },
      });

      scheduler.registerInterval({
        id: "fast-task",
        name: "Fast Task",
        intervalMs: 10000,
        runOnStart: true,
        handler: async () => {
          timestamps.push({ task: "fast", phase: "start", time: Date.now() });
          timestamps.push({ task: "fast", phase: "end", time: Date.now() });
        },
      });

      await delay(200);
      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();

      // slow 应该先完成，然后 fast 才开始
      const slowEnd = timestamps.find((t) => t.task === "slow" && t.phase === "end");
      const fastStart = timestamps.find((t) => t.task === "fast" && t.phase === "start");
      expect(slowEnd).toBeDefined();
      expect(fastStart).toBeDefined();
      expect(fastStart!.time).toBeGreaterThanOrEqual(slowEnd!.time);
    });

    it("SC-10: 硬超时 — 超时任务被终止 + TracingService 记录失败", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      // 极短超时以便测试
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 100 });

      scheduler.registerInterval({
        id: "timeout-task",
        name: "Timeout Task",
        intervalMs: 10000,
        runOnStart: true,
        handler: async () => {
          // 远超超时
          await delay(5000);
        },
      });

      await delay(300);
      scheduler.dispose();
      tracing.flush();
      tracing.dispose();

      // 检查 TracingService 记录了失败
      const rows = sqlite
        .prepare(
          "SELECT event, data, outcome FROM telemetry WHERE event = 'scheduler:task_end'",
        )
        .all() as Array<{ event: string; data: string | null; outcome: string | null }>;

      expect(rows.length).toBeGreaterThanOrEqual(1);
      // outcome 列应包含 success: false
      const outcomeRow = rows.find((r) => r.outcome);
      expect(outcomeRow).toBeDefined();
      const outcome = JSON.parse(outcomeRow!.outcome!) as { success: boolean };
      expect(outcome.success).toBe(false);
    });

    it("SC-11: TracingService 集成 — scheduler:task_start/task_end 事件写入", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      scheduler.registerInterval({
        id: "traced-task",
        name: "Traced Task",
        intervalMs: 10000,
        runOnStart: true,
        handler: async () => {},
      });

      await delay(100);
      scheduler.dispose();
      tracing.flush();
      tracing.dispose();

      const starts = sqlite
        .prepare("SELECT * FROM telemetry WHERE event = 'scheduler:task_start'")
        .all() as Array<Record<string, unknown>>;
      const ends = sqlite
        .prepare("SELECT * FROM telemetry WHERE event = 'scheduler:task_end'")
        .all() as Array<Record<string, unknown>>;

      expect(starts.length).toBeGreaterThanOrEqual(1);
      expect(ends.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("SC-2: Lifecycle", () => {
    it("SC-12: dispose() — 停止所有任务，清理所有 timer", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      const handler = vi.fn(async () => {});

      scheduler.registerInterval({
        id: "dispose-int",
        name: "Dispose Interval",
        intervalMs: 30,
        handler,
      });
      scheduler.registerEventTask({
        id: "dispose-evt",
        name: "Dispose Event",
        event: "session:end",
        handler,
      });

      scheduler.dispose();
      handler.mockClear();

      // dispose 后不应再执行
      eventBus.emit("session:end", {});
      await delay(100);

      tracing.dispose();
      eventBus.dispose();

      expect(handler).not.toHaveBeenCalled();
      expect(scheduler.getStatus().tasks).toHaveLength(0);
    });

    it("SC-13: 重复 task ID — 抛异常", async () => {
      const { createEventBus } = await import("@/platform/event-bus");
      const { createTracingService } = await import("@/platform/tracing-service");
      const { createScheduler } = await import("@/platform/scheduler");

      const eventBus = createEventBus();
      const tracing = createTracingService({ sqlite, silentStderr: true });
      const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });

      scheduler.registerInterval({
        id: "dup-id",
        name: "First",
        intervalMs: 10000,
        handler: async () => {},
      });

      expect(() =>
        scheduler.registerInterval({
          id: "dup-id",
          name: "Second",
          intervalMs: 10000,
          handler: async () => {},
        }),
      ).toThrow(/already registered/);

      scheduler.dispose();
      tracing.dispose();
      eventBus.dispose();
    });
  });
});
