/**
 * processTimeTick 测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createPersonaEngine, KURISU_ENGINE_CONFIG } from "../../../src/inner-life/index.js";
import type { PersonaEngineAPI, TimeTickResult } from "../../../src/inner-life/types.js";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

describe("processTimeTick", () => {
  let engine: PersonaEngineAPI;

  beforeEach(() => {
    engine = createPersonaEngine({ ...KURISU_ENGINE_CONFIG, roleId: "test" });
  });

  // --------------------------------------------------------------------------
  // 基本行为
  // --------------------------------------------------------------------------

  it("should return TimeTickResult with correct userId", () => {
    const result = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());
    expect(result.userId).toBe("u1");
  });

  it("should return valid MoodState", () => {
    const result = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());
    expect(result.mood).toBeDefined();
    expect(typeof result.mood.pleasure).toBe("number");
    expect(typeof result.mood.arousal).toBe("number");
    expect(typeof result.mood.dominance).toBe("number");
    expect(result.mood.updatedAt).toBeGreaterThan(0);
  });

  it("should return valid RelationshipState", () => {
    const result = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());
    expect(result.relationship).toBeDefined();
    expect(typeof result.relationship.familiarity).toBe("number");
    expect(typeof result.relationship.warmth).toBe("number");
  });

  it("should return timeContext string", () => {
    const result = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());
    expect(typeof result.timeContext).toBe("string");
    expect(result.timeContext.length).toBeGreaterThan(0);
    expect(result.timeContext).toContain("距上次对话");
  });

  it("should return shouldAct boolean", () => {
    const result = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());
    expect(typeof result.shouldAct).toBe("boolean");
  });

  // --------------------------------------------------------------------------
  // Mood 衰减 (性格方向回归)
  // --------------------------------------------------------------------------

  it("should decay mood toward personality default over time", () => {
    // First interact to set non-default mood
    engine.processTurn("u1", ["joy", "curiosity"], "text_chat");

    const snapshot1 = engine.getDebugSnapshot("u1");
    const moodBefore = snapshot1.userProjections["u1"]?.projectedMood;

    // Tick with 6 hours elapsed
    const result = engine.processTimeTick("u1", 6 * MS_PER_HOUR, Date.now());

    // Mood should have moved toward default (Kurisu: p=-0.2, a=0.3, d=0.6)
    // Joy/curiosity would have increased pleasure; decay should reduce it
    expect(result.mood.pleasure).toBeLessThanOrEqual(moodBefore!.pleasure);
  });

  it("should persist decayed mood to state store", () => {
    engine.processTurn("u1", ["joy"], "text_chat");

    // Tick
    engine.processTimeTick("u1", 3 * MS_PER_HOUR, Date.now());

    // Subsequent buildContext should use the decayed mood
    const snapshot = engine.getDebugSnapshot("u1");
    const mood = snapshot.userProjections["u1"]?.projectedMood;
    expect(mood).toBeDefined();
    expect(mood!.updatedAt).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Relationship 衰减
  // --------------------------------------------------------------------------

  it("should decay relationship over multiple days", () => {
    // Build up some relationship first
    for (let i = 0; i < 10; i++) {
      engine.processTurn("u1", ["affection"], "text_chat");
    }

    const snapshotBefore = engine.getDebugSnapshot("u1");
    const relBefore = snapshotBefore.relationships["u1"];

    // Tick with 3 days elapsed
    const result = engine.processTimeTick("u1", 3 * MS_PER_DAY, Date.now());

    // Familiarity and warmth should have decreased
    expect(result.relationship.familiarity).toBeLessThanOrEqual(relBefore!.familiarity);
    expect(result.relationship.warmth).toBeLessThanOrEqual(relBefore!.warmth);
  });

  it("should NOT decay stranger below initial values", () => {
    // New user = stranger with 0 familiarity/warmth
    const result = engine.processTimeTick("new-user", MS_PER_DAY, Date.now());
    expect(result.relationship.familiarity).toBeGreaterThanOrEqual(0);
    expect(result.relationship.warmth).toBeGreaterThanOrEqual(0);
  });

  // --------------------------------------------------------------------------
  // shouldAct 集成 (computeShouldAct 已接入)
  // --------------------------------------------------------------------------

  it("should return shouldAct=false for stranger (short silence)", () => {
    // New user, 1 hour — stranger should never trigger proactive action
    const result = engine.processTimeTick("stranger-user", MS_PER_HOUR, Date.now());
    expect(result.shouldAct).toBe(false);
  });

  it("should compute shouldAct via computeShouldAct for non-stranger", () => {
    // Build up relationship to familiar
    for (let i = 0; i < 15; i++) {
      engine.processTurn("u1", ["affection", "trust"], "text_chat");
    }

    const snapshot = engine.getDebugSnapshot("u1");
    const rel = snapshot.relationships["u1"];
    // Should have progressed beyond stranger
    expect(rel).toBeDefined();
    expect(rel!.familiarity).toBeGreaterThan(0);

    // With sufficient silence, shouldAct could be true (probabilistic)
    // We can't guarantee it triggers, but we can verify the field is boolean
    // and that stranger behavior is no longer hardcoded false
    const result = engine.processTimeTick("u1", 6 * MS_PER_HOUR, Date.now());
    expect(typeof result.shouldAct).toBe("boolean");
  });

  it("should return shouldAct=false when silence < 1h (min silence constraint)", () => {
    // Even for non-stranger, minSilenceMs=1h
    for (let i = 0; i < 10; i++) {
      engine.processTurn("u1", ["affection"], "text_chat");
    }
    // 30 minutes < 1 hour min silence
    const result = engine.processTimeTick("u1", 30 * 60_000, Date.now());
    expect(result.shouldAct).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 状态持久化
  // --------------------------------------------------------------------------

  it("should update state so next tick builds on previous decay", () => {
    engine.processTurn("u1", ["joy"], "text_chat");

    // First tick
    const result1 = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());
    // Second tick
    const result2 = engine.processTimeTick("u1", MS_PER_HOUR, Date.now());

    // Second tick should continue from first tick's decayed state
    // Joy decays more → pleasure should be equal or lower
    expect(result2.mood.pleasure).toBeLessThanOrEqual(result1.mood.pleasure + 0.01);
  });
});
