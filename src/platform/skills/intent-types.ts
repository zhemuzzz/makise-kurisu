/**
 * Intent Classification 类型定义
 *
 * @module platform/skills/intent-types
 * @description 2 级意图分类器的核心类型
 *
 * 设计来源:
 * - skill-system.md D7 (2 级意图分类)
 * - skill-system.md D14 (find-skill 动态注入)
 */

// ============================================================================
// Skill 匹配结果
// ============================================================================

/**
 * 匹配方法
 *
 * - command: L1 精确命令匹配 (0 token, confidence=0.95)
 * - llm: L2 LLM 分类 (~800 tokens, confidence varies)
 */
export type MatchMethod = "command" | "llm";

/**
 * 单个 Skill 匹配结果
 */
export interface SkillMatch {
  /** 匹配的 Skill ID */
  readonly skillId: string;
  /** 置信度 (0-1) */
  readonly confidence: number;
  /** 匹配原因 */
  readonly reason: MatchMethod;
  /** 匹配的命令/关键词 (仅 command 方式) */
  readonly matched?: string;
}

// ============================================================================
// 意图分类结果
// ============================================================================

/**
 * 意图分类整体结果
 */
export interface SkillIntentResult {
  /** 匹配列表 (按 confidence 降序) */
  readonly matches: readonly SkillMatch[];
  /** 分类耗时 (毫秒) */
  readonly classificationTime: number;
  /** 使用的分类方法 */
  readonly method: MatchMethod | "none";
}

/**
 * 创建空的意图分类结果
 */
export function createEmptyIntentResult(
  classificationTime: number = 0,
): SkillIntentResult {
  return {
    matches: [],
    classificationTime,
    method: "none",
  };
}
