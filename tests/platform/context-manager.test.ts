/**
 * ContextManager 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * CM-1: Token 预算
 * CM-2: Token 估算
 * CM-3: Prompt 组装（9 级优先队列）
 * CM-4: 工具结果截断
 * CM-5: LLM 输出处理（think/emotion）
 * CM-6: Compact 策略
 * CM-7: Metrics
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("ContextManager", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function createManager(overrides?: Record<string, unknown>) {
    const { createContextManager } = await import(
      "@/platform/context-manager"
    );
    return createContextManager({
      totalContextTokens: 8000,
      identityContent: "I am Kurisu. ".repeat(10), // ~130 chars → ~44 tokens
      safetyMarginTokens: 500,
      tokenEstimateDivisor: 3,
      maxCompacts: 2,
      ...overrides,
    });
  }

  // ============ CM-2: Token 估算 ============

  describe("CM-2: estimateTokens", () => {
    it("CM-01: estimateTokens 基本计算", async () => {
      const cm = await createManager();
      // "hello world" = 11 chars, ceil(11/3) = 4
      expect(cm.estimateTokens("hello world")).toBe(4);
    });

    it("CM-02: estimateTokens 空字符串 → 0", async () => {
      const cm = await createManager();
      expect(cm.estimateTokens("")).toBe(0);
    });

    it("CM-03: estimateTokens 自定义 divisor", async () => {
      const cm = await createManager({ tokenEstimateDivisor: 2 });
      // "hello" = 5 chars, ceil(5/2) = 3
      expect(cm.estimateTokens("hello")).toBe(3);
    });
  });

  // ============ CM-1: Token 预算 ============

  describe("CM-1: checkBudget", () => {
    it("CM-04: checkBudget available 计算", async () => {
      const cm = await createManager({
        totalContextTokens: 8000,
        identityContent: "x".repeat(300), // ceil(300/3) = 100 tokens
        safetyMarginTokens: 500,
      });
      const budget = cm.checkBudget();
      // available = 8000 - 100 - 500 = 7400
      expect(budget.available).toBe(7400);
    });

    it("CM-05: checkBudget shouldCompact when used >= available", async () => {
      const cm = await createManager({
        totalContextTokens: 1000,
        identityContent: "x".repeat(300), // 100 tokens
        safetyMarginTokens: 500,
      });
      // available = 1000 - 100 - 500 = 400
      cm.updateTokenUsage(400);
      const budget = cm.checkBudget();
      expect(budget.shouldCompact).toBe(true);
    });

    it("CM-06: checkBudget shouldDegrade when compactCount >= maxCompacts", async () => {
      const cm = await createManager({
        totalContextTokens: 1000,
        identityContent: "x".repeat(300),
        safetyMarginTokens: 500,
        maxCompacts: 2,
      });
      // Simulate 2 compacts
      await cm.compact({
        messages: [
          { role: "user", content: "hi", pinned: false },
          { role: "assistant", content: "hello", pinned: false },
        ],
        summarize: async (text) => "summary",
      });
      await cm.compact({
        messages: [
          { role: "user", content: "more", pinned: false },
          { role: "assistant", content: "response", pinned: false },
        ],
        summarize: async (text) => "summary2",
      });
      cm.updateTokenUsage(400);
      const budget = cm.checkBudget();
      expect(budget.shouldDegrade).toBe(true);
    });

    it("CM-07: checkBudget 正常状态", async () => {
      const cm = await createManager();
      const budget = cm.checkBudget();
      expect(budget.shouldCompact).toBe(false);
      expect(budget.shouldDegrade).toBe(false);
      expect(budget.used).toBe(0);
    });
  });

  // ============ CM-3: Prompt 组装 ============

  describe("CM-3: assemblePrompt", () => {
    it("CM-08: assemblePrompt priority 1-4 始终包含", async () => {
      const cm = await createManager({ totalContextTokens: 100000 });
      const result = cm.assemblePrompt({
        blocks: [
          { priority: 1, label: "identity", content: "I am Kurisu." },
          { priority: 2, label: "mental", content: "Mood: calm." },
          { priority: 3, label: "lore", content: "Lore summary." },
          { priority: 4, label: "platform", content: "Tools available." },
          { priority: 7, label: "history", content: "User said hello." },
        ],
      });
      expect(result.included.length).toBe(5);
      expect(result.included.map((b) => b.label)).toContain("identity");
      expect(result.included.map((b) => b.label)).toContain("mental");
      expect(result.included.map((b) => b.label)).toContain("lore");
      expect(result.included.map((b) => b.label)).toContain("platform");
    });

    it("CM-09: assemblePrompt priority 5-9 按预算填充", async () => {
      const cm = await createManager({
        totalContextTokens: 200,
        identityContent: "", // 0 identity tokens
        safetyMarginTokens: 0,
      });
      // available = 200 tokens
      const result = cm.assemblePrompt({
        blocks: [
          { priority: 5, label: "tools", content: "x".repeat(300) }, // 100 tokens
          { priority: 6, label: "memory", content: "y".repeat(150) }, // 50 tokens
          { priority: 7, label: "history", content: "z".repeat(120) }, // 40 tokens
        ],
      });
      // All fit within 200 tokens (100+50+40=190)
      expect(result.included.length).toBe(3);
    });

    it("CM-10: assemblePrompt 超预算块被跳过", async () => {
      const cm = await createManager({
        totalContextTokens: 100,
        identityContent: "", // 0 identity tokens
        safetyMarginTokens: 0,
      });
      // available = 100 tokens
      const result = cm.assemblePrompt({
        blocks: [
          { priority: 5, label: "tools", content: "x".repeat(240) }, // 80 tokens
          { priority: 6, label: "memory", content: "y".repeat(300) }, // 100 tokens — would exceed
          { priority: 7, label: "history", content: "z".repeat(30) }, // 10 tokens — fits
        ],
      });
      expect(result.included.map((b) => b.label)).toContain("tools");
      expect(result.included.map((b) => b.label)).not.toContain("memory");
      expect(result.included.map((b) => b.label)).toContain("history");
    });

    it("CM-11: assemblePrompt per-block token 统计", async () => {
      const cm = await createManager({ totalContextTokens: 100000 });
      const result = cm.assemblePrompt({
        blocks: [
          { priority: 1, label: "identity", content: "hello" }, // ceil(5/3) = 2
          { priority: 5, label: "tools", content: "world!" }, // ceil(6/3) = 2
        ],
      });
      expect(result.tokenUsage).toBeDefined();
      expect(result.tokenUsage.total).toBeGreaterThan(0);
    });

    it("CM-12: assemblePrompt 空 blocks", async () => {
      const cm = await createManager();
      const result = cm.assemblePrompt({ blocks: [] });
      expect(result.included).toEqual([]);
      expect(result.tokenUsage.total).toBe(0);
    });
  });

  // ============ CM-4: 工具结果截断 ============

  describe("CM-4: processToolResult", () => {
    it("CM-13: processToolResult default 头部截断", async () => {
      const cm = await createManager();
      const longContent = "a".repeat(5000); // ~1667 tokens > 1300 threshold
      const result = cm.processToolResult({
        toolName: "custom_tool",
        content: longContent,
      });
      expect(result.truncated).toBe(true);
      expect(cm.estimateTokens(result.content)).toBeLessThanOrEqual(1300 + 50); // allow margin for notice
    });

    it("CM-14: processToolResult shell 尾部截断", async () => {
      const cm = await createManager();
      const shellOutput = "start\n" + "middle line\n".repeat(500) + "ERROR: final output";
      const result = cm.processToolResult({
        toolName: "shell",
        content: shellOutput,
      });
      expect(result.truncated).toBe(true);
      // 尾部保留：最终应包含 "ERROR: final output"
      expect(result.content).toContain("ERROR: final output");
    });

    it("CM-15: processToolResult file_read 更高阈值", async () => {
      const cm = await createManager();
      const fileContent = "line\n".repeat(1000); // ~1667 tokens
      const result = cm.processToolResult({
        toolName: "file_read",
        content: fileContent,
      });
      // file_read threshold is 2000, content is ~1667 tokens → not truncated
      expect(result.truncated).toBe(false);
    });

    it("CM-16: processToolResult 截断通知追加", async () => {
      const cm = await createManager();
      const longContent = "x".repeat(5000);
      const result = cm.processToolResult({
        toolName: "custom_tool",
        content: longContent,
      });
      expect(result.content).toContain("已截断");
    });

    it("CM-17: processToolResult 未超阈值 → truncated=false", async () => {
      const cm = await createManager();
      const shortContent = "hello world";
      const result = cm.processToolResult({
        toolName: "custom_tool",
        content: shortContent,
      });
      expect(result.truncated).toBe(false);
      expect(result.content).toBe("hello world");
    });

    it("CM-18: processToolResult web_search 截断", async () => {
      const cm = await createManager();
      const searchResult = "result ".repeat(1000); // ~2333 tokens > 1000 threshold
      const result = cm.processToolResult({
        toolName: "web_search",
        content: searchResult,
      });
      expect(result.truncated).toBe(true);
    });
  });

  // ============ CM-5: LLM 输出处理 ============

  describe("CM-5: processLLMOutput", () => {
    it("CM-19: processLLMOutput 普通文本透传", async () => {
      const cm = await createManager();
      const result = cm.processLLMOutput({ text: "Hello!", done: false });
      expect(result.content).toBe("Hello!");
      expect(result.thinking).toBeUndefined();
      expect(result.emotionTags).toBeUndefined();
    });

    it("CM-20: processLLMOutput think 标签剥离", async () => {
      const cm = await createManager();
      const r1 = cm.processLLMOutput({
        text: "<think>analyzing query</think>The answer is 42.",
        done: false,
      });
      expect(r1.content).toBe("The answer is 42.");
      expect(r1.thinking).toBe("analyzing query");
    });

    it("CM-21: processLLMOutput think 跨 chunk", async () => {
      const cm = await createManager();
      const r1 = cm.processLLMOutput({ text: "prefix <think>start", done: false });
      expect(r1.content).toBe("prefix ");

      const r2 = cm.processLLMOutput({ text: " middle", done: false });
      expect(r2.content).toBe("");

      const r3 = cm.processLLMOutput({ text: " end</think>visible", done: false });
      expect(r3.content).toBe("visible");
      expect(r3.thinking).toBe("start middle end");
    });

    it("CM-22: processLLMOutput emotion_tags 提取", async () => {
      const cm = await createManager();
      const result = cm.processLLMOutput({
        text: "真是的。\n[emotions: 傲娇, 无奈, 关心]",
        done: false,
      });
      expect(result.content).toBe("真是的。");
      expect(result.emotionTags).toEqual(["傲娇", "无奈", "关心"]);
    });

    it("CM-23: processLLMOutput 文本+emotions 分离", async () => {
      const cm = await createManager();
      const result = cm.processLLMOutput({
        text: "Some text here.\n[emotions: happy, sad]",
        done: false,
      });
      expect(result.content).toBe("Some text here.");
      expect(result.emotionTags).toEqual(["happy", "sad"]);
    });

    it("CM-24: processLLMOutput 无特殊标签", async () => {
      const cm = await createManager();
      const result = cm.processLLMOutput({ text: "just plain text", done: false });
      expect(result.content).toBe("just plain text");
      expect(result.thinking).toBeUndefined();
      expect(result.emotionTags).toBeUndefined();
    });

    it("CM-25: processLLMOutput done=true 重置状态", async () => {
      const cm = await createManager();
      // Start think block
      cm.processLLMOutput({ text: "<think>start", done: false });
      // Done resets
      const result = cm.processLLMOutput({ text: "", done: true });
      expect(result.thinking).toBeDefined(); // flush remaining think

      // New chunk should work fresh
      const fresh = cm.processLLMOutput({ text: "new text", done: false });
      expect(fresh.content).toBe("new text");
    });
  });

  // ============ CM-6: Compact 策略 ============

  describe("CM-6: compact", () => {
    it("CM-26: compact pinned 消息保留", async () => {
      const cm = await createManager();
      const summarize = vi.fn(async (text: string) => "summary");
      const result = await cm.compact({
        messages: [
          { role: "user", content: "pinned instruction", pinned: true },
          { role: "assistant", content: "old reply 1", pinned: false },
          { role: "user", content: "old question 2", pinned: false },
          { role: "assistant", content: "old reply 2", pinned: false },
          { role: "user", content: "recent q", pinned: false },
          { role: "assistant", content: "recent a", pinned: false },
        ],
        summarize,
      });
      // Pinned message preserved
      expect(result.preserved.some((m) => m.content === "pinned instruction")).toBe(true);
    });

    it("CM-27: compact 最近 2 轮保留", async () => {
      const cm = await createManager();
      const summarize = vi.fn(async (text: string) => "summary");
      const result = await cm.compact({
        messages: [
          { role: "user", content: "old q1", pinned: false },
          { role: "assistant", content: "old a1", pinned: false },
          { role: "user", content: "old q2", pinned: false },
          { role: "assistant", content: "old a2", pinned: false },
          { role: "user", content: "recent q1", pinned: false },
          { role: "assistant", content: "recent a1", pinned: false },
          { role: "user", content: "recent q2", pinned: false },
          { role: "assistant", content: "recent a2", pinned: false },
        ],
        summarize,
      });
      // 最近 2 轮 (4 条消息) 保留
      expect(result.preserved.some((m) => m.content === "recent q1")).toBe(true);
      expect(result.preserved.some((m) => m.content === "recent a1")).toBe(true);
      expect(result.preserved.some((m) => m.content === "recent q2")).toBe(true);
      expect(result.preserved.some((m) => m.content === "recent a2")).toBe(true);
    });

    it("CM-28: compact 中间历史 summarize", async () => {
      const cm = await createManager();
      const summarize = vi.fn(async (text: string) => "compressed history");
      const result = await cm.compact({
        messages: [
          { role: "user", content: "old q1", pinned: false },
          { role: "assistant", content: "old a1", pinned: false },
          { role: "user", content: "old q2", pinned: false },
          { role: "assistant", content: "old a2", pinned: false },
          { role: "user", content: "recent q", pinned: false },
          { role: "assistant", content: "recent a", pinned: false },
        ],
        summarize,
      });
      expect(summarize).toHaveBeenCalled();
      expect(result.summary).toBe("compressed history");
    });

    it("CM-29: compact compactCount 递增", async () => {
      const cm = await createManager();
      const summarize = async (text: string) => "s";
      expect(cm.getMetrics().compactCount).toBe(0);

      await cm.compact({
        messages: [
          { role: "user", content: "q", pinned: false },
          { role: "assistant", content: "a", pinned: false },
        ],
        summarize,
      });
      expect(cm.getMetrics().compactCount).toBe(1);

      await cm.compact({
        messages: [
          { role: "user", content: "q2", pinned: false },
          { role: "assistant", content: "a2", pinned: false },
        ],
        summarize,
      });
      expect(cm.getMetrics().compactCount).toBe(2);
    });
  });

  // ============ CM-7: Metrics ============

  describe("CM-7: getMetrics", () => {
    it("CM-30: getMetrics 初始值 + recordIteration/recordToolCall/updateTokenUsage", async () => {
      const cm = await createManager();
      const initial = cm.getMetrics();
      expect(initial.iteration).toBe(0);
      expect(initial.toolChain).toEqual([]);
      expect(initial.tokenUsage.total).toBe(8000);
      expect(initial.tokenUsage.used).toBe(0);
      expect(initial.compactCount).toBe(0);

      cm.recordIteration();
      cm.recordIteration();
      cm.recordToolCall({
        name: "shell",
        durationMs: 120,
        success: true,
        truncated: false,
      });
      cm.updateTokenUsage(500);

      const updated = cm.getMetrics();
      expect(updated.iteration).toBe(2);
      expect(updated.toolChain).toHaveLength(1);
      expect(updated.toolChain[0]).toEqual({
        name: "shell",
        durationMs: 120,
        success: true,
        truncated: false,
      });
      expect(updated.tokenUsage.used).toBe(500);
    });
  });
});
