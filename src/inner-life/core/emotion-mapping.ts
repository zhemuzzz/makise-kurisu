/**
 * Emotion Tag → PAD 映射
 *
 * @module inner-life/core/emotion-mapping
 * @description 封闭标签集 + OCC→PAD 映射 + intensity modifier 解析 + fallback
 *
 * 纯函数，无副作用，无状态。
 *
 * @see persona-inner-life.md IL-1, IL-4
 */

import type { EmotionTag, PADVector, ActiveEmotion } from "../types.js";
import { EMOTION_TAGS } from "../types.js";

// ============================================================================
// PAD 映射表
// ============================================================================

/**
 * 情绪标签 → PAD 向量映射
 *
 * 基于 OCC 模型 (Ortony, Clore, Collins) 转换为 PAD 空间
 *
 * @see persona-inner-life.md 第三节
 */
export const EMOTION_PAD_MAP: Readonly<Record<EmotionTag, PADVector>> = {
  // Positive
  joy: { p: +0.7, a: +0.5, d: +0.3 },
  contentment: { p: +0.5, a: -0.2, d: +0.3 },
  pride: { p: +0.5, a: +0.3, d: +0.7 },
  curiosity: { p: +0.3, a: +0.6, d: +0.2 },
  relief: { p: +0.4, a: -0.3, d: +0.2 },

  // Negative
  irritation: { p: -0.5, a: +0.4, d: +0.3 },
  frustration: { p: -0.6, a: +0.5, d: -0.2 },
  shame: { p: -0.4, a: +0.6, d: -0.5 },
  sadness: { p: -0.6, a: -0.3, d: -0.4 },
  anxiety: { p: -0.4, a: +0.5, d: -0.5 },

  // Social
  affection: { p: +0.6, a: +0.2, d: +0.1 },
  trust: { p: +0.4, a: -0.1, d: +0.3 },
  embarrassment: { p: -0.2, a: +0.7, d: -0.4 },
  defensiveness: { p: -0.3, a: +0.4, d: +0.5 },
} as const;

// ============================================================================
// 强度系数
// ============================================================================

/**
 * 强度修饰符 → 系数
 *
 * @see persona-inner-life.md IL-4 intensity_modifiers
 */
export const INTENSITY_MULTIPLIERS: Readonly<Record<string, number>> = {
  "mild_": 0.5,
  "": 1.0,
  "strong_": 1.5,
  "extreme_": 2.0,
} as const;

/** 有效的强度前缀 (按长度降序，确保最长匹配优先) */
const INTENSITY_PREFIXES = ["extreme_", "strong_", "mild_"] as const;

// ============================================================================
// 标签集合 (运行时校验)
// ============================================================================

const VALID_TAGS = new Set<string>(EMOTION_TAGS);

// ============================================================================
// 解析函数
// ============================================================================

/**
 * 解析含 intensity modifier 前缀的情绪标签
 *
 * 示例:
 * - "curiosity" → { tag: "curiosity", intensity: 1.0 }
 * - "mild_irritation" → { tag: "irritation", intensity: 0.5 }
 * - "strong_joy" → { tag: "joy", intensity: 1.5 }
 * - "unknown_tag" → null (IL-4 fallback: 忽略未知标签)
 *
 * @param raw - 原始标签字符串
 * @returns 解析结果，未知标签返回 null
 */
export function parseEmotionTag(
  raw: string,
): { readonly tag: EmotionTag; readonly intensity: number } | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  // 尝试匹配 intensity 前缀
  for (const prefix of INTENSITY_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      const tagPart = trimmed.slice(prefix.length);
      if (VALID_TAGS.has(tagPart)) {
        return {
          tag: tagPart as EmotionTag,
          intensity: INTENSITY_MULTIPLIERS[prefix] ?? 1.0,
        };
      }
    }
  }

  // 无前缀，直接匹配
  if (VALID_TAGS.has(trimmed)) {
    return { tag: trimmed as EmotionTag, intensity: 1.0 };
  }

  // IL-4 Fallback: 未知标签 → 忽略
  return null;
}

/**
 * 计算 PAD 向量模长
 */
function padMagnitude(v: PADVector): number {
  return Math.sqrt(v.p * v.p + v.a * v.a + v.d * v.d);
}

/**
 * 批量映射情绪标签 → ActiveEmotion
 *
 * - 未知标签静默忽略 (IL-4)
 * - 每个标签应用 intensity modifier
 * - weight = PAD 向量模长 × intensity
 *
 * @param rawTags - LLM 输出的原始标签列表
 * @returns 活跃情绪列表
 */
export function mapEmotionTags(
  rawTags: readonly string[],
): readonly ActiveEmotion[] {
  const results: ActiveEmotion[] = [];

  for (const raw of rawTags) {
    const parsed = parseEmotionTag(raw);
    if (!parsed) continue;

    const basePad = EMOTION_PAD_MAP[parsed.tag];
    const scaledPad: PADVector = {
      p: basePad.p * parsed.intensity,
      a: basePad.a * parsed.intensity,
      d: basePad.d * parsed.intensity,
    };

    results.push({
      tag: parsed.tag,
      weight: padMagnitude(scaledPad) * parsed.intensity,
      intensity: parsed.intensity,
      pad: scaledPad,
    });
  }

  return results;
}
