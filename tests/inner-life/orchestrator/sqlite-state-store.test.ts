/**
 * SQLiteStateStore Tests
 *
 * Uses in-memory SQLite (:memory:) for fast, isolated tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import BetterSqlite3 from "better-sqlite3";
import type Database from "better-sqlite3";
import { createSQLiteStateStore } from "../../../src/inner-life/orchestrator/sqlite-state-store.js";
import type { StateStore } from "../../../src/inner-life/orchestrator/state-store.js";
import type {
  CharacterState,
  UserMoodProjection,
  RelationshipState,
  PersonalityDefaults,
  MoodState,
} from "../../../src/inner-life/types.js";

// ============================================================================
// Test Data Factories
// ============================================================================

function makeMood(overrides: Partial<MoodState> = {}): MoodState {
  return {
    pleasure: 0.1,
    arousal: 0.2,
    dominance: 0.3,
    updatedAt: 1000,
    ...overrides,
  };
}

function makePersonality(overrides: Partial<PersonalityDefaults> = {}): PersonalityDefaults {
  return {
    defaultMood: makeMood(),
    emotionBias: { joy: 1.2, irritation: 0.8 },
    moodDecayRate: 0.05,
    expressionThreshold: 0.3,
    ...overrides,
  };
}

function makeCharacterState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    roleId: "kurisu",
    personality: makePersonality(),
    baseMood: makeMood({ pleasure: 0.5, arousal: -0.1, dominance: 0.4, updatedAt: 2000 }),
    userProjections: new Map(),
    relationships: new Map(),
    ...overrides,
  };
}

function makeProjection(overrides: Partial<UserMoodProjection> = {}): UserMoodProjection {
  return {
    projectedMood: makeMood({ pleasure: 0.6, arousal: 0.1, dominance: 0.2, updatedAt: 3000 }),
    recentEmotions: [
      { tag: "joy", weight: 0.8, intensity: 0.9, pad: { p: 0.8, a: 0.5, d: 0.3 } },
    ],
    lastInteraction: 3000,
    ...overrides,
  };
}

function makeRelationship(overrides: Partial<RelationshipState> = {}): RelationshipState {
  return {
    stage: "acquaintance",
    trust: 30,
    familiarity: 25,
    warmth: 20,
    interactionCount: 10,
    lastInteraction: 4000,
    milestoneHistory: [
      { type: "first_meeting", achievedAt: 1000, description: "初次相遇" },
    ],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SQLiteStateStore", () => {
  let db: Database.Database;
  let store: StateStore;

  beforeEach(() => {
    db = new BetterSqlite3(":memory:");
    store = createSQLiteStateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // --------------------------------------------------------------------------
  // CharacterState
  // --------------------------------------------------------------------------

  describe("CharacterState", () => {
    it("should return undefined for non-existent role", () => {
      expect(store.getCharacterState("non-existent")).toBeUndefined();
    });

    it("should save and retrieve character state", () => {
      const state = makeCharacterState();
      store.saveCharacterState("kurisu", state);

      const loaded = store.getCharacterState("kurisu");
      expect(loaded).toBeDefined();
      expect(loaded!.roleId).toBe("kurisu");
      expect(loaded!.baseMood.pleasure).toBe(0.5);
      expect(loaded!.baseMood.arousal).toBe(-0.1);
      expect(loaded!.baseMood.dominance).toBe(0.4);
      expect(loaded!.baseMood.updatedAt).toBe(2000);
    });

    it("should persist personality as JSON", () => {
      const state = makeCharacterState();
      store.saveCharacterState("kurisu", state);

      const loaded = store.getCharacterState("kurisu")!;
      expect(loaded.personality.moodDecayRate).toBe(0.05);
      expect(loaded.personality.expressionThreshold).toBe(0.3);
      expect(loaded.personality.emotionBias).toEqual({ joy: 1.2, irritation: 0.8 });
    });

    it("should save with embedded projections and relationships", () => {
      const projections = new Map<string, UserMoodProjection>();
      projections.set("user1", makeProjection());
      projections.set("user2", makeProjection({ lastInteraction: 5000 }));

      const relationships = new Map<string, RelationshipState>();
      relationships.set("user1", makeRelationship());

      const state = makeCharacterState({ userProjections: projections, relationships });
      store.saveCharacterState("kurisu", state);

      const loaded = store.getCharacterState("kurisu")!;
      expect(loaded.userProjections.size).toBe(2);
      expect(loaded.userProjections.get("user1")!.lastInteraction).toBe(3000);
      expect(loaded.userProjections.get("user2")!.lastInteraction).toBe(5000);
      expect(loaded.relationships.size).toBe(1);
      expect(loaded.relationships.get("user1")!.stage).toBe("acquaintance");
    });

    it("should upsert on repeated save", () => {
      store.saveCharacterState("kurisu", makeCharacterState());
      store.saveCharacterState("kurisu", makeCharacterState({
        baseMood: makeMood({ pleasure: 0.9, updatedAt: 9999 }),
      }));

      const loaded = store.getCharacterState("kurisu")!;
      expect(loaded.baseMood.pleasure).toBe(0.9);
      expect(loaded.baseMood.updatedAt).toBe(9999);
    });

    it("should isolate different roles", () => {
      store.saveCharacterState("kurisu", makeCharacterState({ roleId: "kurisu" }));
      store.saveCharacterState("mayuri", makeCharacterState({
        roleId: "mayuri",
        baseMood: makeMood({ pleasure: 0.8 }),
      }));

      expect(store.getCharacterState("kurisu")!.baseMood.pleasure).toBe(0.5);
      expect(store.getCharacterState("mayuri")!.baseMood.pleasure).toBe(0.8);
    });
  });

  // --------------------------------------------------------------------------
  // UserMoodProjection
  // --------------------------------------------------------------------------

  describe("UserMoodProjection", () => {
    it("should return undefined for non-existent projection", () => {
      expect(store.getUserProjection("kurisu", "user1")).toBeUndefined();
    });

    it("should save and retrieve projection", () => {
      const proj = makeProjection();
      store.saveUserProjection("kurisu", "user1", proj);

      const loaded = store.getUserProjection("kurisu", "user1");
      expect(loaded).toBeDefined();
      expect(loaded!.projectedMood.pleasure).toBe(0.6);
      expect(loaded!.lastInteraction).toBe(3000);
    });

    it("should persist recentEmotions as JSON", () => {
      const proj = makeProjection({
        recentEmotions: [
          { tag: "joy", weight: 0.8, intensity: 0.9, pad: { p: 0.8, a: 0.5, d: 0.3 } },
          { tag: "curiosity", weight: 0.5, intensity: 0.6, pad: { p: 0.4, a: 0.7, d: 0.1 } },
        ],
      });
      store.saveUserProjection("kurisu", "user1", proj);

      const loaded = store.getUserProjection("kurisu", "user1")!;
      expect(loaded.recentEmotions).toHaveLength(2);
      expect(loaded.recentEmotions[0]!.tag).toBe("joy");
      expect(loaded.recentEmotions[1]!.tag).toBe("curiosity");
      expect(loaded.recentEmotions[1]!.pad.a).toBe(0.7);
    });

    it("should upsert on repeated save", () => {
      store.saveUserProjection("kurisu", "user1", makeProjection());
      store.saveUserProjection("kurisu", "user1", makeProjection({ lastInteraction: 9000 }));

      const loaded = store.getUserProjection("kurisu", "user1")!;
      expect(loaded.lastInteraction).toBe(9000);
    });

    it("should isolate different role×user pairs", () => {
      store.saveUserProjection("kurisu", "user1", makeProjection({ lastInteraction: 1000 }));
      store.saveUserProjection("kurisu", "user2", makeProjection({ lastInteraction: 2000 }));
      store.saveUserProjection("mayuri", "user1", makeProjection({ lastInteraction: 3000 }));

      expect(store.getUserProjection("kurisu", "user1")!.lastInteraction).toBe(1000);
      expect(store.getUserProjection("kurisu", "user2")!.lastInteraction).toBe(2000);
      expect(store.getUserProjection("mayuri", "user1")!.lastInteraction).toBe(3000);
    });
  });

  // --------------------------------------------------------------------------
  // RelationshipState
  // --------------------------------------------------------------------------

  describe("RelationshipState", () => {
    it("should return undefined for non-existent relationship", () => {
      expect(store.getRelationship("kurisu", "user1")).toBeUndefined();
    });

    it("should save and retrieve relationship", () => {
      const rel = makeRelationship();
      store.saveRelationship("kurisu", "user1", rel);

      const loaded = store.getRelationship("kurisu", "user1");
      expect(loaded).toBeDefined();
      expect(loaded!.stage).toBe("acquaintance");
      expect(loaded!.trust).toBe(30);
      expect(loaded!.familiarity).toBe(25);
      expect(loaded!.warmth).toBe(20);
      expect(loaded!.interactionCount).toBe(10);
      expect(loaded!.lastInteraction).toBe(4000);
    });

    it("should persist milestoneHistory as JSON", () => {
      const rel = makeRelationship({
        milestoneHistory: [
          { type: "first_meeting", achievedAt: 1000, description: "初次相遇" },
          { type: "first_joke", achievedAt: 2000, description: "首次开玩笑" },
        ],
      });
      store.saveRelationship("kurisu", "user1", rel);

      const loaded = store.getRelationship("kurisu", "user1")!;
      expect(loaded.milestoneHistory).toHaveLength(2);
      expect(loaded.milestoneHistory[0]!.type).toBe("first_meeting");
      expect(loaded.milestoneHistory[1]!.description).toBe("首次开玩笑");
    });

    it("should handle all relationship stages", () => {
      const stages = ["stranger", "acquaintance", "familiar", "friend", "close_friend"] as const;
      for (const stage of stages) {
        store.saveRelationship("kurisu", `user_${stage}`, makeRelationship({ stage }));
        const loaded = store.getRelationship("kurisu", `user_${stage}`)!;
        expect(loaded.stage).toBe(stage);
      }
    });

    it("should upsert on repeated save", () => {
      store.saveRelationship("kurisu", "user1", makeRelationship({ trust: 10 }));
      store.saveRelationship("kurisu", "user1", makeRelationship({ trust: 50 }));

      const loaded = store.getRelationship("kurisu", "user1")!;
      expect(loaded.trust).toBe(50);
    });

    it("should isolate different role×user pairs", () => {
      store.saveRelationship("kurisu", "user1", makeRelationship({ trust: 10 }));
      store.saveRelationship("kurisu", "user2", makeRelationship({ trust: 20 }));
      store.saveRelationship("mayuri", "user1", makeRelationship({ trust: 30 }));

      expect(store.getRelationship("kurisu", "user1")!.trust).toBe(10);
      expect(store.getRelationship("kurisu", "user2")!.trust).toBe(20);
      expect(store.getRelationship("mayuri", "user1")!.trust).toBe(30);
    });
  });

  // --------------------------------------------------------------------------
  // Cross-method consistency
  // --------------------------------------------------------------------------

  describe("cross-method consistency", () => {
    it("individual saves should be visible in getCharacterState", () => {
      // Save character state first (creates the role entry)
      store.saveCharacterState("kurisu", makeCharacterState());

      // Save individual projection and relationship
      store.saveUserProjection("kurisu", "user1", makeProjection({ lastInteraction: 7000 }));
      store.saveRelationship("kurisu", "user1", makeRelationship({ trust: 77 }));

      // getCharacterState should include the individually saved entries
      const loaded = store.getCharacterState("kurisu")!;
      expect(loaded.userProjections.get("user1")!.lastInteraction).toBe(7000);
      expect(loaded.relationships.get("user1")!.trust).toBe(77);
    });

    it("saveCharacterState should update individually saved entries", () => {
      // Save individual projection
      store.saveUserProjection("kurisu", "user1", makeProjection({ lastInteraction: 1000 }));

      // Save full character state with different projection for same user
      const projections = new Map<string, UserMoodProjection>();
      projections.set("user1", makeProjection({ lastInteraction: 9000 }));
      store.saveCharacterState("kurisu", makeCharacterState({ userProjections: projections }));

      // Individual get should reflect the full save
      const loaded = store.getUserProjection("kurisu", "user1")!;
      expect(loaded.lastInteraction).toBe(9000);
    });

    it("should handle empty maps in character state", () => {
      store.saveCharacterState("kurisu", makeCharacterState());

      const loaded = store.getCharacterState("kurisu")!;
      expect(loaded.userProjections.size).toBe(0);
      expect(loaded.relationships.size).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Schema idempotency
  // --------------------------------------------------------------------------

  describe("schema", () => {
    it("should be idempotent (creating store twice on same DB)", () => {
      // Already created in beforeEach, create again
      const store2 = createSQLiteStateStore(db);

      // Both should work
      store.saveCharacterState("kurisu", makeCharacterState());
      const loaded = store2.getCharacterState("kurisu");
      expect(loaded).toBeDefined();
    });
  });
});
