/**
 * 红莉栖人格默认值
 *
 * @module inner-life/config/kurisu
 * @description 牧瀬紅莉栖 (Makise Kurisu) 人格参数配置
 *
 * @see persona-inner-life.md 第三节
 */

import type {
  PersonalityDefaults,
  GrowthBounds,
  PersonaEngineConfig,
} from "../types.js";

// ============================================================================
// 人格默认值
// ============================================================================

/**
 * 红莉栖人格默认值
 *
 * PAD 基线:
 * - P: -0.2 (微不耐烦，傲娇基调)
 * - A: +0.3 (中等活跃，思维敏捷)
 * - D: +0.6 (掌控感强，自信)
 *
 * 情绪偏置 (傲娇增幅):
 * - shame 1.5 (容易害羞)
 * - pride 1.4 (自尊心强)
 * - defensiveness 1.5 (傲娇防御)
 * - curiosity 1.3 (知识欲强)
 *
 * @see persona-inner-life.md 第三节
 */
export const KURISU_PERSONALITY: PersonalityDefaults = {
  defaultMood: {
    pleasure: -0.2,
    arousal: 0.3,
    dominance: 0.6,
    updatedAt: 0,
  },
  emotionBias: {
    shame: 1.5,
    pride: 1.4,
    defensiveness: 1.5,
    curiosity: 1.3,
    embarrassment: 1.3,
    irritation: 1.2,
  },
  moodDecayRate: 0.15,
  expressionThreshold: 0.2,
} as const;

// ============================================================================
// 成长边界
// ============================================================================

/**
 * 红莉栖成长边界
 *
 * 每个 PAD 维度允许的最大漂移量，防止人格崩坏:
 * - P: ±0.3 (不会从傲娇变成阳光少女)
 * - A: ±0.2 (活跃度相对稳定)
 * - D: ±0.2 (掌控感是核心特征)
 */
export const KURISU_GROWTH_BOUNDS: GrowthBounds = {
  maxDrift: {
    p: 0.3,
    a: 0.2,
    d: 0.2,
  },
} as const;

// ============================================================================
// 完整引擎配置
// ============================================================================

/** 成长 drift 间隔: 24 小时 */
const GROWTH_DRIFT_INTERVAL_MS = 86_400_000;

/**
 * 红莉栖 PersonaEngine 配置
 */
export const KURISU_ENGINE_CONFIG: PersonaEngineConfig = {
  roleId: "kurisu",
  personality: KURISU_PERSONALITY,
  baseMoodSyncRatio: 0.03,
  forgettingDays: 30,
  growthBounds: KURISU_GROWTH_BOUNDS,
  growthDriftIntervalMs: GROWTH_DRIFT_INTERVAL_MS,
} as const;
