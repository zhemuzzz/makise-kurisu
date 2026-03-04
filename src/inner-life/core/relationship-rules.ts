/**
 * 关系系统规则
 *
 * @module inner-life/core/relationship-rules
 * @description 阶段转换、衰减、里程碑判定、表达阈值调制
 *
 * 纯函数，无副作用，无状态。
 *
 * @see persona-inner-life.md 第四节、第五节
 */

import type {
  RelationshipState,
  RelationshipStage,
  ActiveEmotion,
  InteractionType,
  Milestone,
} from "../types.js";

// ============================================================================
// 常量
// ============================================================================

/**
 * 关系阶段阈值
 *
 * @see persona-inner-life.md 第四节
 */
export const STAGE_THRESHOLDS: ReadonlyArray<{
  readonly stage: RelationshipStage;
  readonly minFamiliarity: number;
}> = [
  { stage: "close_friend", minFamiliarity: 80 },
  { stage: "friend", minFamiliarity: 60 },
  { stage: "familiar", minFamiliarity: 40 },
  { stage: "acquaintance", minFamiliarity: 20 },
  { stage: "stranger", minFamiliarity: 0 },
] as const;

/**
 * 阶段的 familiarity 下限 (衰减不低于此值)
 */
const STAGE_FLOOR: Readonly<Record<RelationshipStage, number>> = {
  close_friend: 80,
  friend: 60,
  familiar: 40,
  acquaintance: 20,
  stranger: 0,
} as const;

/**
 * 阶段升级的额外条件
 */
const STAGE_EXTRA_CONDITIONS: Readonly<
  Record<RelationshipStage, { readonly minTrust: number; readonly minWarmth: number }>
> = {
  stranger: { minTrust: 0, minWarmth: 0 },
  acquaintance: { minTrust: 0, minWarmth: 0 },
  familiar: { minTrust: 30, minWarmth: 0 },
  friend: { minTrust: 50, minWarmth: 0 },
  close_friend: { minTrust: 70, minWarmth: 60 },
} as const;

/** 每日 familiarity 衰减量 */
const FAMILIARITY_DECAY_PER_DAY = 1;

/** 每日 warmth 衰减量 */
const WARMTH_DECAY_PER_DAY = 2;

/** 交互带来的基础增量 */
const INTERACTION_FAMILIARITY_GAIN = 2;
const INTERACTION_WARMTH_BASE = 1;

// ============================================================================
// 阶段判定
// ============================================================================

/**
 * 根据当前状态评估关系阶段
 *
 * 按 familiarity 降序检查阈值，同时检查额外条件 (trust, warmth)
 *
 * @param state - 当前关系状态
 * @returns 关系阶段
 */
export function evaluateRelationshipStage(
  state: RelationshipState,
): RelationshipStage {
  for (const threshold of STAGE_THRESHOLDS) {
    if (state.familiarity >= threshold.minFamiliarity) {
      const extra = STAGE_EXTRA_CONDITIONS[threshold.stage];
      if (state.trust >= extra.minTrust && state.warmth >= extra.minWarmth) {
        return threshold.stage;
      }
    }
  }

  return "stranger";
}

// ============================================================================
// 关系衰减 (Stardew Valley 模式)
// ============================================================================

/**
 * 计算关系衰减
 *
 * - familiarity: -1/天（不低于当前阶段下限）
 * - warmth: -2/天（无下限，可降为 0）
 * - trust: 不自然衰减（只有负面事件才降低）
 *
 * @param state - 当前关系状态
 * @param elapsedDays - 经过的天数
 * @returns 衰减后的关系状态
 */
export function computeRelationshipDecay(
  state: RelationshipState,
  elapsedDays: number,
): RelationshipState {
  if (elapsedDays <= 0) return state;

  const floor = STAGE_FLOOR[state.stage];
  const newFamiliarity = Math.max(
    floor,
    state.familiarity - FAMILIARITY_DECAY_PER_DAY * elapsedDays,
  );
  const newWarmth = Math.max(
    0,
    state.warmth - WARMTH_DECAY_PER_DAY * elapsedDays,
  );

  // 重新评估阶段
  const candidate: RelationshipState = {
    ...state,
    familiarity: newFamiliarity,
    warmth: newWarmth,
  };
  const newStage = evaluateRelationshipStage(candidate);

  return {
    ...candidate,
    stage: newStage,
  };
}

// ============================================================================
// 交互更新
// ============================================================================

/**
 * 根据交互和情绪更新关系
 *
 * 正面情绪 → trust/warmth 微增
 * 负面情绪 → trust 可能微降
 * familiarity 每次交互 +2
 *
 * @param state - 当前关系状态
 * @param emotions - 活跃情绪列表
 * @param _interactionType - 交互类型 (预留)
 * @returns 更新后的关系状态
 */
export function updateRelationshipFromInteraction(
  state: RelationshipState,
  emotions: readonly ActiveEmotion[],
  _interactionType: InteractionType,
): RelationshipState {
  // 1. familiarity 固定增长
  let newFamiliarity = Math.min(100, state.familiarity + INTERACTION_FAMILIARITY_GAIN);

  // 2. 根据情绪计算 trust/warmth 变化
  let trustDelta = 0;
  let warmthDelta = INTERACTION_WARMTH_BASE; // 基线: 每次交互 +1 warmth

  for (const emotion of emotions) {
    const emotionEffect = computeEmotionRelationshipEffect(emotion);
    trustDelta += emotionEffect.trust;
    warmthDelta += emotionEffect.warmth;
  }

  const newTrust = clamp(state.trust + trustDelta, 0, 100);
  const newWarmth = clamp(state.warmth + warmthDelta, 0, 100);
  const now = Date.now();

  const updated: RelationshipState = {
    ...state,
    trust: newTrust,
    familiarity: newFamiliarity,
    warmth: newWarmth,
    interactionCount: state.interactionCount + 1,
    lastInteraction: now,
  };

  // 3. 重新评估阶段
  const newStage = evaluateRelationshipStage(updated);

  return {
    ...updated,
    stage: newStage,
  };
}

/**
 * 单个情绪对关系的影响
 */
function computeEmotionRelationshipEffect(
  emotion: ActiveEmotion,
): { readonly trust: number; readonly warmth: number } {
  // 正面情绪 → trust/warmth 微增
  // 负面情绪 → trust 微降，warmth 不增
  const scale = emotion.weight * 0.5;

  if (emotion.pad.p > 0) {
    // 正面: trust +0.5~2, warmth +0.5~2
    return {
      trust: scale * 0.8,
      warmth: scale,
    };
  } else {
    // 负面: trust 微降, warmth 不变
    return {
      trust: emotion.pad.p * scale * 0.3, // 负面对 trust 影响较小
      warmth: 0,
    };
  }
}

// ============================================================================
// 表达阈值调制
// ============================================================================

/**
 * 调制表达阈值
 *
 * 关系越近 → 表达阈值越低 → 情绪更容易外露
 *
 * stranger: threshold × 1.0 (压抑)
 * close_friend: threshold × 0.5 (开放)
 *
 * @param base - 基础表达阈值
 * @param relationship - 关系状态
 * @returns 调制后的阈值
 */
export function adjustedThreshold(
  base: number,
  relationship: RelationshipState,
): number {
  const familiarity01 = relationship.familiarity / 100;
  return base * (1 - familiarity01 * 0.5);
}

// ============================================================================
// 里程碑判定
// ============================================================================

/**
 * 检查是否达成新里程碑
 *
 * @param state - 当前关系状态
 * @returns 新里程碑，或 null
 */
export function checkMilestone(state: RelationshipState): Milestone | null {
  const now = Date.now();
  const achieved = new Set(state.milestoneHistory.map((m) => m.type));

  // 阶段里程碑
  const stageMilestone = `stage_${state.stage}`;
  if (!achieved.has(stageMilestone) && state.stage !== "stranger") {
    return {
      type: stageMilestone,
      achievedAt: now,
      description: `关系阶段达到: ${stageDisplayName(state.stage)}`,
    };
  }

  // 交互次数里程碑
  const countMilestones = [10, 50, 100, 500] as const;
  for (const count of countMilestones) {
    const milestoneType = `interaction_${count}`;
    if (state.interactionCount >= count && !achieved.has(milestoneType)) {
      return {
        type: milestoneType,
        achievedAt: now,
        description: `交互次数达到 ${count} 次`,
      };
    }
  }

  return null;
}

// ============================================================================
// 初始状态工厂
// ============================================================================

/**
 * 创建初始关系状态
 */
export function createInitialRelationship(): RelationshipState {
  return {
    stage: "stranger",
    trust: 0,
    familiarity: 0,
    warmth: 0,
    interactionCount: 0,
    lastInteraction: Date.now(),
    milestoneHistory: [],
  };
}

// ============================================================================
// 工具函数
// ============================================================================

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stageDisplayName(stage: RelationshipStage): string {
  const names: Record<RelationshipStage, string> = {
    stranger: "陌生人",
    acquaintance: "认识",
    familiar: "熟悉",
    friend: "朋友",
    close_friend: "挚友",
  };
  return names[stage];
}
