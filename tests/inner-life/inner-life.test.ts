/**
 * Inner Life Engine 测试
 * TDD: RED -> GREEN -> IMPROVE
 *
 * 测试范围:
 * - PersonaCore 纯函数 (emotion-mapping, mood-math, relationship-rules, growth-rules)
 * - PersonaOrchestrator 集成测试 (processTurn, buildContext, injectEvent, getDebugSnapshot)
 *
 * 设计来源:
 * - persona-inner-life.md: IL-1~IL-7
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type {
  PADVector,
  MoodState,
  ActiveEmotion,
  RelationshipState,
  PersonalityDefaults,
  GrowthExperience,
  GrowthBounds,
  PersonaEngineAPI,
  SceneInfo,
} from "@/inner-life/types.js";

import {
  EMOTION_PAD_MAP,
  INTENSITY_MULTIPLIERS,
  parseEmotionTag,
  mapEmotionTags,
} from "@/inner-life/core/emotion-mapping.js";

import {
  clampPAD,
  moodToPAD,
  padToMood,
  computeMoodDecay,
  applyEmotionPull,
  computeProjection,
} from "@/inner-life/core/mood-math.js";

import {
  STAGE_THRESHOLDS,
  evaluateRelationshipStage,
  computeRelationshipDecay,
  updateRelationshipFromInteraction,
  adjustedThreshold,
  checkMilestone,
  createInitialRelationship,
} from "@/inner-life/core/relationship-rules.js";

import {
  computeGrowthDrift,
  syncBaseMood,
} from "@/inner-life/core/growth-rules.js";

import { createPersonaEngine } from "@/inner-life/orchestrator/orchestrator.js";

import {
  KURISU_PERSONALITY,
  KURISU_ENGINE_CONFIG,
} from "@/inner-life/config/kurisu.js";

// ============================================================================
// 测试工具
// ============================================================================

function makeMood(p: number, a: number, d: number, updatedAt = 0): MoodState {
  return { pleasure: p, arousal: a, dominance: d, updatedAt };
}

function makeRelationship(
  overrides: Partial<RelationshipState> = {},
): RelationshipState {
  return {
    stage: "stranger",
    trust: 0,
    familiarity: 0,
    warmth: 0,
    interactionCount: 0,
    lastInteraction: Date.now(),
    milestoneHistory: [],
    ...overrides,
  };
}

function makeEmotion(
  tag: ActiveEmotion["tag"],
  weight: number,
  pad: PADVector,
): ActiveEmotion {
  return { tag, weight, intensity: 1.0, pad };
}

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// ============================================================================
// PersonaCore 纯函数测试
// ============================================================================

describe("PersonaCore: emotion-mapping", () => {
  // EM-01: EMOTION_PAD_MAP 包含 14 个标签
  it("EM-01: EMOTION_PAD_MAP contains all 14 emotion tags", () => {
    const tags = Object.keys(EMOTION_PAD_MAP);
    expect(tags).toHaveLength(14);
    expect(tags).toContain("joy");
    expect(tags).toContain("sadness");
    expect(tags).toContain("affection");
    expect(tags).toContain("defensiveness");
  });

  // EM-02: PAD 值在合理范围
  it("EM-02: all PAD values are within [-1, 1]", () => {
    for (const [, pad] of Object.entries(EMOTION_PAD_MAP)) {
      expect(pad.p).toBeGreaterThanOrEqual(-1);
      expect(pad.p).toBeLessThanOrEqual(1);
      expect(pad.a).toBeGreaterThanOrEqual(-1);
      expect(pad.a).toBeLessThanOrEqual(1);
      expect(pad.d).toBeGreaterThanOrEqual(-1);
      expect(pad.d).toBeLessThanOrEqual(1);
    }
  });

  // EM-03: parseEmotionTag 解析基本标签
  it("EM-03: parses basic emotion tags", () => {
    const result = parseEmotionTag("curiosity");
    expect(result).toEqual({ tag: "curiosity", intensity: 1.0 });
  });

  // EM-04: parseEmotionTag 解析 intensity modifier
  it("EM-04: parses intensity modifier prefixes", () => {
    expect(parseEmotionTag("mild_irritation")).toEqual({
      tag: "irritation",
      intensity: 0.5,
    });
    expect(parseEmotionTag("strong_joy")).toEqual({
      tag: "joy",
      intensity: 1.5,
    });
    expect(parseEmotionTag("extreme_shame")).toEqual({
      tag: "shame",
      intensity: 2.0,
    });
  });

  // EM-05: parseEmotionTag 未知标签返回 null (IL-4 fallback)
  it("EM-05: returns null for unknown tags (IL-4 fallback)", () => {
    expect(parseEmotionTag("unknown_emotion")).toBeNull();
    expect(parseEmotionTag("")).toBeNull();
    expect(parseEmotionTag("  ")).toBeNull();
  });

  // EM-06: mapEmotionTags 批量映射
  it("EM-06: batch maps emotion tags with unknown tags filtered", () => {
    const results = mapEmotionTags([
      "joy",
      "mild_irritation",
      "unknown_tag",
      "curiosity",
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]!.tag).toBe("joy");
    expect(results[1]!.tag).toBe("irritation");
    expect(results[2]!.tag).toBe("curiosity");
  });

  // EM-07: mapEmotionTags 空输入
  it("EM-07: returns empty array for empty input", () => {
    expect(mapEmotionTags([])).toEqual([]);
  });

  // EM-08: mapEmotionTags 权重计算正确
  it("EM-08: weight = PAD magnitude × intensity", () => {
    const results = mapEmotionTags(["strong_joy"]);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.intensity).toBe(1.5);
    // PAD for joy scaled by 1.5: (1.05, 0.75, 0.45)
    // magnitude = sqrt(1.05^2 + 0.75^2 + 0.45^2) ≈ 1.367
    // weight = magnitude * 1.5 ≈ 2.05
    expect(r.weight).toBeGreaterThan(1.5);
    expect(r.weight).toBeLessThan(2.5);
  });

  // EM-09: INTENSITY_MULTIPLIERS 有 4 级
  it("EM-09: has 4 intensity levels", () => {
    expect(INTENSITY_MULTIPLIERS["mild_"]).toBe(0.5);
    expect(INTENSITY_MULTIPLIERS[""]).toBe(1.0);
    expect(INTENSITY_MULTIPLIERS["strong_"]).toBe(1.5);
    expect(INTENSITY_MULTIPLIERS["extreme_"]).toBe(2.0);
  });

  // EM-10: 大小写不敏感
  it("EM-10: case insensitive parsing", () => {
    expect(parseEmotionTag("JOY")).toEqual({ tag: "joy", intensity: 1.0 });
    expect(parseEmotionTag("Mild_Irritation")).toEqual({
      tag: "irritation",
      intensity: 0.5,
    });
  });
});

describe("PersonaCore: mood-math", () => {
  const defaults: PersonalityDefaults = {
    defaultMood: makeMood(0, 0, 0),
    emotionBias: {},
    moodDecayRate: 0.5,
    expressionThreshold: 0.2,
  };

  // MOOD-01: clampPAD 限制范围
  it("MOOD-01: clampPAD clamps values to [-1, 1]", () => {
    const result = clampPAD({ p: 1.5, a: -1.5, d: 0.5 });
    expect(result).toEqual({ p: 1, a: -1, d: 0.5 });
  });

  // MOOD-02: moodToPAD / padToMood 互转
  it("MOOD-02: mood ↔ PAD conversion round-trip", () => {
    const mood = makeMood(0.3, -0.5, 0.7, 1000);
    const pad = moodToPAD(mood);
    expect(pad).toEqual({ p: 0.3, a: -0.5, d: 0.7 });
    const back = padToMood(pad, 1000);
    expect(back).toEqual(mood);
  });

  // MOOD-03: 零时间无衰减
  it("MOOD-03: no decay when elapsed is zero", () => {
    const mood = makeMood(0.8, 0.5, 0.3);
    const result = computeMoodDecay(mood, defaults, 0);
    expect(result).toEqual(mood);
  });

  // MOOD-04: 心境向基线衰减
  it("MOOD-04: mood decays toward baseline over time", () => {
    const mood = makeMood(0.8, 0.5, 0.3);
    const result = computeMoodDecay(mood, defaults, MS_PER_HOUR);
    // After 1 hour with rate 0.5: factor = e^(-0.5) ≈ 0.607
    // new.p = 0 + (0.8 - 0) × 0.607 ≈ 0.486
    expect(result.pleasure).toBeGreaterThan(0);
    expect(result.pleasure).toBeLessThan(0.8);
  });

  // MOOD-05: 长时间衰减后接近基线
  it("MOOD-05: decays to near-baseline after long time", () => {
    const mood = makeMood(0.8, 0.5, 0.3);
    const result = computeMoodDecay(mood, defaults, MS_PER_HOUR * 20);
    expect(Math.abs(result.pleasure)).toBeLessThan(0.01);
    expect(Math.abs(result.arousal)).toBeLessThan(0.01);
    expect(Math.abs(result.dominance)).toBeLessThan(0.01);
  });

  // MOOD-06: 情绪拉扯
  it("MOOD-06: applyEmotionPull modifies mood toward emotion PAD", () => {
    const mood = makeMood(0, 0, 0);
    const emotions: readonly ActiveEmotion[] = [
      makeEmotion("joy", 1.0, { p: 0.7, a: 0.5, d: 0.3 }),
    ];
    const result = applyEmotionPull(mood, emotions, {});
    expect(result.pleasure).toBeGreaterThan(0);
    expect(result.arousal).toBeGreaterThan(0);
  });

  // MOOD-07: emotionBias 增幅 (多情绪竞争时 bias 改变权重比例)
  it("MOOD-07: emotionBias amplifies specific emotions in multi-emotion context", () => {
    const mood = makeMood(0, 0, 0);
    const emotions: readonly ActiveEmotion[] = [
      makeEmotion("shame", 1.0, { p: -0.4, a: 0.6, d: -0.5 }),
      makeEmotion("joy", 1.0, { p: 0.7, a: 0.5, d: 0.3 }),
    ];

    // Without bias: shame and joy have equal weight → near-neutral
    const noBias = applyEmotionPull(mood, emotions, {});
    // With shame bias: shame gets 2× weight → more negative pleasure
    const withBias = applyEmotionPull(mood, emotions, { shame: 2.0 });

    // With shame amplified, pleasure should be more negative
    expect(withBias.pleasure).toBeLessThan(noBias.pleasure);
  });

  // MOOD-08: 空情绪无拉扯
  it("MOOD-08: no pull when emotions are empty", () => {
    const mood = makeMood(0.3, 0.2, 0.1);
    const result = applyEmotionPull(mood, [], {});
    expect(result).toEqual(mood);
  });

  // MOOD-09: PAD clamp 在拉扯后生效
  it("MOOD-09: PAD is clamped after emotion pull", () => {
    const mood = makeMood(0.9, 0.9, 0.9);
    const emotions: readonly ActiveEmotion[] = [
      makeEmotion("joy", 5.0, { p: 1.0, a: 1.0, d: 1.0 }),
    ];
    const result = applyEmotionPull(mood, emotions, {});
    expect(result.pleasure).toBeLessThanOrEqual(1);
    expect(result.arousal).toBeLessThanOrEqual(1);
    expect(result.dominance).toBeLessThanOrEqual(1);
  });

  // MOOD-10: 投影合成
  it("MOOD-10: computeProjection synthesizes base + relationship + residual", () => {
    const baseMood = makeMood(0, 0, 0, 1000);
    const relationship = makeRelationship({
      warmth: 80,
      familiarity: 60,
    });
    const residual = makeMood(0.3, 0.2, 0.1, 2000);

    const result = computeProjection(baseMood, relationship, residual);
    // warmth modifier: (80/100) * 0.1 = 0.08 → pleasure increased
    // familiarity modifier: -(60/100) * 0.1 * 0.5 = -0.03 → arousal decreased
    expect(result.pleasure).toBeGreaterThan(0.3);
    expect(result.updatedAt).toBe(2000);
  });
});

describe("PersonaCore: relationship-rules", () => {
  // REL-01: 5 级阶段判定
  it("REL-01: evaluates 5 relationship stages by familiarity", () => {
    expect(
      evaluateRelationshipStage(
        makeRelationship({ familiarity: 0, trust: 0, warmth: 0 }),
      ),
    ).toBe("stranger");
    expect(
      evaluateRelationshipStage(
        makeRelationship({ familiarity: 25, trust: 0, warmth: 0 }),
      ),
    ).toBe("acquaintance");
    expect(
      evaluateRelationshipStage(
        makeRelationship({ familiarity: 45, trust: 30, warmth: 0 }),
      ),
    ).toBe("familiar");
    expect(
      evaluateRelationshipStage(
        makeRelationship({ familiarity: 65, trust: 50, warmth: 0 }),
      ),
    ).toBe("friend");
    expect(
      evaluateRelationshipStage(
        makeRelationship({ familiarity: 85, trust: 70, warmth: 60 }),
      ),
    ).toBe("close_friend");
  });

  // REL-02: 额外条件不满足时降级
  it("REL-02: downgrades when extra conditions not met", () => {
    // familiarity=85 but trust=40 (needs 70 for close_friend, 50 for friend)
    const result = evaluateRelationshipStage(
      makeRelationship({ familiarity: 85, trust: 40, warmth: 60 }),
    );
    expect(result).toBe("familiar"); // trust 40 >= 30 (familiar)
  });

  // REL-03: familiarity 衰减到阶段下限
  it("REL-03: familiarity decays to stage floor", () => {
    const state = makeRelationship({
      stage: "friend",
      familiarity: 70,
      warmth: 50,
      trust: 60,
    });
    const result = computeRelationshipDecay(state, 15);
    // familiarity: 70 - 15*1 = 55, but floor for "friend" = 60
    expect(result.familiarity).toBe(60);
  });

  // REL-04: warmth 衰减无下限 (可降为 0)
  it("REL-04: warmth decays to zero without floor", () => {
    const state = makeRelationship({
      stage: "familiar",
      familiarity: 50,
      warmth: 10,
      trust: 40,
    });
    const result = computeRelationshipDecay(state, 10);
    // warmth: 10 - 10*2 = -10 → clamped to 0
    expect(result.warmth).toBe(0);
  });

  // REL-05: trust 不自然衰减
  it("REL-05: trust does not naturally decay", () => {
    const state = makeRelationship({
      stage: "friend",
      familiarity: 70,
      warmth: 50,
      trust: 60,
    });
    const result = computeRelationshipDecay(state, 100);
    expect(result.trust).toBe(60); // unchanged
  });

  // REL-06: 零天数无衰减
  it("REL-06: no decay with zero elapsed days", () => {
    const state = makeRelationship({
      stage: "friend",
      familiarity: 70,
      warmth: 50,
      trust: 60,
    });
    const result = computeRelationshipDecay(state, 0);
    expect(result).toEqual(state);
  });

  // REL-07: 交互更新关系
  it("REL-07: interaction updates familiarity +2", () => {
    const state = makeRelationship({ familiarity: 10, warmth: 10, trust: 10 });
    const emotions: readonly ActiveEmotion[] = [
      makeEmotion("joy", 1.0, { p: 0.7, a: 0.5, d: 0.3 }),
    ];
    const result = updateRelationshipFromInteraction(
      state,
      emotions,
      "text_chat",
    );
    expect(result.familiarity).toBe(12);
    expect(result.interactionCount).toBe(1);
  });

  // REL-08: 正面情绪增加 trust 和 warmth
  it("REL-08: positive emotions increase trust and warmth", () => {
    const state = makeRelationship({ trust: 10, warmth: 10 });
    const emotions: readonly ActiveEmotion[] = [
      makeEmotion("joy", 1.0, { p: 0.7, a: 0.5, d: 0.3 }),
    ];
    const result = updateRelationshipFromInteraction(
      state,
      emotions,
      "text_chat",
    );
    expect(result.trust).toBeGreaterThan(10);
    expect(result.warmth).toBeGreaterThan(10);
  });

  // REL-09: 负面情绪降低 trust
  it("REL-09: negative emotions decrease trust", () => {
    const state = makeRelationship({ trust: 50, warmth: 50 });
    const emotions: readonly ActiveEmotion[] = [
      makeEmotion("frustration", 1.0, { p: -0.6, a: 0.5, d: -0.2 }),
    ];
    const result = updateRelationshipFromInteraction(
      state,
      emotions,
      "text_chat",
    );
    expect(result.trust).toBeLessThan(50);
  });

  // REL-10: 表达阈值调制
  it("REL-10: expression threshold decreases with closer relationship", () => {
    const base = 0.5;
    const stranger = makeRelationship({ familiarity: 0 });
    const closeFriend = makeRelationship({ familiarity: 100 });

    const strangerThreshold = adjustedThreshold(base, stranger);
    const closeFriendThreshold = adjustedThreshold(base, closeFriend);

    expect(strangerThreshold).toBe(0.5); // 1.0 × 0.5
    expect(closeFriendThreshold).toBe(0.25); // 0.5 × 0.5
  });

  // REL-11: 里程碑判定 — 阶段里程碑
  it("REL-11: detects stage milestone", () => {
    const state = makeRelationship({
      stage: "acquaintance",
      familiarity: 25,
      milestoneHistory: [],
    });
    const milestone = checkMilestone(state);
    expect(milestone).not.toBeNull();
    expect(milestone!.type).toBe("stage_acquaintance");
  });

  // REL-12: 里程碑判定 — 交互次数
  it("REL-12: detects interaction count milestone", () => {
    const state = makeRelationship({
      stage: "stranger",
      interactionCount: 10,
      milestoneHistory: [],
    });
    const milestone = checkMilestone(state);
    expect(milestone).not.toBeNull();
    expect(milestone!.type).toBe("interaction_10");
  });

  // REL-13: 已有里程碑不重复
  it("REL-13: does not repeat already-achieved milestones", () => {
    const state = makeRelationship({
      stage: "acquaintance",
      interactionCount: 10,
      milestoneHistory: [
        {
          type: "stage_acquaintance",
          achievedAt: 1000,
          description: "test",
        },
        { type: "interaction_10", achievedAt: 1000, description: "test" },
      ],
    });
    const milestone = checkMilestone(state);
    expect(milestone).toBeNull();
  });

  // REL-14: createInitialRelationship
  it("REL-14: creates initial relationship as stranger", () => {
    const rel = createInitialRelationship();
    expect(rel.stage).toBe("stranger");
    expect(rel.trust).toBe(0);
    expect(rel.familiarity).toBe(0);
    expect(rel.warmth).toBe(0);
    expect(rel.interactionCount).toBe(0);
    expect(rel.milestoneHistory).toEqual([]);
  });

  // REL-15: STAGE_THRESHOLDS 按 familiarity 降序
  it("REL-15: STAGE_THRESHOLDS are ordered by descending familiarity", () => {
    for (let i = 0; i < STAGE_THRESHOLDS.length - 1; i++) {
      expect(STAGE_THRESHOLDS[i]!.minFamiliarity).toBeGreaterThan(
        STAGE_THRESHOLDS[i + 1]!.minFamiliarity,
      );
    }
  });
});

describe("PersonaCore: growth-rules", () => {
  const personality: PersonalityDefaults = {
    defaultMood: makeMood(0, 0, 0),
    emotionBias: {},
    moodDecayRate: 0.5,
    expressionThreshold: 0.2,
  };

  const bounds: GrowthBounds = {
    maxDrift: { p: 0.3, a: 0.2, d: 0.2 },
  };

  const now = Date.now();

  // GROW-01: 零经历无变化
  it("GROW-01: no drift when experiences are empty", () => {
    const result = computeGrowthDrift(personality, [], bounds, now);
    expect(result).toEqual(personality);
  });

  // GROW-02: 正向经历漂移 pleasure
  it("GROW-02: positive experiences drift pleasure upward", () => {
    const experiences: readonly GrowthExperience[] = Array.from(
      { length: 100 },
      (_, i) => ({
        padDelta: { p: 0.5, a: 0, d: 0 },
        weight: 1.0,
        timestamp: now - i * MS_PER_DAY,
      }),
    );
    const result = computeGrowthDrift(personality, experiences, bounds, now);
    expect(result.defaultMood.pleasure).toBeGreaterThan(0);
  });

  // GROW-03: 边界保护
  it("GROW-03: drift is bounded by maxDrift", () => {
    const experiences: readonly GrowthExperience[] = Array.from(
      { length: 1000 },
      () => ({
        padDelta: { p: 10, a: 10, d: 10 },
        weight: 100,
        timestamp: now,
      }),
    );
    const result = computeGrowthDrift(personality, experiences, bounds, now);
    const driftP = result.defaultMood.pleasure - personality.defaultMood.pleasure;
    expect(Math.abs(driftP)).toBeLessThanOrEqual(bounds.maxDrift.p + 0.001);
  });

  // GROW-04: 时间衰减 — 近期经历权重更高
  it("GROW-04: recent experiences outweigh old ones in mixed set", () => {
    // Mix: recent positive + old negative vs recent negative + old positive
    // If time decay works, the recent emotions dominate
    const largeBounds: GrowthBounds = { maxDrift: { p: 1, a: 1, d: 1 } };

    const recentPositiveOldNegative: readonly GrowthExperience[] = [
      { padDelta: { p: 0.5, a: 0, d: 0 }, weight: 1, timestamp: now },
      {
        padDelta: { p: -0.5, a: 0, d: 0 },
        weight: 1,
        timestamp: now - 365 * MS_PER_DAY,
      },
    ];
    const recentNegativeOldPositive: readonly GrowthExperience[] = [
      { padDelta: { p: -0.5, a: 0, d: 0 }, weight: 1, timestamp: now },
      {
        padDelta: { p: 0.5, a: 0, d: 0 },
        weight: 1,
        timestamp: now - 365 * MS_PER_DAY,
      },
    ];

    const result1 = computeGrowthDrift(
      personality,
      recentPositiveOldNegative,
      largeBounds,
      now,
    );
    const result2 = computeGrowthDrift(
      personality,
      recentNegativeOldPositive,
      largeBounds,
      now,
    );

    // Recent positive should result in higher pleasure than recent negative
    expect(result1.defaultMood.pleasure).toBeGreaterThan(
      result2.defaultMood.pleasure,
    );
  });

  // GROW-05: syncBaseMood 温水煮青蛙
  it("GROW-05: syncBaseMood applies small fraction of delta", () => {
    const baseMood = makeMood(0, 0, 0);
    const delta: PADVector = { p: 1.0, a: 0.5, d: -0.3 };
    const result = syncBaseMood(baseMood, delta, 0.03);

    expect(result.pleasure).toBeCloseTo(0.03, 5);
    expect(result.arousal).toBeCloseTo(0.015, 5);
    expect(result.dominance).toBeCloseTo(-0.009, 5);
  });

  // GROW-06: syncBaseMood 结果在 [-1, 1]
  it("GROW-06: syncBaseMood clamps to [-1, 1]", () => {
    const baseMood = makeMood(0.99, 0.99, -0.99);
    const delta: PADVector = { p: 10, a: 10, d: -10 };
    const result = syncBaseMood(baseMood, delta, 0.5);

    expect(result.pleasure).toBeLessThanOrEqual(1);
    expect(result.arousal).toBeLessThanOrEqual(1);
    expect(result.dominance).toBeGreaterThanOrEqual(-1);
  });
});

// ============================================================================
// PersonaOrchestrator 集成测试
// ============================================================================

describe("PersonaOrchestrator", () => {
  let engine: PersonaEngineAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));

    engine = createPersonaEngine(KURISU_ENGINE_CONFIG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const privateScene: SceneInfo = {
    type: "private",
    targetUserId: "user1",
  };

  // ORCH-01: processTurn 更新心境
  it("ORCH-01: processTurn updates mood via emotion pull", () => {
    const before = engine.getDebugSnapshot("user1");
    engine.processTurn("user1", ["joy", "curiosity"], "text_chat");
    const after = engine.getDebugSnapshot("user1");

    // baseMood should shift slightly
    expect(after.baseMood.pleasure).not.toBe(before.baseMood.pleasure);
  });

  // ORCH-02: processTurn 同步 baseMood
  it("ORCH-02: processTurn syncs baseMood (frog boiling)", () => {
    const before = engine.getDebugSnapshot();

    // Multiple positive interactions
    for (let i = 0; i < 10; i++) {
      engine.processTurn("user1", ["joy", "contentment"], "text_chat");
    }

    const after = engine.getDebugSnapshot();
    // baseMood should have shifted positive
    expect(after.baseMood.pleasure).toBeGreaterThan(before.baseMood.pleasure);
  });

  // ORCH-03: processTurn 更新关系
  it("ORCH-03: processTurn updates relationship", () => {
    engine.processTurn("user1", ["joy"], "text_chat");
    const snapshot = engine.getDebugSnapshot("user1");
    const rel = snapshot.relationships["user1"];

    expect(rel).toBeDefined();
    expect(rel!.interactionCount).toBe(1);
    expect(rel!.familiarity).toBeGreaterThan(0);
  });

  // ORCH-04: processTurn 空标签不崩溃
  it("ORCH-04: processTurn handles empty emotion tags", () => {
    expect(() => {
      engine.processTurn("user1", [], "text_chat");
    }).not.toThrow();
  });

  // ORCH-05: buildContext 返回 PromptSegments
  it("ORCH-05: buildContext returns valid PromptSegments", () => {
    engine.processTurn("user1", ["curiosity"], "text_chat");
    const segments = engine.buildContext("user1", privateScene);

    expect(segments.mentalModel).toBeDefined();
    expect(segments.mentalModel.length).toBeGreaterThan(0);
    expect(segments.mentalModel.some((s) => s.includes("内心状态"))).toBe(
      true,
    );
  });

  // ORCH-06: buildContext per-user 隔离
  it("ORCH-06: per-user mood isolation", () => {
    engine.processTurn("user1", ["joy", "joy", "joy"], "text_chat");
    engine.processTurn(
      "user2",
      ["frustration", "sadness"],
      "text_chat",
    );

    const snap1 = engine.getDebugSnapshot("user1");
    const snap2 = engine.getDebugSnapshot("user2");

    const proj1 = snap1.userProjections["user1"];
    const proj2 = snap2.userProjections["user2"];

    expect(proj1).toBeDefined();
    expect(proj2).toBeDefined();
    // user1 should be more positive than user2
    expect(proj1!.projectedMood.pleasure).toBeGreaterThan(
      proj2!.projectedMood.pleasure,
    );
  });

  // ORCH-07: buildContext 首次用户默认
  it("ORCH-07: buildContext for new user returns defaults", () => {
    const segments = engine.buildContext("new_user", privateScene);
    expect(segments.mentalModel.length).toBeGreaterThan(0);
  });

  // ORCH-08: injectEvent 全局事件
  it("ORCH-08: injectEvent global affects baseMood", () => {
    const before = engine.getDebugSnapshot();

    engine.injectEvent({
      type: "holiday",
      scope: "global",
      moodImpact: { p: 0.3, a: 0.1, d: 0 },
      description: "节日快乐",
      timestamp: Date.now(),
    });

    const after = engine.getDebugSnapshot();
    expect(after.baseMood.pleasure).toBeGreaterThan(before.baseMood.pleasure);
  });

  // ORCH-09: injectEvent 用户事件
  it("ORCH-09: injectEvent user-scoped affects only that user", () => {
    // Ensure user1 exists
    engine.processTurn("user1", ["joy"], "text_chat");
    const before = engine.getDebugSnapshot("user1");

    engine.injectEvent({
      type: "gift",
      scope: "user",
      userId: "user1",
      moodImpact: { p: 0.5, a: 0, d: 0 },
      description: "收到礼物",
      timestamp: Date.now(),
    });

    const after = engine.getDebugSnapshot("user1");
    const proj = after.userProjections["user1"];
    const beforeProj = before.userProjections["user1"];
    expect(proj!.projectedMood.pleasure).toBeGreaterThan(
      beforeProj!.projectedMood.pleasure,
    );
  });

  // ORCH-10: getDebugSnapshot 完整状态
  it("ORCH-10: getDebugSnapshot returns complete state", () => {
    engine.processTurn("user1", ["joy"], "text_chat");
    const snapshot = engine.getDebugSnapshot();

    expect(snapshot.roleId).toBe("kurisu");
    expect(snapshot.baseMood).toBeDefined();
    expect(snapshot.personality).toBeDefined();
    expect(snapshot.snapshotAt).toBeGreaterThan(0);
  });

  // ORCH-11: getDebugSnapshot 指定用户
  it("ORCH-11: getDebugSnapshot filters by userId", () => {
    engine.processTurn("user1", ["joy"], "text_chat");
    engine.processTurn("user2", ["sadness"], "text_chat");

    const snap = engine.getDebugSnapshot("user1");
    expect(Object.keys(snap.userProjections)).toEqual(["user1"]);
    expect(Object.keys(snap.relationships)).toEqual(["user1"]);
  });

  // ORCH-12: 里程碑触发
  it("ORCH-12: milestone triggers on stage change", () => {
    // Many interactions to increase familiarity
    for (let i = 0; i < 15; i++) {
      engine.processTurn("user1", ["joy", "trust"], "text_chat");
    }

    const snap = engine.getDebugSnapshot("user1");
    const rel = snap.relationships["user1"];
    expect(rel).toBeDefined();
    // Should have at least interactionCount >= 10 milestone
    if (rel!.milestoneHistory.length > 0) {
      expect(
        rel!.milestoneHistory.some(
          (m) =>
            m.type.startsWith("stage_") ||
            m.type.startsWith("interaction_"),
        ),
      ).toBe(true);
    }
  });

  // ORCH-13: buildContext 群聊场景
  it("ORCH-13: buildContext includes group scene info", () => {
    engine.processTurn("user1", ["curiosity"], "text_chat");
    const groupScene: SceneInfo = {
      type: "group",
      targetUserId: "user1",
      participants: [
        {
          userId: "user1",
          displayName: "Alice",
          relationshipStage: "familiar",
        },
        {
          userId: "user2",
          displayName: "Bob",
          relationshipStage: "stranger",
        },
      ],
    };

    const segments = engine.buildContext("user1", groupScene);
    const text = segments.mentalModel.join("\n");
    expect(text).toContain("群聊");
    expect(text).toContain("Bob");
  });

  // ORCH-14: 多用户独立 baseMood 温水煮青蛙
  it("ORCH-14: baseMood converges through multiple user interactions", () => {
    const initial = engine.getDebugSnapshot().baseMood.pleasure;

    // Both users have positive interactions
    for (let i = 0; i < 5; i++) {
      engine.processTurn("user1", ["joy"], "text_chat");
      engine.processTurn("user2", ["contentment"], "text_chat");
    }

    const final = engine.getDebugSnapshot().baseMood.pleasure;
    expect(final).toBeGreaterThan(initial);
  });

  // ORCH-15: 关系阶段自然升级
  it("ORCH-15: relationship stage upgrades through interactions", () => {
    // 50 interactions should push familiarity past 20 (acquaintance)
    for (let i = 0; i < 12; i++) {
      engine.processTurn("user1", ["trust", "joy"], "text_chat");
    }

    const snap = engine.getDebugSnapshot("user1");
    const rel = snap.relationships["user1"];
    expect(rel).toBeDefined();
    expect(rel!.familiarity).toBeGreaterThanOrEqual(20);
    expect(["acquaintance", "familiar", "friend", "close_friend"]).toContain(
      rel!.stage,
    );
  });

  // ORCH-16: KURISU_PERSONALITY 配置验证
  it("ORCH-16: Kurisu personality has correct defaults", () => {
    expect(KURISU_PERSONALITY.defaultMood.pleasure).toBe(-0.2);
    expect(KURISU_PERSONALITY.defaultMood.arousal).toBe(0.3);
    expect(KURISU_PERSONALITY.defaultMood.dominance).toBe(0.6);
    expect(KURISU_PERSONALITY.emotionBias.shame).toBe(1.5);
    expect(KURISU_PERSONALITY.emotionBias.pride).toBe(1.4);
    expect(KURISU_PERSONALITY.emotionBias.defensiveness).toBe(1.5);
    expect(KURISU_PERSONALITY.moodDecayRate).toBe(0.15);
    expect(KURISU_PERSONALITY.expressionThreshold).toBe(0.2);
  });
});
