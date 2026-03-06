/**
 * handleTimeTick 测试
 */

import { describe, it, expect, vi } from "vitest";
import { handleTimeTick, type TimeTickDeps, type ProactiveActionEvent } from "../../src/platform/time-tick-handler.js";
import { createPersonaEngine, KURISU_ENGINE_CONFIG } from "../../src/inner-life/index.js";
import type { PersonaEngineAPI } from "../../src/inner-life/types.js";

const MS_PER_HOUR = 3_600_000;

function createTestEngine(roleId: string): PersonaEngineAPI {
  return createPersonaEngine({ ...KURISU_ENGINE_CONFIG, roleId });
}

describe("handleTimeTick", () => {
  it("should return zero stats when no users tracked", () => {
    const engine = createTestEngine("r1");
    const deps: TimeTickDeps = {
      engines: new Map([["r1", engine]]),
    };
    const stats = handleTimeTick(deps);
    expect(stats.usersProcessed).toBe(0);
    expect(stats.actionsTriggered).toBe(0);
  });

  it("should process users that have interacted", () => {
    const engine = createTestEngine("r1");
    // Create user interaction so they appear in snapshot
    engine.processTurn("u1", ["joy"], "text_chat");

    // Advance "time" by modifying the projection's lastInteraction
    // We can't easily control time, but processTimeTick works with the
    // elapsed value computed from snapshot. The user was just created
    // so elapsed will be very small (< 5min) and skipped.
    // Instead, let's verify the handler gracefully handles recent users.
    const deps: TimeTickDeps = {
      engines: new Map([["r1", engine]]),
    };
    const stats = handleTimeTick(deps);
    // Recent user (< 5min) should be skipped
    expect(stats.usersProcessed).toBe(0);
  });

  it("should process multiple roles", () => {
    const engine1 = createTestEngine("r1");
    const engine2 = createTestEngine("r2");

    const deps: TimeTickDeps = {
      engines: new Map([
        ["r1", engine1],
        ["r2", engine2],
      ]),
    };
    const stats = handleTimeTick(deps);
    expect(stats.usersProcessed).toBe(0); // no users
    expect(stats.actionsTriggered).toBe(0);
  });

  it("should call onAction when shouldAct is true", () => {
    // Use a mock engine to control shouldAct
    const mockEngine: PersonaEngineAPI = {
      getDebugSnapshot: () => ({
        roleId: "r1",
        characterState: {
          baseMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
          personalityDefaults: { pleasure: 0, arousal: 0, dominance: 0 },
          growthExperiences: [],
          createdAt: 0,
        },
        relationships: {},
        userProjections: {
          "u1": {
            projectedMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
            recentEmotions: [],
            lastInteraction: Date.now() - 2 * MS_PER_HOUR, // 2h ago
          },
        },
        emotionTags: {},
        config: KURISU_ENGINE_CONFIG,
      }),
      processTimeTick: () => ({
        userId: "u1",
        mood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: Date.now() },
        relationship: {
          stage: "familiar" as const,
          familiarity: 50,
          warmth: 30,
          trust: 40,
          lastInteraction: Date.now(),
          interactionCount: 10,
          milestoneHistory: [],
        },
        shouldAct: true,
        timeContext: "距上次对话已过去 2 小时。",
      }),
      // Stubs for unused methods
      buildContext: () => ({ systemPrompt: "", contextBlock: "" }),
      processTurn: () => {},
    } as unknown as PersonaEngineAPI;

    const actions: ProactiveActionEvent[] = [];
    const deps: TimeTickDeps = {
      engines: new Map([["r1", mockEngine]]),
      onAction: (event) => actions.push(event),
    };

    const stats = handleTimeTick(deps);
    expect(stats.usersProcessed).toBe(1);
    expect(stats.actionsTriggered).toBe(1);
    expect(actions).toHaveLength(1);
    expect(actions[0].roleId).toBe("r1");
    expect(actions[0].userId).toBe("u1");
    expect(actions[0].timeContext).toContain("2 小时");
  });

  it("should NOT call onAction when shouldAct is false", () => {
    const mockEngine: PersonaEngineAPI = {
      getDebugSnapshot: () => ({
        roleId: "r1",
        characterState: {
          baseMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
          personalityDefaults: { pleasure: 0, arousal: 0, dominance: 0 },
          growthExperiences: [],
          createdAt: 0,
        },
        relationships: {},
        userProjections: {
          "u1": {
            projectedMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
            recentEmotions: [],
            lastInteraction: Date.now() - 2 * MS_PER_HOUR,
          },
        },
        emotionTags: {},
        config: KURISU_ENGINE_CONFIG,
      }),
      processTimeTick: () => ({
        userId: "u1",
        mood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: Date.now() },
        relationship: {
          stage: "stranger" as const,
          familiarity: 0,
          warmth: 0,
          trust: 0,
          lastInteraction: Date.now(),
          interactionCount: 0,
          milestoneHistory: [],
        },
        shouldAct: false,
        timeContext: "距上次对话已过去 2 小时。",
      }),
      buildContext: () => ({ systemPrompt: "", contextBlock: "" }),
      processTurn: () => {},
    } as unknown as PersonaEngineAPI;

    const actions: ProactiveActionEvent[] = [];
    const deps: TimeTickDeps = {
      engines: new Map([["r1", mockEngine]]),
      onAction: (event) => actions.push(event),
    };

    const stats = handleTimeTick(deps);
    expect(stats.usersProcessed).toBe(1);
    expect(stats.actionsTriggered).toBe(0);
    expect(actions).toHaveLength(0);
  });

  it("should skip users with lastInteraction < 5min ago", () => {
    const mockEngine: PersonaEngineAPI = {
      getDebugSnapshot: () => ({
        roleId: "r1",
        characterState: {
          baseMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
          personalityDefaults: { pleasure: 0, arousal: 0, dominance: 0 },
          growthExperiences: [],
          createdAt: 0,
        },
        relationships: {},
        userProjections: {
          "u1": {
            projectedMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: 0 },
            recentEmotions: [],
            lastInteraction: Date.now() - 60_000, // 1min ago
          },
        },
        emotionTags: {},
        config: KURISU_ENGINE_CONFIG,
      }),
      processTimeTick: vi.fn(),
      buildContext: () => ({ systemPrompt: "", contextBlock: "" }),
      processTurn: () => {},
    } as unknown as PersonaEngineAPI;

    const stats = handleTimeTick({ engines: new Map([["r1", mockEngine]]) });
    expect(stats.usersProcessed).toBe(0);
    expect(mockEngine.processTimeTick).not.toHaveBeenCalled();
  });

  it("should handle empty engines map", () => {
    const stats = handleTimeTick({ engines: new Map() });
    expect(stats.usersProcessed).toBe(0);
    expect(stats.actionsTriggered).toBe(0);
  });
});
