/**
 * E2E 集成测试 — Gateway → Platform → Agent → 回复
 *
 * Phase 4c Step 3: 验证完整对话链路
 *
 * 使用 bootstrapFull() 初始化真实 Foundation + noop Domain Services，
 * 替换 LLM Port 为 mock 实现，验证 Agent.execute() 全链路。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PlatformServices } from "@/agent/ports/platform-services.js";
import {
  createMockLLM,
  createMockLLMWithToolCall,
  createSlowLLM,
  createFailingLLM,
  collectEvents,
  DEFAULT_INPUT,
  DEFAULT_CONFIG,
  createTestConfigDir,
  createKurisuPersona,
  createMinimalPersona,
  cleanupTestDir,
  type TestConfigDirs,
} from "./e2e-helpers.js";

// ============ Test Suite ============

describe("E2E Conversation", () => {
  let dirs: TestConfigDirs;

  beforeEach(() => {
    vi.resetModules();
    dirs = createTestConfigDir("e2e");
    createKurisuPersona(dirs.personasDir);
  });

  afterEach(() => {
    cleanupTestDir(dirs.tempDir);
    vi.restoreAllMocks();
  });

  // ---- E2E-01: 纯文本对话 ----

  it("E2E-01: 完整对话链路 — 用户消息 → Agent 回复", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;

      const mockLLM = createMockLLM("呐...你好，我是牧瀬紅莉栖。有什么事吗？");
      const services: PlatformServices = {
        ...role.services,
        llm: mockLLM,
      };

      const agent = new Agent(role.identity, services);
      const { events, result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG),
      );

      const textDeltas = events.filter((e) => e.type === "text_delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      const completeEvents = events.filter((e) => e.type === "complete");
      expect(completeEvents.length).toBe(1);

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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;

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

      const toolStarts = events.filter((e) => e.type === "tool_start");
      const toolEnds = events.filter((e) => e.type === "tool_end");
      expect(toolStarts.length).toBe(1);
      expect(toolEnds.length).toBe(1);

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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const agent = new Agent(role.identity, role.services);

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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const { llm: slowLLM, resolve: resolveFirst } = createSlowLLM();

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

      expect(events2.some((e) => e.type === "status" && "message" in e && e.message === "queued")).toBe(true);
      const r2 = result2 as { success: boolean };
      expect(r2.success).toBe(false);

      // 释放第一条
      resolveFirst();
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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const logSpy = vi.fn();

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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const storeSpy = vi.fn();

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

      expect(storeSpy).toHaveBeenCalledTimes(2);

      expect(storeSpy.mock.calls[0][0]).toBe("你好，请问你是谁？");
      expect(storeSpy.mock.calls[0][2]).toEqual({ type: "user_message" });

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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
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
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const failingLLM = createFailingLLM("LLM API error: model unavailable");

      const services: PlatformServices = {
        ...role.services,
        llm: failingLLM,
      };

      const agent = new Agent(role.identity, services);
      const { events, result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG),
      );

      const errorEvents = events.filter((e) => e.type === "error");
      expect(errorEvents.length).toBeGreaterThan(0);

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
  let dirs: TestConfigDirs;

  beforeEach(() => {
    vi.resetModules();
    dirs = createTestConfigDir("smoke");
    createMinimalPersona(dirs.personasDir);
  });

  afterEach(() => {
    cleanupTestDir(dirs.tempDir);
    vi.restoreAllMocks();
  });

  it("SMOKE-01: 最小链路 — 消息进 → 回复出", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");
    const { Agent } = await import("@/agent/agent.js");

    const bootstrap = await bootstrapFull({
      configDir: dirs.configDir,
      roles: ["minimal"],
      personasDir: dirs.personasDir,
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
      configDir: dirs.configDir,
      roles: ["minimal"],
      personasDir: dirs.personasDir,
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
