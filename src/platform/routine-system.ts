/**
 * RoutineSystem 日常任务系统
 * 位置: src/platform/routine-system.ts
 *
 * RT-1: 四源模型 (system / persona / user / self)
 * RT-2: RoutineRegistry YAML 数据模型 + pre_check 机制
 * RT-3: CRUD (add / update / remove / getAll / findByName)
 * RT-4: 渐进启用（三层过滤: config.enabled → enabledSources → entry.enabled）
 * RT-B: 会话优先 + 重复触发跳过
 * RT-C: 容量限制 + 过期清理
 *
 * 核心定位: 角色的日程表——定义角色在无对话时的自主行为。
 * RoutineSystem 定义做什么，Scheduler 负责什么时候做，Agent 后台模式负责怎么做。
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { EventBus } from "./event-bus.js";
import type { Scheduler } from "./scheduler.js";
import type { TracingService } from "./tracing-service.js";
import type {
  RoutineConfig,
  RoutinePermissionLevel,
  RoutineSource,
} from "./types/config.js";

// ============ 类型 ============

export interface RoutineEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly trigger: string;
  readonly delay?: number;
  readonly source: RoutineSource;
  readonly skills: readonly string[];
  readonly permissionLevel: RoutinePermissionLevel;
  readonly notifyUser: boolean;
  readonly addedBy?: string;
  readonly expires?: string;
  readonly preCheck?: string;
}

export interface AddRoutineOptions {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly enabled?: boolean;
  readonly trigger: string;
  readonly delay?: number;
  readonly source: RoutineSource;
  readonly skills?: readonly string[];
  readonly permissionLevel?: RoutinePermissionLevel;
  readonly notifyUser?: boolean;
  readonly addedBy?: string;
  readonly expires?: string;
  readonly preCheck?: string;
}

export type RoutineUpdatePatch = Partial<Omit<RoutineEntry, "id" | "source">>;

export type PreCheckFn = () => Promise<boolean>;
export type RoutineTaskHandler = (routine: RoutineEntry) => Promise<void>;

export interface RoutineSystem {
  getAll(): readonly RoutineEntry[];
  getById(id: string): RoutineEntry | undefined;
  findByName(name: string): readonly RoutineEntry[];
  add(options: AddRoutineOptions): RoutineEntry;
  update(id: string, patch: RoutineUpdatePatch): RoutineEntry;
  remove(id: string): boolean;
  syncToScheduler(): void;
  registerPreCheck(key: string, fn: PreCheckFn): void;
  setTaskHandler(handler: RoutineTaskHandler): void;
  setInSession(inSession: boolean): void;
  cleanExpired(): number;
  dispose(): void;
}

export interface RoutineSystemConfig {
  readonly scheduler: Scheduler;
  readonly tracing: TracingService;
  readonly eventBus: EventBus;
  readonly routineConfig: RoutineConfig;
  readonly yamlPath: string;
}

// ============ 系统内置 routine ============

const VALID_SOURCES: ReadonlySet<string> = new Set([
  "system",
  "persona",
  "user",
  "self",
]);

const VALID_PERMISSION_LEVELS: ReadonlySet<string> = new Set([
  "low",
  "confirm",
  "high",
]);

const SOURCE_ID_PREFIX: Readonly<Record<string, string>> = {
  user: "usr",
  persona: "per",
  self: "self",
};

const SYSTEM_ROUTINES: readonly AddRoutineOptions[] = [
  {
    id: "session-reflect",
    name: "对话反思",
    description: "反思本次对话，提取值得学习的内容",
    enabled: true,
    trigger: "event:session:end",
    delay: 5000,
    source: "system",
    skills: [],
  },
  {
    id: "heartbeat-check",
    name: "主动联系检查",
    description: "检查是否应该主动联系某个用户",
    enabled: false,
    trigger: "interval:3600000",
    source: "system",
    notifyUser: true,
    preCheck: "ile:shouldHeartbeat",
  },
  {
    id: "daily-learning",
    name: "每日学习",
    description: "学习兴趣领域的最新研究",
    enabled: false,
    trigger: "cron:0 6 * * *",
    source: "system",
    skills: ["web-search"],
  },
  {
    id: "knowledge-consolidation",
    name: "知识整理",
    description: "整理知识库：合并重复、归档低效、淘汰过时条目",
    enabled: false,
    trigger: "cron:0 3 * * 0",
    source: "system",
    preCheck: "ks:shouldConsolidate",
  },
  {
    id: "time-tick",
    name: "时间感知",
    description: "定期触发心境衰减、关系衰减和主动行为判定",
    enabled: true,
    trigger: "interval:1800000",
    source: "system",
    preCheck: "ile:shouldTick",
  },
];

// ============ YAML snake_case ↔ camelCase ============

interface YamlRoutineRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled?: boolean;
  readonly trigger: string;
  readonly delay?: number;
  readonly source: string;
  readonly skills?: readonly string[];
  readonly permission_level?: string;
  readonly notify_user?: boolean;
  readonly added_by?: string;
  readonly expires?: string;
  readonly pre_check?: string;
}

function yamlToEntry(
  raw: YamlRoutineRecord,
  defaultPermission: RoutinePermissionLevel,
): RoutineEntry {
  if (!VALID_SOURCES.has(raw.source)) {
    throw new Error(`Invalid routine source in YAML: "${raw.source}" (id: ${raw.id})`);
  }

  const permLevel = raw.permission_level as RoutinePermissionLevel | undefined;
  if (permLevel !== undefined && !VALID_PERMISSION_LEVELS.has(permLevel)) {
    throw new Error(`Invalid routine permission_level in YAML: "${permLevel}" (id: ${raw.id})`);
  }

  const base = {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    enabled: raw.enabled !== false,
    trigger: raw.trigger,
    source: raw.source as RoutineSource,
    skills: raw.skills ?? [],
    permissionLevel: permLevel ?? defaultPermission,
    notifyUser: raw.notify_user ?? false,
  };

  // exactOptionalPropertyTypes: Record 中间层 + as 断言（同 buildEntry 模式）
  const parts: Record<string, unknown> = {};
  if (raw.delay !== undefined) parts["delay"] = raw.delay;
  if (raw.added_by !== undefined) parts["addedBy"] = raw.added_by;
  if (raw.expires !== undefined) parts["expires"] = raw.expires;
  if (raw.pre_check !== undefined) parts["preCheck"] = raw.pre_check;

  return { ...base, ...parts } as RoutineEntry;
}

function entryToYaml(entry: RoutineEntry): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    enabled: entry.enabled,
    trigger: entry.trigger,
    source: entry.source,
  };

  if (entry.delay !== undefined) result["delay"] = entry.delay;
  if (entry.skills.length > 0) result["skills"] = [...entry.skills];
  if (entry.permissionLevel !== "confirm") result["permission_level"] = entry.permissionLevel;
  if (entry.notifyUser) result["notify_user"] = entry.notifyUser;
  if (entry.addedBy !== undefined) result["added_by"] = entry.addedBy;
  if (entry.expires !== undefined) result["expires"] = entry.expires;
  if (entry.preCheck !== undefined) result["pre_check"] = entry.preCheck;

  return result;
}

// ============ 实现 ============

class RoutineSystemImpl implements RoutineSystem {
  private readonly config: RoutineConfig;
  private readonly scheduler: Scheduler;
  private readonly tracing: TracingService;
  private readonly yamlPath: string;

  private routines: Map<string, RoutineEntry> = new Map();
  private preChecks: Map<string, PreCheckFn> = new Map();
  private taskHandler: RoutineTaskHandler | null = null;
  private inSession = false;
  private synced = false;
  private registeredTaskIds: Set<string> = new Set();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(cfg: RoutineSystemConfig) {
    this.config = cfg.routineConfig;
    this.scheduler = cfg.scheduler;
    this.tracing = cfg.tracing;
    this.yamlPath = cfg.yamlPath;

    this.loadFromYaml();
    this.mergeSystemRoutines();
  }

  // ============ 加载 ============

  private loadFromYaml(): void {
    try {
      const content = readFileSync(this.yamlPath, "utf-8");
      const parsed = yamlParse(content) as { routines?: readonly YamlRoutineRecord[] } | null;
      if (parsed?.routines) {
        for (const raw of parsed.routines) {
          const entry = yamlToEntry(raw, this.config.defaultPermissionLevel);
          this.routines.set(entry.id, entry);
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.tracing.log({
          level: "warn",
          category: "scheduler",
          event: "routine:yaml-load-error",
          data: { error: String(err) },
          timestamp: Date.now(),
        });
      }
      // ENOENT: 静默，空 Map
    }
  }

  private mergeSystemRoutines(): void {
    for (const sysOpt of SYSTEM_ROUTINES) {
      if (!this.routines.has(sysOpt.id!)) {
        this.routines.set(sysOpt.id!, this.buildEntry(sysOpt));
      }
    }
  }

  // ============ 公共接口 ============

  getAll(): readonly RoutineEntry[] {
    return [...this.routines.values()];
  }

  getById(id: string): RoutineEntry | undefined {
    return this.routines.get(id);
  }

  findByName(name: string): readonly RoutineEntry[] {
    const results: RoutineEntry[] = [];
    for (const entry of this.routines.values()) {
      if (entry.name === name) {
        results.push(entry);
      }
    }
    return results;
  }

  add(options: AddRoutineOptions): RoutineEntry {
    // 验证 source
    if (!VALID_SOURCES.has(options.source)) {
      throw new Error(`Invalid routine source: ${options.source}`);
    }

    // 容量检查
    if (this.routines.size >= this.config.maxRoutinesPerRole) {
      throw new Error(
        `Routine capacity limit reached (${this.config.maxRoutinesPerRole}). ` +
          "Remove unused routines before adding new ones.",
      );
    }

    // 生成或校验 ID
    const id = options.id ?? this.generateId(options.source);
    if (this.routines.has(id)) {
      throw new Error(`Routine ID already exists: ${id}`);
    }

    const entry = this.buildEntry({ ...options, id });
    this.routines.set(id, entry);
    this.persistToYaml();

    // 如果已 sync，自动注册到 Scheduler
    if (this.synced && this.isRoutineActive(entry)) {
      this.registerToScheduler(entry);
    }

    this.tracing.log({
      level: "info",
      category: "scheduler",
      event: "routine:added",
      data: { id, name: entry.name, source: entry.source },
      timestamp: Date.now(),
    });

    return entry;
  }

  update(id: string, patch: RoutineUpdatePatch): RoutineEntry {
    const existing = this.routines.get(id);
    if (!existing) {
      throw new Error(`Routine not found: ${id}`);
    }

    const updated = this.applyPatch(existing, patch);
    this.routines.set(id, updated);
    this.persistToYaml();

    // 重新同步该任务到 Scheduler
    if (this.synced) {
      this.cancelFromScheduler(id);
      if (this.isRoutineActive(updated)) {
        this.registerToScheduler(updated);
      }
    }

    return updated;
  }

  remove(id: string): boolean {
    const existing = this.routines.get(id);
    if (!existing) {
      return false;
    }

    if (existing.source === "system") {
      throw new Error(`Cannot remove system routine: ${id}`);
    }

    this.routines.delete(id);
    this.cancelFromScheduler(id);
    this.persistToYaml();

    this.tracing.log({
      level: "info",
      category: "scheduler",
      event: "routine:removed",
      data: { id, name: existing.name },
      timestamp: Date.now(),
    });

    return true;
  }

  syncToScheduler(): void {
    // 取消所有已注册的任务
    for (const taskId of this.registeredTaskIds) {
      try {
        this.scheduler.cancel(taskId);
      } catch {
        // 任务可能已不存在
      }
    }
    this.registeredTaskIds.clear();

    // 清理过期
    this.cleanExpired();

    // 注册所有 active routine
    for (const entry of this.routines.values()) {
      if (this.isRoutineActive(entry)) {
        this.registerToScheduler(entry);
      }
    }

    // 启动清理定时器
    this.startCleanupTimer();

    this.synced = true;
  }

  registerPreCheck(key: string, fn: PreCheckFn): void {
    this.preChecks.set(key, fn);
  }

  setTaskHandler(handler: RoutineTaskHandler): void {
    this.taskHandler = handler;
  }

  setInSession(inSession: boolean): void {
    this.inSession = inSession;
  }

  cleanExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    const toRemove: string[] = [];
    for (const entry of this.routines.values()) {
      if (
        entry.source !== "system" &&
        entry.expires !== undefined &&
        new Date(entry.expires).getTime() < now
      ) {
        toRemove.push(entry.id);
      }
    }

    for (const id of toRemove) {
      this.routines.delete(id);
      this.cancelFromScheduler(id);
      cleaned++;
    }

    if (cleaned > 0) {
      this.persistToYaml();
      this.tracing.log({
        level: "info",
        category: "scheduler",
        event: "routine:expired-cleanup",
        data: { count: cleaned },
        timestamp: Date.now(),
      });
    }

    return cleaned;
  }

  dispose(): void {
    // 取消所有 Scheduler 任务
    for (const taskId of this.registeredTaskIds) {
      try {
        this.scheduler.cancel(taskId);
      } catch {
        // 忽略
      }
    }
    this.registeredTaskIds.clear();

    // 停止清理定时器
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    this.synced = false;
  }

  // ============ 内部方法 ============

  private buildEntry(options: AddRoutineOptions): RoutineEntry {
    const base = {
      id: options.id!,
      name: options.name,
      description: options.description,
      enabled: options.enabled !== false,
      trigger: options.trigger,
      source: options.source,
      skills: options.skills ? [...options.skills] : [],
      permissionLevel: options.permissionLevel ?? this.config.defaultPermissionLevel,
      notifyUser: options.notifyUser ?? false,
    };

    // exactOptionalPropertyTypes: 显式分支构建
    const parts: Record<string, unknown> = {};
    if (options.delay !== undefined) parts["delay"] = options.delay;
    if (options.addedBy !== undefined) parts["addedBy"] = options.addedBy;
    if (options.expires !== undefined) parts["expires"] = options.expires;
    if (options.preCheck !== undefined) parts["preCheck"] = options.preCheck;

    return { ...base, ...parts } as RoutineEntry;
  }

  private applyPatch(
    existing: RoutineEntry,
    patch: RoutineUpdatePatch,
  ): RoutineEntry {
    // 构建新对象（不可变更新）
    const merged = {
      id: existing.id,
      source: existing.source,
      name: patch.name ?? existing.name,
      description: patch.description ?? existing.description,
      enabled: patch.enabled ?? existing.enabled,
      trigger: patch.trigger ?? existing.trigger,
      skills: patch.skills ? [...patch.skills] : [...existing.skills],
      permissionLevel: patch.permissionLevel ?? existing.permissionLevel,
      notifyUser: patch.notifyUser ?? existing.notifyUser,
    };

    // 可选字段：patch 显式设置时覆盖，否则保留原值
    const parts: Record<string, unknown> = {};
    const delayVal = patch.delay !== undefined ? patch.delay : existing.delay;
    if (delayVal !== undefined) parts["delay"] = delayVal;
    const addedByVal = patch.addedBy !== undefined ? patch.addedBy : existing.addedBy;
    if (addedByVal !== undefined) parts["addedBy"] = addedByVal;
    const expiresVal = patch.expires !== undefined ? patch.expires : existing.expires;
    if (expiresVal !== undefined) parts["expires"] = expiresVal;
    const preCheckVal = patch.preCheck !== undefined ? patch.preCheck : existing.preCheck;
    if (preCheckVal !== undefined) parts["preCheck"] = preCheckVal;

    return { ...merged, ...parts } as RoutineEntry;
  }

  private generateId(source: RoutineSource): string {
    const prefix = SOURCE_ID_PREFIX[source] ?? source;
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = `${prefix}-${randomUUID().slice(0, 8)}`;
      if (!this.routines.has(id)) {
        return id;
      }
    }
    // 极低概率：3 次碰撞，用完整 UUID
    return `${prefix}-${randomUUID()}`;
  }

  private isRoutineActive(entry: RoutineEntry): boolean {
    if (!this.config.enabled) return false;
    if (!this.config.enabledSources.includes(entry.source)) return false;
    if (!entry.enabled) return false;
    return true;
  }

  private registerToScheduler(entry: RoutineEntry): void {
    const taskId = `routine:${entry.id}`;
    const handler = this.createRoutineHandler(entry);

    try {
      if (entry.trigger.startsWith("event:")) {
        const eventName = entry.trigger.slice("event:".length);
        this.scheduler.registerEventTask({
          id: taskId,
          name: entry.name,
          event: eventName,
          handler: async () => handler(),
          ...(entry.delay !== undefined ? { delayMs: entry.delay } : {}),
        });
      } else if (entry.trigger.startsWith("cron:")) {
        const cronExpr = entry.trigger.slice("cron:".length);
        this.scheduler.registerCron({
          id: taskId,
          name: entry.name,
          cron: cronExpr,
          handler,
        });
      } else if (entry.trigger.startsWith("interval:")) {
        const ms = parseInt(entry.trigger.slice("interval:".length), 10);
        if (isNaN(ms) || ms <= 0) {
          this.tracing.log({
            level: "warn",
            category: "scheduler",
            event: "routine:invalid-interval",
            data: { id: entry.id, trigger: entry.trigger },
            timestamp: Date.now(),
          });
          return;
        }
        this.scheduler.registerInterval({
          id: taskId,
          name: entry.name,
          intervalMs: ms,
          handler,
        });
      } else {
        this.tracing.log({
          level: "warn",
          category: "scheduler",
          event: "routine:unknown-trigger",
          data: { id: entry.id, trigger: entry.trigger },
          timestamp: Date.now(),
        });
        return;
      }

      this.registeredTaskIds.add(taskId);
    } catch (err: unknown) {
      this.tracing.log({
        level: "warn",
        category: "scheduler",
        event: "routine:register-error",
        data: { id: entry.id, error: String(err) },
        timestamp: Date.now(),
      });
    }
  }

  private cancelFromScheduler(id: string): void {
    const taskId = `routine:${id}`;
    if (this.registeredTaskIds.has(taskId)) {
      try {
        this.scheduler.cancel(taskId);
      } catch {
        // 任务可能已不存在
      }
      this.registeredTaskIds.delete(taskId);
    }
  }

  private createRoutineHandler(entry: RoutineEntry): () => Promise<void> {
    return async () => {
      // RT-B: 会话优先
      if (this.inSession) {
        this.tracing.log({
          level: "debug",
          category: "scheduler",
          event: "routine:skipped-in-session",
          data: { id: entry.id, name: entry.name },
          timestamp: Date.now(),
        });
        return;
      }

      // pre_check
      if (entry.preCheck !== undefined) {
        const checkFn = this.preChecks.get(entry.preCheck);
        if (checkFn) {
          try {
            const passed = await checkFn();
            if (!passed) {
              this.tracing.log({
                level: "debug",
                category: "scheduler",
                event: "routine:precheck-failed",
                data: { id: entry.id, preCheck: entry.preCheck },
                timestamp: Date.now(),
              });
              return;
            }
          } catch (err: unknown) {
            // pre_check 异常视为 pass
            this.tracing.log({
              level: "warn",
              category: "scheduler",
              event: "routine:precheck-error",
              data: { id: entry.id, preCheck: entry.preCheck, error: String(err) },
              timestamp: Date.now(),
            });
          }
        }
        // 未注册的 pre_check 默认 pass
      }

      // 执行任务
      if (this.taskHandler) {
        this.tracing.log({
          level: "info",
          category: "scheduler",
          event: "routine:executing",
          data: { id: entry.id, name: entry.name, source: entry.source },
          timestamp: Date.now(),
        });

        await this.taskHandler(entry);
      }
    };
  }

  // ============ YAML 持久化 ============

  private persistToYaml(): void {
    const routines = [...this.routines.values()].map(entryToYaml);
    const yamlContent = yamlStringify({ routines });

    const dir = dirname(this.yamlPath);
    mkdirSync(dir, { recursive: true });

    // 原子写入: tmp → rename
    const tmpPath = join(dir, `.active.yaml.tmp.${Date.now()}`);
    writeFileSync(tmpPath, yamlContent, "utf-8");
    renameSync(tmpPath, this.yamlPath);
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
    }
    this.cleanupTimer = setInterval(() => {
      this.cleanExpired();
    }, this.config.cleanupIntervalMs);
    this.cleanupTimer.unref();
  }
}

// ============ 工厂函数 ============

export function createRoutineSystem(config: RoutineSystemConfig): RoutineSystem {
  return new RoutineSystemImpl(config);
}
