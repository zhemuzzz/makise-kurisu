/**
 * Intent Matcher
 *
 * 根据用户输入匹配最相关的 Skills
 */

import type { SkillInstance, IntentMatchResult, TriggerRule } from "./types";

/**
 * 意图匹配配置
 */
export interface IntentMatcherConfig {
  /** 关键词匹配权重 */
  keywordWeight?: number;
  /** 意图匹配权重 */
  intentWeight?: number;
  /** 正则匹配权重 */
  patternWeight?: number;
  /** 最小置信度阈值 */
  minConfidence?: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<IntentMatcherConfig> = {
  keywordWeight: 0.7,
  intentWeight: 0.8,
  patternWeight: 0.9,
  minConfidence: 0.3,
};

/**
 * 意图匹配器
 *
 * 支持三种匹配方式：
 * 1. 关键词匹配（精确/模糊）
 * 2. 意图匹配（字符串包含）
 * 3. 正则匹配
 */
export class IntentMatcher {
  private config: Required<IntentMatcherConfig>;

  constructor(config: IntentMatcherConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 匹配用户输入与所有 Skills
   *
   * @param input - 用户输入
   * @param skills - 已加载的 Skills
   * @returns 按置信度排序的匹配结果
   */
  match(input: string, skills: readonly SkillInstance[]): IntentMatchResult[] {
    const results: IntentMatchResult[] = [];
    const normalizedInput = this.normalizeInput(input);

    for (const skill of skills) {
      const result = this.matchSkill(normalizedInput, skill);
      if (result && result.confidence >= this.config.minConfidence) {
        results.push(result);
      }
    }

    // 按置信度降序排序
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 匹配单个 Skill
   */
  private matchSkill(
    normalizedInput: string,
    skill: SkillInstance,
  ): IntentMatchResult | null {
    const trigger = skill.config.trigger;

    // 1. 正则匹配（最高优先级）
    if (trigger.patterns) {
      const patternResult = this.matchPatterns(normalizedInput, trigger);
      if (patternResult) {
        return patternResult;
      }
    }

    // 2. 关键词匹配
    if (trigger.keywords) {
      const keywordResult = this.matchKeywords(normalizedInput, trigger);
      if (keywordResult) {
        return keywordResult;
      }
    }

    // 3. 意图匹配
    if (trigger.intent) {
      const intentResult = this.matchIntent(normalizedInput, trigger);
      if (intentResult) {
        return intentResult;
      }
    }

    return null;
  }

  /**
   * 关键词匹配
   */
  private matchKeywords(
    normalizedInput: string,
    trigger: TriggerRule,
  ): IntentMatchResult | null {
    const keywords = trigger.keywords;
    if (!keywords || keywords.length === 0) return null;

    let maxConfidence = 0;
    let matchedKeyword = "";

    for (const keyword of keywords) {
      const normalizedKeyword = this.normalizeInput(keyword);

      // 精确匹配
      if (normalizedInput.includes(normalizedKeyword)) {
        const confidence = this.config.keywordWeight;
        if (confidence > maxConfidence) {
          maxConfidence = confidence;
          matchedKeyword = keyword;
        }
      }

      // 模糊匹配（编辑距离）
      const similarity = this.calculateSimilarity(
        normalizedInput,
        normalizedKeyword,
      );
      const confidence = similarity * this.config.keywordWeight;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        matchedKeyword = keyword;
      }
    }

    // 应用最小置信度阈值
    const minConfidence = trigger.minConfidence ?? this.config.minConfidence;
    if (maxConfidence >= minConfidence && matchedKeyword) {
      return {
        skillId: "", // 由调用者填充
        confidence: maxConfidence,
        reason: "keyword",
        matched: matchedKeyword,
      };
    }

    return null;
  }

  /**
   * 意图匹配
   */
  private matchIntent(
    normalizedInput: string,
    trigger: TriggerRule,
  ): IntentMatchResult | null {
    const intents = trigger.intent;
    if (!intents || intents.length === 0) return null;

    // 简单的意图匹配：检查输入是否包含意图关键词
    for (const intent of intents) {
      const normalizedIntent = this.normalizeInput(intent);

      // 检查输入是否包含意图
      if (normalizedInput.includes(normalizedIntent)) {
        return {
          skillId: "", // 由调用者填充
          confidence: this.config.intentWeight,
          reason: "intent",
          matched: intent,
        };
      }

      // 模糊匹配
      const similarity = this.calculateSimilarity(
        normalizedInput,
        normalizedIntent,
      );
      if (similarity > 0.7) {
        return {
          skillId: "", // 由调用者填充
          confidence: similarity * this.config.intentWeight,
          reason: "intent",
          matched: intent,
        };
      }
    }

    return null;
  }

  /**
   * 正则匹配
   */
  private matchPatterns(
    normalizedInput: string,
    trigger: TriggerRule,
  ): IntentMatchResult | null {
    const patterns = trigger.patterns;
    if (!patterns || patterns.length === 0) return null;

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern, "i");
        if (regex.test(normalizedInput)) {
          return {
            skillId: "", // 由调用者填充
            confidence: this.config.patternWeight,
            reason: "pattern",
            matched: pattern,
          };
        }
      } catch {
        // 无效正则，跳过
        console.warn(`Invalid pattern: ${pattern}`);
      }
    }

    return null;
  }

  /**
   * 标准化输入（去除标点、空格，转小写）
   */
  private normalizeInput(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, " ") // 保留字母和数字
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 计算字符串相似度（Jaccard 相似度）
   */
  private calculateSimilarity(a: string, b: string): number {
    // 简单的字符集相似度
    const setA = new Set(a.split(""));
    const setB = new Set(b.split(""));

    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }
}

/**
 * 创建 Intent Matcher 实例
 */
export function createIntentMatcher(config?: IntentMatcherConfig): IntentMatcher {
  return new IntentMatcher(config);
}
