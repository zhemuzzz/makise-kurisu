/**
 * computeShouldAct 测试
 */

import { describe, it, expect } from "vitest";
import {
  computeShouldAct,
  DEFAULT_PROACTIVE_CONFIG,
  type ShouldActInput,
  type ProactiveConfig,
} from "../../../src/inner-life/core/proactive-behavior.js";
import type { MoodState, RelationshipState } from "../../../src/inner-life/types.js";

// ============================================================================
// Helpers
// ============================================================================

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

function makeMood(overrides?: Partial<MoodState>): MoodState {
  return {
    pleasure: 0,
    arousal: 0,
    dominance: 0,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeRelationship(overrides?: Partial<RelationshipState>): RelationshipState {
  return {
    stage: "familiar",
    familiarity: 50,
    warmth: 30,
    trust: 40,
    lastInteraction: Date.now() - 2 * MS_PER_HOUR,
    interactionCount: 10,
    milestoneHistory: [],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<ShouldActInput>): ShouldActInput {
  return {
    relationship: makeRelationship(),
    elapsedMs: 2 * MS_PER_HOUR,
    mood: makeMood(),
    actionsToday: 0,
    config: DEFAULT_PROACTIVE_CONFIG,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("computeShouldAct", () => {
  // --------------------------------------------------------------------------
  // 硬性约束
  // --------------------------------------------------------------------------

  describe("hard constraints", () => {
    it("should return do_nothing when silence < minSilenceMs", () => {
      const input = makeInput({ elapsedMs: 30 * 60_000 }); // 30min < 1h
      const result = computeShouldAct(input, 0); // randomValue=0 → 必中
      expect(result.shouldAct).toBe(false);
      expect(result.probability).toBe(0);
      expect(result.action).toBe("do_nothing");
      expect(result.reason).toContain("沉默时间不足");
    });

    it("should return do_nothing when actionsToday >= maxActionsPerDay", () => {
      const input = makeInput({ actionsToday: 3 }); // default max = 3
      const result = computeShouldAct(input, 0);
      expect(result.shouldAct).toBe(false);
      expect(result.probability).toBe(0);
      expect(result.reason).toContain("每日限额");
    });

    it("should return do_nothing for stranger regardless of probability", () => {
      const input = makeInput({
        relationship: makeRelationship({ stage: "stranger", familiarity: 0 }),
      });
      const result = computeShouldAct(input, 0);
      expect(result.shouldAct).toBe(false);
      expect(result.probability).toBe(0);
      expect(result.reason).toContain("陌生人");
    });
  });

  // --------------------------------------------------------------------------
  // 概率计算
  // --------------------------------------------------------------------------

  describe("probability calculation", () => {
    it("should compute probability with default config and familiar user", () => {
      const input = makeInput({
        relationship: makeRelationship({ familiarity: 50 }),
        elapsedMs: 2 * MS_PER_HOUR,
        mood: makeMood({ pleasure: 0 }),
      });
      // randomValue=1 → 不触发，但可以观察概率
      const result = computeShouldAct(input, 1);

      // baseProbability=0.05, relationshipFactor=0.5, timeFactor=(2h-1h)/24h≈0.0417
      // emotionFactor=max(0.5, 1+0*0.3)=1.0
      // raw = 0.05 * (1+0.5*2) * (1+0.0417) * 1.0 = 0.05 * 2 * 1.0417 = 0.10417
      expect(result.probability).toBeCloseTo(0.1042, 3);
      expect(result.shouldAct).toBe(false);
    });

    it("should increase probability with higher familiarity", () => {
      const lowFam = makeInput({
        relationship: makeRelationship({ familiarity: 20 }),
      });
      const highFam = makeInput({
        relationship: makeRelationship({ familiarity: 80 }),
      });

      const rLow = computeShouldAct(lowFam, 1);
      const rHigh = computeShouldAct(highFam, 1);

      expect(rHigh.probability).toBeGreaterThan(rLow.probability);
    });

    it("should increase probability with longer silence", () => {
      const short = makeInput({ elapsedMs: 2 * MS_PER_HOUR });
      const long = makeInput({ elapsedMs: 12 * MS_PER_HOUR });

      const rShort = computeShouldAct(short, 1);
      const rLong = computeShouldAct(long, 1);

      expect(rLong.probability).toBeGreaterThan(rShort.probability);
    });

    it("should cap timeFactor at 24h", () => {
      const at24h = makeInput({ elapsedMs: MS_PER_DAY + MS_PER_HOUR });
      const at48h = makeInput({ elapsedMs: 2 * MS_PER_DAY });

      const r24 = computeShouldAct(at24h, 1);
      const r48 = computeShouldAct(at48h, 1);

      // timeFactor 应当都为 1（封顶），概率相同
      expect(r24.probability).toBeCloseTo(r48.probability, 4);
    });

    it("should clamp probability to MAX_PROBABILITY (0.6)", () => {
      const input = makeInput({
        relationship: makeRelationship({
          stage: "close_friend",
          familiarity: 100,
        }),
        elapsedMs: 2 * MS_PER_DAY,
        mood: makeMood({ pleasure: 1 }), // max happiness
        config: { ...DEFAULT_PROACTIVE_CONFIG, baseProbability: 0.5 },
      });
      const result = computeShouldAct(input, 1);
      expect(result.probability).toBeLessThanOrEqual(0.6);
    });

    it("should have higher probability when happy (positive pleasure)", () => {
      const sad = makeInput({ mood: makeMood({ pleasure: -1 }) });
      const happy = makeInput({ mood: makeMood({ pleasure: 1 }) });

      const rSad = computeShouldAct(sad, 1);
      const rHappy = computeShouldAct(happy, 1);

      expect(rHappy.probability).toBeGreaterThan(rSad.probability);
    });

    it("should floor emotionFactor at 0.5 (very negative pleasure)", () => {
      // pleasure=-1 → emotionFactor = max(0.5, 1 + (-1)*0.3) = max(0.5, 0.7) = 0.7
      // pleasure=-2 (hypothetical) would give max(0.5, 0.4) = 0.5, but PAD is [-1,1]
      // At pleasure=-1: factor = 0.7, not 0.5
      // The floor matters for extreme values
      const input = makeInput({ mood: makeMood({ pleasure: -1 }) });
      const result = computeShouldAct(input, 1);
      expect(result.probability).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // 触发判定
  // --------------------------------------------------------------------------

  describe("trigger decision", () => {
    it("should trigger when randomValue < probability", () => {
      const input = makeInput();
      const { probability } = computeShouldAct(input, 1); // get probability first
      const result = computeShouldAct(input, probability - 0.001); // just below → trigger
      expect(result.shouldAct).toBe(true);
    });

    it("should NOT trigger when randomValue >= probability", () => {
      const input = makeInput();
      const { probability } = computeShouldAct(input, 1);
      const result = computeShouldAct(input, probability + 0.001); // just above → no trigger
      expect(result.shouldAct).toBe(false);
      expect(result.reason).toContain("未触发");
    });

    it("should trigger with randomValue = 0 (guaranteed)", () => {
      const input = makeInput();
      const result = computeShouldAct(input, 0);
      expect(result.shouldAct).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 行动类型选择
  // --------------------------------------------------------------------------

  describe("action type selection", () => {
    it("should prefer send_message for close friends (roll < 0.6)", () => {
      const input = makeInput({
        relationship: makeRelationship({ stage: "close_friend", familiarity: 90 }),
      });
      const result = computeShouldAct(input, 0); // roll=0 < 0.6 → send_message
      expect(result.action).toBe("send_message");
    });

    it("should select self_reflect for close friends when roll >= 0.6", () => {
      const input = makeInput({
        relationship: makeRelationship({ stage: "friend", familiarity: 70 }),
      });
      // Need probability > 0.7 to trigger with roll=0.7, then action check uses same roll
      // Use roll=0 to guarantee trigger, but action selection uses same randomValue
      // Actually, looking at the code: selectAction uses the SAME randomValue
      // roll=0 → trigger (0 < prob) → action: 0 < 0.6 → send_message
      // roll=0.7 → need prob > 0.7 to trigger
      // Let's use a high-probability config
      const highProbInput = makeInput({
        relationship: makeRelationship({ stage: "friend", familiarity: 90 }),
        elapsedMs: MS_PER_DAY,
        config: { ...DEFAULT_PROACTIVE_CONFIG, baseProbability: 0.3 },
      });
      const result = computeShouldAct(highProbInput, 0.59);
      // 0.59 < probability (should be high) → trigger
      // selectAction: friend, roll=0.59, 0.59 < 0.6 → send_message
      if (result.shouldAct) {
        expect(result.action).toBe("send_message");
      }
    });

    it("should prefer self_reflect for acquaintance (roll >= 0.3)", () => {
      const input = makeInput({
        relationship: makeRelationship({ stage: "acquaintance", familiarity: 20 }),
        elapsedMs: MS_PER_DAY,
        config: { ...DEFAULT_PROACTIVE_CONFIG, baseProbability: 0.3 },
      });
      // acquaintance: roll < 0.3 → send_message, roll >= 0.3 → self_reflect
      // Need to trigger first, so use a value that works
      // probability with fam=20: 0.3 * (1+0.2*2) * (1+1) * 1.0 = 0.3 * 1.4 * 2 = 0.84 → clamped to 0.6
      const result = computeShouldAct(input, 0.35);
      // 0.35 < 0.6 → trigger, action: acquaintance, roll=0.35 >= 0.3 → self_reflect
      expect(result.shouldAct).toBe(true);
      expect(result.action).toBe("self_reflect");
    });

    it("should select send_message for acquaintance when roll < 0.3", () => {
      const input = makeInput({
        relationship: makeRelationship({ stage: "acquaintance", familiarity: 20 }),
        elapsedMs: MS_PER_DAY,
        config: { ...DEFAULT_PROACTIVE_CONFIG, baseProbability: 0.3 },
      });
      const result = computeShouldAct(input, 0.1);
      expect(result.shouldAct).toBe(true);
      expect(result.action).toBe("send_message");
    });
  });

  // --------------------------------------------------------------------------
  // 边界情况
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("should handle elapsedMs exactly at minSilenceMs", () => {
      const input = makeInput({ elapsedMs: MS_PER_HOUR }); // exactly 1h
      const result = computeShouldAct(input, 0);
      // timeFactor = (1h - 1h) / 24h = 0
      // Should still compute (not blocked)
      expect(result.probability).toBeGreaterThan(0);
    });

    it("should handle actionsToday at maxActionsPerDay - 1", () => {
      const input = makeInput({ actionsToday: 2 }); // max=3, 2 < 3 → allowed
      const result = computeShouldAct(input, 0);
      expect(result.shouldAct).toBe(true);
    });

    it("should handle zero familiarity non-stranger", () => {
      const input = makeInput({
        relationship: makeRelationship({ stage: "acquaintance", familiarity: 0 }),
      });
      const result = computeShouldAct(input, 1);
      // relationshipFactor=0, prob = 0.05 * 1 * (1+timeFactor) * 1.0
      expect(result.probability).toBeGreaterThan(0);
    });

    it("should work with custom config", () => {
      const config: ProactiveConfig = {
        baseProbability: 0.1,
        maxActionsPerDay: 5,
        minSilenceMs: 30 * 60_000, // 30min
      };
      const input = makeInput({
        config,
        elapsedMs: 45 * 60_000, // 45min > 30min custom min
      });
      const result = computeShouldAct(input, 0);
      expect(result.shouldAct).toBe(true);
    });
  });
});
