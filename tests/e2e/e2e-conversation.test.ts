/**
 * E2E 集成测试 — Gateway → Platform → Agent → 回复
 *
 * Phase 4c Step 3: 验证完整对话链路
 *
 * 使用 bootstrapFull() 初始化真实 Foundation + noop Domain Services，
 * 替换 LLM Port 为 mock 实现，验证 Agent.execute() 全链路。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentEvent, AgentConfig, AgentInput } from "@/agent/types.js";
import type { LLMResponse } from "@/agent/types.js";
import type {
  LLMProviderPort,
  LLMStreamChunk,
  PlatformServices,
} from "@/agent/ports/platform-services.js";

// ============ Test Helpers ============

/**
 * 创建 mock LLM，返回固定文本
 */
function createMockLLM(responseText: string): LLMProviderPort {
  return {
    async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
      // 分 chunk 返回
      const words = responseText.split(" ");
      for (const word of words) {
        yield { delta: word + " " };
      }

      return {
        content: responseText,
        finishReason: "stop" as const,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };
    },
    getAvailableModels: () => ["mock-model"],
    isModelAvailable: () => true,
  };
}

/**
 * 创建 mock LLM，带工具调用
 */
function createMockLLMWithToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  followUpResponse: string,
): LLMProviderPort {
  let callCount = 0;

  return {
    async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
      callCount++;

      if (callCount === 1) {
        // 第一次: 返回工具调用
        yield {
          delta: "",
          toolCalls: [
            {
              id: "call-1",
              name: toolName,
              arguments: JSON.stringify(toolArgs),
            },
          ],
        };

        return {
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: toolName,
              arguments: JSON.stringify(toolArgs),
            },
          ],
          finishReason: "tool_calls" as const,
          usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        };
      }

      // 第二次: 返回最终响应
      yield { delta: followUpResponse };

      return {
        content: followUpResponse,
        finishReason: "stop" as const,
        usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
      };
    },
    getAvailableModels: () => ["mock-model"],
    isModelAvailable: () => true,
  };
}

/**
 * 收集 AsyncGenerator 的所有事件和返回值
 */
async function collectEvents(
  gen: AsyncGenerator<AgentEvent, unknown, unknown>,
): Promise<{ events: AgentEvent[]; result: unknown }> {
  const events: AgentEvent[] = [];
  let iter = await gen.next();
  while (!iter.done) {
    events.push(iter.value);
    iter = await gen.next();
  }
  return { events, result: iter.value };
}

// ============ Test Constants ============

const DEFAULT_INPUT: AgentInput = {
  userMessage: "你好，请问你是谁？",
  activatedSkills: [],
  recalledMemories: [],
  conversationHistory: [],
  mentalModel: {
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    activeEmotions: [],
    relationshipStage: 1,
    relationshipDescription: "初次见面",
    formattedText: "[mood: neutral]",
  },
};

const DEFAULT_CONFIG: AgentConfig = {
  mode: "conversation",
  maxIterations: 25,
  timeout: 30000,
  sessionId: "e2e-session-1",
  userId: "e2e-user-1",
  isSubAgent: false,
  debugEnabled: false,
};

// ============ Test Suite ============

describe("E2E Conversation", () => {
  let tempDir: string;
  let configDir: string;
  let personasDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-e2e-"));
    configDir = join(tempDir, "config");
    personasDir = join(configDir, "personas");

    // 创建配置文件
    mkdirSync(join(configDir, "system"), { recursive: true });

    writeFileSync(
      join(configDir, "system", "platform.yaml"),
      `
storage:
  dataDir: ${join(tempDir, "data")}
  qdrant:
    host: localhost
    port: 6333

scheduler:
  evolutionInterval: 86400000
  heartbeatCheckInterval: 3600000
  ileDecayInterval: 1800000
  telemetryCleanupCron: "0 3 * * *"

context:
  safetyMargin: 0.2
  tokenEstimateDivisor: 3
  maxIterations: 25

executor:
  type: docker
  docker:
    image: kurisu-sandbox:latest
    memoryLimit: "512m"
    cpuLimit: "1.0"
    networkMode: none
    timeout: 30000
`,
    );

    writeFileSync(
      join(configDir, "system", "permissions.yaml"),
      `
version: "1.0"
defaultLevel: confirm
tools:
  safe: []
  confirm: []
  deny: []
paths:
  deny: []
  confirm: []
  allow: []
shell:
  denyPatterns: []
  confirmPatterns: []
`,
    );

    writeFileSync(
      join(configDir, "models.yaml"),
      `
models:
  - id: test-model
    name: Test Model
    provider: test
    model: test-v1
    endpoint: https://test.example.com/api
    secretRef: zhipuApiKey
    capabilities:
      - chat

defaults:
  conversation: test-model
  embedding: test-model
`,
    );

    // 创建测试角色配置
    const roleDir = join(personasDir, "kurisu");
    mkdirSync(roleDir, { recursive: true });

    writeFileSync(
      join(roleDir, "soul.md"),
      `# Kurisu

I am Makise Kurisu, a genius neuroscientist.
I maintain a tsundere personality while being deeply analytical.
`,
    );

    writeFileSync(
      join(roleDir, "persona.yaml"),
      `
speech:
  catchphrases:
    - "哼，这种事情我当然知道"
    - "别、别误会了"
  patterns:
    greeting:
      - "呐...有什么事吗"
  tone:
    default: "tsundere"
behavior:
  tendencies:
    - analytical
    - tsundere
  reactions:
    error: "这...不可能吧"
    success: "哼，理所当然的结果"
formatting:
  useEllipsis: true
  useDash: true
`,
    );

    writeFileSync(
      join(roleDir, "lore.md"),
      `# Kurisu Lore

<!-- core -->
Makise Kurisu is a member of the Future Gadget Lab.
She specializes in neuroscience and time travel theory.
<!-- /core -->

## Extended Background

Additional background information.
`,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ---- E2E-01: 纯文本对话 ----

  it("E2E-01: 完整对话链路 — 用户消息 → Agent 回复", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;

      // 替换 LLM 为 mock
      const mockLLM = createMockLLM("呐...你好，我是牧瀬紅莉栖。有什么事吗？");
      const services: PlatformServices = {
        ...role.services,
        llm: mockLLM,
      };

      const agent = new Agent(role.identity, services);
      const { events, result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG),
      );

      // 验证事件流
      const textDeltas = events.filter((e) => e.type === "text_delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // 验证完成事件
      const completeEvents = events.filter((e) => e.type === "complete");
      expect(completeEvents.length).toBe(1);

      // 验证最终结果
      const agentResult = result as { success: boolean; finalResponse: string };
      expect(agentResult.success).toBe(true);
      expect(agentResult.finalResponse).toContain("牧瀬紅莉栖");
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-02: 工具调用链路 ----

  it("E2E-02: 工具调用链路 — LLM 请求工具 → 执行 → 回复", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;

      // LLM 先返回工具调用，再返回文本
      const mockLLM = createMockLLMWithToolCall(
        "test-tool",
        { query: "hello" },
        "工具执行完毕，结果如下...",
      );

      const services: PlatformServices = {
        ...role.services,
        llm: mockLLM,
      };

      const agent = new Agent(role.identity, services);
      const { events, result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG),
      );

      // 验证工具事件
      const toolStarts = events.filter((e) => e.type === "tool_start");
      const toolEnds = events.filter((e) => e.type === "tool_end");
      expect(toolStarts.length).toBe(1);
      expect(toolEnds.length).toBe(1);

      // 验证最终结果
      const agentResult = result as { success: boolean; finalResponse: string; toolCalls: unknown[] };
      expect(agentResult.success).toBe(true);
      expect(agentResult.toolCalls.length).toBe(1);
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-03: Identity 正确注入 ----

  it("E2E-03: Agent identity 正确加载", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const agent = new Agent(role.identity, role.services);

      // 验证 Identity
      expect(agent.identity.roleId).toBe("kurisu");
      expect(agent.identity.soul).toContain("Makise Kurisu");
      expect(agent.identity.persona.name).toBeDefined();
      expect(agent.identity.persona.catchphrases).toContain("哼，这种事情我当然知道");
      expect(agent.identity.loreCore).toContain("Future Gadget Lab");
      expect(agent.identity.loreCore).not.toContain("Extended Background");
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-04: 消息排队 (session lock) ----

  it("E2E-04: 并发消息排队 — 第二条消息返回 queued", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;

      // 使用慢 LLM 模拟长时间处理
      let resolveFirst: (() => void) | null = null;
      const slowLLM: LLMProviderPort = {
        async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
          yield { delta: "done" };
          return {
            content: "done",
            finishReason: "stop" as const,
            usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          };
        },
        getAvailableModels: () => ["mock"],
        isModelAvailable: () => true,
      };

      const services: PlatformServices = { ...role.services, llm: slowLLM };
      const agent = new Agent(role.identity, services);

      // 第一条消息开始执行 (不 await)
      const gen1 = agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG);
      const firstIter = gen1.next(); // 启动 generator，开始执行

      // 等一小段让 lock 生效
      await new Promise((r) => setTimeout(r, 10));

      // 第二条消息应该被排队
      const gen2 = agent.execute(
        { ...DEFAULT_INPUT, userMessage: "第二条消息" },
        DEFAULT_CONFIG,
      );
      const { events: events2, result: result2 } = await collectEvents(gen2);

      // 第二条应该是 queued
      expect(events2.some((e) => e.type === "status" && "message" in e && e.message === "queued")).toBe(true);
      const r2 = result2 as { success: boolean };
      expect(r2.success).toBe(false);

      // 释放第一条
      resolveFirst!();
      await firstIter;
      // 消费完第一个 generator
      let iter = await gen1.next();
      while (!iter.done) {
        iter = await gen1.next();
      }
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-05: Tracing 贯穿全链路 ----

  it("E2E-05: Tracing 记录 pipeline 事件", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const logSpy = vi.fn();

      // 包装 tracing — 委托所有方法，拦截 log
      const tracing = role.services.tracing;
      const tracingProxy = {
        log: (event: Parameters<typeof tracing.log>[0]) => {
          logSpy(event);
          tracing.log(event);
        },
        logMetric: tracing.logMetric.bind(tracing),
        startSpan: tracing.startSpan.bind(tracing),
        endSpan: tracing.endSpan.bind(tracing),
      };

      const services: PlatformServices = {
        ...role.services,
        tracing: tracingProxy,
        llm: createMockLLM("test response"),
      };

      const agent = new Agent(role.identity, services);
      await collectEvents(agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG));

      // 验证关键事件被记录
      const loggedTypes = logSpy.mock.calls.map(
        (c: unknown[]) => (c[0] as { type: string }).type,
      );

      expect(loggedTypes).toContain("agent_created");
      expect(loggedTypes).toContain("pipeline_start");
      expect(loggedTypes).toContain("preprocess_complete");
      expect(loggedTypes).toContain("postprocess_complete");
      expect(loggedTypes).toContain("pipeline_complete");
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-06: Memory 写入验证 ----

  it("E2E-06: 成功对话后写入 Memory", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const storeSpy = vi.fn();

      // 包装 memory.store 来监视调用
      const memoryProxy = {
        ...role.services.memory,
        store: async (...args: Parameters<typeof role.services.memory.store>) => {
          storeSpy(...args);
        },
      };

      const services: PlatformServices = {
        ...role.services,
        memory: memoryProxy,
        llm: createMockLLM("这是我的回复"),
      };

      const agent = new Agent(role.identity, services);
      await collectEvents(agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG));

      // 用户消息和助手回复都应该被写入
      expect(storeSpy).toHaveBeenCalledTimes(2);

      // 第一次: 用户消息
      expect(storeSpy.mock.calls[0][0]).toBe("你好，请问你是谁？");
      expect(storeSpy.mock.calls[0][2]).toEqual({ type: "user_message" });

      // 第二次: 助手回复
      expect(storeSpy.mock.calls[1][0]).toContain("这是我的回复");
      expect(storeSpy.mock.calls[1][2]).toEqual({
        type: "assistant_response",
        roleId: "kurisu",
      });
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-07: 权限检查链路 ----

  it("E2E-07: 工具执行前进行权限检查", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const checkSpy = vi.fn().mockResolvedValue({
        level: "allow",
        allowed: true,
        requiresConfirmation: false,
      });

      const permissionProxy = {
        ...role.services.permission,
        check: checkSpy,
      };

      const services: PlatformServices = {
        ...role.services,
        permission: permissionProxy,
        llm: createMockLLMWithToolCall("some-tool", { a: 1 }, "done"),
      };

      const agent = new Agent(role.identity, services);
      await collectEvents(agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG));

      // 权限检查被调用
      expect(checkSpy).toHaveBeenCalledWith(
        "some-tool",
        expect.anything(),
        DEFAULT_CONFIG.sessionId,
      );
    } finally {
      bootstrap.shutdown();
    }
  });

  // ---- E2E-08: 降级场景 ----

  it("E2E-08: LLM 错误触发降级", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["kurisu"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;

      // LLM 抛出 system error
      const failingLLM: LLMProviderPort = {
        async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
          throw new Error("LLM API error: model unavailable");
        },
        getAvailableModels: () => [],
        isModelAvailable: () => false,
      };

      const services: PlatformServices = {
        ...role.services,
        llm: failingLLM,
      };

      const agent = new Agent(role.identity, services);
      const { events, result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG),
      );

      // 应触发 error 事件（pipeline catch）
      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents.length).toBeGreaterThan(0);

      // 结果应为降级
      const agentResult = result as { success: boolean; degraded: boolean };
      expect(agentResult.success).toBe(false);
      expect(agentResult.degraded).toBe(true);
    } finally {
      bootstrap.shutdown();
    }
  });
});

// ============ Smoke Test ============

describe("Smoke Test", () => {
  let tempDir: string;
  let configDir: string;
  let personasDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-smoke-"));
    configDir = join(tempDir, "config");
    personasDir = join(configDir, "personas");

    mkdirSync(join(configDir, "system"), { recursive: true });

    writeFileSync(
      join(configDir, "system", "platform.yaml"),
      `
storage:
  dataDir: ${join(tempDir, "data")}
  qdrant:
    host: localhost
    port: 6333
scheduler:
  evolutionInterval: 86400000
  heartbeatCheckInterval: 3600000
  ileDecayInterval: 1800000
  telemetryCleanupCron: "0 3 * * *"
context:
  safetyMargin: 0.2
  tokenEstimateDivisor: 3
  maxIterations: 25
executor:
  type: docker
  docker:
    image: kurisu-sandbox:latest
    memoryLimit: "512m"
    cpuLimit: "1.0"
    networkMode: none
    timeout: 30000
`,
    );

    writeFileSync(
      join(configDir, "system", "permissions.yaml"),
      `
version: "1.0"
defaultLevel: confirm
tools:
  safe: []
  confirm: []
  deny: []
paths:
  deny: []
  confirm: []
  allow: []
shell:
  denyPatterns: []
  confirmPatterns: []
`,
    );

    writeFileSync(
      join(configDir, "models.yaml"),
      `
models:
  - id: test-model
    name: Test Model
    provider: test
    model: test-v1
    endpoint: https://test.example.com/api
    secretRef: zhipuApiKey
    capabilities:
      - chat
defaults:
  conversation: test-model
  embedding: test-model
`,
    );

    const roleDir = join(personasDir, "minimal");
    mkdirSync(roleDir, { recursive: true });
    writeFileSync(join(roleDir, "soul.md"), "# Minimal\nI am a minimal test agent.");
    writeFileSync(
      join(roleDir, "persona.yaml"),
      `
speech:
  catchphrases: []
  patterns: {}
  tone:
    default: "neutral"
behavior:
  tendencies: []
  reactions: {}
formatting:
  useEllipsis: false
  useDash: false
`,
    );
    writeFileSync(
      join(roleDir, "lore.md"),
      "# Lore\n<!-- core -->\nMinimal lore.\n<!-- /core -->",
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("SMOKE-01: 最小链路 — 消息进 → 回复出", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["minimal"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("minimal")!;

      const services: PlatformServices = {
        ...role.services,
        llm: createMockLLM("Hello from minimal agent"),
      };

      const agent = new Agent(role.identity, services);

      const gen = agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG);
      let iter = await gen.next();
      while (!iter.done) {
        iter = await gen.next();
      }

      const result = iter.value as { success: boolean; finalResponse: string };
      expect(result.success).toBe(true);
      expect(result.finalResponse).toContain("Hello from minimal agent");
    } finally {
      bootstrap.shutdown();
    }
  });

  it("SMOKE-02: Agent 创建 + Identity 验证", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir,
      roles: ["minimal"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("minimal")!;
      const agent = new Agent(role.identity, role.services);

      expect(agent.identity.roleId).toBe("minimal");
      expect(agent.identity.soul).toContain("minimal test agent");
      expect(agent.identity.loreCore).toBe("Minimal lore.");
    } finally {
      bootstrap.shutdown();
    }
  });
});
