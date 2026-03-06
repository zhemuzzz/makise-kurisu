/**
 * ILE Snapshot Formatter
 *
 * @module inner-life/core/snapshot-formatter
 * @description 纯函数，将 DebugSnapshot 格式化为自然语言摘要
 *
 * 供 Evolution 后台任务使用 (~50-100 tokens)
 */

import type { MoodState, DebugSnapshot } from "../types.js";

// ============================================================================
// 共享常量
// ============================================================================

/** 关系阶段中文名 */
export const STAGE_NAMES: Readonly<Record<string, string>> = {
  stranger: "陌生人",
  acquaintance: "认识",
  familiar: "熟悉",
  friend: "朋友",
  close_friend: "挚友",
};

// ============================================================================
// 共享函数
// ============================================================================

/**
 * 描述心境 (自然语言)
 *
 * 从 context-builder.ts 提取为共享函数。
 */
export function describeMood(mood: MoodState): string {
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

// ============================================================================
// Snapshot Formatter
// ============================================================================

/**
 * 格式化 ILE 快照为自然语言摘要
 *
 * 输出示例 (~50 tokens):
 * ```
 * 心境: 略微不悦但自信掌控 (P:-0.2 A:+0.3 D:+0.6)
 * 用户关系: user1=朋友(trust:52,warmth:45), user2=陌生人(trust:10,warmth:5)
 * ```
 *
 * @param snapshot - DebugSnapshot
 * @returns 自然语言摘要
 */
export function formatILESummary(snapshot: DebugSnapshot): string {
  const lines: string[] = [];

  // 心境
  const moodDesc = describeMood(snapshot.baseMood);
  const p = fmtNum(snapshot.baseMood.pleasure);
  const a = fmtNum(snapshot.baseMood.arousal);
  const d = fmtNum(snapshot.baseMood.dominance);
  lines.push(`心境: ${moodDesc} (P:${p} A:${a} D:${d})`);

  // 用户关系 (最多 5 个)
  const relEntries = Object.entries(snapshot.relationships);
  if (relEntries.length > 0) {
    const relParts = relEntries.slice(0, 5).map(([uid, rel]) => {
      const stage = STAGE_NAMES[rel.stage] ?? rel.stage;
      return `${uid}=${stage}(trust:${Math.round(rel.trust)},warmth:${Math.round(rel.warmth)})`;
    });
    lines.push(`用户关系: ${relParts.join(", ")}`);
  }

  return lines.join("\n");
}

// ============================================================================
// 工具函数
// ============================================================================

function fmtNum(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return rounded >= 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}
