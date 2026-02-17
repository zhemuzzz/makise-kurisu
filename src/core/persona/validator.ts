/**
 * PersonaValidator - 人设校验器
 * 负责检测 OOC、语气一致性、关系一致性
 */

import { MentalModel, ValidationResult } from "./types";
import {
  OOC_PHRASES,
  MOE_KEYWORDS,
  INTIMATE_KEYWORDS,
  TSUNDERE_KEYWORDS,
} from "./constants";

/**
 * OOC 检测结果
 */
export interface OOCResult {
  detected: boolean;
  keywords: string[];
}

/**
 * 语气一致性检测结果
 */
export interface ToneResult {
  consistent: boolean;
  reason?: string;
}

/**
 * 关系一致性检测结果
 */
export interface RelationshipResult {
  consistent: boolean;
  reason?: string;
}

/**
 * 详细校验结果
 */
export interface DetailedValidationResult extends ValidationResult {
  details: {
    ooc: OOCResult;
    tone: ToneResult;
    relationship: RelationshipResult;
  };
}

/**
 * PersonaValidator 类
 * 校验响应是否符合人设
 */
export class PersonaValidator {
  private mentalModel: MentalModel;

  constructor(mentalModel?: MentalModel) {
    // 提供默认的心智模型
    this.mentalModel = mentalModel ?? {
      user_profile: {
        name: "",
        relationship: "stranger",
        preferences: [],
      },
      relationship_graph: {
        trust_level: 0,
        familiarity: 0,
        emotional_state: "neutral",
      },
      shared_memories: {
        key_events: [],
        inside_jokes: [],
        repeated_topics: [],
      },
    };
  }

  /**
   * 检测 OOC (Out of Character) 关键词
   * @param response 要检测的响应文本
   * @returns OOC 检测结果
   */
  detectOOC(response: string): OOCResult {
    // 输入验证
    if (typeof response !== "string") {
      return { detected: false, keywords: [] };
    }

    const detectedKeywords: string[] = [];
    const lowerResponse = response.toLowerCase();

    for (const keyword of OOC_PHRASES) {
      // 不区分大小写匹配
      if (lowerResponse.includes(keyword.toLowerCase())) {
        detectedKeywords.push(keyword);
      }
    }

    return {
      detected: detectedKeywords.length > 0,
      keywords: detectedKeywords,
    };
  }

  /**
   * 检查语气一致性
   * @param response 要检查的响应文本
   * @returns 语气一致性结果
   */
  checkToneConsistency(response: string): ToneResult {
    // 输入验证
    if (typeof response !== "string") {
      return { consistent: true };
    }

    const lowerResponse = response.toLowerCase();

    // 检查卖萌关键词（不区分大小写）
    for (const keyword of MOE_KEYWORDS) {
      if (lowerResponse.includes(keyword.toLowerCase())) {
        return {
          consistent: false,
          reason: `包含破坏人设的卖萌表达: "${keyword}"`,
        };
      }
    }

    // 检查过度热情表达（亲密关系级别允许，科学热情除外）
    const familiarity = this.mentalModel.relationship_graph.familiarity;
    // 只有在亲密级别 (familiarity >= 80) 时才允许亲密表达
    if (familiarity < 80) {
      for (const keyword of INTIMATE_KEYWORDS) {
        if (lowerResponse.includes(keyword.toLowerCase())) {
          return {
            consistent: false,
            reason: `过度热情的表达不符合傲娇性格: "${keyword}"`,
          };
        }
      }
    }

    // 科学相关内容应该被允许
    const scientificPatterns = [
      /根据.*理论/,
      /从.*角度/,
      /量子力学/,
      /相对论/,
      /实验/,
      /SERN/,
      /多世界/,
      /时间/,
      /观测/,
    ];

    const isScientific = scientificPatterns.some((pattern) =>
      pattern.test(response),
    );

    if (isScientific) {
      return { consistent: true };
    }

    // 傲娇表达应该被允许
    const hasTsundere = TSUNDERE_KEYWORDS.some((keyword) =>
      response.includes(keyword),
    );
    if (hasTsundere) {
      return { consistent: true };
    }

    // 默认通过
    return { consistent: true };
  }

  /**
   * 检查关系一致性
   * @param response 要检查的响应文本
   * @returns 关系一致性结果
   */
  checkRelationshipConsistency(response: string): RelationshipResult {
    // 输入验证
    if (typeof response !== "string") {
      return { consistent: true };
    }

    const familiarity = this.mentalModel.relationship_graph.familiarity;

    // 陌生阶段 (0-20): 不能使用亲密表达
    if (familiarity <= 20) {
      for (const keyword of INTIMATE_KEYWORDS) {
        if (response.includes(keyword)) {
          return {
            consistent: false,
            reason: `陌生阶段不应使用亲密表达: "${keyword}"`,
          };
        }
      }
    }

    // 熟人阶段 (21-50): 仍不能使用过于亲密的表达
    if (familiarity > 20 && familiarity <= 50) {
      const tooIntimate = ["亲爱的", "宝贝", "最喜欢你了"];
      for (const keyword of tooIntimate) {
        if (response.includes(keyword)) {
          return {
            consistent: false,
            reason: `熟人阶段不应使用过于亲密的表达: "${keyword}"`,
          };
        }
      }
    }

    // 朋友阶段 (51-80) 和 亲密阶段 (81-100): 允许更亲密的表达
    // 但仍需保持傲娇性格
    return { consistent: true };
  }

  /**
   * 综合校验响应
   * @param response 要校验的响应文本
   * @returns 详细校验结果
   */
  validate(response: string): DetailedValidationResult {
    // 输入验证
    if (typeof response !== "string") {
      return {
        isValid: true,
        violations: [],
        shouldRegenerate: false,
        details: {
          ooc: { detected: false, keywords: [] },
          tone: { consistent: true },
          relationship: { consistent: true },
        },
      };
    }

    const violations: string[] = [];
    const details = {
      ooc: this.detectOOC(response),
      tone: this.checkToneConsistency(response),
      relationship: this.checkRelationshipConsistency(response),
    };

    if (details.ooc.detected) {
      violations.push(`OOC检测: ${details.ooc.keywords.join(", ")}`);
    }

    if (!details.tone.consistent && details.tone.reason) {
      violations.push(details.tone.reason);
    }

    if (!details.relationship.consistent && details.relationship.reason) {
      violations.push(details.relationship.reason);
    }

    return {
      isValid: violations.length === 0,
      violations,
      shouldRegenerate: violations.length > 0,
      details,
    };
  }
}
