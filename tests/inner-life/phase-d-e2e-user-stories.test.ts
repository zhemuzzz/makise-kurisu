/**
 * Phase D 端到端用户故事验证
 *
 * 验证各模块串联后的完整链路（不 mock ILE 内部）:
 * - D1: 多轮对话→情绪连续性
 * - D2: 关系升级 + Growth 联动
 * - D3: cognition 元工具读写回路
 * - D4: 时间驱动→shouldAct 链路
 * - D5: handleTimeTick 真实引擎链路
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createPersonaEngine,
  createInMemoryStateStore,
  KURISU_ENGINE_CONFIG,
} from "../../src/inner-life/index.js";
import type {
  PersonaEngineAPI,
  PersonaEngineConfig,
  TimeTickResult,
} from "../../src/inner-life/types.js";
import type { StateStore } from "../../src/inner-life/orchestrator/state-store.js";
import { handleTimeTick, type TimeTickDeps, type ProactiveActionEvent } from "../../src/platform/time-tick-handler.js";
import { manageCognitionHandler } from "../../src/agent/meta-tools/manage-cognition.js";
import { SessionStateImpl } from "../../src/agent/meta-tools/session-state-impl.js";
import type { MetaToolContext, SessionState } from "../../src/agent/meta-tools/types.js";
import type { CognitionStore } from "../../src/platform/storage/cognition-store.js";

// ============================================================================
// Helpers
// ============================================================================

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function makeConfig(overrides?: Partial<PersonaEngineConfig>): PersonaEngineConfig {
  return { ...KURISU_ENGINE_CONFIG, ...overrides };
}

function createMockCognitionStore(): CognitionStore & { stored: string } {
  const store: CognitionStore & { stored: string } = {
    stored: "",
    read: vi.fn(async () => store.stored),
    write: vi.fn(async (content: string) => {
      store.stored = content;
    }),
  };
  return store;
}

function createMetaToolContext(sessionState: SessionState): MetaToolContext {
  return {
    sessionId: "test-session",
    userId: "test-user",
    agentId: "test-agent",
    sessionState,
    skills: {} as MetaToolContext["skills"],
    subAgents: {} as MetaToolContext["subAgents"],
  };
}

// ============================================================================
// D1: 多轮对话→情绪连续性
// ============================================================================

describe("D1: 多轮对话→情绪连续性", () => {
  let store: StateStore;
  let engine: PersonaEngineAPI;

  beforeEach(() => {
    store = createInMemoryStateStore();
    engine = createPersonaEngine(makeConfig(), store);
  });

  it("D1.1: 连续正面情绪 → pleasure 持续上升", () => {
    const snaps: number[] = [];

    snaps.push(engine.getDebugSnapshot("u1").baseMood.pleasure);

    for (let i = 0; i < 5; i++) {
      engine.processTurn("u1", ["joy"], "text_chat");
    }

    snaps.push(engine.getDebugSnapshot("u1").baseMood.pleasure);

    for (let i = 0; i < 5; i++) {
      engine.processTurn("u1", ["joy", "contentment"], "text_chat");
    }

    snaps.push(engine.getDebugSnapshot("u1").baseMood.pleasure);

    // baseMood should be monotonically increasing (or at least not decreasing)
    expect(snaps[1]).toBeGreaterThan(snaps[0]);
    expect(snaps[2]).toBeGreaterThanOrEqual(snaps[1]);
  });

  it("D1.2: 正面→负面切换 → projected mood 先升后降", () => {
    // Phase 1: positive
    for (let i = 0; i < 5; i++) {
      engine.processTurn("u1", ["joy"], "text_chat");
    }
    const afterPositive = engine.getDebugSnapshot("u1").userProjections["u1"]!.projectedMood.pleasure;

    // Phase 2: negative (more rounds to overcome positive momentum)
    for (let i = 0; i < 8; i++) {
      engine.processTurn("u1", ["irritation", "frustration"], "text_chat");
    }
    const afterNegative = engine.getDebugSnapshot("u1").userProjections["u1"]!.projectedMood.pleasure;

    // User projection should show the shift
    expect(afterNegative).toBeLessThan(afterPositive);
  });

  it("D1.3: 多用户独立 → u1 正面 u2 负面，互不干扰", () => {
    for (let i = 0; i < 5; i++) {
      engine.processTurn("u1", ["joy", "trust"], "text_chat");
      engine.processTurn("u2", ["irritation", "frustration"], "text_chat");
    }

    const snap = engine.getDebugSnapshot();
    const u1Proj = snap.userProjections["u1"];
    const u2Proj = snap.userProjections["u2"];

    expect(u1Proj).toBeDefined();
    expect(u2Proj).toBeDefined();
    expect(u1Proj!.projectedMood.pleasure).toBeGreaterThan(
      u2Proj!.projectedMood.pleasure,
    );
  });
});

// ============================================================================
// D2: 关系升级 + Growth 联动
// ============================================================================

describe("D2: 关系升级 + Growth 联动", () => {
  let store: StateStore;
  let config: PersonaEngineConfig;
  let engine: PersonaEngineAPI;

  beforeEach(() => {
    store = createInMemoryStateStore();
    config = makeConfig({
      growthBounds: { maxDrift: { p: 0.3, a: 0.2, d: 0.2 } },
      growthDriftIntervalMs: MS_PER_DAY,
    });
    engine = createPersonaEngine(config, store);
  });

  it("D2.1: 关系升级过程中 GrowthExperience 同步积累", () => {
    // 12 轮正面互动 → 足够升级 + 积累经历
    for (let i = 0; i < 12; i++) {
      engine.processTurn("u1", ["trust", "joy"], "text_chat");
    }

    // 验证关系升级
    const snap = engine.getDebugSnapshot("u1");
    const rel = snap.relationships["u1"];
    expect(rel).toBeDefined();
    expect(["acquaintance", "familiar", "friend", "close_friend"]).toContain(rel!.stage);

    // 验证 Growth 积累同步发生
    const growth = store.getGrowthState(config.roleId);
    expect(growth).toBeDefined();
    expect(growth!.experiences.length).toBe(12); // 每轮 1 条
    // 所有经历的 padDelta.p 应该 > 0 (正面情绪)
    for (const exp of growth!.experiences) {
      expect(exp.padDelta.p).toBeGreaterThan(0);
    }
  });

  it("D2.2: relationship + mood + growth 三状态联动", () => {
    const initialMood = engine.getDebugSnapshot().baseMood.pleasure;

    for (let i = 0; i < 8; i++) {
      engine.processTurn("u1", ["joy", "trust"], "text_chat");
    }

    const snap = engine.getDebugSnapshot("u1");

    // Mood: baseMood pleasure 应该上升
    expect(snap.baseMood.pleasure).toBeGreaterThan(initialMood);

    // Relationship: 至少有互动记录
    const rel = snap.relationships["u1"]!;
    expect(rel.interactionCount).toBe(8);
    expect(rel.familiarity).toBeGreaterThan(0);
    expect(rel.trust).toBeGreaterThan(0);

    // Growth: 积累了 8 条经历
    const growth = store.getGrowthState(config.roleId);
    expect(growth!.experiences.length).toBe(8);
  });
});

// ============================================================================
// D3: cognition 元工具读写回路
// ============================================================================

describe("D3: cognition 元工具读写回路", () => {
  it("D3.1: write→persist→新 session read 完整回路", async () => {
    const cognitionStore = createMockCognitionStore();

    // Session 1: write
    const session1 = new SessionStateImpl({
      cognitionStore,
    });
    const ctx1 = createMetaToolContext(session1);

    const writeResult = await manageCognitionHandler(
      { action: "write", content: "# 我的认知\n\n冈部是个笨蛋。" },
      ctx1,
    );
    expect(writeResult.success).toBe(true);

    // 等待 fire-and-forget 持久化
    await vi.waitFor(() => {
      expect(cognitionStore.stored).toBe("# 我的认知\n\n冈部是个笨蛋。");
    });

    // Session 2: 从 store 加载初始认知
    const persisted = await cognitionStore.read();
    const session2 = new SessionStateImpl({
      cognitionStore,
      initialCognition: {
        content: persisted,
        formattedText: `## 我的认知笔记\n\n${persisted}`,
      },
    });
    const ctx2 = createMetaToolContext(session2);

    const readResult = await manageCognitionHandler({ action: "read" }, ctx2);
    expect(readResult.success).toBe(true);

    const output = readResult.output as Record<string, unknown>;
    expect(output["content"]).toBe("# 我的认知\n\n冈部是个笨蛋。");
  });

  it("D3.2: 超长内容被拒绝 (>6000 chars)", async () => {
    const session = new SessionStateImpl();
    const ctx = createMetaToolContext(session);

    const longContent = "あ".repeat(6001);
    const result = await manageCognitionHandler(
      { action: "write", content: longContent },
      ctx,
    );

    expect(result.success).toBe(false);
  });

  it("D3.3: 空初始状态→write→read", async () => {
    const session = new SessionStateImpl();
    const ctx = createMetaToolContext(session);

    // Read empty
    const readEmpty = await manageCognitionHandler({ action: "read" }, ctx);
    expect(readEmpty.success).toBe(true);
    expect((readEmpty.output as Record<string, unknown>)["content"]).toBe("");

    // Write
    await manageCognitionHandler(
      { action: "write", content: "新认知" },
      ctx,
    );

    // Read back
    const readAfter = await manageCognitionHandler({ action: "read" }, ctx);
    expect(readAfter.success).toBe(true);
    expect((readAfter.output as Record<string, unknown>)["content"]).toBe("新认知");
  });
});

// ============================================================================
// D4: 时间驱动→shouldAct 链路
// ============================================================================

describe("D4: 时间驱动→shouldAct 链路", () => {
  let store: StateStore;
  let config: PersonaEngineConfig;
  let engine: PersonaEngineAPI;

  beforeEach(() => {
    store = createInMemoryStateStore();
    config = makeConfig({
      growthBounds: { maxDrift: { p: 0.3, a: 0.2, d: 0.2 } },
      growthDriftIntervalMs: MS_PER_DAY,
    });
    engine = createPersonaEngine(config, store);
  });

  it("D4.1: 短时间 tick (<1h) → shouldAct = false", () => {
    engine.processTurn("u1", ["joy"], "text_chat");

    const result = engine.processTimeTick("u1", 30 * 60_000, Date.now() + 30 * 60_000);
    expect(result.shouldAct).toBe(false);
  });

  it("D4.2: 长时间 tick (4h+) + 有关系 → timeContext 有效", () => {
    // 建立关系
    for (let i = 0; i < 5; i++) {
      engine.processTurn("u1", ["joy", "trust"], "text_chat");
    }

    const now = Date.now();
    const elapsed = 4 * MS_PER_HOUR;
    const result = engine.processTimeTick("u1", elapsed, now + elapsed);

    // timeContext 应该包含时间描述
    expect(result.timeContext).toContain("距上次对话");
    // mood 和 relationship 应该有效
    expect(result.mood).toBeDefined();
    expect(result.relationship).toBeDefined();
    expect(result.relationship.familiarity).toBeGreaterThan(0);
  });

  it("D4.3: tick 后 mood 向性格方向衰减", () => {
    // 先拉高 pleasure
    for (let i = 0; i < 8; i++) {
      engine.processTurn("u1", ["joy"], "text_chat");
    }
    const beforeTick = engine.getDebugSnapshot("u1");
    const beforePleasure = beforeTick.userProjections["u1"]!.projectedMood.pleasure;

    // 4h tick → mood 衰减回性格默认
    const now = Date.now();
    engine.processTimeTick("u1", 4 * MS_PER_HOUR, now + 4 * MS_PER_HOUR);

    const afterTick = engine.getDebugSnapshot("u1");
    const afterPleasure = afterTick.userProjections["u1"]!.projectedMood.pleasure;

    // Kurisu default pleasure = -0.2，所以 positive mood 应该衰减回去
    const defaultPleasure = KURISU_ENGINE_CONFIG.personality.defaultMood.pleasure;
    // 衰减后应该更接近默认值
    expect(Math.abs(afterPleasure - defaultPleasure)).toBeLessThanOrEqual(
      Math.abs(beforePleasure - defaultPleasure),
    );
  });

  it("D4.4: tick→growth drift→personality 微调 (≥24h)", () => {
    // 积累正面经历
    for (let i = 0; i < 10; i++) {
      engine.processTurn("u1", ["joy", "trust"], "text_chat");
    }

    const beforePersonality = engine.getDebugSnapshot().personality;
    const beforePleasure = beforePersonality.defaultMood.pleasure;

    // 24h+ tick 触发 growth drift
    const now = Date.now();
    engine.processTimeTick("u1", MS_PER_DAY + 1000, now + MS_PER_DAY + 1000);

    const afterPersonality = engine.getDebugSnapshot().personality;
    const afterPleasure = afterPersonality.defaultMood.pleasure;

    // 10 轮正面经历应该让 personality.defaultMood.pleasure 至少不减少
    expect(afterPleasure).toBeGreaterThanOrEqual(beforePleasure);

    // GrowthState 应该更新 lastDriftAt
    const growth = store.getGrowthState(config.roleId);
    expect(growth).toBeDefined();
    expect(growth!.lastDriftAt).toBeGreaterThan(0);
  });
});

// ============================================================================
// D5: handleTimeTick 真实引擎链路
// ============================================================================

describe("D5: handleTimeTick 真实引擎链路", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("D5.1: 真实引擎 + fakeTimers → handleTimeTick 处理用户", () => {
    const baseTime = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    const engine = createPersonaEngine({ ...KURISU_ENGINE_CONFIG, roleId: "r1" });

    // 建立用户互动
    engine.processTurn("u1", ["joy"], "text_chat");

    // 前进 2 小时 (> MIN_ELAPSED_MS 的 5min)
    vi.setSystemTime(baseTime + 2 * MS_PER_HOUR);

    const actions: ProactiveActionEvent[] = [];
    const deps: TimeTickDeps = {
      engines: new Map([["r1", engine]]),
      onAction: (ev) => actions.push(ev),
    };

    const stats = handleTimeTick(deps);

    // 2h 后应该处理该用户
    expect(stats.usersProcessed).toBe(1);
  });

  it("D5.2: 多角色多用户场景", () => {
    const baseTime = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    const engine1 = createPersonaEngine({ ...KURISU_ENGINE_CONFIG, roleId: "r1" });
    const engine2 = createPersonaEngine({ ...KURISU_ENGINE_CONFIG, roleId: "r2" });

    engine1.processTurn("u1", ["joy"], "text_chat");
    engine1.processTurn("u2", ["curiosity"], "text_chat");
    engine2.processTurn("u3", ["trust"], "text_chat");

    // 前进 1 小时
    vi.setSystemTime(baseTime + MS_PER_HOUR);

    const deps: TimeTickDeps = {
      engines: new Map([
        ["r1", engine1],
        ["r2", engine2],
      ]),
    };

    const stats = handleTimeTick(deps);

    // 3 个用户都应该被处理
    expect(stats.usersProcessed).toBe(3);
  });
});
