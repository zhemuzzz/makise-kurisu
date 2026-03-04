/**
 * LLM 意图分类器
 *
 * KURISU-024: 会话设置流水线重构 - LLM 意图分类兜底
 *
 * 作为正则快速路径的兜底，处理自然语言变体。
 *
 * 特性：
 * 1. 短路条件：消息过短跳过 LLM
 * 2. 置信度阈值：confidence >= 阈值 才接受
 * 3. 缓存：相同输入复用结果
 * 4. 超时控制：超时降级
 * 5. 可禁用：通过配置关闭 LLM 兜底
 *
 * @module gateway/llm-intent-classifier
 */

import type {
  IModelProvider,
  Message,
  ChatOptions,
} from "../models/types";

// ===========================================
// 类型定义
// ===========================================

/**
 * LLM 意图分类结果
 */
export interface LLMIntentClassificationResult {
  /** 是否识别到意图 */
  readonly isIntent: boolean;
  /** 置信度 (0-1) */
  readonly confidence: number;
  /** 匹配的意图类型（对应 Handler type） */
  readonly intentType?: string;
  /** 操作类型（如 "disable", "enable", "upgrade", "downgrade"） */
  readonly action?: string;
  /** 目标值（如目标权限级别） */
  readonly targetValue?: string;
  /** LLM 分类理由（调试用） */
  readonly reasoning?: string;
}

/**
 * LLM 意图分类器配置
 */
export interface LLMIntentClassifierConfig {
  /** 模型提供者（用于获取 LLM 实例） */
  readonly modelProvider: IModelProvider;
  /** 使用的模型能力（默认 "conversation"） */
  readonly capability?: string;
  /** 置信度阈值（默认 0.7） */
  readonly confidenceThreshold?: number;
  /** 最小输入长度（短消息跳过 LLM，默认 6 字符） */
  readonly minInputLength?: number;
  /** 最大输入长度（超长截断，默认 200 字符） */
  readonly maxInputLength?: number;
  /** 启用/禁用 LLM 兜底（默认 true） */
  readonly enabled?: boolean;
  /** 超时时间（毫秒，默认 3000） */
  readonly timeout?: number;
  /** 缓存 TTL（毫秒，默认 60000，即 1 分钟） */
  readonly cacheTTL?: number;
}

/**
 * 已注册意图的元信息（供 LLM 参考）
 */
export interface IntentMetadata {
  /** 意图类型（对应 Handler type） */
  readonly type: string;
  /** 意图描述 */
  readonly description: string;
  /** 支持的操作类型 */
  readonly actions?: readonly string[];
  /** 示例输入 */
  readonly examples: readonly string[];
}

/**
 * 缓存条目
 */
interface CacheEntry {
  readonly result: LLMIntentClassificationResult;
  readonly expiresAt: number;
}

// ===========================================
// LLM 意图分类器
// ===========================================

/**
 * LLM 意图分类器
 *
 * @example
 * ```typescript
 * const classifier = new LLMIntentClassifier({
 *   modelProvider,
 *   confidenceThreshold: 0.7,
 *   minInputLength: 6,
 *   timeout: 3000,
 * });
 *
 * classifier.registerIntent({
 *   type: "delete_confirm",
 *   description: "切换删除文件时的确认提示",
 *   actions: ["disable", "enable"],
 *   examples: ["以后删东西不用问我了", "开启删除确认"],
 * });
 *
 * const result = await classifier.classify("以后删东西不用问我了");
 * // result.intentType === "delete_confirm"
 * // result.action === "disable"
 * ```
 */
export class LLMIntentClassifier {
  private readonly config: {
    readonly modelProvider: IModelProvider;
    readonly capability: string;
    readonly confidenceThreshold: number;
    readonly minInputLength: number;
    readonly maxInputLength: number;
    readonly enabled: boolean;
    readonly timeout: number;
    readonly cacheTTL: number;
  };

  private readonly intents: Map<string, IntentMetadata> = new Map();
  private readonly cache: Map<string, CacheEntry> = new Map();

  constructor(config: LLMIntentClassifierConfig) {
    if (!config.modelProvider) {
      throw new Error("modelProvider is required for LLMIntentClassifier");
    }

    this.config = {
      modelProvider: config.modelProvider,
      capability: config.capability ?? "conversation",
      confidenceThreshold: config.confidenceThreshold ?? 0.7,
      minInputLength: config.minInputLength ?? 6,
      maxInputLength: config.maxInputLength ?? 200,
      enabled: config.enabled ?? true,
      timeout: config.timeout ?? 3000,
      cacheTTL: config.cacheTTL ?? 60000,
    };
  }

  /**
   * 注册意图类型
   */
  registerIntent(metadata: IntentMetadata): this {
    // 验证必填字段
    if (!metadata.type || typeof metadata.type !== "string") {
      throw new Error("IntentMetadata.type is required and must be a string");
    }
    if (!metadata.description || typeof metadata.description !== "string") {
      throw new Error(
        "IntentMetadata.description is required and must be a string",
      );
    }
    if (!Array.isArray(metadata.examples) || metadata.examples.length === 0) {
      throw new Error("IntentMetadata.examples must be a non-empty array");
    }

    this.intents.set(metadata.type, metadata);
    return this;
  }

  /**
   * 批量注册意图类型
   */
  registerIntents(metadataList: readonly IntentMetadata[]): this {
    for (const metadata of metadataList) {
      this.registerIntent(metadata);
    }
    return this;
  }

  /**
   * 获取已注册的意图数量
   */
  getIntentCount(): number {
    return this.intents.size;
  }

  /**
   * 分类用户输入
   *
   * @param input 用户输入
   * @returns 分类结果
   */
  async classify(input: string): Promise<LLMIntentClassificationResult> {
    // 1. 短路检查
    if (!this.shouldClassify(input)) {
      return { isIntent: false, confidence: 0 };
    }

    // 2. 标准化输入
    const normalizedInput = this.normalizeInput(input);

    // 3. 检查缓存
    const cached = this.getFromCache(normalizedInput);
    if (cached) {
      return cached;
    }

    // 4. 调用 LLM 分类
    try {
      const result = await this.classifyWithLLM(normalizedInput);

      // 5. 缓存结果
      this.setCache(normalizedInput, result);

      return result;
    } catch (error) {
      // 6. 错误降级
      console.warn("[LLMIntentClassifier] Classification failed:", error);
      return { isIntent: false, confidence: 0 };
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ===========================================
  // 私有方法
  // ===========================================

  /**
   * 短路检查：是否应该调用 LLM
   */
  private shouldClassify(input: string): boolean {
    // 禁用时跳过
    if (!this.config.enabled) {
      return false;
    }

    // 空输入跳过
    if (!input || input.trim().length === 0) {
      return false;
    }

    // 输入过短跳过
    if (input.trim().length < this.config.minInputLength) {
      return false;
    }

    // 无注册意图跳过
    if (this.intents.size === 0) {
      return false;
    }

    return true;
  }

  /**
   * 标准化输入（用于缓存 key）
   */
  private normalizeInput(input: string): string {
    let normalized = input.trim();

    // 截断过长输入
    if (normalized.length > this.config.maxInputLength) {
      normalized = normalized.slice(0, this.config.maxInputLength);
    }

    return normalized;
  }

  /**
   * 调用 LLM 进行分类
   */
  private async classifyWithLLM(
    input: string,
  ): Promise<LLMIntentClassificationResult> {
    const model = this.config.modelProvider.getByCapability(
      this.config.capability,
    );

    // 构建 Prompt
    const prompt = this.buildPrompt(input);

    // 带超时的调用
    const chatOptions: ChatOptions = {
      maxTokens: 200,
      temperature: 0.1, // 低温度提高一致性
    };

    const messages: Message[] = [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ];

    // 使用 AbortController 模式管理超时，避免内存泄漏
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("LLM classification timeout"));
      }, this.config.timeout);
    });

    try {
      const response = await Promise.race([
        model.chat(messages, chatOptions),
        timeoutPromise,
      ]);
      return this.parseResponse(response.content);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  /**
   * 构建 LLM Prompt
   */
  private buildPrompt(input: string): { system: string; user: string } {
    const intentDescriptions = Array.from(this.intents.values())
      .map((intent) => {
        const actions = intent.actions
          ? `，支持操作：${intent.actions.join("、")}`
          : "";
        return `- ${intent.type}：${intent.description}${actions}\n  示例：${intent.examples.join("、")}`;
      })
      .join("\n");

    const system = `你是一个意图分类器，负责识别用户输入的意图类型。

支持的意图类型：
${intentDescriptions}

请分析用户输入，判断是否属于以上意图之一。

输出格式（JSON）：
{
  "isIntent": boolean,      // 是否识别到意图
  "confidence": number,     // 置信度 0-1
  "intentType": string,     // 意图类型（如 "delete_confirm"）
  "action": string,         // 操作类型（如 "disable"、"enable"）
  "targetValue": string,    // 目标值（可选）
  "reasoning": string       // 简要理由
}

注意：
1. 只有在你有较高把握时才返回 isIntent: true
2. confidence 应反映你对判断的确信程度（0.7 以上才被认为有效）
3. 如果不属于任何已知意图，返回 isIntent: false, confidence: 0`;

    const user = `用户输入："${input}"`;

    return { system, user };
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(content: string): LLMIntentClassificationResult {
    try {
      // 提取 JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { isIntent: false, confidence: 0 };
      }

      const parsed: Record<string, unknown> = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      // 验证并限制置信度范围
      const confidence = Math.max(0, Math.min(1, typeof parsed["confidence"] === "number" ? parsed["confidence"] : 0));

      // 置信度阈值检查
      if (confidence < this.config.confidenceThreshold) {
        return { isIntent: false, confidence };
      }

      // 验证意图类型是否注册
      const intentType = typeof parsed["intentType"] === "string" ? parsed["intentType"] : undefined;
      if (intentType && !this.intents.has(intentType)) {
        return { isIntent: false, confidence: 0 };
      }

      // 验证 isIntent
      const isIntent =
        parsed["isIntent"] === true &&
        confidence >= this.config.confidenceThreshold;

      const action = typeof parsed["action"] === "string" ? parsed["action"] : undefined;
      const targetValue = typeof parsed["targetValue"] === "string" ? parsed["targetValue"] : undefined;
      const reasoning = typeof parsed["reasoning"] === "string" ? parsed["reasoning"] : undefined;

      return {
        isIntent,
        confidence,
        ...(isIntent && intentType && { intentType }),
        ...(isIntent && action && { action }),
        ...(isIntent && targetValue && { targetValue }),
        ...(isIntent && reasoning && { reasoning }),
      };
    } catch {
      return { isIntent: false, confidence: 0 };
    }
  }

  /**
   * 缓存操作
   * 使用懒过期策略：只在访问时检查过期，避免 O(n) 遍历
   */
  private getFromCache(input: string): LLMIntentClassificationResult | null {
    const cached = this.cache.get(input);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.result;
      }
      // 懒过期：访问时删除过期条目
      this.cache.delete(input);
    }
    return null;
  }

  private setCache(input: string, result: LLMIntentClassificationResult): void {
    this.cache.set(input, {
      result,
      expiresAt: Date.now() + this.config.cacheTTL,
    });
  }
}

// ===========================================
// 工厂函数
// ===========================================

/**
 * 创建 LLM 意图分类器
 */
export function createLLMIntentClassifier(
  config: LLMIntentClassifierConfig,
): LLMIntentClassifier {
  return new LLMIntentClassifier(config);
}
