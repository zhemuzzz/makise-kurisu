/**
 * Scheduler 统一调度服务
 * 位置: src/platform/scheduler.ts
 *
 * SC-1: 任务类型 (Interval / Cron / Event-Triggered)
 * SC-2: 核心接口 (register + cancel + pause/resume + getStatus)
 * SC-5: 错误处理 + 执行追踪（TracingService outcome 事件）
 *
 * 核心原则: Scheduler 只负责触发，不负责业务逻辑。业务由各 Service 自行处理。
 * 所有任务串行执行（个人助手场景无需并发），30s 硬超时。
 */

import { Cron } from "croner";
import type { EventBus } from "./event-bus.js";
import type { TracingService } from "./tracing-service.js";

// ============ 类型 ============

export interface IntervalTask {
  readonly id: string;
  readonly name: string;
  readonly intervalMs: number;
  readonly handler: () => Promise<void>;
  readonly runOnStart?: boolean;
}

export interface CronTask {
  readonly id: string;
  readonly name: string;
  readonly cron: string;
  readonly handler: () => Promise<void>;
}

export interface EventTask {
  readonly id: string;
  readonly name: string;
  readonly event: string;
  readonly delayMs?: number;
  readonly handler: (payload: unknown) => Promise<void>;
}

export type TaskState = "active" | "paused" | "cancelled";

export interface TaskStatus {
  readonly id: string;
  readonly name: string;
  readonly type: "interval" | "cron" | "event";
  readonly state: TaskState;
}

export interface SchedulerStatus {
  readonly tasks: readonly TaskStatus[];
}

export interface Scheduler {
  registerInterval(task: IntervalTask): string;
  registerCron(task: CronTask): string;
  registerEventTask(task: EventTask): string;
  cancel(taskId: string): void;
  pause(taskId: string): void;
  resume(taskId: string): void;
  getStatus(): SchedulerStatus;
  dispose(): void;
}

export interface SchedulerConfig {
  readonly eventBus: EventBus;
  readonly tracing: TracingService;
  readonly taskTimeoutMs?: number;
}

// ============ 内部类型 ============

interface QueueItem {
  readonly taskId: string;
  readonly args: readonly unknown[];
}

/** Internal state — `state` and `stop` are intentionally mutable for lifecycle management */
interface TaskEntry {
  readonly id: string;
  readonly name: string;
  readonly type: "interval" | "cron" | "event";
  state: TaskState;
  readonly handler: (...args: readonly unknown[]) => Promise<void>;
  stop: () => void;
  /** 原始配置，用于 resume 时重建 */
  readonly originalTask: IntervalTask | CronTask | EventTask;
}

// ============ 实现 ============

class SchedulerImpl implements Scheduler {
  private readonly eventBus: EventBus;
  private readonly tracing: TracingService;
  private readonly taskTimeoutMs: number;
  private readonly tasks = new Map<string, TaskEntry>();
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private disposed = false;

  constructor(config: SchedulerConfig) {
    this.eventBus = config.eventBus;
    this.tracing = config.tracing;
    this.taskTimeoutMs = config.taskTimeoutMs ?? 30000;
  }

  registerInterval(task: IntervalTask): string {
    this.ensureNotDuplicate(task.id);

    const timerId = setInterval(() => {
      this.enqueue(task.id);
    }, task.intervalMs);
    if (timerId.unref) {
      timerId.unref();
    }

    const entry: TaskEntry = {
      id: task.id,
      name: task.name,
      type: "interval",
      state: "active",
      handler: task.handler,
      stop: () => clearInterval(timerId),
      originalTask: task,
    };
    this.tasks.set(task.id, entry);

    if (task.runOnStart) {
      this.enqueue(task.id);
    }

    return task.id;
  }

  registerCron(task: CronTask): string {
    this.ensureNotDuplicate(task.id);

    const job = new Cron(task.cron, { unref: true, paused: false }, () => {
      this.enqueue(task.id);
    });

    const entry: TaskEntry = {
      id: task.id,
      name: task.name,
      type: "cron",
      state: "active",
      handler: task.handler,
      stop: () => job.stop(),
      originalTask: task,
    };
    this.tasks.set(task.id, entry);

    return task.id;
  }

  registerEventTask(task: EventTask): string {
    this.ensureNotDuplicate(task.id);

    const delayMs = task.delayMs ?? 0;
    const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

    const eventHandler = (payload: unknown): void => {
      if (delayMs > 0) {
        const timeoutId = setTimeout(() => {
          pendingTimeouts.delete(timeoutId);
          this.enqueue(task.id, payload);
        }, delayMs);
        if (timeoutId.unref) {
          timeoutId.unref();
        }
        pendingTimeouts.add(timeoutId);
      } else {
        this.enqueue(task.id, payload);
      }
    };

    this.eventBus.on(task.event, eventHandler);

    const entry: TaskEntry = {
      id: task.id,
      name: task.name,
      type: "event",
      state: "active",
      handler: task.handler,
      stop: () => {
        this.eventBus.off(task.event, eventHandler);
        for (const t of pendingTimeouts) {
          clearTimeout(t);
        }
        pendingTimeouts.clear();
      },
      originalTask: task,
    };
    this.tasks.set(task.id, entry);

    return task.id;
  }

  cancel(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;

    entry.stop();
    entry.state = "cancelled";
    this.tasks.delete(taskId);
  }

  pause(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry || entry.state !== "active") return;

    entry.stop();
    entry.state = "paused";
  }

  resume(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry || entry.state !== "paused") return;

    // 重建 timer/cron/listener
    const newStop = this.recreateTaskTrigger(entry);
    entry.stop = newStop;
    entry.state = "active";
  }

  getStatus(): SchedulerStatus {
    const tasks: TaskStatus[] = [];
    for (const entry of this.tasks.values()) {
      tasks.push({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        state: entry.state,
      });
    }
    return { tasks };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.tasks.values()) {
      entry.stop();
    }
    this.tasks.clear();
    this.queue.length = 0;
  }

  // ============ Private ============

  private ensureNotDuplicate(taskId: string): void {
    if (this.tasks.has(taskId)) {
      throw new Error(`Task ${taskId} already registered`);
    }
  }

  private enqueue(taskId: string, ...args: readonly unknown[]): void {
    if (this.disposed) return;
    this.queue.push({ taskId, args });
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0 && !this.disposed) {
        const item = this.queue.shift()!;
        const entry = this.tasks.get(item.taskId);
        if (!entry || entry.state !== "active") continue;
        await this.executeWithTimeout(entry, item.args);
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeWithTimeout(
    entry: TaskEntry,
    args: readonly unknown[],
  ): Promise<void> {
    this.tracing.log({
      level: "info",
      category: "scheduler",
      event: "scheduler:task_start",
      data: { taskId: entry.id, taskName: entry.name, type: entry.type },
      timestamp: Date.now(),
    });

    const startTime = Date.now();
    let success = true;
    let errorMessage: string | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        entry.handler(...args),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`Task timeout after ${this.taskTimeoutMs}ms`));
          }, this.taskTimeoutMs);
          if (timeoutId.unref) {
            timeoutId.unref();
          }
        }),
      ]);
    } catch (err) {
      success = false;
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    const durationMs = Date.now() - startTime;
    const outcome = success
      ? { success: true as const, durationMs }
      : {
          success: false as const,
          durationMs,
          ...(errorMessage ? { errorMessage } : {}),
        };
    this.tracing.log({
      level: success ? "info" : "warn",
      category: "scheduler",
      event: "scheduler:task_end",
      data: { taskId: entry.id, taskName: entry.name },
      outcome,
      timestamp: Date.now(),
    });
  }

  private recreateTaskTrigger(entry: TaskEntry): () => void {
    switch (entry.type) {
      case "interval": {
        const task = entry.originalTask as IntervalTask;
        const timerId = setInterval(() => {
          this.enqueue(entry.id);
        }, task.intervalMs);
        if (timerId.unref) {
          timerId.unref();
        }
        return () => clearInterval(timerId);
      }
      case "cron": {
        const task = entry.originalTask as CronTask;
        const job = new Cron(task.cron, { unref: true, paused: false }, () => {
          this.enqueue(entry.id);
        });
        return () => job.stop();
      }
      case "event": {
        const task = entry.originalTask as EventTask;
        const delayMs = task.delayMs ?? 0;
        const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

        const eventHandler = (payload: unknown): void => {
          if (delayMs > 0) {
            const timeoutId = setTimeout(() => {
              pendingTimeouts.delete(timeoutId);
              this.enqueue(entry.id, payload);
            }, delayMs);
            if (timeoutId.unref) {
              timeoutId.unref();
            }
            pendingTimeouts.add(timeoutId);
          } else {
            this.enqueue(entry.id, payload);
          }
        };

        this.eventBus.on(task.event, eventHandler);
        return () => {
          this.eventBus.off(task.event, eventHandler);
          for (const t of pendingTimeouts) {
            clearTimeout(t);
          }
          pendingTimeouts.clear();
        };
      }
    }
  }
}

// ============ 工厂函数 ============

export function createScheduler(config: SchedulerConfig): Scheduler {
  return new SchedulerImpl(config);
}
