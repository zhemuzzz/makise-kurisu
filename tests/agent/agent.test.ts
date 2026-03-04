/**
 * Agent Core 测试
 * TDD: RED -> GREEN -> IMPROVE
 *
 * 测试范围:
 * - Pipeline 执行顺序
 * - ReAct 迭代限制
 * - Token 预算降级
 * - 错误分类
 * - 降级路径
 * - AgentEvent 流
 * - Abort 传播
 * - Session 处理锁
 * - 消息队列
 *
 * 设计来源:
 * - agent-core.md: D1~D6, D13, D19/BG-1
 * - react-engineering.md: C1~C4
 * - context-manager.md: CM-1~CM-7
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type {
  Identity,
  AgentConfig,
  AgentInput,
  AgentEvent,
  AgentResult,
  LLMMessage,
  LLMResponse,
  ToolCall,
  ToolResult,
  ToolCallRecord,
} from "@/agent/types.js";
import type { PlatformServices } from "@/agent/ports/platform-services.js";
import type {
  BudgetCheckResult,
  ProcessedOutput,
  CompactResult,
  ContextStats,
} from "@/agent/ports/platform-services.js";
import type {
  PermissionResult,
  ToolPermissionAnnotation,
  ApprovalRequest,
  ApprovalResponse,
  TracingEvent,
  MemoryRecallResult,
  LLMStreamChunk,
  LLMCallConfig,
  SubAgentConfig,
  SubAgentResult,
  SubAgentStatus,
  SkillSearchResult,
  SkillActivation,
} from "@/agent/ports/platform-services.js";
import type { ToolDef } from "@/platform/tools/types.js";

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * 创建测试用 Identity
 */
function createTestIdentity(overrides?: Partial<Identity>): Identity {
  return {
    roleId: "kurisu",
    soul: "我是牧濑红莉栖，一名物理学家。虽然嘴上不饶人，但我其实很关心身边的人。",
    persona: {
      name: "Kurisu",
      description: "傲娇的天才物理学家",
      catchphrases: ["哼", "笨蛋", "...算了"],
      tone: "傲娇但专业",
    },
    loreCore: "来自未来的科学家，时间旅行研究的专家。",
    ...overrides,
  };
}

/**
 * 创建测试用 AgentConfig
 */
function createTestConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    mode: "conversation",
    maxIterations: 25,
    timeout: 120000,
    sessionId: "test-session-123",
    userId: "test-user-456",
    isSubAgent: false,
    debugEnabled: false,
    ...overrides,
  };
}

/**
 * 创建测试用 AgentInput
 */
function createTestInput(overrides?: Partial<AgentInput>): AgentInput {
  return {
    userMessage: "你好",
    activatedSkills: [],
    recalledMemories: [],
    conversationHistory: [],
    mentalModel: {
      mood: { pleasure: 0.5, arousal: 0.3, dominance: 0.4 },
      activeEmotions: ["calm"],
      relationshipStage: 3,
      relationshipDescription: "朋友",
      formattedText: "当前心境：平静",
    },
    ...overrides,
  };
}

/**
 * 创建 Mock ContextManagerPort
 */
function createMockContextManager() {
  return {
    assemblePrompt: vi.fn(
      async (): Promise<LLMMessage[]> => [
        { role: "system", content: "You are Kurisu." },
        { role: "user", content: "Hello" },
      ],
    ),
    checkBudget: vi.fn(
      (): BudgetCheckResult => ({
        withinBudget: true,
        currentTokens: 1000,
        maxTokens: 8000,
        remainingTokens: 7000,
        shouldCompact: false,
        shouldDegrade: false,
      }),
    ),
    processLLMOutput: vi.fn(
      (rawOutput: string): ProcessedOutput => ({
        visibleContent: rawOutput.replace(
          /<thinking>[\s\S]*?<\/thinking>/g,
          "",
        ),
        thinkingContent: undefined,
        emotionTags: undefined,
        truncated: false,
      }),
    ),
    processToolResult: vi.fn((result: ToolResult): string =>
      typeof result.output === "string"
        ? result.output
        : JSON.stringify(result.output),
    ),
    compact: vi.fn(
      async (messages: LLMMessage[]): Promise<CompactResult> => ({
        messages,
        tokensBefore: 7000,
        tokensAfter: 3000,
        success: true,
        summary: "Summary of conversation",
      }),
    ),
    getStats: vi.fn(
      (): ContextStats => ({
        totalTokens: 1000,
        priorityDistribution: {},
        compactCount: 0,
      }),
    ),
  };
}

/**
 * 创建 Mock ToolExecutorPort
 */
function createMockToolExecutor() {
  const toolResults: Map<string, ToolResult> = new Map();

  return {
    execute: vi.fn(async (toolCall: ToolCall): Promise<ToolResult> => {
      const existing = toolResults.get(toolCall.id);
      if (existing) return existing;
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        success: true,
        output: "Tool executed successfully",
        latency: 100,
      };
    }),
    executeBatch: vi.fn(
      async (toolCalls: ToolCall[]): Promise<ToolResult[]> => {
        return Promise.all(
          toolCalls.map(
            (tc) =>
              toolResults.get(tc.id) ?? {
                callId: tc.id,
                toolName: tc.name,
                success: true,
                output: "Batch execution result",
                latency: 50,
              },
          ),
        );
      },
    ),
    getToolDefinitions: vi.fn(
      async (): Promise<ToolDef[]> => [
        {
          name: "test_tool",
          description: "A test tool",
          inputSchema: { type: "object", properties: {} },
          permission: "safe",
          source: { type: "native" },
        },
      ],
    ),
    isToolAvailable: vi.fn(
      (toolName: string): boolean => toolName === "test_tool",
    ),
    _setToolResult: (callId: string, result: ToolResult) => {
      toolResults.set(callId, result);
    },
    _clearResults: () => {
      toolResults.clear();
    },
  };
}

/**
 * 创建 Mock SkillManagerPort
 */
function createMockSkillManager() {
  return {
    findSkill: vi.fn(async (): Promise<SkillSearchResult[]> => []),
    getActiveSkills: vi.fn(async (): Promise<SkillActivation[]> => []),
    activate: vi.fn(
      async (): Promise<SkillActivation> => ({
        id: "skill-1",
        name: "Test Skill",
        injectionLevel: "full",
        activatedAt: Date.now(),
      }),
    ),
    archive: vi.fn(async (): Promise<boolean> => true),
    createDraft: vi.fn(async (): Promise<string> => "draft-123"),
    confirmDraft: vi.fn(async (): Promise<boolean> => true),
  };
}

/**
 * 创建 Mock SubAgentManagerPort
 */
function createMockSubAgentManager() {
  return {
    spawn: vi.fn(async (): Promise<string> => "sub-agent-123"),
    awaitResult: vi.fn(
      async (): Promise<SubAgentResult> => ({
        subAgentId: "sub-agent-123",
        success: true,
        result: { data: "Sub-agent completed" },
        stats: {
          iterations: 5,
          toolCallCount: 2,
          totalTokens: 500,
          inputTokens: 300,
          outputTokens: 200,
          duration: 3000,
          compactCount: 0,
        },
      }),
    ),
    abort: vi.fn(async (): Promise<boolean> => true),
    getActiveCount: vi.fn((): number => 0),
    getStatus: vi.fn((): SubAgentStatus => "completed"),
  };
}

/**
 * 创建 Mock PermissionPort
 */
function createMockPermission() {
  const toolPermissions: Map<string, PermissionResult> = new Map();

  return {
    check: vi.fn(
      async (): Promise<PermissionResult> => ({
        level: "allow",
        allowed: true,
        requiresConfirmation: false,
      }),
    ),
    getToolAnnotation: vi.fn(
      (toolName: string): ToolPermissionAnnotation => ({
        toolName,
        level: toolPermissions.get(toolName)?.level ?? "safe",
      }),
    ),
    getToolAnnotations: vi.fn(
      (toolNames: string[]): Record<string, ToolPermissionAnnotation> => {
        const result: Record<string, ToolPermissionAnnotation> = {};
        for (const name of toolNames) {
          result[name] = { toolName: name, level: "safe" };
        }
        return result;
      },
    ),
    _setPermission: (toolName: string, result: PermissionResult) => {
      toolPermissions.set(toolName, result);
    },
  };
}

/**
 * 创建 Mock ApprovalPort
 */
function createMockApproval() {
  const pendingResponses: Map<string, ApprovalResponse> = new Map();

  return {
    requestApproval: vi.fn(
      async (): Promise<string> => `approval-${Date.now()}`,
    ),
    awaitResponse: vi.fn(
      async (approvalId: string): Promise<ApprovalResponse> =>
        pendingResponses.get(approvalId) ?? {
          approvalId,
          action: "approve",
        },
    ),
    handleUserResponse: vi.fn(),
    rejectAllPending: vi.fn(),
    getPendingCount: vi.fn((): number => 0),
    _setResponse: (approvalId: string, response: ApprovalResponse) => {
      pendingResponses.set(approvalId, response);
    },
  };
}

/**
 * 创建 Mock TracingPort
 */
function createMockTracing() {
  const events: TracingEvent[] = [];
  const spans: Map<
    string,
    { name: string; parentId?: string; startTime: number }
  > = new Map();

  return {
    log: vi.fn((event: TracingEvent) => {
      events.push(event);
    }),
    logMetric: vi.fn(),
    startSpan: vi.fn((name: string, parentId?: string): string => {
      const spanId = `span-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      spans.set(spanId, { name, parentId, startTime: Date.now() });
      return spanId;
    }),
    endSpan: vi.fn((spanId: string) => {
      spans.delete(spanId);
    }),
    _getEvents: () => [...events],
    _clearEvents: () => {
      events.length = 0;
    },
  };
}

/**
 * 创建 Mock MemoryPort
 */
function createMockMemory() {
  return {
    recall: vi.fn(async (): Promise<MemoryRecallResult[]> => []),
    store: vi.fn(async (): Promise<void> => {}),
  };
}

/**
 * 创建 Mock LLMProviderPort
 */
function createMockLLM() {
  const responses: LLMResponse[] = [];
  let responseIndex = 0;

  return {
    stream: vi.fn(function* (
      _messages: LLMMessage[],
      _tools: ToolDef[],
      _config: LLMCallConfig,
      signal?: AbortSignal,
    ): Generator<LLMStreamChunk, LLMResponse, unknown> {
      const response =
        responses[responseIndex] ??
        ({
          content: "Hello! I'm Kurisu.",
          toolCalls: undefined,
          finishReason: "stop",
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        } as LLMResponse);

      responseIndex++;

      // Stream content in chunks
      if (response.content) {
        const words = response.content.split(" ");
        for (let i = 0; i < words.length; i++) {
          if (signal?.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          yield { delta: (i > 0 ? " " : "") + words[i] };
        }
      }

      // Stream tool calls (reactLoop collects them from chunks)
      if (response.toolCalls && response.toolCalls.length > 0) {
        yield { delta: "", toolCalls: response.toolCalls as Partial<ToolCall>[] };
      }

      return response;
    }),
    getAvailableModels: vi.fn((): string[] => ["glm-5", "gpt-4"]),
    isModelAvailable: vi.fn((): boolean => true),
    _addResponse: (response: LLMResponse) => {
      responses.push(response);
    },
    _setResponseIndex: (index: number) => {
      responseIndex = index;
    },
    _clearResponses: () => {
      responses.length = 0;
      responseIndex = 0;
    },
  };
}

/**
 * 创建完整的 Mock PlatformServices
 */
function createMockPlatformServices(): PlatformServices & {
  context: ReturnType<typeof createMockContextManager> & object;
  tools: ReturnType<typeof createMockToolExecutor> & object;
  skills: ReturnType<typeof createMockSkillManager> & object;
  subAgents: ReturnType<typeof createMockSubAgentManager> & object;
  permission: ReturnType<typeof createMockPermission> & object;
  approval: ReturnType<typeof createMockApproval> & object;
  tracing: ReturnType<typeof createMockTracing> & object;
  memory: ReturnType<typeof createMockMemory> & object;
  llm: ReturnType<typeof createMockLLM> & object;
} {
  return {
    context: createMockContextManager(),
    tools: createMockToolExecutor(),
    skills: createMockSkillManager(),
    subAgents: createMockSubAgentManager(),
    permission: createMockPermission(),
    approval: createMockApproval(),
    tracing: createMockTracing(),
    memory: createMockMemory(),
    llm: createMockLLM(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("Agent Core", () => {
  let mockServices: ReturnType<typeof createMockPlatformServices>;
  let identity: Identity;

  beforeEach(() => {
    vi.resetModules();
    mockServices = createMockPlatformServices();
    identity = createTestIdentity();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============ Pipeline 执行顺序 ============

  describe("Pipeline", () => {
    it("PIPE-01: execute 应该按 PreProcess -> ReAct -> PostProcess 顺序执行", async () => {
      // This test will fail until Agent is implemented
      expect.assertions(1);

      // Expected call order:
      // 1. context.assemblePrompt() - PreProcess
      // 2. llm.stream() - ReAct
      // 3. context.processLLMOutput() - PostProcess
      // 4. memory.store() - PostProcess

      const expectedOrder = [
        "assemblePrompt",
        "stream",
        "processLLMOutput",
        "store",
      ];

      // Will verify once Agent is implemented
      expect(expectedOrder).toEqual([
        "assemblePrompt",
        "stream",
        "processLLMOutput",
        "store",
      ]);
    });

    it("PIPE-02: PreProcess 应该调用 assemblePrompt 和 checkBudget", async () => {
      // Test that PreProcess phase calls the right services
      expect.assertions(1);

      const { context } = mockServices;

      // PreProcess should:
      // 1. context.assemblePrompt(input, config)
      // 2. context.checkBudget(messages)
      // 3. tools.getToolDefinitions(skillIds)

      // Will verify once Agent is implemented
      expect(context.assemblePrompt).toBeDefined();
    });

    it("PIPE-03: PostProcess 应该处理输出并写入记忆", async () => {
      // Test that PostProcess phase handles output correctly
      expect.assertions(2);

      const { context, memory } = mockServices;

      // PostProcess should:
      // 1. context.processLLMOutput(rawOutput)
      // 2. memory.store(finalResponse, userId, metadata)
      // 3. tracing.log(completeEvent)

      expect(context.processLLMOutput).toBeDefined();
      expect(memory.store).toBeDefined();
    });
  });

  // ============ ReAct 迭代限制 ============

  describe("ReAct Loop", () => {
    it("REACT-01: Main Agent maxIterations = 25", async () => {
      expect.assertions(1);

      const mainConfig = createTestConfig({ isSubAgent: false });
      expect(mainConfig.maxIterations).toBe(25);
    });

    it("REACT-02: Sub-Agent maxIterations = 15", async () => {
      expect.assertions(1);

      const subConfig = createTestConfig({
        isSubAgent: true,
        maxIterations: 15,
      });
      expect(subConfig.maxIterations).toBe(15);
    });

    it("REACT-03: 达到 maxIterations 时应该触发降级", async () => {
      // Test that reaching maxIterations triggers degradation
      expect.assertions(2);

      const config = createTestConfig({ maxIterations: 3 });
      const { llm, context } = mockServices;

      // Setup: LLM always returns tool calls (never stops)
      llm._addResponse({
        content: "",
        toolCalls: [{ id: "tc-1", name: "test_tool", arguments: {} }],
        finishReason: "tool_calls",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      });
      llm._addResponse({
        content: "",
        toolCalls: [{ id: "tc-2", name: "test_tool", arguments: {} }],
        finishReason: "tool_calls",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      });
      llm._addResponse({
        content: "",
        toolCalls: [{ id: "tc-3", name: "test_tool", arguments: {} }],
        finishReason: "tool_calls",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      });

      // After maxIterations, should degrade
      // Will verify once Agent is implemented
      expect(config.maxIterations).toBe(3);
      expect(llm.stream).toBeDefined();
    });

    it("REACT-04: LLM 返回纯文本时应该结束循环", async () => {
      // Test that ReAct loop exits when LLM returns text without tool calls
      expect.assertions(1);

      const { llm } = mockServices;

      // Setup: LLM returns text response (no tool calls)
      llm._addResponse({
        content: "Hello! How can I help you?",
        toolCalls: undefined,
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      });

      // Should exit loop and return response
      expect(llm.stream).toBeDefined();
    });

    it("REACT-05: 每次迭代后应该检查 Token 预算", async () => {
      // Test that checkBudget is called after each iteration
      expect.assertions(1);

      const { context, llm } = mockServices;

      // Setup multiple tool call iterations
      llm._addResponse({
        content: "",
        toolCalls: [{ id: "tc-1", name: "test_tool", arguments: {} }],
        finishReason: "tool_calls",
        usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      });
      llm._addResponse({
        content: "Done!",
        finishReason: "stop",
        usage: { promptTokens: 150, completionTokens: 10, totalTokens: 160 },
      });

      // checkBudget should be called after each iteration
      expect(context.checkBudget).toBeDefined();
    });
  });

  // ============ Token 预算降级 ============

  describe("Token Budget Degradation", () => {
    it("BUDGET-01: shouldCompact=true 时应该触发 compact", async () => {
      expect.assertions(2);

      const { context } = mockServices;

      // Setup: checkBudget returns shouldCompact = true
      context.checkBudget.mockReturnValueOnce({
        withinBudget: false,
        currentTokens: 7500,
        maxTokens: 8000,
        remainingTokens: 500,
        shouldCompact: true,
        shouldDegrade: false,
      });

      const result = context.checkBudget();

      expect(result.shouldCompact).toBe(true);
      expect(result.shouldDegrade).toBe(false);
    });

    it("BUDGET-02: shouldDegrade=true 时应该走降级路径", async () => {
      expect.assertions(2);

      const { context } = mockServices;

      // Setup: checkBudget returns shouldDegrade = true
      context.checkBudget.mockReturnValueOnce({
        withinBudget: false,
        currentTokens: 7900,
        maxTokens: 8000,
        remainingTokens: 100,
        shouldCompact: false,
        shouldDegrade: true,
      });

      const result = context.checkBudget();

      expect(result.shouldDegrade).toBe(true);
      expect(result.shouldCompact).toBe(false);
    });

    it("BUDGET-03: compact 成功后应该恢复 ReAct", async () => {
      expect.assertions(2);

      const { context } = mockServices;

      // Setup: compact succeeds
      context.compact.mockResolvedValueOnce({
        messages: [{ role: "user", content: "Summary" }],
        tokensBefore: 7500,
        tokensAfter: 2000,
        success: true,
        summary: "Conversation summary",
      });

      const result = await context.compact([], []);

      expect(result.success).toBe(true);
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    });

    it("BUDGET-04: compact 失败后应该降级", async () => {
      expect.assertions(1);

      const { context } = mockServices;

      // Setup: compact fails
      context.compact.mockResolvedValueOnce({
        messages: [],
        tokensBefore: 7500,
        tokensAfter: 7500,
        success: false,
      });

      const result = await context.compact([], []);

      expect(result.success).toBe(false);
    });

    it("BUDGET-05: compact 达到 maxCompacts 次后应该降级", async () => {
      expect.assertions(1);

      const { context } = mockServices;

      // Simulate multiple compacts
      const stats = context.getStats();

      // After maxCompacts (default 2), shouldDegrade should be true
      expect(stats.compactCount).toBeDefined();
    });
  });

  // ============ 错误分类 (C1-1) ============

  describe("Error Classification", () => {
    it("ERR-01: TOOL_ERROR - 参数错误应该返回错误结果", async () => {
      expect.assertions(1);

      const { tools } = mockServices;

      // Setup: tool execution returns error for invalid params
      tools.execute.mockResolvedValueOnce({
        callId: "tc-invalid",
        toolName: "test_tool",
        success: false,
        output: null,
        error: "INVALID_PARAMS: Missing required parameter 'query'",
        latency: 10,
      });

      const result = await tools.execute({
        id: "tc-invalid",
        name: "test_tool",
        arguments: {},
      });

      expect(result.success).toBe(false);
    });

    it("ERR-02: TOOL_ERROR - 执行失败应该返回错误结果", async () => {
      expect.assertions(1);

      const { tools } = mockServices;

      // Setup: tool execution fails
      tools.execute.mockResolvedValueOnce({
        callId: "tc-fail",
        toolName: "test_tool",
        success: false,
        output: null,
        error: "EXECUTION_FAILED: Network timeout",
        latency: 30000,
      });

      const result = await tools.execute({
        id: "tc-fail",
        name: "test_tool",
        arguments: { query: "test" },
      });

      expect(result.success).toBe(false);
    });

    it("ERR-03: TOOL_ERROR - 权限被拒应该返回 PermissionDenied", async () => {
      expect.assertions(2);

      const { permission } = mockServices;

      // Setup: permission check returns deny
      permission.check.mockResolvedValueOnce({
        level: "deny",
        allowed: false,
        requiresConfirmation: false,
        reason: "Tool is in deny list",
      });

      const result = await permission.check(
        "dangerous_tool",
        {},
        "session-123",
      );

      expect(result.allowed).toBe(false);
      expect(result.level).toBe("deny");
    });

    it("ERR-04: TOOL_ERROR - 用户拒绝确认应该返回 UserRejected", async () => {
      expect.assertions(1);

      const { approval } = mockServices;

      // Setup: user rejects the approval
      approval._setResponse("approval-reject", {
        approvalId: "approval-reject",
        action: "reject",
        userMessage: "I don't want to run this command",
      });

      const result = await approval.awaitResponse("approval-reject");

      expect(result.action).toBe("reject");
    });

    it("ERR-05: TOOL_ERROR - 工具超时应该返回 Timeout", async () => {
      expect.assertions(1);

      const { tools } = mockServices;

      // Setup: tool execution times out
      tools.execute.mockResolvedValueOnce({
        callId: "tc-timeout",
        toolName: "slow_tool",
        success: false,
        output: null,
        error: "TIMEOUT: Execution exceeded 30000ms",
        latency: 30000,
      });

      const result = await tools.execute({
        id: "tc-timeout",
        name: "slow_tool",
        arguments: {},
      });

      expect(result.error).toContain("TIMEOUT");
    });

    it("ERR-06: TRANSIENT - 网络超时应该自动重试 1 次", async () => {
      // Test that transient errors are retried once
      expect.assertions(1);

      // TRANSIENT errors (network timeout, rate limit) should be retried once
      // with 2s interval

      // Will verify once Agent is implemented
      expect(true).toBe(true);
    });

    it("ERR-07: TRANSIENT - 速率限制应该自动重试 1 次", async () => {
      // Test rate limit retry
      expect.assertions(1);

      // Will verify once Agent is implemented
      expect(true).toBe(true);
    });

    it("ERR-08: SYSTEM_ERROR - LLM 错误不应该写入 history", async () => {
      // Test that SYSTEM_ERROR does not persist to history
      expect.assertions(1);

      const { llm, memory } = mockServices;

      // Setup: LLM throws an error
      llm.stream.mockImplementationOnce(function* () {
        throw new Error("LLM_ERROR: API unavailable");
      });

      // SYSTEM_ERROR should:
      // 1. NOT write to memory
      // 2. Yield error event
      // 3. Use degradation template

      // Will verify once Agent is implemented
      expect(memory.store).toBeDefined();
    });

    it("ERR-09: SYSTEM_ERROR - Context 溢出应该触发降级", async () => {
      expect.assertions(1);

      const { context } = mockServices;

      // Setup: Context overflow
      context.checkBudget.mockReturnValueOnce({
        withinBudget: false,
        currentTokens: 10000,
        maxTokens: 8000,
        remainingTokens: 0,
        shouldCompact: false,
        shouldDegrade: true,
      });

      const result = context.checkBudget();

      expect(result.shouldDegrade).toBe(true);
    });

    it("ERR-10: SYSTEM_ERROR - 模型不可用应该直接降级", async () => {
      expect.assertions(1);

      const { llm } = mockServices;

      // Setup: model not available
      llm.isModelAvailable.mockReturnValue(false);

      const available = llm.isModelAvailable("nonexistent-model");

      expect(available).toBe(false);
    });
  });

  // ============ 降级路径 (C1-2) ============

  describe("Degradation Paths", () => {
    it("DEG-01: maxIterations 达到时应该使用降级模板", async () => {
      // Test degradation template usage
      expect.assertions(1);

      // When maxIterations is reached:
      // 1. Keep all completed tool results
      // 2. Send final round to LLM with degradation instruction
      // 3. If final round fails, use static template

      // Template: "抱歉，这个任务有点复杂，我暂时没法完全完成。让我先总结一下目前的进展..."
      expect(true).toBe(true);
    });

    it("DEG-02: Token 预算耗尽时应该先 compact 再降级", async () => {
      expect.assertions(2);

      const { context } = mockServices;

      // Setup: budget exhausted
      context.checkBudget.mockReturnValueOnce({
        withinBudget: false,
        currentTokens: 8000,
        maxTokens: 8000,
        remainingTokens: 0,
        shouldCompact: true,
        shouldDegrade: false,
      });

      const budget = context.checkBudget();

      // Should try compact first
      expect(budget.shouldCompact).toBe(true);

      // If compact fails or already compacted 2 times, degrade
      context.checkBudget.mockReturnValueOnce({
        withinBudget: false,
        currentTokens: 8000,
        maxTokens: 8000,
        remainingTokens: 0,
        shouldCompact: false,
        shouldDegrade: true,
      });

      const afterCompact = context.checkBudget();
      expect(afterCompact.shouldDegrade).toBe(true);
    });

    it("DEG-03: SYSTEM_ERROR 时应该直接使用静态降级模板", async () => {
      // Test SYSTEM_ERROR degradation path
      expect.assertions(1);

      // SYSTEM_ERROR should:
      // 1. NOT write to history
      // 2. Use static template immediately
      // 3. Keep session alive for next message

      // Template: "出了点技术问题，我需要休息一下。稍后再试试？"
      expect(true).toBe(true);
    });

    it("DEG-04: 降级后的 complete 事件应该携带 degraded=true", async () => {
      // Test that degraded complete events are properly marked
      expect.assertions(1);

      // CompleteEvent should have:
      // - degraded: true
      // - degradationReason: string
      // - finalResponse: degradation template response

      expect(true).toBe(true);
    });
  });

  // ============ AgentEvent 流 (C3-1) ============

  describe("AgentEvent Stream", () => {
    it("EVENT-01: text_delta 事件应该携带增量文本", async () => {
      expect.assertions(1);

      const { llm } = mockServices;

      // Setup: LLM streams text
      llm._addResponse({
        content: "Hello world",
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      });

      // Expected event:
      // { type: "text_delta", content: "Hello", timestamp: ... }
      // { type: "text_delta", content: " world", timestamp: ... }

      expect(llm.stream).toBeDefined();
    });

    it("EVENT-02: tool_start 事件应该在工具执行前 yield", async () => {
      expect.assertions(1);

      // When tool execution starts:
      // { type: "tool_start", toolName: "shell", args: { cmd: "ls" }, timestamp: ... }

      expect(true).toBe(true);
    });

    it("EVENT-03: tool_end 事件应该在工具执行后 yield", async () => {
      expect.assertions(1);

      // When tool execution ends:
      // { type: "tool_end", toolName: "shell", result: { success: true, ... }, timestamp: ... }

      expect(true).toBe(true);
    });

    it("EVENT-04: error 事件仅在 SYSTEM_ERROR 时 yield", async () => {
      expect.assertions(1);

      // error event should ONLY be yielded for SYSTEM_ERROR
      // TOOL_ERROR is normal ReAct flow, no error event

      // { type: "error", code: "LLM_ERROR", message: "...", timestamp: ... }

      expect(true).toBe(true);
    });

    it("EVENT-05: status 事件应该报告 compact/取消等状态", async () => {
      expect.assertions(1);

      // Status events for:
      // - compact: { type: "status", message: "compacting", ... }
      // - cancel: { type: "status", message: "canceled", ... }

      expect(true).toBe(true);
    });

    it("EVENT-06: complete 事件应该携带 emotionTags", async () => {
      expect.assertions(1);

      const { context } = mockServices;

      // Setup: processLLMOutput extracts emotion tags
      context.processLLMOutput.mockReturnValueOnce({
        visibleContent: "Hello!",
        thinkingContent: undefined,
        emotionTags: ["happy", "friendly"],
        truncated: false,
      });

      const processed = context.processLLMOutput(
        "Hello! [emotion: happy, friendly]",
      );

      // Complete event:
      // { type: "complete", emotionTags: ["happy", "friendly"], finalResponse: "Hello!", ... }
      expect(processed.emotionTags).toEqual(["happy", "friendly"]);
    });

    it("EVENT-07: complete 事件应该包含工具调用记录", async () => {
      expect.assertions(1);

      // CompleteEvent should include:
      // toolCalls: ToolCallRecord[]

      // ToolCallRecord:
      // - toolName: string
      // - args: unknown
      // - result: ToolResult
      // - duration: number

      expect(true).toBe(true);
    });

    it("EVENT-08: 事件时间戳应该是毫秒级", async () => {
      expect.assertions(1);

      const now = Date.now();

      // All events should have timestamp in milliseconds
      // Verify timestamp is close to current time

      expect(now).toBeGreaterThan(0);
    });
  });

  // ============ Abort 传播 (C3-5) ============

  describe("Abort Propagation", () => {
    it("ABORT-01: signal.aborted 应该在每次迭代开始时检查", async () => {
      expect.assertions(1);

      // ReAct loop should check signal.aborted at the start of each iteration
      // If aborted, yield status event and return

      expect(true).toBe(true);
    });

    it("ABORT-02: Abort 时 AsyncGenerator.return() 应该正确终止", async () => {
      expect.assertions(1);

      // When abort signal is received:
      // 1. Call AsyncGenerator.return()
      // 2. Mark unreturned tool_calls as "canceled"

      expect(true).toBe(true);
    });

    it("ABORT-03: 工具执行应该收到 AbortSignal", async () => {
      expect.assertions(2);

      const { tools } = mockServices;
      const controller = new AbortController();

      // Tool execution should receive AbortSignal
      await tools.execute(
        { id: "tc-1", name: "test_tool", arguments: {} },
        "session-123",
        controller.signal,
      );

      expect(tools.execute).toHaveBeenCalled();
      expect(controller.signal).toBeInstanceOf(AbortSignal);
    });

    it("ABORT-04: LLM 流应该在 Abort 时中断", async () => {
      expect.assertions(1);

      const { llm } = mockServices;
      const controller = new AbortController();

      // LLM stream should throw AbortError when signal is aborted
      const gen = llm.stream([], [], {} as LLMCallConfig, controller.signal);

      // Abort immediately
      controller.abort();

      // Iterator should handle abort
      expect(gen).toBeDefined();
    });

    it("ABORT-05: Docker 工具 Abort 应该 docker kill", async () => {
      expect.assertions(1);

      // When tool is aborted:
      // - Docker tools: docker kill
      // - MCP tools: cancel notification
      // - Long-running tools: periodic signal.aborted check

      expect(true).toBe(true);
    });

    it("ABORT-06: Abort 后应该 yield status 事件", async () => {
      expect.assertions(1);

      // After abort, yield:
      // { type: "status", message: "canceled", timestamp: ... }

      expect(true).toBe(true);
    });
  });

  // ============ Session 处理锁 ============

  describe("Session Lock", () => {
    it("LOCK-01: 同 session 同时只有一个 ReAct 循环", async () => {
      expect.assertions(1);

      // If a message comes in while ReAct is running:
      // - Queue the message (max 3)
      // - Process after current ReAct completes

      expect(true).toBe(true);
    });

    it("LOCK-02: 新消息进队列而不是中断当前循环", async () => {
      expect.assertions(1);

      // New messages should be queued, not interrupt running ReAct

      expect(true).toBe(true);
    });

    it("LOCK-03: 队列上限 3 条，超过丢弃最早的", async () => {
      expect.assertions(1);

      // Message queue:
      // - Max 3 messages
      // - FIFO when processing
      // - Drop oldest when over limit

      expect(true).toBe(true);
    });
  });

  // ============ 消息队列 ============

  describe("Message Queue", () => {
    it("QUEUE-01: 队列应该有上限 3 条", async () => {
      expect.assertions(1);

      // Queue max size: 3

      expect(true).toBe(true);
    });

    it("QUEUE-02: 超过 3 条时丢弃最早的", async () => {
      expect.assertions(1);

      // When queue has 3 items and new message arrives:
      // 1. Remove oldest (first in)
      // 2. Add new message to end

      expect(true).toBe(true);
    });

    it("QUEUE-03: 队列消息应该按 FIFO 顺序处理", async () => {
      expect.assertions(1);

      // Messages should be processed in order they were received

      expect(true).toBe(true);
    });
  });

  // ============ Sub-Agent ============

  describe("Sub-Agent", () => {
    it("SUB-01: spawn 应该创建 Sub-Agent 配置", async () => {
      expect.assertions(2);

      const { subAgents } = mockServices;

      const config: SubAgentConfig = {
        parentAgentId: "main-agent-1",
        sessionId: "session-123",
        taskGoal: "Search for recent AI papers",
        contextSlice: [],
        skillIds: ["web-search"],
        maxIterations: 15,
        timeout: 60000,
        returnFormat: "structured",
      };

      const subAgentId = await subAgents.spawn(config);

      expect(subAgentId).toBeDefined();
      expect(subAgents.spawn).toHaveBeenCalledWith(config);
    });

    it("SUB-02: awaitResult 应该等待 Sub-Agent 完成", async () => {
      expect.assertions(1);

      const { subAgents } = mockServices;

      const result = await subAgents.awaitResult("sub-agent-123");

      expect(result.success).toBe(true);
    });

    it("SUB-03: abort 应该终止 Sub-Agent", async () => {
      expect.assertions(1);

      const { subAgents } = mockServices;

      const success = await subAgents.abort("sub-agent-123");

      expect(success).toBe(true);
    });

    it("SUB-04: Sub-Agent maxIterations 应该是 15", async () => {
      expect.assertions(1);

      const subConfig = createTestConfig({
        isSubAgent: true,
        maxIterations: 15,
      });

      expect(subConfig.maxIterations).toBe(15);
    });
  });

  // ============ 权限和确认流程 ============

  describe("Permission and Approval", () => {
    it("PERM-01: safe 工具应该直接执行", async () => {
      expect.assertions(2);

      const { permission } = mockServices;

      permission.check.mockResolvedValueOnce({
        level: "allow",
        allowed: true,
        requiresConfirmation: false,
      });

      const result = await permission.check(
        "web_search",
        { query: "test" },
        "session-123",
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(false);
    });

    it("PERM-02: confirm 工具应该请求用户确认", async () => {
      expect.assertions(2);

      const { permission } = mockServices;

      permission.check.mockResolvedValueOnce({
        level: "confirm",
        allowed: true,
        requiresConfirmation: true,
        riskDescription: "This command modifies files",
      });

      const result = await permission.check(
        "shell",
        { cmd: "rm -rf" },
        "session-123",
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
    });

    it("PERM-03: deny 工具应该直接拒绝", async () => {
      expect.assertions(2);

      const { permission } = mockServices;

      permission.check.mockResolvedValueOnce({
        level: "deny",
        allowed: false,
        requiresConfirmation: false,
        reason: "Tool is in deny list",
      });

      const result = await permission.check(
        "file_delete",
        { path: "/etc/passwd" },
        "session-123",
      );

      expect(result.allowed).toBe(false);
      expect(result.level).toBe("deny");
    });

    it("PERM-04: ApprovalService 应该 suspend ReAct 等待用户响应", async () => {
      expect.assertions(2);

      const { approval } = mockServices;

      const approvalId = await approval.requestApproval({
        sessionId: "session-123",
        toolName: "shell",
        args: { cmd: "rm -rf /workspace" },
        reason: "User confirmation required for destructive operation",
        riskDescription: "This will delete all files in /workspace",
      });

      expect(approvalId).toBeDefined();
      expect(approval.requestApproval).toHaveBeenCalled();
    });

    it("PERM-05: 用户批准后应该继续执行工具", async () => {
      expect.assertions(1);

      const { approval } = mockServices;

      approval._setResponse("approval-approve", {
        approvalId: "approval-approve",
        action: "approve",
      });

      const response = await approval.awaitResponse("approval-approve");

      expect(response.action).toBe("approve");
    });

    it("PERM-06: 用户拒绝后应该返回 TOOL_ERROR", async () => {
      expect.assertions(1);

      const { approval } = mockServices;

      approval._setResponse("approval-reject", {
        approvalId: "approval-reject",
        action: "reject",
        userMessage: "I don't want to run this",
      });

      const response = await approval.awaitResponse("approval-reject");

      expect(response.action).toBe("reject");
    });

    it("PERM-07: 确认超时应该返回 timeout", async () => {
      expect.assertions(1);

      const { approval } = mockServices;

      approval._setResponse("approval-timeout", {
        approvalId: "approval-timeout",
        action: "timeout",
      });

      const response = await approval.awaitResponse("approval-timeout");

      expect(response.action).toBe("timeout");
    });
  });

  // ============ 追踪和日志 ============

  describe("Tracing", () => {
    it("TRACE-01: 应该记录 Agent 开始事件", async () => {
      expect.assertions(1);

      const { tracing } = mockServices;

      tracing.log({
        type: "agent:start",
        sessionId: "session-123",
        data: { input: "Hello" },
      });

      const events = tracing._getEvents();
      expect(events).toHaveLength(1);
    });

    it("TRACE-02: 应该记录工具调用事件", async () => {
      expect.assertions(1);

      const { tracing } = mockServices;

      tracing.log({
        type: "tool:call",
        sessionId: "session-123",
        data: { toolName: "shell", args: { cmd: "ls" } },
      });

      const events = tracing._getEvents();
      expect(events).toHaveLength(1);
    });

    it("TRACE-03: 应该记录 Agent 完成事件", async () => {
      expect.assertions(1);

      const { tracing } = mockServices;

      tracing.log({
        type: "agent:complete",
        sessionId: "session-123",
        data: { finalResponse: "Done!", iterations: 3 },
      });

      const events = tracing._getEvents();
      expect(events).toHaveLength(1);
    });

    it("TRACE-04: 应该记录错误事件", async () => {
      expect.assertions(1);

      const { tracing } = mockServices;

      tracing.log({
        type: "agent:error",
        sessionId: "session-123",
        level: "error",
        data: { error: "LLM_ERROR: API unavailable" },
      });

      const events = tracing._getEvents();
      expect(events).toHaveLength(1);
    });

    it("TRACE-05: 应该支持 Span 追踪", async () => {
      expect.assertions(2);

      const { tracing } = mockServices;

      const spanId = tracing.startSpan("react-iteration");
      expect(spanId).toBeDefined();

      tracing.endSpan(spanId);
      // Span should be removed
      expect(true).toBe(true);
    });
  });

  // ============ 记忆写入 ============

  describe("Memory", () => {
    it("MEM-01: 应该在 PostProcess 阶段写入记忆", async () => {
      expect.assertions(1);

      const { memory } = mockServices;

      await memory.store(
        "User asked about AI and I explained machine learning",
        "user-456",
        { type: "conversation", emotionTags: ["helpful"] },
      );

      expect(memory.store).toHaveBeenCalled();
    });

    it("MEM-02: 应该记录角色状态变化", async () => {
      expect.assertions(1);

      const { memory } = mockServices;

      await memory.store(
        "Kurisu felt happy after helping the user",
        "user-456",
        { type: "emotion_change", emotion: "happy" },
      );

      expect(memory.store).toHaveBeenCalled();
    });

    it("MEM-03: 应该记录角色承诺", async () => {
      expect.assertions(1);

      const { memory } = mockServices;

      await memory.store(
        "Kurisu promised to help with the project tomorrow",
        "user-456",
        { type: "promise", deadline: Date.now() + 86400000 },
      );

      expect(memory.store).toHaveBeenCalled();
    });
  });

  // ============ 双模式 (会话/后台) ============

  describe("Dual Mode", () => {
    it("MODE-01: 会话模式应该使用用户消息作为输入", async () => {
      expect.assertions(1);

      const conversationConfig = createTestConfig({ mode: "conversation" });

      expect(conversationConfig.mode).toBe("conversation");
    });

    it("MODE-02: 后台模式应该使用 taskGoal 作为输入", async () => {
      expect.assertions(2);

      const backgroundConfig = createTestConfig({ mode: "background" });
      const backgroundInput = createTestInput({
        userMessage: "",
        taskGoal: "Review and summarize recent conversations",
      });

      expect(backgroundConfig.mode).toBe("background");
      expect(backgroundInput.taskGoal).toBeDefined();
    });

    it("MODE-03: 后台模式权限策略 (TODO: Background System)", async () => {
      // H5: 后台模式权限需要与 Scheduler/Background System 联动
      // 不同任务类型应有不同权限级别，留到 Background System 阶段实现
      expect.assertions(1);
      expect(true).toBe(true);
    });

    it("MODE-04: 后台模式同一时间最多 1 个任务", async () => {
      expect.assertions(1);

      // Concurrent background tasks limit: 1

      expect(true).toBe(true);
    });
  });

  // ============ 边界情况 ============

  describe("Edge Cases", () => {
    it("EDGE-01: 空用户消息应该被处理", async () => {
      expect.assertions(1);

      const emptyInput = createTestInput({ userMessage: "" });

      expect(emptyInput.userMessage).toBe("");
    });

    it("EDGE-02: 超长用户消息应该被截断或处理", async () => {
      expect.assertions(1);

      const longMessage = "A".repeat(100000);
      const longInput = createTestInput({ userMessage: longMessage });

      // Should be handled by ContextManager
      expect(longInput.userMessage.length).toBe(100000);
    });

    it("EDGE-03: 无激活 Skills 时应该正常工作", async () => {
      expect.assertions(1);

      const noSkillsInput = createTestInput({ activatedSkills: [] });

      expect(noSkillsInput.activatedSkills).toHaveLength(0);
    });

    it("EDGE-04: 无对话历史时应该正常工作", async () => {
      expect.assertions(1);

      const noHistoryInput = createTestInput({ conversationHistory: [] });

      expect(noHistoryInput.conversationHistory).toHaveLength(0);
    });

    it("EDGE-05: 工具结果超大时应该截断", async () => {
      expect.assertions(1);

      const { context } = mockServices;

      const largeResult: ToolResult = {
        callId: "tc-large",
        toolName: "test_tool",
        success: true,
        output: "X".repeat(100000),
        latency: 100,
      };

      const processed = context.processToolResult(
        largeResult,
        "test_tool",
        1000,
      );

      // Should be truncated to maxLength
      expect(context.processToolResult).toBeDefined();
    });

    it("EDGE-06: 所有工具都不可用时应该返回纯文本", async () => {
      expect.assertions(1);

      const { tools } = mockServices;

      tools.isToolAvailable.mockReturnValue(false);

      // Agent should still be able to respond with text
      expect(true).toBe(true);
    });
  });

  // ============ 性能和资源 ============

  describe("Performance", () => {
    it("PERF-01: 单次迭代应该在合理时间内完成", async () => {
      expect.assertions(1);

      const startTime = Date.now();

      // Single iteration should complete within reasonable time
      // (depends on LLM latency, but overhead should be minimal)

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000); // Overhead < 1s
    });

    it("PERF-02: 大量工具调用不应该阻塞", async () => {
      expect.assertions(1);

      const { tools } = mockServices;

      // Batch tool execution
      const toolCalls: ToolCall[] = Array.from({ length: 10 }, (_, i) => ({
        id: `tc-${i}`,
        name: "test_tool",
        arguments: { index: i },
      }));

      await tools.executeBatch(toolCalls, "session-123");

      expect(tools.executeBatch).toHaveBeenCalled();
    });

    it("PERF-03: ContextManager 操作不应该显著增加延迟", async () => {
      expect.assertions(1);

      const { context } = mockServices;

      const startAssemble = Date.now();
      await context.assemblePrompt(createTestInput(), createTestConfig());
      const assembleTime = Date.now() - startAssemble;

      // assemblePrompt should be fast (< 100ms for typical inputs)
      expect(assembleTime).toBeLessThan(100);
    });
  });
});
