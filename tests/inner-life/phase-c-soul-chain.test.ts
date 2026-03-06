/**
 * Phase C 灵魂传导链补全 — 测试
 *
 * 覆盖:
 * - C2: emotionTags 记忆存储 (agent postProcess)
 * - C3: Growth 经历积累 + 周期性 drift
 * - C4: snapshot-formatter + evolution ILE 感知
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createPersonaEngine,
  createInMemoryStateStore,
  computeAverageEmotionPad,
  computeGrowthDrift,
  formatILESummary,
  describeMood,
  STAGE_NAMES,
  KURISU_ENGINE_CONFIG,
} from "../../src/inner-life/index.js";
import type {
  ActiveEmotion,
  PADVector,
  PersonaEngineConfig,
  DebugSnapshot,
  GrowthBounds,
  PersonalityDefaults,
  GrowthExperience,
  MoodState,
  StateStore,
} from "../../src/inner-life/index.js";

// ============================================================================
// Helpers
// ============================================================================

const MS_PER_DAY = 86_400_000;

function makeConfig(overrides?: Partial<PersonaEngineConfig>): PersonaEngineConfig {
  return {
    ...KURISU_ENGINE_CONFIG,
    ...overrides,
  };
}

function makeEmotion(
  tag: string,
  pad: PADVector,
  weight = 0.5,
  intensity = 1,
): ActiveEmotion {
  return {
    tag: tag as ActiveEmotion["tag"],
    pad,
    weight,
    intensity,
  };
}

// ============================================================================
// C2: emotionTags → 记忆存储 (agent-level, tested indirectly via type)
// ============================================================================

// Agent-level tests are in agent.test.ts — here we test the pure function helper

// ============================================================================
// C3: computeAverageEmotionPad
// ============================================================================

describe("computeAverageEmotionPad", () => {
  it("returns zero vector for empty array", () => {
    const result = computeAverageEmotionPad([]);
    expect(result).toEqual({ p: 0, a: 0, d: 0 });
  });

  it("returns single emotion PAD as-is when only one emotion", () => {
    const emotions = [makeEmotion("joy", { p: 0.8, a: 0.5, d: 0.3 }, 1.0)];
    const result = computeAverageEmotionPad(emotions);
    expect(result.p).toBeCloseTo(0.8);
    expect(result.a).toBeCloseTo(0.5);
    expect(result.d).toBeCloseTo(0.3);
  });

  it("computes weighted average for multiple emotions", () => {
    const emotions = [
      makeEmotion("joy", { p: 1.0, a: 0.0, d: 0.0 }, 2.0),
      makeEmotion("sadness", { p: -1.0, a: 0.0, d: 0.0 }, 1.0),
    ];
    const result = computeAverageEmotionPad(emotions);
    // Weighted: (1.0*2 + (-1.0)*1) / (2+1) = 1/3 ≈ 0.333
    expect(result.p).toBeCloseTo(1 / 3, 2);
  });

  it("returns zero vector when all weights are 0", () => {
    const emotions = [makeEmotion("joy", { p: 0.8, a: 0.5, d: 0.3 }, 0)];
    const result = computeAverageEmotionPad(emotions);
    expect(result).toEqual({ p: 0, a: 0, d: 0 });
  });
});

// ============================================================================
// C3: Growth 积累 via processTurn
// ============================================================================

describe("Growth accumulation in processTurn", () => {
  let store: StateStore;
  let config: PersonaEngineConfig;

  beforeEach(() => {
    store = createInMemoryStateStore();
    config = makeConfig({
      growthBounds: { maxDrift: { p: 0.3, a: 0.2, d: 0.2 } },
      growthDriftIntervalMs: MS_PER_DAY,
    });
  });

  it("accumulates GrowthExperience when emotions are present", () => {
    const engine = createPersonaEngine(config, store);
    engine.processTurn("user1", ["joy"], "text_chat");

    const growth = store.getGrowthState(config.roleId);
    expect(growth).toBeDefined();
    expect(growth!.experiences.length).toBe(1);
    expect(growth!.experiences[0].padDelta.p).toBeGreaterThan(0);
  });

  it("does NOT accumulate when no emotions", () => {
    const engine = createPersonaEngine(config, store);
    engine.processTurn("user1", [], "text_chat");

    const growth = store.getGrowthState(config.roleId);
    // Should be undefined (never saved) or empty
    expect(growth?.experiences.length ?? 0).toBe(0);
  });

  it("does NOT accumulate when growthBounds not configured", () => {
    const noBoundsConfig = makeConfig({ growthBounds: undefined });
    const engine = createPersonaEngine(noBoundsConfig, store);
    engine.processTurn("user1", ["joy"], "text_chat");

    const growth = store.getGrowthState(noBoundsConfig.roleId);
    expect(growth?.experiences.length ?? 0).toBe(0);
  });

  it("accumulates multiple experiences across turns", () => {
    const engine = createPersonaEngine(config, store);
    engine.processTurn("user1", ["joy"], "text_chat");
    engine.processTurn("user1", ["curiosity"], "text_chat");
    engine.processTurn("user1", ["irritation"], "text_chat");

    const growth = store.getGrowthState(config.roleId);
    expect(growth!.experiences.length).toBe(3);
  });

  it("experience weight is average of emotion weights", () => {
    const engine = createPersonaEngine(config, store);
    engine.processTurn("user1", ["joy", "pride"], "text_chat");

    const growth = store.getGrowthState(config.roleId);
    expect(growth!.experiences.length).toBe(1);
    // Weight should be > 0 (average of emotion weights)
    expect(growth!.experiences[0].weight).toBeGreaterThan(0);
  });
});

// ============================================================================
// C3d: Growth drift in processTimeTick
// ============================================================================

describe("Growth drift in processTimeTick", () => {
  let store: StateStore;
  let config: PersonaEngineConfig;

  beforeEach(() => {
    store = createInMemoryStateStore();
    config = makeConfig({
      growthBounds: { maxDrift: { p: 0.3, a: 0.2, d: 0.2 } },
      growthDriftIntervalMs: MS_PER_DAY,
    });
  });

  it("triggers drift when enough time has passed and experiences exist", () => {
    const engine = createPersonaEngine(config, store);
    // Accumulate some positive experiences
    engine.processTurn("user1", ["joy"], "text_chat");
    engine.processTurn("user1", ["joy"], "text_chat");
    engine.processTurn("user1", ["joy"], "text_chat");

    const before = engine.getDebugSnapshot();
    const beforeP = before.personality.defaultMood.pleasure;

    // Tick with > 24h elapsed
    const now = Date.now();
    engine.processTimeTick("user1", MS_PER_DAY + 1000, now + MS_PER_DAY + 1000);

    // Check growth state was updated
    const growth = store.getGrowthState(config.roleId);
    expect(growth!.lastDriftAt).toBeGreaterThan(0);

    // Personality should have shifted slightly toward positive pleasure
    const after = engine.getDebugSnapshot();
    expect(after.personality.defaultMood.pleasure).toBeGreaterThanOrEqual(beforeP);
  });

  it("does NOT trigger drift when less than driftInterval since last drift", () => {
    const engine = createPersonaEngine(config, store);
    engine.processTurn("user1", ["joy"], "text_chat");

    // Set lastDriftAt to "just now" so the interval hasn't elapsed
    const now = Date.now();
    const growth = store.getGrowthState(config.roleId)!;
    store.saveGrowthState(config.roleId, {
      ...growth,
      lastDriftAt: now,
    });

    const before = engine.getDebugSnapshot();

    // Tick with currentTime only 1 second after lastDriftAt
    engine.processTimeTick("user1", 1000, now + 1000);

    const after = engine.getDebugSnapshot();
    // Personality should NOT change (drift interval not met)
    expect(after.personality.defaultMood.pleasure).toBe(before.personality.defaultMood.pleasure);
  });

  it("does NOT trigger drift when no growthBounds configured", () => {
    const noBoundsConfig = makeConfig({ growthBounds: undefined });
    const engine = createPersonaEngine(noBoundsConfig, store);
    engine.processTurn("user1", ["joy"], "text_chat");

    engine.processTimeTick("user1", MS_PER_DAY + 1000, Date.now() + MS_PER_DAY + 1000);

    // No growth state should exist at all
    const growth = store.getGrowthState(noBoundsConfig.roleId);
    expect(growth?.experiences.length ?? 0).toBe(0);
  });

  it("does NOT trigger drift when no experiences", () => {
    const engine = createPersonaEngine(config, store);

    const before = engine.getDebugSnapshot();
    engine.processTimeTick("user1", MS_PER_DAY + 1000, Date.now() + MS_PER_DAY + 1000);
    const after = engine.getDebugSnapshot();

    expect(after.personality.defaultMood.pleasure).toBe(before.personality.defaultMood.pleasure);
  });

  it("prunes experiences older than 7 days after drift", () => {
    const engine = createPersonaEngine(config, store);

    // Manually seed old experiences
    const now = Date.now();
    const oldExp: GrowthExperience = {
      padDelta: { p: 0.1, a: 0, d: 0 },
      weight: 0.5,
      timestamp: now - 10 * MS_PER_DAY, // 10 days ago
    };
    const recentExp: GrowthExperience = {
      padDelta: { p: 0.1, a: 0, d: 0 },
      weight: 0.5,
      timestamp: now - 1 * MS_PER_DAY, // 1 day ago
    };
    store.saveGrowthState(config.roleId, {
      experiences: [oldExp, recentExp],
      lastDriftAt: 0,
    });

    // Trigger drift
    const tickTime = now + MS_PER_DAY + 1000;
    engine.processTimeTick("user1", MS_PER_DAY + 1000, tickTime);

    const growth = store.getGrowthState(config.roleId);
    // Old experience should be pruned, recent should remain
    expect(growth!.experiences.length).toBe(1);
    expect(growth!.experiences[0].timestamp).toBe(recentExp.timestamp);
  });

  it("updates lastDriftAt after drift", () => {
    const engine = createPersonaEngine(config, store);
    engine.processTurn("user1", ["joy"], "text_chat");

    const tickTime = Date.now() + MS_PER_DAY + 1000;
    engine.processTimeTick("user1", MS_PER_DAY + 1000, tickTime);

    const growth = store.getGrowthState(config.roleId);
    expect(growth!.lastDriftAt).toBe(tickTime);
  });
});

// ============================================================================
// C4b: snapshot-formatter
// ============================================================================

describe("describeMood", () => {
  it("returns '开心' for high pleasure", () => {
    const mood: MoodState = { pleasure: 0.5, arousal: 0, dominance: 0, updatedAt: 0 };
    expect(describeMood(mood)).toContain("开心");
  });

  it("returns '烦躁' for low pleasure", () => {
    const mood: MoodState = { pleasure: -0.5, arousal: 0, dominance: 0, updatedAt: 0 };
    expect(describeMood(mood)).toContain("烦躁");
  });

  it("returns '略微不悦' for neutral-ish mood (pleasure=0 is in 略微不悦 range)", () => {
    const mood: MoodState = { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 };
    expect(describeMood(mood)).toBe("略微不悦");
  });

  it("combines arousal and dominance descriptors", () => {
    const mood: MoodState = { pleasure: 0.5, arousal: 0.5, dominance: 0.7, updatedAt: 0 };
    const desc = describeMood(mood);
    expect(desc).toContain("开心");
    expect(desc).toContain("活跃");
    expect(desc).toContain("自信掌控");
  });
});

describe("STAGE_NAMES", () => {
  it("maps all 5 stages", () => {
    expect(STAGE_NAMES["stranger"]).toBe("陌生人");
    expect(STAGE_NAMES["acquaintance"]).toBe("认识");
    expect(STAGE_NAMES["familiar"]).toBe("熟悉");
    expect(STAGE_NAMES["friend"]).toBe("朋友");
    expect(STAGE_NAMES["close_friend"]).toBe("挚友");
  });
});

describe("formatILESummary", () => {
  it("formats empty snapshot", () => {
    const snapshot: DebugSnapshot = {
      roleId: "kurisu",
      baseMood: { pleasure: -0.2, arousal: 0.3, dominance: 0.6, updatedAt: 0 },
      personality: KURISU_ENGINE_CONFIG.personality,
      userProjections: {},
      relationships: {},
      snapshotAt: Date.now(),
    };

    const result = formatILESummary(snapshot);
    expect(result).toContain("心境:");
    expect(result).toContain("P:");
    expect(result).not.toContain("用户关系:");
  });

  it("formats snapshot with user relationships", () => {
    const snapshot: DebugSnapshot = {
      roleId: "kurisu",
      baseMood: { pleasure: 0.1, arousal: 0.3, dominance: 0.6, updatedAt: 0 },
      personality: KURISU_ENGINE_CONFIG.personality,
      userProjections: {},
      relationships: {
        user1: {
          stage: "friend",
          trust: 52,
          familiarity: 65,
          warmth: 45,
          interactionCount: 100,
          lastInteraction: Date.now(),
          milestoneHistory: [],
        },
      },
      snapshotAt: Date.now(),
    };

    const result = formatILESummary(snapshot);
    expect(result).toContain("用户关系:");
    expect(result).toContain("user1=朋友");
    expect(result).toContain("trust:52");
    expect(result).toContain("warmth:45");
  });

  it("limits to 5 users max", () => {
    const relationships: DebugSnapshot["relationships"] = {};
    for (let i = 0; i < 8; i++) {
      relationships[`user${i}`] = {
        stage: "stranger",
        trust: 10,
        familiarity: 5,
        warmth: 5,
        interactionCount: 1,
        lastInteraction: 0,
        milestoneHistory: [],
      };
    }

    const snapshot: DebugSnapshot = {
      roleId: "kurisu",
      baseMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
      personality: KURISU_ENGINE_CONFIG.personality,
      userProjections: {},
      relationships,
      snapshotAt: Date.now(),
    };

    const result = formatILESummary(snapshot);
    // Count user mentions: should be at most 5
    const userMatches = result.match(/user\d=/g);
    expect(userMatches!.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// C4a: Evolution ILE integration
// ============================================================================

describe("Evolution ILE integration", () => {
  it("ileSummary appears in BackgroundTaskContext when getter provided", async () => {
    const { createEvolutionService } = await import("../../src/evolution/evolution-service.js");

    let capturedContext: unknown = null;

    const evolution = createEvolutionService({
      evolutionConfig: {
        enabled: true,
        reflectionDelayMs: 0,
        reflectionMaxTokens: 1000,
      },
      pipeline: {
        getHealthReport: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, pending: 0 }),
        dispose: vi.fn(),
      } as any,
      tracing: { log: vi.fn() },
      executeBackgroundTask: async (ctx) => {
        capturedContext = ctx;
      },
      getILESummary: () => "心境: 略微不悦但自信掌控 (P:-0.2 A:+0.3 D:+0.6)",
    });

    await evolution.executeRoutine("session-reflect", "会话反思");

    expect(capturedContext).toBeDefined();
    expect((capturedContext as any).ileSummary).toBe(
      "心境: 略微不悦但自信掌控 (P:-0.2 A:+0.3 D:+0.6)",
    );
  });

  it("works without ileSummary getter (backward compatible)", async () => {
    const { createEvolutionService } = await import("../../src/evolution/evolution-service.js");

    let capturedContext: unknown = null;

    const evolution = createEvolutionService({
      evolutionConfig: {
        enabled: true,
        reflectionDelayMs: 0,
        reflectionMaxTokens: 1000,
      },
      pipeline: {
        getHealthReport: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, pending: 0 }),
        dispose: vi.fn(),
      } as any,
      tracing: { log: vi.fn() },
      executeBackgroundTask: async (ctx) => {
        capturedContext = ctx;
      },
      // No getILESummary
    });

    await evolution.executeRoutine("session-reflect", "会话反思");

    expect(capturedContext).toBeDefined();
    expect((capturedContext as any).ileSummary).toBeUndefined();
  });

  it("does not call getter when evolution is disabled", async () => {
    const { createEvolutionService } = await import("../../src/evolution/evolution-service.js");

    const getter = vi.fn(() => "should not be called");

    const evolution = createEvolutionService({
      evolutionConfig: {
        enabled: false,
        reflectionDelayMs: 0,
        reflectionMaxTokens: 1000,
      },
      pipeline: {
        getHealthReport: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0, pending: 0 }),
        dispose: vi.fn(),
      } as any,
      tracing: { log: vi.fn() },
      executeBackgroundTask: vi.fn(),
      getILESummary: getter,
    });

    await evolution.executeRoutine("session-reflect", "会话反思");

    expect(getter).not.toHaveBeenCalled();
  });
});

// ============================================================================
// StateStore GrowthState roundtrip
// ============================================================================

describe("StateStore GrowthState", () => {
  it("roundtrips GrowthState correctly (InMemory)", () => {
    const store = createInMemoryStateStore();

    expect(store.getGrowthState("kurisu")).toBeUndefined();

    const state = {
      experiences: [
        { padDelta: { p: 0.1, a: 0.2, d: -0.1 }, weight: 0.5, timestamp: Date.now() },
      ],
      lastDriftAt: Date.now() - MS_PER_DAY,
    };

    store.saveGrowthState("kurisu", state);
    const loaded = store.getGrowthState("kurisu");
    expect(loaded).toEqual(state);
  });
});
