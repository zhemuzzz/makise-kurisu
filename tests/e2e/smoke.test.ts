/**
 * 冒烟测试 — Phase 6b
 *
 * 验证新场景（与 e2e-conversation.test.ts 不重复）:
 * A. Agent 补充: 多轮对话、超时中断、Sub-Agent 模式
 * B. Platform 集成: ContextManager、PermissionService deny、ILE、SkillManager
 * C. 后台系统: EventBus、Scheduler、EvolutionService
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { PlatformServices } from "@/agent/ports/platform-services.js";
import type { AgentConfig } from "@/agent/types.js";
import {
  createMockLLM,
  createMockLLMWithToolCall,
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

// ============ A. Agent 补充冒烟 ============

describe("Smoke: Agent 补充", () => {
  let dirs: TestConfigDirs;

  beforeEach(() => {
    vi.resetModules();
    dirs = createTestConfigDir("smoke-agent");
    createMinimalPersona(dirs.personasDir);
  });

  afterEach(() => {
    cleanupTestDir(dirs.tempDir);
    vi.restoreAllMocks();
  });

  it("SMOKE-A1: 多轮对话 — 带 conversationHistory 正常工作", async () => {
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
        llm: createMockLLM("这是第二轮回复"),
      };

      const agent = new Agent(role.identity, services);

      // 带历史消息的输入
      const inputWithHistory = {
        ...DEFAULT_INPUT,
        userMessage: "你刚才说的是什么意思？",
        conversationHistory: [
          { role: "user" as const, content: "你好" },
          { role: "assistant" as const, content: "你好！我是测试助手。" },
        ],
      };

      const { result } = await collectEvents(
        agent.execute(inputWithHistory, DEFAULT_CONFIG),
      );

      const agentResult = result as { success: boolean; finalResponse: string };
      expect(agentResult.success).toBe(true);
      expect(agentResult.finalResponse).toContain("第二轮回复");
    } finally {
      bootstrap.shutdown();
    }
  });

  it("SMOKE-A2: 超时中断 — AbortSignal.timeout 触发", async () => {
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

      // LLM 在短暂延迟后抛出 AbortError（模拟被超时中断）
      const abortableLLM = {
        async *stream(_messages: unknown, _options: unknown, signal?: AbortSignal) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 10_000);
            if (signal) {
              signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
              });
            }
          });
        },
        getAvailableModels: () => ["mock"],
        isModelAvailable: () => true,
      } as PlatformServices["llm"];

      const services: PlatformServices = {
        ...role.services,
        llm: abortableLLM,
      };

      const agent = new Agent(role.identity, services);

      // 极短超时
      const shortTimeoutConfig: AgentConfig = {
        ...DEFAULT_CONFIG,
        timeout: 100,
      };

      const { result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, shortTimeoutConfig),
      );

      const agentResult = result as { success: boolean; degraded: boolean };
      expect(agentResult.success).toBe(false);
    } finally {
      bootstrap.shutdown();
    }
  }, 10_000);

  it("SMOKE-A3: Sub-Agent 模式 — isSubAgent=true", async () => {
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
        llm: createMockLLM("Sub-agent 完成任务"),
      };

      const agent = new Agent(role.identity, services);

      const subAgentConfig: AgentConfig = {
        ...DEFAULT_CONFIG,
        isSubAgent: true,
        parentAgentId: "parent-1",
        maxIterations: 15,
      };

      const { result } = await collectEvents(
        agent.execute(DEFAULT_INPUT, subAgentConfig),
      );

      const agentResult = result as { success: boolean; finalResponse: string };
      expect(agentResult.success).toBe(true);
      expect(agentResult.finalResponse).toContain("Sub-agent");
    } finally {
      bootstrap.shutdown();
    }
  });
});

// ============ B. Platform 集成冒烟 ============

describe("Smoke: Platform 集成", () => {
  let dirs: TestConfigDirs;

  beforeEach(() => {
    vi.resetModules();
    dirs = createTestConfigDir("smoke-platform");
    createKurisuPersona(dirs.personasDir);
  });

  afterEach(() => {
    cleanupTestDir(dirs.tempDir);
    vi.restoreAllMocks();
  });

  it("SMOKE-B1: ContextManager — 超长输入不崩溃", async () => {
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

      const services: PlatformServices = {
        ...role.services,
        llm: createMockLLM("处理完毕"),
      };

      const agent = new Agent(role.identity, services);

      // 超长用户输入 (10K 字符)
      const longInput = {
        ...DEFAULT_INPUT,
        userMessage: "请分析这段内容：" + "很长的文本".repeat(2000),
      };

      const { result } = await collectEvents(
        agent.execute(longInput, DEFAULT_CONFIG),
      );

      const agentResult = result as { success: boolean };
      expect(agentResult.success).toBe(true);
    } finally {
      bootstrap.shutdown();
    }
  });

  it("SMOKE-B2: PermissionService deny — 被禁工具直接拒绝", async () => {
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

      // 模拟权限拒绝
      const denyPermission = {
        ...role.services.permission,
        check: vi.fn().mockResolvedValue({
          level: "deny",
          allowed: false,
          requiresConfirmation: false,
          reason: "tool is denied by policy",
        }),
      };

      const services: PlatformServices = {
        ...role.services,
        permission: denyPermission,
        llm: createMockLLMWithToolCall("dangerous-tool", {}, "不应到达此处"),
      };

      const agent = new Agent(role.identity, services);
      const { events } = await collectEvents(
        agent.execute(DEFAULT_INPUT, DEFAULT_CONFIG),
      );

      // 权限检查被调用
      expect(denyPermission.check).toHaveBeenCalled();

      // 应产生 tool_end 事件（包含权限拒绝信息）
      const toolEnds = events.filter((e) => e.type === "tool_end");
      expect(toolEnds.length).toBeGreaterThan(0);
    } finally {
      bootstrap.shutdown();
    }
  });

  it("SMOKE-B3: InnerLifeEngine — processTurn 更新情绪状态", async () => {
    const { createPersonaEngine, KURISU_ENGINE_CONFIG } = await import(
      "@/inner-life/index.js"
    );

    const engine = createPersonaEngine(KURISU_ENGINE_CONFIG);

    // processTurn 更新情绪状态
    engine.processTurn("test-user", ["joy"], "text_chat");

    // buildContext 应该生成 prompt 片段
    const scene = { type: "private" as const, targetUserId: "test-user" };
    const context = engine.buildContext("test-user", scene);
    expect(context).toBeDefined();
    expect(context.mentalModel.length).toBeGreaterThan(0);

    // debug snapshot 不应崩溃
    const snapshot = engine.getDebugSnapshot("test-user");
    expect(snapshot).toBeDefined();
    expect(snapshot.baseMood).toBeDefined();
  });

  it("SMOKE-B4: SkillManager — findSkill 命令匹配", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const bootstrap = await bootstrapFull({
      configDir: dirs.configDir,
      roles: ["kurisu"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = bootstrap.roles.get("kurisu")!;
      const skills = role.services.skills;

      // findSkill 应该存在并返回结果
      const result = await skills.findSkill("/search");
      // 可能找到也可能不找到（取决于 skill 加载），但不应崩溃
      expect(result).toBeDefined();
    } finally {
      bootstrap.shutdown();
    }
  });
});

// ============ C. 后台系统冒烟 ============

describe("Smoke: 后台系统", () => {
  let dirs: TestConfigDirs;

  beforeEach(() => {
    vi.resetModules();
    dirs = createTestConfigDir("smoke-bg");
    createMinimalPersona(dirs.personasDir);
  });

  afterEach(() => {
    cleanupTestDir(dirs.tempDir);
    vi.restoreAllMocks();
  });

  it("SMOKE-C1: EventBus — 事件发布 + 订阅回调", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const bootstrap = await bootstrapFull({
      configDir: dirs.configDir,
      roles: ["minimal"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const { eventBus } = bootstrap.background;
      const received: unknown[] = [];

      eventBus.on("test:smoke", (payload: unknown) => {
        received.push(payload);
      });

      eventBus.emit("test:smoke", { data: "hello" });

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ data: "hello" });
    } finally {
      bootstrap.shutdown();
    }
  });

  it("SMOKE-C2: Scheduler — interval 任务注册 + 触发", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");
    vi.useFakeTimers();

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const bootstrap = await bootstrapFull({
      configDir: dirs.configDir,
      roles: ["minimal"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const { scheduler } = bootstrap.background;
      let callCount = 0;

      const taskId = scheduler.registerInterval({
        id: "smoke-test-task",
        name: "smoke-test-task",
        intervalMs: 1000,
        handler: async () => {
          callCount++;
        },
      });

      expect(taskId).toBeDefined();

      // 推进时间
      await vi.advanceTimersByTimeAsync(1100);
      expect(callCount).toBeGreaterThanOrEqual(1);

      scheduler.cancel(taskId);
    } finally {
      vi.useRealTimers();
      bootstrap.shutdown();
    }
  });

  it("SMOKE-C3: EvolutionService — correction 提交 + 验证", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const bootstrap = await bootstrapFull({
      configDir: dirs.configDir,
      roles: ["minimal"],
      personasDir: dirs.personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const { pipeline } = bootstrap.background;

      // submitCorrection 使用更简单的 CorrectionSignal 接口
      const result = await pipeline.submitCorrection({
        sessionId: "smoke-session",
        messageId: "smoke-msg-1",
        originalBehavior: "Incorrect response",
        correction: "Smoke test correction",
      });

      // 应该返回结果（可能成功或验证失败，但不应崩溃）
      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
    } finally {
      bootstrap.shutdown();
    }
  });
});
