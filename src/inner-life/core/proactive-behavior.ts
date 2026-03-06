/**
 * 主动行为判定 — 纯函数
 *
 * @module inner-life/core/proactive-behavior
 * @description shouldAct 概率函数 + 行动类型选择
 *
 * 概率公式:
 *   probability = baseProbability × (1 + relationshipFactor × 2) × (1 + timeFactor) × emotionFactor
 *   clamped to [0, 0.6]
 *
 * 行动类型:
 *   - send_message: 主动发消息
 *   - self_reflect: 自我反思（内部）
 *   - do_nothing: 不行动
 */

import type { MoodState, RelationshipState } from "../types.js";

// ============================================================================
// Types
// ============================================================================

export interface ProactiveConfig {
  /** 基础概率 (默认 0.05 = 5%) */
  readonly baseProbability: number;
  /** 每日每用户最大主动行动次数 (默认 3) */
  readonly maxActionsPerDay: number;
  /** 最小沉默时长才考虑主动行动 (ms, 默认 1h) */
  readonly minSilenceMs: number;
}

export type ProactiveAction = "send_message" | "self_reflect" | "do_nothing";

export interface ShouldActInput {
  readonly relationship: RelationshipState;
  readonly elapsedMs: number;
  readonly mood: MoodState;
  readonly actionsToday: number;
  readonly config: ProactiveConfig;
}

export interface ShouldActResult {
  readonly shouldAct: boolean;
  readonly probability: number;
  readonly action: ProactiveAction;
  readonly reason: string;
}

// ============================================================================
// Constants
// ============================================================================

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const MAX_PROBABILITY = 0.6;

export const DEFAULT_PROACTIVE_CONFIG: Readonly<ProactiveConfig> = {
  baseProbability: 0.05,
  maxActionsPerDay: 3,
  minSilenceMs: MS_PER_HOUR,
};

// ============================================================================
// Public API
// ============================================================================

/**
 * 计算是否应该主动行动
 *
 * @param input - 判定输入
 * @param randomValue - 可选：注入随机数 (0~1)，用于测试确定性
 * @returns ShouldActResult
 */
export function computeShouldAct(
  input: ShouldActInput,
  randomValue?: number,
): ShouldActResult {
  const { relationship, elapsedMs, mood, actionsToday, config } = input;

  // 硬性约束: 沉默时间不足
  if (elapsedMs < config.minSilenceMs) {
    return {
      shouldAct: false,
      probability: 0,
      action: "do_nothing",
      reason: "沉默时间不足",
    };
  }

  // 硬性约束: 每日限额
  if (actionsToday >= config.maxActionsPerDay) {
    return {
      shouldAct: false,
      probability: 0,
      action: "do_nothing",
      reason: "已达每日限额",
    };
  }

  // 硬性约束: 陌生人不主动
  if (relationship.stage === "stranger") {
    return {
      shouldAct: false,
      probability: 0,
      action: "do_nothing",
      reason: "陌生人不主动行动",
    };
  }

  // 概率计算
  const relationshipFactor = relationship.familiarity / 100; // 0~1
  const timeFactor = Math.min(1, (elapsedMs - config.minSilenceMs) / MS_PER_DAY); // 0~1, 24h 封顶
  const emotionFactor = Math.max(0.5, 1 + mood.pleasure * 0.3); // 0.5~1.3

  const rawProbability =
    config.baseProbability *
    (1 + relationshipFactor * 2) *
    (1 + timeFactor) *
    emotionFactor;

  const probability = Math.min(rawProbability, MAX_PROBABILITY);

  // 掷骰子
  const roll = randomValue ?? Math.random();
  const shouldAct = roll < probability;

  if (!shouldAct) {
    return {
      shouldAct: false,
      probability,
      action: "do_nothing",
      reason: `概率 ${(probability * 100).toFixed(1)}% 未触发`,
    };
  }

  // 行动类型选择
  const action = selectAction(relationship, randomValue);

  return {
    shouldAct: true,
    probability,
    action,
    reason: `概率 ${(probability * 100).toFixed(1)}% 触发`,
  };
}

// ============================================================================
// Internal
// ============================================================================

function selectAction(
  relationship: RelationshipState,
  randomValue?: number,
): ProactiveAction {
  const roll = randomValue ?? Math.random();

  // 亲密关系更倾向于发消息
  if (relationship.stage === "friend" || relationship.stage === "close_friend") {
    return roll < 0.6 ? "send_message" : "self_reflect";
  }

  // 一般关系更倾向于自我反思
  return roll < 0.3 ? "send_message" : "self_reflect";
}
