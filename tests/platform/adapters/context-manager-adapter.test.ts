/**
 * ContextManagerAdapter 测试
 *
 * 适配 ContextManager → ContextManagerPort
 * 最复杂的 adapter: AgentInput→ContextBlock[], AssembledPrompt→LLMMessage[]
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextManagerAdapter } from "../../../src/platform/adapters/context-manager-adapter.js";
import type { ContextManagerPort, BudgetCheckResult, ProcessedOutput, CompactResult, ContextStats } from "../../../src/agent/ports/platform-services.js";
import type { ContextManager, AssembledPrompt, BudgetStatus, ContextMetrics, ContextBlock } from "../../../src/platform/context-manager.js";
import type { AgentInput, AgentConfig, LLMMessage, MentalModelSnapshot } from "../../../src/agent/types.js";
import type { ToolResult } from "../../../src/platform/tools/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContextManager(): {
  cm: ContextManager;
  assemblePrompt: ReturnType<typeof vi.fn>;
  processToolResult: ReturnType<typeof vi.fn>;
  processLLMOutput: ReturnType<typeof vi.fn>;
  checkBudget: ReturnType<typeof vi.fn>;
  compact: ReturnType<typeof vi.fn>;
  estimateTokens: ReturnType<typeof vi.fn>;
  getMetrics: ReturnType<typeof vi.fn>;
  recordIteration: ReturnType<typeof vi.fn>;
  recordToolCall: ReturnType<typeof vi.fn>;
  updateTokenUsage: ReturnType<typeof vi.fn>;
} {
  const assemblePrompt = vi.fn().mockReturnValue({
    included: [],
    skipped: [],
    tokenUsage: { total: 0, perBlock: new Map() },
  } satisfies AssembledPrompt);

  const processToolResult = vi.fn().mockReturnValue({
    content: "processed",
    truncated: false,
    originalLength: 9,
  });

  const processLLMOutput = vi.fn().mockReturnValue({
    content: "output",
  });

  const checkBudget = vi.fn().mockReturnValue({
    total: 8000,
    identityFixed: 500,
    safetyMargin: 500,
    available: 7000,
    used: 1000,
    shouldCompact: false,
    shouldDegrade: false,
  } satisfies BudgetStatus);

  const compact = vi.fn().mockResolvedValue({
    preserved: [],
    summary: "summary",
    removedCount: 3,
  });

  const estimateTokens = vi.fn().mockImplementation((text: string) =>
    Math.ceil(text.length / 3),
  );
  const getMetrics = vi.fn().mockReturnValue({
    iteration: 2,
    toolChain: [],
    tokenUsage: { total: 8000, identityFixed: 500, used: 1000, available: 7000 },
    compactCount: 1,
  } satisfies ContextMetrics);
  const recordIteration = vi.fn();
  const recordToolCall = vi.fn();
  const updateTokenUsage = vi.fn();

  const cm = {
    assemblePrompt,
    processToolResult,
    processLLMOutput,
    checkBudget,
    compact,
    estimateTokens,
    getMetrics,
    recordIteration,
    recordToolCall,
    updateTokenUsage,
  } as unknown as ContextManager;

  return {
    cm,
    assemblePrompt,
    processToolResult,
    processLLMOutput,
    checkBudget,
    compact,
    estimateTokens,
    getMetrics,
    recordIteration,
    recordToolCall,
    updateTokenUsage,
  };
}

const minimalMentalModel: MentalModelSnapshot = {
  mood: { pleasure: 0.5, arousal: 0.3, dominance: 0.4 },
  activeEmotions: ["neutral"],
  relationshipStage: 1,
  relationshipDescription: "初识",
  formattedText: "[Mood: neutral]",
};

function createMinimalAgentInput(overrides?: Partial<AgentInput>): AgentInput {
  return {
    userMessage: "Hello",
    activatedSkills: [],
    recalledMemories: [],
    conversationHistory: [],
    mentalModel: minimalMentalModel,
    ...overrides,
  };
}

const minimalConfig: AgentConfig = {
  mode: "conversation",
  maxIterations: 25,
  timeout: 120000,
  sessionId: "test-session",
  userId: "test-user",
  isSubAgent: false,
  debugEnabled: false,
};

// ============================================================================
// Tests
// ============================================================================

describe("ContextManagerAdapter", () => {
  let adapter: ContextManagerPort;
  let mock: ReturnType<typeof createMockContextManager>;

  beforeEach(() => {
    mock = createMockContextManager();
    adapter = new ContextManagerAdapter(mock.cm, async (text) => `Summary: ${text.slice(0, 20)}`);
  });

  describe("assemblePrompt", () => {
    it("should convert AgentInput to ContextBlocks and delegate", async () => {
      const input = createMinimalAgentInput({
        userMessage: "Tell me a joke",
      });

      // Mock the assembler to return blocks as-is
      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => {
        return {
          included: assembleInput.blocks,
          skipped: [],
          tokenUsage: { total: 100, perBlock: new Map() },
        };
      });

      const result = await adapter.assemblePrompt(input, minimalConfig);

      // Should have called assemblePrompt with blocks
      expect(mock.assemblePrompt).toHaveBeenCalledTimes(1);
      const callArg = mock.assemblePrompt.mock.calls[0][0] as { blocks: readonly ContextBlock[] };
      expect(callArg.blocks.length).toBeGreaterThan(0);

      // Result should be LLMMessage[]
      expect(Array.isArray(result)).toBe(true);
    });

    it("should create user-message block with priority 2", async () => {
      const input = createMinimalAgentInput({ userMessage: "Hello world" });

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 50, perBlock: new Map() },
      }));

      await adapter.assemblePrompt(input, minimalConfig);

      const callArg = mock.assemblePrompt.mock.calls[0][0] as { blocks: readonly ContextBlock[] };
      const userBlock = callArg.blocks.find((b: ContextBlock) => b.label === "user-message");
      expect(userBlock).toBeDefined();
      expect(userBlock!.priority).toBe(2);
      expect(userBlock!.content).toBe("Hello world");
    });

    it("should create mental-model block with priority 3", async () => {
      const input = createMinimalAgentInput();

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 50, perBlock: new Map() },
      }));

      await adapter.assemblePrompt(input, minimalConfig);

      const callArg = mock.assemblePrompt.mock.calls[0][0] as { blocks: readonly ContextBlock[] };
      const modelBlock = callArg.blocks.find((b: ContextBlock) => b.label === "mental-model");
      expect(modelBlock).toBeDefined();
      expect(modelBlock!.priority).toBe(3);
      expect(modelBlock!.content).toContain("neutral");
    });

    it("should create skill blocks for activated skills", async () => {
      const input = createMinimalAgentInput({
        activatedSkills: [
          {
            id: "coding",
            name: "代码助手",
            injectionLevel: "full",
            knowledge: "Code knowledge here",
            tools: [],
          },
        ],
      });

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 50, perBlock: new Map() },
      }));

      await adapter.assemblePrompt(input, minimalConfig);

      const callArg = mock.assemblePrompt.mock.calls[0][0] as { blocks: readonly ContextBlock[] };
      const skillBlock = callArg.blocks.find((b: ContextBlock) => b.label === "skill:coding");
      expect(skillBlock).toBeDefined();
      expect(skillBlock!.priority).toBe(3);
      expect(skillBlock!.content).toContain("Code knowledge here");
    });

    it("should create memory block with priority 5", async () => {
      const input = createMinimalAgentInput({
        recalledMemories: [
          { content: "Past event", relevanceScore: 0.9, source: "episodic", timestamp: Date.now() },
        ],
      });

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 50, perBlock: new Map() },
      }));

      await adapter.assemblePrompt(input, minimalConfig);

      const callArg = mock.assemblePrompt.mock.calls[0][0] as { blocks: readonly ContextBlock[] };
      const memBlock = callArg.blocks.find((b: ContextBlock) => b.label === "memories");
      expect(memBlock).toBeDefined();
      expect(memBlock!.priority).toBe(5);
      expect(memBlock!.content).toContain("Past event");
    });

    it("should create todo block with priority 4 when present", async () => {
      const input = createMinimalAgentInput({
        todoState: {
          todos: [{ id: "1", content: "Task A", status: "in_progress" }],
          formattedText: "▶ Task A",
        },
      });

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 50, perBlock: new Map() },
      }));

      await adapter.assemblePrompt(input, minimalConfig);

      const callArg = mock.assemblePrompt.mock.calls[0][0] as { blocks: readonly ContextBlock[] };
      const todoBlock = callArg.blocks.find((b: ContextBlock) => b.label === "todo");
      expect(todoBlock).toBeDefined();
      expect(todoBlock!.priority).toBe(4);
      expect(todoBlock!.content).toContain("Task A");
    });

    it("should return system message + user message as LLMMessage[]", async () => {
      const input = createMinimalAgentInput({ userMessage: "Test" });

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 50, perBlock: new Map() },
      }));

      const result = await adapter.assemblePrompt(input, minimalConfig);

      // Should have at least a system message and user message
      const systemMsg = result.find((m) => m.role === "system");
      const userMsg = result.find((m) => m.role === "user");
      expect(systemMsg).toBeDefined();
      expect(userMsg).toBeDefined();
      expect(userMsg!.content).toBe("Test");
    });

    it("should include conversation history as individual messages", async () => {
      const input = createMinimalAgentInput({
        conversationHistory: [
          { role: "user", content: "Hi", timestamp: 1000 },
          { role: "assistant", content: "Hello!", timestamp: 1001 },
        ],
      });

      mock.assemblePrompt.mockImplementation((assembleInput: { blocks: readonly ContextBlock[] }) => ({
        included: assembleInput.blocks,
        skipped: [],
        tokenUsage: { total: 100, perBlock: new Map() },
      }));

      const result = await adapter.assemblePrompt(input, minimalConfig);

      // Should include history messages
      expect(result.length).toBeGreaterThanOrEqual(4); // system + 2 history + user
      const roles = result.map((m) => m.role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
    });
  });

  describe("checkBudget", () => {
    it("should estimate tokens from messages and delegate", () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "You are Kurisu" },
        { role: "user", content: "Hello" },
      ];

      const result = adapter.checkBudget(messages);

      expect(mock.updateTokenUsage).toHaveBeenCalled();
      expect(mock.checkBudget).toHaveBeenCalled();
      expect(result.withinBudget).toBe(true);
      expect(result.shouldCompact).toBe(false);
    });

    it("should map BudgetStatus to BudgetCheckResult", () => {
      mock.checkBudget.mockReturnValue({
        total: 8000,
        identityFixed: 500,
        safetyMargin: 500,
        available: 7000,
        used: 7500,
        shouldCompact: true,
        shouldDegrade: false,
      });

      const result = adapter.checkBudget([{ role: "user", content: "x" }]);

      expect(result.withinBudget).toBe(false);
      expect(result.shouldCompact).toBe(true);
      expect(result.shouldDegrade).toBe(false);
      expect(result.maxTokens).toBe(8000);
    });
  });

  describe("processLLMOutput", () => {
    it("should delegate string to Platform processLLMOutput", () => {
      mock.processLLMOutput
        .mockReturnValueOnce({ content: "Hello world" })
        .mockReturnValueOnce({ content: "" });

      const result = adapter.processLLMOutput("Hello world");

      expect(result.visibleContent).toBe("Hello world");
      expect(result.truncated).toBe(false);
    });

    it("should extract thinking content", () => {
      mock.processLLMOutput
        .mockReturnValueOnce({ content: "visible", thinking: "reasoning" })
        .mockReturnValueOnce({ content: "" });

      const result = adapter.processLLMOutput("<think>reasoning</think>visible");

      expect(result.visibleContent).toBe("visible");
      expect(result.thinkingContent).toBe("reasoning");
    });

    it("should extract emotion tags", () => {
      mock.processLLMOutput
        .mockReturnValueOnce({ content: "text", emotionTags: ["happy", "curious"] })
        .mockReturnValueOnce({ content: "" });

      const result = adapter.processLLMOutput("text\n[emotions: happy, curious]");

      expect(result.emotionTags).toEqual(["happy", "curious"]);
    });
  });

  describe("processToolResult", () => {
    it("should delegate to Platform and return content string", () => {
      mock.processToolResult.mockReturnValue({
        content: "processed output",
        truncated: false,
        originalLength: 15,
      });

      const toolResult: ToolResult = {
        callId: "c1",
        toolName: "web_search",
        success: true,
        output: "raw output",
        latency: 100,
      };

      const result = adapter.processToolResult(toolResult, "web_search");

      expect(result).toBe("processed output");
      expect(mock.processToolResult).toHaveBeenCalledWith({
        toolName: "web_search",
        content: "raw output",
      });
    });

    it("should handle non-string output by stringifying", () => {
      mock.processToolResult.mockReturnValue({
        content: '{"key":"value"}',
        truncated: false,
        originalLength: 15,
      });

      const toolResult: ToolResult = {
        callId: "c1",
        toolName: "test",
        success: true,
        output: { key: "value" },
        latency: 50,
      };

      adapter.processToolResult(toolResult, "test");

      expect(mock.processToolResult).toHaveBeenCalledWith({
        toolName: "test",
        content: '{"key":"value"}',
      });
    });
  });

  describe("compact", () => {
    it("should convert LLMMessages to CompactMessages and delegate", async () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "How are you?" },
        { role: "assistant", content: "I'm fine" },
      ];

      mock.compact.mockResolvedValue({
        preserved: [
          { role: "system", content: "System prompt", pinned: true },
          { role: "user", content: "How are you?", pinned: false },
          { role: "assistant", content: "I'm fine", pinned: false },
        ],
        summary: "User greeted assistant.",
        removedCount: 2,
      });

      mock.estimateTokens
        .mockReturnValueOnce(500) // before
        .mockReturnValueOnce(300); // after

      const result = await adapter.compact(messages);

      expect(result.success).toBe(true);
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.summary).toBe("User greeted assistant.");
    });

    it("should mark system messages as pinned", async () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "System" },
        { role: "user", content: "Q" },
      ];

      mock.compact.mockResolvedValue({
        preserved: [{ role: "system", content: "System", pinned: true }],
        summary: "",
        removedCount: 1,
      });

      await adapter.compact(messages);

      const compactInput = mock.compact.mock.calls[0][0];
      const systemMsg = compactInput.messages.find((m: { role: string }) => m.role === "system");
      expect(systemMsg.pinned).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should map ContextMetrics to ContextStats", () => {
      const stats = adapter.getStats();

      expect(stats.totalTokens).toBe(8000);
      expect(stats.compactCount).toBe(1);
      expect(stats.priorityDistribution).toBeDefined();
    });
  });
});
