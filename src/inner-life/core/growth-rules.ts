/**
 * 成长规则
 *
 * @module inner-life/core/growth-rules
 * @description 基线漂移公式 + 边界保护
 *
 * 纯函数，无副作用，无状态。
 *
 * @see persona-inner-life.md IL-1, 第一节 (Personality 周月级)
 */

import type {
  PersonalityDefaults,
  GrowthExperience,
  GrowthBounds,
  MoodState,
  PADVector,
} from "../types.js";

// ============================================================================
// 常量
// ============================================================================

/** 成长学习率 (每次经历对基线的影响比例) */
const GROWTH_LEARNING_RATE = 0.01;

/** 时间衰减半衰期 (毫秒，30 天) */
const HALF_LIFE_MS = 30 * 86_400_000;

/** ln(2) 用于半衰期计算 */
const LN2 = Math.LN2;

// ============================================================================
// 基线漂移
// ============================================================================

/**
 * 计算人格基线漂移
 *
 * 累积经历缓慢漂移人格基线 (周/月级变化):
 * - 每个 GrowthExperience 按时间衰减后加权
 * - 总漂移量受 GrowthBounds 约束 (防止人格崩坏)
 * - 学习率极低 (1%), 只有大量持续的同方向经历才会产生可观的漂移
 *
 * @param current - 当前人格默认值
 * @param experiences - 成长经历列表
 * @param bounds - 漂移边界
 * @param referenceTime - 参考时间 (用于计算时间衰减)
 * @returns 漂移后的人格默认值
 */
export function computeGrowthDrift(
  current: PersonalityDefaults,
  experiences: readonly GrowthExperience[],
  bounds: GrowthBounds,
  referenceTime: number = Date.now(),
): PersonalityDefaults {
  if (experiences.length === 0) return current;

  // 1. 加权聚合所有经历的 PAD 变化
  let deltaP = 0;
  let deltaA = 0;
  let deltaD = 0;
  let totalWeight = 0;

  for (const exp of experiences) {
    // 时间衰减: 越久远的经历影响越小
    const age = referenceTime - exp.timestamp;
    const decay = Math.exp(-(LN2 / HALF_LIFE_MS) * Math.max(0, age));
    const w = exp.weight * decay;

    deltaP += exp.padDelta.p * w;
    deltaA += exp.padDelta.a * w;
    deltaD += exp.padDelta.d * w;
    totalWeight += w;
  }

  if (totalWeight === 0) return current;

  // 2. 归一化 + 学习率
  const scale = GROWTH_LEARNING_RATE / totalWeight;
  const rawDriftP = deltaP * scale;
  const rawDriftA = deltaA * scale;
  const rawDriftD = deltaD * scale;

  // 3. 边界保护: 限制每个维度的漂移量
  const clampedDriftP = clampDrift(rawDriftP, bounds.maxDrift.p);
  const clampedDriftA = clampDrift(rawDriftA, bounds.maxDrift.a);
  const clampedDriftD = clampDrift(rawDriftD, bounds.maxDrift.d);

  // 4. 应用漂移到 defaultMood
  const baseMood = current.defaultMood;
  const newDefaultMood: MoodState = {
    pleasure: clamp(baseMood.pleasure + clampedDriftP, -1, 1),
    arousal: clamp(baseMood.arousal + clampedDriftA, -1, 1),
    dominance: clamp(baseMood.dominance + clampedDriftD, -1, 1),
    updatedAt: referenceTime,
  };

  return {
    ...current,
    defaultMood: newDefaultMood,
  };
}

// ============================================================================
// baseMood 温水煮青蛙同步
// ============================================================================

/**
 * 将 per-user 变化量的一小部分同步到 baseMood
 *
 * @see persona-inner-life.md IL-2 baseMood 更新策略
 *
 * @param baseMood - 当前全局基线心境
 * @param userMoodDelta - 用户交互产生的心境变化 (projectedMood - baseMood)
 * @param syncRatio - 同步比例 (0-1, 默认 0.03 即 3%)
 * @returns 更新后的 baseMood
 */
export function syncBaseMood(
  baseMood: MoodState,
  userMoodDelta: PADVector,
  syncRatio: number = 0.03,
): MoodState {
  return {
    pleasure: clamp(baseMood.pleasure + userMoodDelta.p * syncRatio, -1, 1),
    arousal: clamp(baseMood.arousal + userMoodDelta.a * syncRatio, -1, 1),
    dominance: clamp(baseMood.dominance + userMoodDelta.d * syncRatio, -1, 1),
    updatedAt: Date.now(),
  };
}

// ============================================================================
// 工具函数
// ============================================================================

function clampDrift(drift: number, maxAbsDrift: number): number {
  return Math.max(-maxAbsDrift, Math.min(maxAbsDrift, drift));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
