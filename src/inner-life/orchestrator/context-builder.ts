/**
 * Prompt 片段构建
 *
 * @module inner-life/orchestrator/context-builder
 * @description 将 ILE 内部状态转换为 Prompt 注入格式 (~80 tokens)
 *
 * @see persona-inner-life.md IL-6
 */

import type {
  MoodState,
  ActiveEmotion,
  RelationshipState,
  PromptSegments,
  SceneInfo,
  CharacterState,
  UserMoodProjection,
} from "../types.js";
import { describeMood, STAGE_NAMES } from "../core/snapshot-formatter.js";

// ============================================================================
// Mental Model 文本构建
// ============================================================================

/**
 * 格式化 Mental Model 文本
 *
 * 输出示例 (~80 tokens):
 * ```
 * ## 内心状态
 * 心境: 微妙开心但保持警惕 (P:0.3 A:0.4 D:0.6)
 * 活跃情绪: curiosity(0.7), mild_irritation(0.3)
 * 与 {user}: 熟悉阶段, trust:52, warmth:45
 * ```
 *
 * @param mood - 投影心境
 * @param emotions - 活跃情绪
 * @param relationship - 关系状态
 * @param userId - 用户 ID
 * @returns 格式化的 Mental Model 文本
 */
export function buildMentalModelText(
  mood: MoodState,
  emotions: readonly ActiveEmotion[],
  relationship: RelationshipState,
  userId: string,
): string {
  const lines: string[] = [];

  // 心境描述
  const moodDesc = describeMood(mood);
  lines.push(
    `心境: ${moodDesc} (P:${fmt(mood.pleasure)} A:${fmt(mood.arousal)} D:${fmt(mood.dominance)})`,
  );

  // 活跃情绪
  if (emotions.length > 0) {
    const emotionList = emotions
      .slice(0, 4) // 最多显示 4 个
      .map((e) => `${e.tag}(${fmt(e.weight)})`)
      .join(", ");
    lines.push(`活跃情绪: ${emotionList}`);
  }

  // 关系
  const stageName = STAGE_NAMES[relationship.stage] ?? relationship.stage;
  lines.push(
    `与 ${userId}: ${stageName}阶段, trust:${Math.round(relationship.trust)}, warmth:${Math.round(relationship.warmth)}`,
  );

  return lines.join("\n");
}

/**
 * 构建完整 Prompt 片段
 *
 * @param charState - 角色完整状态
 * @param userId - 用户 ID
 * @param scene - 场景信息
 * @param projection - Per-User 投影
 * @param relationship - 关系状态
 * @returns PromptSegments
 */
export function buildPromptSegments(
  _charState: CharacterState,
  userId: string,
  scene: SceneInfo,
  projection: UserMoodProjection,
  relationship: RelationshipState,
): PromptSegments {
  const mentalModelText = buildMentalModelText(
    projection.projectedMood,
    projection.recentEmotions,
    relationship,
    userId,
  );

  // 场景上下文
  const sceneLines: string[] = [];
  if (scene.type === "group" && scene.participants) {
    const others = scene.participants
      .filter((p) => p.userId !== userId)
      .map((p) => `${p.displayName}(${p.relationshipStage})`)
      .join(", ");
    if (others) {
      sceneLines.push(`场景: 群聊, 在场: ${others}`);
    }
  }

  const mentalModel = [
    "## 内心状态",
    mentalModelText,
    ...sceneLines,
  ];

  return {
    identity: [],
    mentalModel,
    lore: [],
  };
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化数字为保留一位小数
 */
function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded >= 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}
