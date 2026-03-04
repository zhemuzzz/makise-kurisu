/**
 * SkillIntentClassifier 实现
 *
 * @module platform/skills/intent-classifier
 * @description 2 级意图分类器: L1 命令匹配 + L2 LLM 分类
 *
 * 设计来源:
 * - skill-system.md D7 (2 级意图分类)
 * - skill-system.md D14 (find-skill 动态注入)
 */

import type { ISkillRegistry, SkillInstance } from "./types.js";
import type { IModelProvider, Message } from "../models/types.js";
import type { SkillMatch, SkillIntentResult } from "./intent-types.js";
import { createEmptyIntentResult } from "./intent-types.js";

// ============================================================================
// Interface
// ============================================================================

/**
 * SkillIntentClassifier 配置
 */
export interface SkillIntentClassifierConfig {
  /** Skill 注册表 */
  readonly skillRegistry: ISkillRegistry;
  /** 模型提供者 (可选 — 无则跳过 L2) */
  readonly modelProvider?: IModelProvider;
  /** L2 使用的模型能力 */
  readonly capability?: string;
  /** L2 置信度阈值 */
  readonly confidenceThreshold?: number;
  /** L2 超时 (ms) */
  readonly timeout?: number;
  /** L2 缓存 TTL (ms) */
  readonly cacheTTL?: number;
  /** 是否启用 L2 */
  readonly enabled?: boolean;
}

/**
 * ISkillIntentClassifier — 意图分类器接口
 */
export interface ISkillIntentClassifier {
  /** 同步 L1 命令匹配 */
  classify(input: string): SkillIntentResult;
  /** 异步 L1 + L2 分类 */
  classifyAsync(input: string): Promise<SkillIntentResult>;
  /** 清除 L2 缓存 */
  clearCache(): void;
}

// ============================================================================
// Implementation
// ============================================================================

interface CacheEntry {
  readonly result: SkillIntentResult;
  readonly timestamp: number;
}

/**
 * 工厂函数
 */
export function createSkillIntentClassifier(
  config: SkillIntentClassifierConfig,
): ISkillIntentClassifier {
  const registry = config.skillRegistry;
  const modelProvider = config.modelProvider;
  const capability = config.capability ?? "conversation";
  const confidenceThreshold = config.confidenceThreshold ?? 0.6;
  const timeout = config.timeout ?? 3000;
  const cacheTTL = config.cacheTTL ?? 60000;
  const enabled = config.enabled ?? true;

  const cache = new Map<string, CacheEntry>();
  const MAX_CACHE_SIZE = 500;

  // ---- helpers ----

  function getActiveSkills(): readonly SkillInstance[] {
    return registry.list().filter((s) => s.status === "active");
  }

  // ---- L1: Command Match ----

  function classifyL1(input: string): SkillIntentResult {
    const start = Date.now();
    const trimmed = input.trim();

    if (trimmed.length === 0) {
      return createEmptyIntentResult(Date.now() - start);
    }

    // 只匹配以 / 或 ! 开头的命令
    if (!trimmed.startsWith("/") && !trimmed.startsWith("!")) {
      return createEmptyIntentResult(Date.now() - start);
    }

    const activeSkills = getActiveSkills();
    const matches: SkillMatch[] = [];

    for (const skill of activeSkills) {
      const commands = skill.config.trigger.commands;
      if (!commands) continue;

      for (const cmd of commands) {
        // 精确前缀匹配: 输入以命令开头，且之后是空格或结束
        if (
          trimmed === cmd ||
          trimmed.startsWith(cmd + " ")
        ) {
          matches.push({
            skillId: skill.config.id,
            confidence: 0.95,
            reason: "command",
            matched: cmd,
          });
          break; // 一个 skill 只匹配一次
        }
      }
    }

    if (matches.length > 0) {
      return {
        matches,
        classificationTime: Date.now() - start,
        method: "command",
      };
    }

    return createEmptyIntentResult(Date.now() - start);
  }

  // ---- L2: LLM Classification ----

  async function classifyL2(input: string): Promise<SkillIntentResult> {
    const start = Date.now();

    // 检查启用状态
    if (!enabled || !modelProvider) {
      return createEmptyIntentResult(Date.now() - start);
    }

    // 缓存查询
    const cached = cache.get(input);
    if (cached) {
      if (Date.now() - cached.timestamp < cacheTTL) {
        return cached.result;
      }
      cache.delete(input); // evict stale entry
    }

    const activeSkills = getActiveSkills();
    if (activeSkills.length === 0) {
      return createEmptyIntentResult(Date.now() - start);
    }

    // 构建 LLM prompt
    const skillList = activeSkills
      .map((s) => `- ${s.config.id}: ${s.config.name}`)
      .join("\n");

    const systemPrompt = `You are an intent classifier. Given a user message, determine which skills are most relevant.

Available skills:
${skillList}

Respond with JSON only:
{"matches": [{"skillId": "...", "confidence": 0.0-1.0, "reasoning": "..."}]}

If no skill matches, respond: {"matches": []}`;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
    ];

    try {
      const model = modelProvider.getByCapability(capability);

      // 带超时的 LLM 调用
      const response = await Promise.race([
        model.chat(messages, { temperature: 0.1, maxTokens: 200 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("LLM classification timeout")), timeout),
        ),
      ]);

      const parsed = parseLLMResponse(response.content);
      const matches = filterAndSort(parsed, confidenceThreshold);

      const result: SkillIntentResult = {
        matches,
        classificationTime: Date.now() - start,
        method: matches.length > 0 ? "llm" : "none",
      };

      // 缓存结果 (LRU-like: 超限时移除最旧条目)
      if (cache.size >= MAX_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(input, { result, timestamp: Date.now() });

      return result;
    } catch {
      // 超时或其他错误 — 优雅降级
      return createEmptyIntentResult(Date.now() - start);
    }
  }

  function parseLLMResponse(content: string): readonly LLMMatch[] {
    try {
      const parsed = JSON.parse(content) as { matches?: readonly LLMMatch[] };
      return parsed.matches ?? [];
    } catch {
      return [];
    }
  }

  function filterAndSort(
    llmMatches: readonly LLMMatch[],
    threshold: number,
  ): readonly SkillMatch[] {
    const activeIds = new Set(getActiveSkills().map((s) => s.config.id));

    return llmMatches
      .filter((m) => m.confidence >= threshold && activeIds.has(m.skillId))
      .map((m) => ({
        skillId: m.skillId,
        confidence: m.confidence,
        reason: "llm" as const,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  // ---- public API ----

  function classify(input: string): SkillIntentResult {
    return classifyL1(input);
  }

  async function classifyAsync(input: string): Promise<SkillIntentResult> {
    // 先尝试 L1
    const l1Result = classifyL1(input);
    if (l1Result.matches.length > 0) {
      return l1Result;
    }

    // L1 未命中 → L2
    return classifyL2(input);
  }

  function clearCache(): void {
    cache.clear();
  }

  return {
    classify,
    classifyAsync,
    clearCache,
  };
}

// ============================================================================
// Internal Types
// ============================================================================

interface LLMMatch {
  readonly skillId: string;
  readonly confidence: number;
  readonly reasoning?: string;
}
