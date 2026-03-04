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
  const stageNames: Record<string, string> = {
    stranger: "陌生人",
    acquaintance: "认识",
    familiar: "熟悉",
    friend: "朋友",
    close_friend: "挚友",
  };
  const stageName = stageNames[relationship.stage] ?? relationship.stage;
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
 * 描述心境 (自然语言)
 */
function describeMood(mood: MoodState): string {
  const parts: string[] = [];

  // Pleasure
  if (mood.pleasure > 0.3) parts.push("开心");
  else if (mood.pleasure > 0) parts.push("微妙开心");
  else if (mood.pleasure > -0.3) parts.push("略微不悦");
  else parts.push("烦躁");

  // Arousal
  if (mood.arousal > 0.3) parts.push("活跃");
  else if (mood.arousal < -0.3) parts.push("低沉");

  // Dominance
  if (mood.dominance > 0.5) parts.push("自信掌控");
  else if (mood.dominance < -0.3) parts.push("不安");

  return parts.join("但") || "平静";
}

/**
 * 格式化数字为保留一位小数
 */
function fmt(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded >= 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}
