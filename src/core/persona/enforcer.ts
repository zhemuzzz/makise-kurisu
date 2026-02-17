/**
 * PersonaEnforcer - 人设强化器
 * 负责将响应转换为人设一致的风格
 */

import { MentalModel } from "./types";

/**
 * OOC 短语列表（需要移除）
 */
const OOC_PHRASES = [
  "作为AI",
  "作为人工智能",
  "我是一个程序",
  "我是一个AI",
  "作为助手",
  "我无法",
  "我是一种",
  "AI助手",
  "人工智能助手",
  "人工智能程序",
  "语言模型",
  "Anthropic",
  "Claude",
];

/**
 * 傲娇前缀列表（以 "哼" 开头）
 */
const TSUNDERE_PREFIXES = ["哼，", "哼 ", "哼"];

/**
 * 情感关键词列表
 */
const EMOTIONAL_KEYWORDS = [
  "喜欢你",
  "爱你",
  "在乎你",
  "关心你",
  "想你",
  "担心你",
];

/**
 * 默认响应
 */
const DEFAULT_RESPONSE = "哼，有什么事吗？";

/**
 * PersonaEnforcer 类
 * 强化响应的人设特征
 */
export class PersonaEnforcer {
  private mentalModel: MentalModel;
  private seed: number;

  constructor(mentalModel?: MentalModel) {
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
    // 使用固定种子确保确定性输出
    this.seed = 12345;
  }

  /**
   * 伪随机数生成器（确定性）
   */
  private seededRandom(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * 强化响应的人设特征
   * @param response 要强化的响应文本
   * @returns 强化后的响应
   */
  enforce(response: string): string {
    // 输入验证
    if (response === null || response === undefined) {
      return DEFAULT_RESPONSE;
    }

    if (typeof response !== "string") {
      return DEFAULT_RESPONSE;
    }

    const trimmed = response.trim();
    if (trimmed === "") {
      return DEFAULT_RESPONSE;
    }

    // 重置种子以确保相同输入产生相同输出
    this.seed = this.hashString(trimmed);

    let enforced = trimmed;

    // 1. 移除 OOC 短语
    enforced = this.removeOOCPhrases(enforced);

    // 2. 检查是否已有傲娇特征
    const hasTsundere = this.hasTsundereMarkers(enforced);

    // 3. 如果有情感内容，添加犹豫
    if (this.hasEmotionalContent(enforced)) {
      enforced = this.addEmotionalHesitation(enforced);
    }

    // 4. 如果没有傲娇特征，添加前缀
    if (!hasTsundere) {
      enforced = this.addTsunderePrefix(enforced);
    }

    // 5. 根据关系程度调整
    enforced = this.adjustForRelationship(enforced);

    return enforced;
  }

  /**
   * 计算字符串的哈希值（用于确定性随机）
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) || 12345;
  }

  /**
   * 检查是否已有傲娇标记
   */
  private hasTsundereMarkers(text: string): boolean {
    const markers = [
      "哼",
      "笨蛋",
      "才不是",
      "才没有",
      "你这家伙",
      "你是笨蛋吗",
    ];
    return markers.some((marker) => text.includes(marker));
  }

  /**
   * 检查是否包含情感内容
   */
  private hasEmotionalContent(text: string): boolean {
    return EMOTIONAL_KEYWORDS.some((keyword) => text.includes(keyword));
  }

  /**
   * 添加傲娇前缀
   * @param response 要添加前缀的响应文本
   * @returns 添加前缀后的响应
   */
  addTsunderePrefix(response: string): string {
    if (!response || response.trim() === "") {
      return response;
    }

    const trimmed = response.trim();

    // 检查是否已有傲娇前缀
    for (const prefix of TSUNDERE_PREFIXES) {
      if (trimmed.startsWith(prefix)) {
        return trimmed;
      }
    }

    // 选择前缀（确定性）
    const index = Math.floor(this.seededRandom() * TSUNDERE_PREFIXES.length);
    const prefix = TSUNDERE_PREFIXES[index];

    return prefix + trimmed;
  }

  /**
   * 转换为反问句
   * @param response 要转换的响应文本
   * @returns 转换后的响应
   */
  convertToRhetorical(response: string): string {
    if (!response || response.trim() === "") {
      return response;
    }

    const trimmed = response.trim();

    // 如果已经是问句，保持原样
    if (trimmed.includes("？") || trimmed.includes("?")) {
      return trimmed;
    }

    // 常见陈述句转换
    const conversions: Array<{ pattern: RegExp; replacement: string }> = [
      {
        pattern: /^你是对的$/,
        replacement: "你不是笨蛋吗？居然能说出正确的话。",
      },
      { pattern: /^好的$/, replacement: "哼，好吧，既然你这么说..." },
      {
        pattern: /^我知道了$/,
        replacement: "这种事还需要你说？我早就知道了。",
      },
      { pattern: /^我同意$/, replacement: "哼，难得我们的意见一致呢。" },
      { pattern: /^我明白$/, replacement: "你以为我连这个都不懂吗？" },
    ];

    for (const { pattern, replacement } of conversions) {
      if (pattern.test(trimmed)) {
        return replacement;
      }
    }

    // 默认转换：添加反问语气
    return `${trimmed}...这不是理所当然的吗？`;
  }

  /**
   * 添加情感犹豫
   * @param response 要添加犹豫的响应文本
   * @returns 添加犹豫后的响应
   */
  addEmotionalHesitation(response: string): string {
    if (!response || response.trim() === "") {
      return response;
    }

    let result = response;

    // 为情感表达添加犹豫和否认
    const hesitationPatterns: Array<{ pattern: RegExp; replacement: string }> =
      [
        {
          pattern: /我喜欢你/g,
          replacement: "我...我才没有喜欢你呢！",
        },
        {
          pattern: /我爱你/g,
          replacement: "爱...爱什么的，才不是那样！",
        },
        {
          pattern: /我在乎你/g,
          replacement: "我才没有在乎你...只是，只是作为科学家的好奇心而已！",
        },
        {
          pattern: /我关心你/g,
          replacement: "关...关心？谁关心你了！别误会了！",
        },
        {
          pattern: /我想你/g,
          replacement: "才没有想你呢！只是...只是恰好想到了而已。",
        },
        {
          pattern: /我担心你/g,
          replacement: "担...担心？我才没有担心你！",
        },
      ];

    for (const { pattern, replacement } of hesitationPatterns) {
      result = result.replace(pattern, replacement);
    }

    return result;
  }

  /**
   * 转义正则表达式特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * 移除 OOC 短语
   * @param response 要处理的响应文本
   * @returns 移除 OOC 后的响应
   */
  removeOOCPhrases(response: string): string {
    // 输入验证 - 返回空字符串而不是 null/undefined
    if (!response || typeof response !== "string") {
      return "";
    }

    let result = response;

    // 移除 OOC 短语（转义正则特殊字符防止 ReDoS）
    for (const phrase of OOC_PHRASES) {
      const regex = new RegExp(this.escapeRegex(phrase), "gi");
      result = result.replace(regex, "");
    }

    // 清理多余的空格和标点
    result = result
      .replace(/\s+/g, " ")
      .replace(/^[,，、。\s]+/, "")
      .replace(/[,，、。\s]+$/, "")
      .trim();

    return result;
  }

  /**
   * 根据关系程度调整响应
   */
  private adjustForRelationship(response: string): string {
    const familiarity = this.mentalModel.relationship_graph.familiarity;

    // 如果内容被清空，返回默认响应
    if (!response || response.trim() === "") {
      return DEFAULT_RESPONSE;
    }

    // 陌生人阶段：更加冷淡
    if (familiarity <= 20) {
      // 可以添加更多冷淡标记
      if (!response.startsWith("哼") && !response.startsWith("...")) {
        // 50% 概率添加冷淡前缀
        if (this.seededRandom() > 0.5) {
          return `...${response}`;
        }
      }
    }

    // 朋友阶段及以上：保持傲娇风格
    return response;
  }
}
