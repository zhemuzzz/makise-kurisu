/**
 * SQLiteStateStore — ILE 持久化存储
 *
 * @module inner-life/orchestrator/sqlite-state-store
 * @description
 *   使用 better-sqlite3（同步 API）实现 StateStore 接口。
 *   接受外部传入的 Database 实例（来自 RoleDataStore），
 *   在独立的 ile_ 前缀表中存储 ILE 状态。
 *
 * Tables:
 *   - ile_character_state: per-role baseMood + personality JSON
 *   - ile_user_projections: per role×user 心境投影
 *   - ile_relationships: per role×user 关系状态
 *
 * @see persona-inner-life.md IL-3
 */

import type Database from "better-sqlite3";

import type {
  CharacterState,
  UserMoodProjection,
  RelationshipState,
  MoodState,
  PersonalityDefaults,
  ActiveEmotion,
  Milestone,
  GrowthState,
  GrowthExperience,
} from "../types.js";
import type { StateStore } from "./state-store.js";

// ============================================================================
// Schema
// ============================================================================

const ILE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS ile_character_state (
    role_id TEXT PRIMARY KEY,
    personality_json TEXT NOT NULL,
    pleasure REAL NOT NULL DEFAULT 0.0,
    arousal REAL NOT NULL DEFAULT 0.0,
    dominance REAL NOT NULL DEFAULT 0.0,
    mood_updated_at INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS ile_user_projections (
    role_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    pleasure REAL NOT NULL DEFAULT 0.0,
    arousal REAL NOT NULL DEFAULT 0.0,
    dominance REAL NOT NULL DEFAULT 0.0,
    mood_updated_at INTEGER NOT NULL DEFAULT 0,
    recent_emotions_json TEXT NOT NULL DEFAULT '[]',
    last_interaction INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (role_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS ile_relationships (
    role_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'stranger',
    trust REAL NOT NULL DEFAULT 0.0,
    familiarity REAL NOT NULL DEFAULT 0.0,
    warmth REAL NOT NULL DEFAULT 0.0,
    interaction_count INTEGER NOT NULL DEFAULT 0,
    last_interaction INTEGER NOT NULL DEFAULT 0,
    milestone_history_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (role_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_ile_projections_role ON ile_user_projections(role_id);
  CREATE INDEX IF NOT EXISTS idx_ile_relationships_role ON ile_relationships(role_id);

  CREATE TABLE IF NOT EXISTS ile_growth_state (
    role_id TEXT PRIMARY KEY,
    experiences_json TEXT NOT NULL DEFAULT '[]',
    last_drift_at INTEGER NOT NULL DEFAULT 0
  );
`;

// ============================================================================
// Implementation
// ============================================================================

class SQLiteStateStoreImpl implements StateStore {
  private readonly db: Database.Database;

  // Prepared statements (lazy-initialized)
  private stmtGetCharacter: Database.Statement | undefined;
  private stmtUpsertCharacter: Database.Statement | undefined;
  private stmtGetProjection: Database.Statement | undefined;
  private stmtUpsertProjection: Database.Statement | undefined;
  private stmtGetRelationship: Database.Statement | undefined;
  private stmtUpsertRelationship: Database.Statement | undefined;
  private stmtGetAllProjections: Database.Statement | undefined;
  private stmtGetAllRelationships: Database.Statement | undefined;
  private stmtGetGrowthState: Database.Statement | undefined;
  private stmtUpsertGrowthState: Database.Statement | undefined;

  constructor(db: Database.Database) {
    this.db = db;
    db.exec(ILE_SCHEMA);
  }

  // --------------------------------------------------------------------------
  // CharacterState
  // --------------------------------------------------------------------------

  getCharacterState(roleId: string): CharacterState | undefined {
    const row = this.getCharacterStmt().get(roleId) as CharacterRow | undefined;
    if (row === undefined) {
      return undefined;
    }

    // Load all projections and relationships for this role
    const projectionRows = this.getAllProjectionsStmt().all(roleId) as ProjectionRow[];
    const relationshipRows = this.getAllRelationshipsStmt().all(roleId) as RelationshipRow[];

    const userProjections = new Map<string, UserMoodProjection>();
    for (const pr of projectionRows) {
      userProjections.set(pr.user_id, rowToProjection(pr));
    }

    const relationships = new Map<string, RelationshipState>();
    for (const rr of relationshipRows) {
      relationships.set(rr.user_id, rowToRelationship(rr));
    }

    return {
      roleId,
      personality: JSON.parse(row.personality_json) as PersonalityDefaults,
      baseMood: {
        pleasure: row.pleasure,
        arousal: row.arousal,
        dominance: row.dominance,
        updatedAt: row.mood_updated_at,
      },
      userProjections,
      relationships,
    };
  }

  saveCharacterState(roleId: string, state: CharacterState): void {
    this.db.transaction(() => {
      // Upsert character row
      this.getUpsertCharacterStmt().run(
        roleId,
        JSON.stringify(state.personality),
        state.baseMood.pleasure,
        state.baseMood.arousal,
        state.baseMood.dominance,
        state.baseMood.updatedAt,
      );

      // Upsert each projection
      for (const [userId, proj] of state.userProjections) {
        this.saveProjectionRow(roleId, userId, proj);
      }

      // Upsert each relationship
      for (const [userId, rel] of state.relationships) {
        this.saveRelationshipRow(roleId, userId, rel);
      }
    })();
  }

  // --------------------------------------------------------------------------
  // UserMoodProjection
  // --------------------------------------------------------------------------

  getUserProjection(
    roleId: string,
    userId: string,
  ): UserMoodProjection | undefined {
    const row = this.getProjectionStmt().get(roleId, userId) as ProjectionRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return rowToProjection(row);
  }

  saveUserProjection(
    roleId: string,
    userId: string,
    projection: UserMoodProjection,
  ): void {
    this.saveProjectionRow(roleId, userId, projection);
  }

  // --------------------------------------------------------------------------
  // RelationshipState
  // --------------------------------------------------------------------------

  getRelationship(
    roleId: string,
    userId: string,
  ): RelationshipState | undefined {
    const row = this.getRelationshipStmt().get(roleId, userId) as RelationshipRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return rowToRelationship(row);
  }

  saveRelationship(
    roleId: string,
    userId: string,
    state: RelationshipState,
  ): void {
    this.saveRelationshipRow(roleId, userId, state);
  }

  // --------------------------------------------------------------------------
  // Private: Row Operations
  // --------------------------------------------------------------------------

  private saveProjectionRow(
    roleId: string,
    userId: string,
    projection: UserMoodProjection,
  ): void {
    this.getUpsertProjectionStmt().run(
      roleId,
      userId,
      projection.projectedMood.pleasure,
      projection.projectedMood.arousal,
      projection.projectedMood.dominance,
      projection.projectedMood.updatedAt,
      JSON.stringify(projection.recentEmotions),
      projection.lastInteraction,
    );
  }

  private saveRelationshipRow(
    roleId: string,
    userId: string,
    state: RelationshipState,
  ): void {
    this.getUpsertRelationshipStmt().run(
      roleId,
      userId,
      state.stage,
      state.trust,
      state.familiarity,
      state.warmth,
      state.interactionCount,
      state.lastInteraction,
      JSON.stringify(state.milestoneHistory),
    );
  }

  // --------------------------------------------------------------------------
  // GrowthState
  // --------------------------------------------------------------------------

  getGrowthState(roleId: string): GrowthState | undefined {
    const row = this.getGrowthStateStmt().get(roleId) as GrowthStateRow | undefined;
    if (row === undefined) return undefined;
    return {
      experiences: JSON.parse(row.experiences_json) as GrowthExperience[],
      lastDriftAt: row.last_drift_at,
    };
  }

  saveGrowthState(roleId: string, state: GrowthState): void {
    this.getUpsertGrowthStateStmt().run(
      roleId,
      JSON.stringify(state.experiences),
      state.lastDriftAt,
    );
  }

  // --------------------------------------------------------------------------
  // Private: Lazy Prepared Statements
  // --------------------------------------------------------------------------

  private getCharacterStmt(): Database.Statement {
    this.stmtGetCharacter ??= this.db.prepare(
      `SELECT personality_json, pleasure, arousal, dominance, mood_updated_at
       FROM ile_character_state WHERE role_id = ?`,
    );
    return this.stmtGetCharacter;
  }

  private getUpsertCharacterStmt(): Database.Statement {
    this.stmtUpsertCharacter ??= this.db.prepare(
      `INSERT INTO ile_character_state (role_id, personality_json, pleasure, arousal, dominance, mood_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(role_id) DO UPDATE SET
         personality_json = excluded.personality_json,
         pleasure = excluded.pleasure,
         arousal = excluded.arousal,
         dominance = excluded.dominance,
         mood_updated_at = excluded.mood_updated_at`,
    );
    return this.stmtUpsertCharacter;
  }

  private getProjectionStmt(): Database.Statement {
    this.stmtGetProjection ??= this.db.prepare(
      `SELECT user_id, pleasure, arousal, dominance, mood_updated_at, recent_emotions_json, last_interaction
       FROM ile_user_projections WHERE role_id = ? AND user_id = ?`,
    );
    return this.stmtGetProjection;
  }

  private getUpsertProjectionStmt(): Database.Statement {
    this.stmtUpsertProjection ??= this.db.prepare(
      `INSERT INTO ile_user_projections (role_id, user_id, pleasure, arousal, dominance, mood_updated_at, recent_emotions_json, last_interaction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(role_id, user_id) DO UPDATE SET
         pleasure = excluded.pleasure,
         arousal = excluded.arousal,
         dominance = excluded.dominance,
         mood_updated_at = excluded.mood_updated_at,
         recent_emotions_json = excluded.recent_emotions_json,
         last_interaction = excluded.last_interaction`,
    );
    return this.stmtUpsertProjection;
  }

  private getRelationshipStmt(): Database.Statement {
    this.stmtGetRelationship ??= this.db.prepare(
      `SELECT user_id, stage, trust, familiarity, warmth, interaction_count, last_interaction, milestone_history_json
       FROM ile_relationships WHERE role_id = ? AND user_id = ?`,
    );
    return this.stmtGetRelationship;
  }

  private getUpsertRelationshipStmt(): Database.Statement {
    this.stmtUpsertRelationship ??= this.db.prepare(
      `INSERT INTO ile_relationships (role_id, user_id, stage, trust, familiarity, warmth, interaction_count, last_interaction, milestone_history_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(role_id, user_id) DO UPDATE SET
         stage = excluded.stage,
         trust = excluded.trust,
         familiarity = excluded.familiarity,
         warmth = excluded.warmth,
         interaction_count = excluded.interaction_count,
         last_interaction = excluded.last_interaction,
         milestone_history_json = excluded.milestone_history_json`,
    );
    return this.stmtUpsertRelationship;
  }

  private getAllProjectionsStmt(): Database.Statement {
    this.stmtGetAllProjections ??= this.db.prepare(
      `SELECT user_id, pleasure, arousal, dominance, mood_updated_at, recent_emotions_json, last_interaction
       FROM ile_user_projections WHERE role_id = ?`,
    );
    return this.stmtGetAllProjections;
  }

  private getAllRelationshipsStmt(): Database.Statement {
    this.stmtGetAllRelationships ??= this.db.prepare(
      `SELECT user_id, stage, trust, familiarity, warmth, interaction_count, last_interaction, milestone_history_json
       FROM ile_relationships WHERE role_id = ?`,
    );
    return this.stmtGetAllRelationships;
  }

  private getGrowthStateStmt(): Database.Statement {
    this.stmtGetGrowthState ??= this.db.prepare(
      `SELECT experiences_json, last_drift_at
       FROM ile_growth_state WHERE role_id = ?`,
    );
    return this.stmtGetGrowthState;
  }

  private getUpsertGrowthStateStmt(): Database.Statement {
    this.stmtUpsertGrowthState ??= this.db.prepare(
      `INSERT INTO ile_growth_state (role_id, experiences_json, last_drift_at)
       VALUES (?, ?, ?)
       ON CONFLICT(role_id) DO UPDATE SET
         experiences_json = excluded.experiences_json,
         last_drift_at = excluded.last_drift_at`,
    );
    return this.stmtUpsertGrowthState;
  }
}

// ============================================================================
// Row Types
// ============================================================================

interface CharacterRow {
  readonly personality_json: string;
  readonly pleasure: number;
  readonly arousal: number;
  readonly dominance: number;
  readonly mood_updated_at: number;
}

interface ProjectionRow {
  readonly user_id: string;
  readonly pleasure: number;
  readonly arousal: number;
  readonly dominance: number;
  readonly mood_updated_at: number;
  readonly recent_emotions_json: string;
  readonly last_interaction: number;
}

interface RelationshipRow {
  readonly user_id: string;
  readonly stage: string;
  readonly trust: number;
  readonly familiarity: number;
  readonly warmth: number;
  readonly interaction_count: number;
  readonly last_interaction: number;
  readonly milestone_history_json: string;
}

interface GrowthStateRow {
  readonly experiences_json: string;
  readonly last_drift_at: number;
}

// ============================================================================
// Row ↔ Domain Converters
// ============================================================================

function rowToProjection(row: ProjectionRow): UserMoodProjection {
  const projectedMood: MoodState = {
    pleasure: row.pleasure,
    arousal: row.arousal,
    dominance: row.dominance,
    updatedAt: row.mood_updated_at,
  };

  return {
    projectedMood,
    recentEmotions: JSON.parse(row.recent_emotions_json) as ActiveEmotion[],
    lastInteraction: row.last_interaction,
  };
}

function rowToRelationship(row: RelationshipRow): RelationshipState {
  return {
    stage: row.stage as RelationshipState["stage"],
    trust: row.trust,
    familiarity: row.familiarity,
    warmth: row.warmth,
    interactionCount: row.interaction_count,
    lastInteraction: row.last_interaction,
    milestoneHistory: JSON.parse(row.milestone_history_json) as Milestone[],
  };
}

// ============================================================================
// Factory
// ============================================================================

/**
 * 创建 SQLite 状态存储
 *
 * @param db - better-sqlite3 Database 实例（通常来自 RoleDataStore）
 */
export function createSQLiteStateStore(db: Database.Database): StateStore {
  return new SQLiteStateStoreImpl(db);
}
