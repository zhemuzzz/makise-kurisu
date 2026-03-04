/**
 * RoutineSystem 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * RT-1: 四源模型 (system / persona / user / self)
 * RT-2: 数据模型 (YAML + trigger 三种格式 + pre_check)
 * RT-3: CRUD (add / update / remove / getAll / findByName)
 * RT-4: 渐进启用 (三层过滤: config.enabled → enabledSources → entry.enabled)
 * RT-B: 执行行为 (inSession 跳过 + 重复触发跳过)
 * RT-C: 生命周期 (容量限制 + 过期清理)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import BetterSqlite3 from "better-sqlite3";
import { stringify as yamlStringify } from "yaml";
import type { RoutineConfig } from "@/platform/types/config.js";

/** 等待异步队列处理 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 创建默认 RoutineConfig */
function makeRoutineConfig(overrides?: Partial<RoutineConfig>): RoutineConfig {
  return {
    enabled: true,
    enabledSources: ["system", "persona", "user", "self"],
    maxRoutinesPerRole: 50,
    cleanupIntervalMs: 3600000,
    defaultPermissionLevel: "confirm",
    ...overrides,
  };
}

/** 写一个 routine YAML 到文件 */
function writeRoutineYaml(
  yamlPath: string,
  routines: readonly Record<string, unknown>[],
): void {
  const dir = join(yamlPath, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(yamlPath, yamlStringify({ routines }), "utf-8");
}

describe("RoutineSystem", () => {
  let tempDir: string;
  let sqlite: InstanceType<typeof BetterSqlite3>;
  let yamlPath: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-routine-test-"));
    const dbDir = join(tempDir, "platform");
    mkdirSync(dbDir, { recursive: true });

    const { TELEMETRY_SCHEMA } = await import("@/platform/tracing-service");
    sqlite = new BetterSqlite3(join(dbDir, "tracing.sqlite"));
    sqlite.pragma("journal_mode = WAL");
    sqlite.exec(TELEMETRY_SCHEMA);
    const columns = sqlite.pragma("table_info(telemetry)") as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "outcome")) {
      sqlite.exec("ALTER TABLE telemetry ADD COLUMN outcome TEXT");
    }

    yamlPath = join(tempDir, "routines", "active.yaml");
  });

  afterEach(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ============ 辅助函数 ============

  async function createDeps() {
    const { createEventBus } = await import("@/platform/event-bus");
    const { createTracingService } = await import("@/platform/tracing-service");
    const { createScheduler } = await import("@/platform/scheduler");
    const { createRoutineSystem } = await import("@/platform/routine-system");

    const eventBus = createEventBus();
    const tracing = createTracingService({ sqlite, silentStderr: true });
    const scheduler = createScheduler({ eventBus, tracing, taskTimeoutMs: 5000 });
    return { eventBus, tracing, scheduler, createRoutineSystem };
  }

  function createSystem(
    deps: Awaited<ReturnType<typeof createDeps>>,
    configOverrides?: Partial<RoutineConfig>,
  ) {
    return deps.createRoutineSystem({
      scheduler: deps.scheduler,
      tracing: deps.tracing,
      eventBus: deps.eventBus,
      routineConfig: makeRoutineConfig(configOverrides),
      yamlPath,
    });
  }

  function disposeAll(
    system: { dispose(): void },
    deps: { scheduler: { dispose(): void }; tracing: { dispose(): void }; eventBus: { dispose(): void } },
  ) {
    system.dispose();
    deps.scheduler.dispose();
    deps.tracing.dispose();
    deps.eventBus.dispose();
  }

  // ============ RT-1: 四源模型 ============

  describe("RT-1: 四源模型", () => {
    it("RT-01: system routine 不可 remove", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      expect(() => system.remove("session-reflect")).toThrow(/cannot remove system routine/i);

      disposeAll(system, deps);
    });

    it("RT-02: persona source routine 可添加和调整 enabled", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.add({
        id: "per-physics-study",
        name: "物理前沿学习",
        description: "学习理论物理和时间旅行理论的最新研究",
        trigger: "cron:0 6 * * *",
        source: "persona",
        skills: ["web-search"],
      });

      expect(entry.source).toBe("persona");
      expect(entry.enabled).toBe(true);

      const updated = system.update("per-physics-study", { enabled: false });
      expect(updated.enabled).toBe(false);

      disposeAll(system, deps);
    });

    it("RT-03: user source routine 完整 CRUD", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const added = system.add({
        name: "AI新闻推送",
        description: "搜索 AI 领域最新新闻，总结发给用户",
        trigger: "cron:0 8 * * *",
        source: "user",
        skills: ["web-search"],
        notifyUser: true,
        addedBy: "user-123",
      });

      expect(added.id).toMatch(/^usr-/);
      expect(added.name).toBe("AI新闻推送");
      expect(added.notifyUser).toBe(true);

      const updated = system.update(added.id, { name: "AI新闻日报" });
      expect(updated.name).toBe("AI新闻日报");

      const removed = system.remove(added.id);
      expect(removed).toBe(true);

      expect(system.getById(added.id)).toBeUndefined();

      disposeAll(system, deps);
    });

    it("RT-04: self source routine 带 expires", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.add({
        name: "Docker深入学习",
        description: "深入学习 Docker 容器化知识",
        trigger: "cron:0 14 * * 3",
        source: "self",
        skills: ["web-search"],
        expires: "2026-04-01",
      });

      expect(entry.id).toMatch(/^self-/);
      expect(entry.expires).toBe("2026-04-01");

      disposeAll(system, deps);
    });

    it("RT-05: 无效 source 被 Zod 拒绝或 add 拒绝", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      expect(() =>
        system.add({
          name: "Invalid",
          description: "Invalid source test",
          trigger: "cron:0 0 * * *",
          source: "invalid" as "system",
        }),
      ).toThrow();

      disposeAll(system, deps);
    });
  });

  // ============ RT-2: 数据模型 ============

  describe("RT-2: 数据模型", () => {
    it("RT-06: YAML 加载解析所有字段", async () => {
      writeRoutineYaml(yamlPath, [
        {
          id: "test-routine",
          name: "测试任务",
          description: "这是一个测试任务",
          enabled: true,
          trigger: "cron:0 8 * * *",
          source: "user",
          skills: ["web-search"],
          permission_level: "high",
          notify_user: true,
          added_by: "user-456",
          expires: "2026-12-31",
          pre_check: "test:check",
        },
      ]);

      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.getById("test-routine");
      expect(entry).toBeDefined();
      expect(entry!.name).toBe("测试任务");
      expect(entry!.description).toBe("这是一个测试任务");
      expect(entry!.trigger).toBe("cron:0 8 * * *");
      expect(entry!.source).toBe("user");
      expect(entry!.skills).toEqual(["web-search"]);
      expect(entry!.permissionLevel).toBe("high");
      expect(entry!.notifyUser).toBe(true);
      expect(entry!.addedBy).toBe("user-456");
      expect(entry!.expires).toBe("2026-12-31");
      expect(entry!.preCheck).toBe("test:check");

      disposeAll(system, deps);
    });

    it("RT-07: 缺失 YAML 文件 — 静默初始化，仍有系统内置", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const all = system.getAll();
      const systemRoutines = all.filter((r) => r.source === "system");
      expect(systemRoutines.length).toBeGreaterThanOrEqual(4);
      expect(system.getById("session-reflect")).toBeDefined();
      expect(system.getById("heartbeat-check")).toBeDefined();
      expect(system.getById("daily-learning")).toBeDefined();
      expect(system.getById("knowledge-consolidation")).toBeDefined();

      disposeAll(system, deps);
    });

    it("RT-08: event trigger 格式 + delay 传递", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const reflect = system.getById("session-reflect");
      expect(reflect).toBeDefined();
      expect(reflect!.trigger).toBe("event:session:end");
      expect(reflect!.delay).toBe(5000);

      disposeAll(system, deps);
    });

    it("RT-09: cron trigger 格式", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const learning = system.getById("daily-learning");
      expect(learning).toBeDefined();
      expect(learning!.trigger).toBe("cron:0 6 * * *");

      disposeAll(system, deps);
    });

    it("RT-10: interval trigger 格式", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const heartbeat = system.getById("heartbeat-check");
      expect(heartbeat).toBeDefined();
      expect(heartbeat!.trigger).toBe("interval:3600000");

      disposeAll(system, deps);
    });

    it("RT-11: pre_check true — handler 执行", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.registerPreCheck("test:pass", async () => true);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        id: "precheck-test",
        name: "PreCheck测试",
        description: "测试 pre_check 通过",
        trigger: "interval:50",
        source: "user",
        preCheck: "test:pass",
      });

      system.syncToScheduler();
      await delay(120);

      expect(handler).toHaveBeenCalled();

      disposeAll(system, deps);
    });

    it("RT-12: pre_check false — handler 跳过", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.registerPreCheck("test:fail", async () => false);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        id: "precheck-skip",
        name: "PreCheck跳过",
        description: "测试 pre_check 失败跳过",
        trigger: "interval:50",
        source: "user",
        preCheck: "test:fail",
      });

      system.syncToScheduler();
      await delay(120);

      expect(handler).not.toHaveBeenCalled();

      disposeAll(system, deps);
    });

    it("RT-13: pre_check 未注册 — 默认 pass", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        id: "precheck-unregistered",
        name: "未注册检查",
        description: "未注册的 pre_check 默认通过",
        trigger: "interval:50",
        source: "user",
        preCheck: "unknown:check",
      });

      system.syncToScheduler();
      await delay(120);

      expect(handler).toHaveBeenCalled();

      disposeAll(system, deps);
    });

    it("RT-14: pre_check 抛异常 — 视为 pass", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.registerPreCheck("test:error", async () => {
        throw new Error("pre_check error");
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        id: "precheck-error",
        name: "异常检查",
        description: "pre_check 抛异常时默认通过",
        trigger: "interval:50",
        source: "user",
        preCheck: "test:error",
      });

      system.syncToScheduler();
      await delay(120);

      expect(handler).toHaveBeenCalled();

      disposeAll(system, deps);
    });
  });

  // ============ RT-3: CRUD ============

  describe("RT-3: CRUD", () => {
    it("RT-17: add 持久化到 YAML", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        name: "新任务",
        description: "测试 YAML 持久化",
        trigger: "cron:0 12 * * *",
        source: "user",
      });

      const yaml = readFileSync(yamlPath, "utf-8");
      expect(yaml).toContain("新任务");
      expect(yaml).toContain("测试 YAML 持久化");

      disposeAll(system, deps);
    });

    it("RT-18: add 自动生成 ID — source 前缀 + UUID 短码", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const user = system.add({
        name: "User Task",
        description: "User routine",
        trigger: "cron:0 0 * * *",
        source: "user",
      });
      expect(user.id).toMatch(/^usr-[0-9a-f]{8}$/);

      const persona = system.add({
        name: "Persona Task",
        description: "Persona routine",
        trigger: "cron:0 0 * * *",
        source: "persona",
      });
      expect(persona.id).toMatch(/^per-[0-9a-f]{8}$/);

      const self = system.add({
        name: "Self Task",
        description: "Self routine",
        trigger: "cron:0 0 * * *",
        source: "self",
      });
      expect(self.id).toMatch(/^self-[0-9a-f]{8}$/);

      disposeAll(system, deps);
    });

    it("RT-19: add 指定 ID 冲突拒绝", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        id: "custom-id",
        name: "First",
        description: "First routine",
        trigger: "cron:0 0 * * *",
        source: "user",
      });

      expect(() =>
        system.add({
          id: "custom-id",
          name: "Second",
          description: "Duplicate ID",
          trigger: "cron:0 0 * * *",
          source: "user",
        }),
      ).toThrow(/already exists/i);

      disposeAll(system, deps);
    });

    it("RT-20: update patch 含 enabled 切换", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.add({
        name: "Switchable",
        description: "Toggle test",
        trigger: "cron:0 0 * * *",
        source: "user",
      });

      const disabled = system.update(entry.id, { enabled: false });
      expect(disabled.enabled).toBe(false);
      expect(disabled.name).toBe("Switchable");

      const renamed = system.update(entry.id, { name: "Renamed", enabled: true });
      expect(renamed.enabled).toBe(true);
      expect(renamed.name).toBe("Renamed");

      disposeAll(system, deps);
    });

    it("RT-21: remove 非 system routine", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.add({
        name: "Removable",
        description: "Will be removed",
        trigger: "cron:0 0 * * *",
        source: "user",
      });

      expect(system.remove(entry.id)).toBe(true);
      expect(system.getById(entry.id)).toBeUndefined();

      // remove 不存在的 ID 返回 false
      expect(system.remove("nonexistent")).toBe(false);

      disposeAll(system, deps);
    });

    it("RT-22: getAll 返回不可变快照", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const all1 = system.getAll();
      const count1 = all1.length;

      system.add({
        name: "New One",
        description: "After snapshot",
        trigger: "cron:0 0 * * *",
        source: "user",
      });

      // 之前的快照不受影响
      expect(all1.length).toBe(count1);
      // 新快照有新增
      expect(system.getAll().length).toBe(count1 + 1);

      disposeAll(system, deps);
    });

    it("RT-23: findByName 按名称查询", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        name: "AI新闻",
        description: "AI news summary",
        trigger: "cron:0 8 * * *",
        source: "user",
      });

      system.add({
        name: "AI新闻",
        description: "AI news for another channel",
        trigger: "cron:0 9 * * *",
        source: "user",
      });

      const found = system.findByName("AI新闻");
      expect(found.length).toBe(2);

      const notFound = system.findByName("不存在的任务");
      expect(notFound.length).toBe(0);

      disposeAll(system, deps);
    });
  });

  // ============ RT-4: 渐进启用 ============

  describe("RT-4: 渐进启用", () => {
    it("RT-24: config.enabled=false — 全部不注册到 Scheduler", async () => {
      const deps = await createDeps();
      const system = createSystem(deps, { enabled: false });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(100);

      expect(handler).not.toHaveBeenCalled();

      disposeAll(system, deps);
    });

    it("RT-25: enabledSources=[\"system\"] — 只注册 system routine", async () => {
      const deps = await createDeps();
      const system = createSystem(deps, { enabledSources: ["system"] });

      // session-reflect (system, enabled=true) 应该注册
      // 添加一个 user routine 不应该注册
      system.add({
        name: "User routine",
        description: "Should not run",
        trigger: "interval:50",
        source: "user",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(120);

      // handler 可能被调用（session-reflect 是 event 触发，不会自动执行）
      // 但 user routine 不应该被执行
      const calls = handler.mock.calls;
      for (const call of calls) {
        const routine = call[0] as { source: string };
        expect(routine.source).toBe("system");
      }

      disposeAll(system, deps);
    });

    it("RT-26: enabledSources 含 persona 时 persona routine 注册", async () => {
      const deps = await createDeps();
      const system = createSystem(deps, { enabledSources: ["system", "persona"] });

      system.add({
        name: "Persona学习",
        description: "角色默认学习任务",
        trigger: "interval:50",
        source: "persona",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(120);

      const personaCalls = handler.mock.calls.filter(
        (call) => (call[0] as { source: string }).source === "persona",
      );
      expect(personaCalls.length).toBeGreaterThan(0);

      disposeAll(system, deps);
    });

    it("RT-27: source 不在 enabledSources 中 — 跳过", async () => {
      const deps = await createDeps();
      const system = createSystem(deps, { enabledSources: ["system"] });

      system.add({
        name: "Self routine",
        description: "Should not run",
        trigger: "interval:50",
        source: "self",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(120);

      const selfCalls = handler.mock.calls.filter(
        (call) => (call[0] as { source: string }).source === "self",
      );
      expect(selfCalls.length).toBe(0);

      disposeAll(system, deps);
    });

    it("RT-28: entry.enabled=false — 跳过（即使 source 已启用）", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        name: "Disabled entry",
        description: "Should not run",
        trigger: "interval:50",
        source: "user",
        enabled: false,
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(120);

      const userCalls = handler.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === "Disabled entry",
      );
      expect(userCalls.length).toBe(0);

      disposeAll(system, deps);
    });

    it("RT-29: 三层过滤完整验证", async () => {
      const deps = await createDeps();
      const system = createSystem(deps, {
        enabled: true,
        enabledSources: ["system", "user"],
      });

      // user + enabled=true → 应该运行
      system.add({
        id: "active-user",
        name: "Active",
        description: "Should run",
        trigger: "interval:50",
        source: "user",
      });

      // user + enabled=false → 不运行
      system.add({
        id: "disabled-user",
        name: "Disabled",
        description: "Should not run",
        trigger: "interval:50",
        source: "user",
        enabled: false,
      });

      // persona (不在 enabledSources) → 不运行
      system.add({
        id: "per-blocked",
        name: "Blocked persona",
        description: "Should not run",
        trigger: "interval:50",
        source: "persona",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(120);

      const ids = handler.mock.calls.map((call) => (call[0] as { id: string }).id);
      expect(ids).toContain("active-user");
      expect(ids).not.toContain("disabled-user");
      expect(ids).not.toContain("per-blocked");

      disposeAll(system, deps);
    });
  });

  // ============ RT-B: 执行行为 ============

  describe("RT-B: 执行行为", () => {
    it("RT-33: inSession=true — handler 跳过", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        name: "Session block",
        description: "Should skip in session",
        trigger: "interval:50",
        source: "user",
      });

      system.setInSession(true);
      system.syncToScheduler();
      await delay(120);

      expect(handler).not.toHaveBeenCalled();

      disposeAll(system, deps);
    });

    it("RT-34: session 结束后恢复执行", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        name: "Resume test",
        description: "Should resume after session",
        trigger: "interval:50",
        source: "user",
      });

      system.setInSession(true);
      system.syncToScheduler();
      await delay(80);
      expect(handler).not.toHaveBeenCalled();

      system.setInSession(false);
      await delay(120);
      expect(handler).toHaveBeenCalled();

      disposeAll(system, deps);
    });
  });

  // ============ RT-C: 生命周期 ============

  describe("RT-C: 生命周期", () => {
    it("RT-36: 容量超限拒绝", async () => {
      const deps = await createDeps();
      const system = createSystem(deps, { maxRoutinesPerRole: 6 });

      // 系统内置占 4 条，还能加 2 条
      system.add({
        name: "Slot 5",
        description: "Fifth routine",
        trigger: "cron:0 0 * * *",
        source: "user",
      });

      system.add({
        name: "Slot 6",
        description: "Sixth routine",
        trigger: "cron:0 0 * * *",
        source: "user",
      });

      expect(() =>
        system.add({
          name: "Overflow",
          description: "Should fail",
          trigger: "cron:0 0 * * *",
          source: "user",
        }),
      ).toThrow(/capacity|limit/i);

      disposeAll(system, deps);
    });

    it("RT-37: cleanExpired 返回清理数量", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      // 添加一个已过期的 routine
      system.add({
        name: "Expired",
        description: "Already expired",
        trigger: "cron:0 0 * * *",
        source: "self",
        expires: "2020-01-01",
      });

      // 添加一个未过期的 routine
      system.add({
        name: "Future",
        description: "Not expired yet",
        trigger: "cron:0 0 * * *",
        source: "self",
        expires: "2099-01-01",
      });

      const cleaned = system.cleanExpired();
      expect(cleaned).toBe(1);

      disposeAll(system, deps);
    });

    it("RT-38: cleanExpired 跳过 system routine（即使理论上有 expires）", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      // system routine 永远不应该被清理
      const countBefore = system.getAll().filter((r) => r.source === "system").length;
      system.cleanExpired();
      const countAfter = system.getAll().filter((r) => r.source === "system").length;

      expect(countAfter).toBe(countBefore);

      disposeAll(system, deps);
    });

    it("RT-39: 过期条目从 YAML 移除", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        id: "expired-entry",
        name: "Will expire",
        description: "Expired routine",
        trigger: "cron:0 0 * * *",
        source: "user",
        expires: "2020-01-01",
      });

      // 验证写入了 YAML
      let yaml = readFileSync(yamlPath, "utf-8");
      expect(yaml).toContain("expired-entry");

      system.cleanExpired();

      // 验证从 YAML 移除
      yaml = readFileSync(yamlPath, "utf-8");
      expect(yaml).not.toContain("expired-entry");

      disposeAll(system, deps);
    });
  });

  // ============ Scheduler 集成 ============

  describe("Scheduler 集成", () => {
    it("RT-42: syncToScheduler 注册所有 active routine", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        name: "Active interval",
        description: "Runs on interval",
        trigger: "interval:50",
        source: "user",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(120);

      expect(handler).toHaveBeenCalled();

      disposeAll(system, deps);
    });

    it("RT-43: re-sync 先取消旧任务再注册新", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      system.add({
        name: "First sync",
        description: "Initial routine",
        trigger: "interval:50",
        source: "user",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(80);

      const callsAfterFirstSync = handler.mock.calls.length;

      // re-sync 不应该导致重复注册
      system.syncToScheduler();
      await delay(80);

      // 应该继续执行，但不应该有重复 handler（如两倍速率）
      const callsAfterResync = handler.mock.calls.length;
      expect(callsAfterResync).toBeGreaterThan(callsAfterFirstSync);

      disposeAll(system, deps);
    });

    it("RT-44: add 后自动同步到 Scheduler（如果已 sync）", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();

      // 在 sync 后添加新 routine
      system.add({
        name: "Late addition",
        description: "Added after sync",
        trigger: "interval:50",
        source: "user",
      });

      await delay(120);

      const lateAdditionCalls = handler.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === "Late addition",
      );
      expect(lateAdditionCalls.length).toBeGreaterThan(0);

      disposeAll(system, deps);
    });

    it("RT-45: remove 后自动从 Scheduler 取消", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.add({
        name: "To be removed",
        description: "Will be cancelled",
        trigger: "interval:50",
        source: "user",
      });

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);
      system.syncToScheduler();
      await delay(80);

      const callsBefore = handler.mock.calls.length;
      system.remove(entry.id);

      handler.mockClear();
      await delay(120);

      // 删除后不应该再有该 routine 的调用
      const removedCalls = handler.mock.calls.filter(
        (call) => (call[0] as { name: string }).name === "To be removed",
      );
      expect(removedCalls.length).toBe(0);

      disposeAll(system, deps);
    });

    it("RT-46: TracingService 记录 routine 事件", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        name: "Traced routine",
        description: "Test tracing",
        trigger: "interval:50",
        source: "user",
      });

      system.syncToScheduler();
      await delay(120);

      // flush TracingService buffer to SQLite
      deps.tracing.flush();

      // 检查 TracingService 有相关事件记录
      const rows = sqlite
        .prepare("SELECT * FROM telemetry WHERE event LIKE 'routine:%'")
        .all();
      expect(rows.length).toBeGreaterThan(0);

      disposeAll(system, deps);
    });
  });

  // ============ YAML 持久化 ============

  describe("YAML 持久化", () => {
    it("RT-47: load → save → reload 往返保真", async () => {
      // 先创建一个系统并添加 routines
      const deps1 = await createDeps();
      const system1 = createSystem(deps1);

      system1.add({
        id: "roundtrip-test",
        name: "往返测试",
        description: "测试 YAML 往返保真",
        trigger: "cron:0 12 * * *",
        source: "user",
        skills: ["web-search", "file-ops"],
        notifyUser: true,
        addedBy: "user-789",
      });

      disposeAll(system1, deps1);

      // 重新加载
      const deps2 = await createDeps();
      const system2 = createSystem(deps2);

      const reloaded = system2.getById("roundtrip-test");
      expect(reloaded).toBeDefined();
      expect(reloaded!.name).toBe("往返测试");
      expect(reloaded!.description).toBe("测试 YAML 往返保真");
      expect(reloaded!.trigger).toBe("cron:0 12 * * *");
      expect(reloaded!.skills).toEqual(["web-search", "file-ops"]);
      expect(reloaded!.notifyUser).toBe(true);
      expect(reloaded!.addedBy).toBe("user-789");

      disposeAll(system2, deps2);
    });

    it("RT-48: snake_case ↔ camelCase 正确转换", async () => {
      writeRoutineYaml(yamlPath, [
        {
          id: "snake-test",
          name: "Snake Case测试",
          description: "测试 snake_case 转换",
          trigger: "cron:0 0 * * *",
          source: "user",
          permission_level: "high",
          notify_user: true,
          added_by: "user-321",
          pre_check: "test:check",
        },
      ]);

      const deps = await createDeps();
      const system = createSystem(deps);

      const entry = system.getById("snake-test");
      expect(entry).toBeDefined();
      expect(entry!.permissionLevel).toBe("high");
      expect(entry!.notifyUser).toBe(true);
      expect(entry!.addedBy).toBe("user-321");
      expect(entry!.preCheck).toBe("test:check");

      // 保存后读取 YAML，确认 snake_case
      system.update("snake-test", { name: "Updated Name" });
      const yaml = readFileSync(yamlPath, "utf-8");
      expect(yaml).toContain("permission_level");
      expect(yaml).toContain("notify_user");
      expect(yaml).toContain("added_by");
      expect(yaml).toContain("pre_check");

      disposeAll(system, deps);
    });
  });

  // ============ 系统内置 ============

  describe("系统内置 routine", () => {
    it("RT-52: 系统内置有正确的默认 enabled 状态", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      // session-reflect 默认 enabled
      expect(system.getById("session-reflect")!.enabled).toBe(true);
      // 其他系统 routine 默认 disabled
      expect(system.getById("heartbeat-check")!.enabled).toBe(false);
      expect(system.getById("daily-learning")!.enabled).toBe(false);
      expect(system.getById("knowledge-consolidation")!.enabled).toBe(false);

      disposeAll(system, deps);
    });

    it("RT-53: system routine 不可 remove 但可 update enabled", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      expect(() => system.remove("session-reflect")).toThrow(/cannot remove/i);

      const updated = system.update("session-reflect", { enabled: false });
      expect(updated.enabled).toBe(false);

      // 恢复
      const restored = system.update("session-reflect", { enabled: true });
      expect(restored.enabled).toBe(true);

      disposeAll(system, deps);
    });

    it("RT-54: YAML 缺失 system routine 时自动补充", async () => {
      // 写一个只有部分 system routine 的 YAML
      writeRoutineYaml(yamlPath, [
        {
          id: "session-reflect",
          name: "对话反思",
          description: "反思本次对话",
          trigger: "event:session:end",
          source: "system",
          enabled: false, // 用户改过 enabled
        },
      ]);

      const deps = await createDeps();
      const system = createSystem(deps);

      // session-reflect 保留用户修改
      expect(system.getById("session-reflect")!.enabled).toBe(false);

      // 缺失的 system routine 被补充
      expect(system.getById("heartbeat-check")).toBeDefined();
      expect(system.getById("daily-learning")).toBeDefined();
      expect(system.getById("knowledge-consolidation")).toBeDefined();

      disposeAll(system, deps);
    });

    it("RT-55: system routine 有语义化 ID", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const systemRoutines = system.getAll().filter((r) => r.source === "system");
      for (const r of systemRoutines) {
        expect(r.id).toMatch(/^[a-z][a-z0-9-]+$/);
        expect(r.name).toBeTruthy();
        expect(r.description).toBeTruthy();
      }

      disposeAll(system, deps);
    });
  });

  // ============ dispose ============

  describe("dispose", () => {
    it("RT-50: dispose 后 Scheduler 任务全部取消", async () => {
      const deps = await createDeps();
      const system = createSystem(deps);

      const handler = vi.fn(async () => {});
      system.setTaskHandler(handler);

      system.add({
        name: "Disposable",
        description: "Should stop after dispose",
        trigger: "interval:50",
        source: "user",
      });

      system.syncToScheduler();
      await delay(80);

      system.dispose();
      handler.mockClear();

      await delay(120);
      expect(handler).not.toHaveBeenCalled();

      deps.scheduler.dispose();
      deps.tracing.dispose();
      deps.eventBus.dispose();
    });
  });
});
