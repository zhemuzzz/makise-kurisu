/**
 * PAD 心境向量运算
 *
 * @module inner-life/core/mood-math
 * @description PAD 衰减、情绪拉扯、投影合成 — 纯数学函数
 *
 * 纯函数，无副作用，无状态。
 *
 * @see persona-inner-life.md IL-1, IL-2
 */

import type {
  PADVector,
  MoodState,
  PersonalityDefaults,
  ActiveEmotion,
  EmotionTag,
  RelationshipState,
} from "../types.js";

// ============================================================================
// 常量
// ============================================================================

/** 一小时的毫秒数 */
const MS_PER_HOUR = 3_600_000;

/** 情绪拉扯的默认学习率 */
const EMOTION_PULL_RATE = 0.3;

/** 关系修正系数 (warmth/100 * 这个系数 → mood pleasure 修正) */
const RELATIONSHIP_MOOD_FACTOR = 0.1;

// ============================================================================
// PAD 工具函数
// ============================================================================

/**
 * 限制 PAD 向量每个维度到 [-1, 1]
 */
export function clampPAD(v: PADVector): PADVector {
  return {
    p: Math.max(-1, Math.min(1, v.p)),
    a: Math.max(-1, Math.min(1, v.a)),
    d: Math.max(-1, Math.min(1, v.d)),
  };
}

/**
 * MoodState 与 PADVector 互转
 */
export function moodToPAD(mood: MoodState): PADVector {
  return { p: mood.pleasure, a: mood.arousal, d: mood.dominance };
}

export function padToMood(pad: PADVector, updatedAt: number): MoodState {
  const clamped = clampPAD(pad);
  return {
    pleasure: clamped.p,
    arousal: clamped.a,
    dominance: clamped.d,
    updatedAt,
  };
}

// ============================================================================
// 心境衰减
// ============================================================================

/**
 * 计算心境向基线的指数衰减
 *
 * 每个 PAD 维度独立指数衰减:
 *   new = default + (current - default) × e^(-decayRate × hours)
 *
 * @param current - 当前心境
 * @param defaults - 人格默认值 (包含 defaultMood 和 moodDecayRate)
 * @param elapsedMs - 经过的毫秒数
 * @returns 衰减后的新心境
 */
export function computeMoodDecay(
  current: MoodState,
  defaults: PersonalityDefaults,
  elapsedMs: number,
): MoodState {
  if (elapsedMs <= 0) return current;

  const hours = elapsedMs / MS_PER_HOUR;
  const factor = Math.exp(-defaults.moodDecayRate * hours);
  const base = defaults.defaultMood;

  return padToMood(
    {
      p: base.pleasure + (current.pleasure - base.pleasure) * factor,
      a: base.arousal + (current.arousal - base.arousal) * factor,
      d: base.dominance + (current.dominance - base.dominance) * factor,
    },
    current.updatedAt + elapsedMs,
  );
}

// ============================================================================
// 情绪拉扯
// ============================================================================

/**
 * 情绪脉冲拉扯心境
 *
 * 多个情绪的 PAD 向量加权平均后，按学习率混合到当前心境:
 *   new = current + pullRate × Σ(emotion.pad × emotion.weight × bias)
 *
 * @param mood - 当前心境
 * @param emotions - 活跃情绪列表
 * @param emotionBias - 人格情绪偏置 (增幅/衰减系数)
 * @returns 拉扯后的新心境
 */
export function applyEmotionPull(
  mood: MoodState,
  emotions: readonly ActiveEmotion[],
  emotionBias: Readonly<Partial<Record<EmotionTag, number>>>,
): MoodState {
  if (emotions.length === 0) return mood;

  let deltaP = 0;
  let deltaA = 0;
  let deltaD = 0;
  let totalWeight = 0;

  for (const emotion of emotions) {
    const bias = emotionBias[emotion.tag] ?? 1.0;
    const w = emotion.weight * bias;

    deltaP += emotion.pad.p * w;
    deltaA += emotion.pad.a * w;
    deltaD += emotion.pad.d * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return mood;

  // 归一化后按学习率混合
  const scale = EMOTION_PULL_RATE / totalWeight;

  return padToMood(
    {
      p: mood.pleasure + deltaP * scale,
      a: mood.arousal + deltaA * scale,
      d: mood.dominance + deltaD * scale,
    },
    Date.now(),
  );
}

// ============================================================================
// Per-User 投影合成 (IL-2)
// ============================================================================

/**
 * 计算 Per-User 心境投影
 *
 * projectedMood = baseMood + relationshipModifier + recentResidual
 *
 * relationshipModifier: 关系越好 → pleasure 轻微提升
 * recentResidual: 近期交互残余 (已存储在 UserMoodProjection 中)
 *
 * @param baseMood - 角色全局基线心境
 * @param relationship - 用户关系状态
 * @param residual - 近期交互残余心境
 * @returns 合成后的投影心境
 */
export function computeProjection(
  baseMood: MoodState,
  relationship: RelationshipState,
  residual: MoodState,
): MoodState {
  // 关系修正: warmth 越高 → pleasure 轻微正向
  const warmthModifier = (relationship.warmth / 100) * RELATIONSHIP_MOOD_FACTOR;
  // 亲密度修正: familiarity 越高 → arousal 轻微降低 (更放松)
  const familiarityModifier =
    -(relationship.familiarity / 100) * RELATIONSHIP_MOOD_FACTOR * 0.5;

  // 残余 = residual - baseMood 的差值部分
  const residualDeltaP = residual.pleasure - baseMood.pleasure;
  const residualDeltaA = residual.arousal - baseMood.arousal;
  const residualDeltaD = residual.dominance - baseMood.dominance;

  return padToMood(
    {
      p: baseMood.pleasure + warmthModifier + residualDeltaP,
      a: baseMood.arousal + familiarityModifier + residualDeltaA,
      d: baseMood.dominance + residualDeltaD,
    },
    Math.max(baseMood.updatedAt, residual.updatedAt),
  );
}
