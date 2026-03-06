/**
 * Inner Life Engine — Barrel Exports
 *
 * @module inner-life
 * @description 对外导出: 类型、接口、工厂函数、Core 纯函数
 *
 * @see persona-inner-life.md
 */

// ============================================================================
// 类型导出
// ============================================================================

export type {
  PADVector,
  MoodState,
  EmotionTag,
  IntensityModifier,
  ActiveEmotion,
  PersonalityDefaults,
  UserMoodProjection,
  RelationshipState,
  RelationshipStage,
  Milestone,
  GrowthExperience,
  GrowthBounds,
  CharacterState,
  InteractionType,
  PersonaEvent,
  SceneInfo,
  ParticipantInfo,
  PromptSegments,
  DebugSnapshot,
  PersonaEngineAPI,
  PersonaEngineConfig,
  TimeTickResult,
} from "./types.js";

export { EMOTION_TAGS } from "./types.js";

// ============================================================================
// Core 纯函数 (供直接调用/测试)
// ============================================================================

// emotion-mapping
export {
  EMOTION_PAD_MAP,
  INTENSITY_MULTIPLIERS,
  parseEmotionTag,
  mapEmotionTags,
} from "./core/emotion-mapping.js";

// mood-math
export {
  clampPAD,
  moodToPAD,
  padToMood,
  computeMoodDecay,
  applyEmotionPull,
  computeProjection,
} from "./core/mood-math.js";

// relationship-rules
export {
  STAGE_THRESHOLDS,
  evaluateRelationshipStage,
  computeRelationshipDecay,
  updateRelationshipFromInteraction,
  adjustedThreshold,
  checkMilestone,
  createInitialRelationship,
} from "./core/relationship-rules.js";

// growth-rules
export {
  computeGrowthDrift,
  syncBaseMood,
} from "./core/growth-rules.js";

// time-context
export { formatTimeContext } from "./core/time-context.js";

// proactive-behavior
export {
  computeShouldAct,
  DEFAULT_PROACTIVE_CONFIG,
} from "./core/proactive-behavior.js";
export type {
  ProactiveConfig,
  ProactiveAction,
  ShouldActInput,
  ShouldActResult,
} from "./core/proactive-behavior.js";

// ============================================================================
// Orchestrator (工厂)
// ============================================================================

export { createPersonaEngine } from "./orchestrator/orchestrator.js";

// ============================================================================
// State Store (供 DI 注入)
// ============================================================================

export type { StateStore } from "./orchestrator/state-store.js";
export { createInMemoryStateStore } from "./orchestrator/state-store.js";

// ============================================================================
// 配置
// ============================================================================

export {
  KURISU_PERSONALITY,
  KURISU_GROWTH_BOUNDS,
  KURISU_ENGINE_CONFIG,
} from "./config/kurisu.js";

// ============================================================================
// Context Builder (供 Platform adapter 使用)
// ============================================================================

export {
  buildMentalModelText,
  buildPromptSegments,
} from "./orchestrator/context-builder.js";
