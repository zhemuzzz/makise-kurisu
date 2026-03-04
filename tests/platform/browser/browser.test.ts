/**
 * Browser Module 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * WB-1~7: StagehandService + 8 browser tools + 配置
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============ Mock Stagehand SDK ============

// Mock page
function createMockPage() {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue("Example Page"),
    url: vi.fn().mockReturnValue("https://example.com"),
    screenshot: vi.fn().mockResolvedValue(Buffer.from("fake-png")),
    evaluate: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock V3Context
function createMockContext() {
  const page = createMockPage();
  return {
    pages: vi.fn().mockReturnValue([page]),
    activePage: vi.fn().mockReturnValue(page),
    _page: page,
  };
}

// Mock Stagehand V3 instance
function createMockStagehand() {
  const ctx = createMockContext();
  return {
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    act: vi.fn().mockResolvedValue({
      success: true,
      message: "Clicked button",
      actionDescription: "click",
      actions: [],
    }),
    extract: vi.fn().mockResolvedValue({ title: "Hello", author: "World" }),
    observe: vi.fn().mockResolvedValue([
      { selector: "#btn1", description: "Submit button", method: "click" },
      { selector: "#link1", description: "Home link", method: "click" },
    ]),
    agent: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({
        success: true,
        message: "Task completed",
        actions: [
          { type: "act", action: "clicked search", reasoning: "need to search" },
          { type: "extract", reasoning: "extracting results" },
        ],
        completed: true,
      }),
    }),
    context: ctx,
    _mockPage: ctx._page,
  };
}

// ============ Types Tests ============

describe("Browser Types", () => {
  it("BT-01: IBrowserService interface methods exist", async () => {
    const types = await import("@/platform/browser/types");

    // Constants exported
    expect(types.DEFAULT_SCROLL_AMOUNT).toBe(500);
    expect(types.DEFAULT_AGENT_MAX_STEPS).toBe(20);
    expect(types.DEFAULT_NAVIGATION_TIMEOUT).toBe(15000);
  });
});

// ============ ToolDef Tests ============

describe("Browser ToolDefs", () => {
  it("TD-01: 8 个 ToolDef 正确定义", async () => {
    const { BROWSER_TOOL_DEFS } = await import("@/platform/browser/tools");

    expect(BROWSER_TOOL_DEFS).toHaveLength(8);

    const names = BROWSER_TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual([
      "browser_navigate",
      "browser_act",
      "browser_extract",
      "browser_observe",
      "browser_agent",
      "browser_screenshot",
      "browser_get_url",
      "browser_scroll",
    ]);
  });

  it("TD-02: 权限分级正确 — act/agent=confirm, 其余=safe", async () => {
    const { BROWSER_TOOL_DEFS } = await import("@/platform/browser/tools");

    const permissionMap = Object.fromEntries(
      BROWSER_TOOL_DEFS.map((t) => [t.name, t.permission]),
    );

    expect(permissionMap.browser_navigate).toBe("safe");
    expect(permissionMap.browser_act).toBe("confirm");
    expect(permissionMap.browser_extract).toBe("safe");
    expect(permissionMap.browser_observe).toBe("safe");
    expect(permissionMap.browser_agent).toBe("confirm");
    expect(permissionMap.browser_screenshot).toBe("safe");
    expect(permissionMap.browser_get_url).toBe("safe");
    expect(permissionMap.browser_scroll).toBe("safe");
  });

  it("TD-03: 所有 ToolDef 的 source 类型为 native", async () => {
    const { BROWSER_TOOL_DEFS } = await import("@/platform/browser/tools");

    for (const tool of BROWSER_TOOL_DEFS) {
      expect(tool.source.type).toBe("native");
      expect(tool.source.nativeId).toBe(tool.name);
    }
  });

  it("TD-04: browser_navigate 需要 url 参数", async () => {
    const { BROWSER_NAVIGATE_TOOL } = await import("@/platform/browser/tools");

    expect(BROWSER_NAVIGATE_TOOL.inputSchema.required).toContain("url");
    expect(BROWSER_NAVIGATE_TOOL.inputSchema.properties?.url?.type).toBe("string");
  });

  it("TD-05: browser_act 需要 action 参数", async () => {
    const { BROWSER_ACT_TOOL } = await import("@/platform/browser/tools");

    expect(BROWSER_ACT_TOOL.inputSchema.required).toContain("action");
  });

  it("TD-06: browser_extract 需要 instruction 参数", async () => {
    const { BROWSER_EXTRACT_TOOL } = await import("@/platform/browser/tools");

    expect(BROWSER_EXTRACT_TOOL.inputSchema.required).toContain("instruction");
    // schema 是可选的
    expect(BROWSER_EXTRACT_TOOL.inputSchema.properties?.schema).toBeDefined();
  });

  it("TD-07: browser_agent 需要 instruction, maxSteps 可选", async () => {
    const { BROWSER_AGENT_TOOL } = await import("@/platform/browser/tools");

    expect(BROWSER_AGENT_TOOL.inputSchema.required).toContain("instruction");
    expect(BROWSER_AGENT_TOOL.inputSchema.properties?.maxSteps?.type).toBe("number");
  });

  it("TD-08: browser_scroll 需要 direction 参数", async () => {
    const { BROWSER_SCROLL_TOOL } = await import("@/platform/browser/tools");

    expect(BROWSER_SCROLL_TOOL.inputSchema.required).toContain("direction");
    expect(BROWSER_SCROLL_TOOL.inputSchema.properties?.direction?.enum).toEqual(["up", "down"]);
  });
});

// ============ StagehandService Tests ============

describe("StagehandService", () => {
  let mockStagehand: ReturnType<typeof createMockStagehand>;

  beforeEach(() => {
    mockStagehand = createMockStagehand();
    vi.resetModules();
  });

  // Helper: 创建一个已初始化的 service (注入 mock)
  async function createInitializedService() {
    // 直接使用 mock 注入而非真正的 import
    const { StagehandService } = await import("@/platform/browser/stagehand-service");
    const config = {
      env: "local" as const,
      model: "openai/gpt-4o-mini",
      selfHeal: true,
      verbose: 1,
    };
    const service = new StagehandService(config);

    // 注入 mock stagehand (绕过 init 的真实启动)
    (service as unknown as Record<string, unknown>).stagehand = mockStagehand;
    (service as unknown as Record<string, unknown>).initialized = true;

    return service;
  }

  it("SS-01: 构造后 isInitialized() 返回 false", async () => {
    const { StagehandService } = await import("@/platform/browser/stagehand-service");
    const service = new StagehandService({
      env: "local",
      model: "openai/gpt-4o-mini",
    });

    expect(service.isInitialized()).toBe(false);
  });

  it("SS-02: 未初始化时调用工具方法抛出错误", async () => {
    const { StagehandService } = await import("@/platform/browser/stagehand-service");
    const service = new StagehandService({
      env: "local",
      model: "openai/gpt-4o-mini",
    });

    await expect(service.navigate({ url: "https://example.com" })).rejects.toThrow(
      "StagehandService not initialized",
    );
  });

  it("SS-03: navigate — 调用 page.goto + 返回 url/title", async () => {
    const service = await createInitializedService();

    const result = await service.navigate({ url: "https://example.com" });

    expect(mockStagehand._mockPage.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
      timeoutMs: 15000,
    });
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Example Page");
  });

  it("SS-04: navigate — 自定义 waitUntil", async () => {
    const service = await createInitializedService();

    await service.navigate({ url: "https://example.com", waitUntil: "networkidle" });

    expect(mockStagehand._mockPage.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle",
      timeoutMs: 15000,
    });
  });

  it("SS-05: act — 调用 stagehand.act + 返回结果", async () => {
    const service = await createInitializedService();

    const result = await service.act({ action: "click the login button" });

    expect(mockStagehand.act).toHaveBeenCalledWith("click the login button");
    expect(result.success).toBe(true);
    expect(result.message).toBe("Clicked button");
  });

  it("SS-06: extract — 无 schema 时调用 instruction-only", async () => {
    const service = await createInitializedService();

    const result = await service.extract({ instruction: "extract the title" });

    expect(mockStagehand.extract).toHaveBeenCalledWith("extract the title");
    expect(result).toEqual({ title: "Hello", author: "World" });
  });

  it("SS-07: extract — 有 schema 时转为 Zod + 调用", async () => {
    const service = await createInitializedService();
    const schema = {
      type: "object",
      properties: {
        title: { type: "string", description: "文章标题" },
        author: { type: "string", description: "作者" },
      },
    };

    await service.extract({ instruction: "extract info", schema });

    expect(mockStagehand.extract).toHaveBeenCalledTimes(1);
    // 第二个参数是 Zod schema
    const zodArg = mockStagehand.extract.mock.calls[0][1];
    expect(zodArg).toBeDefined();
    // 验证 Zod schema 结构
    expect(zodArg._def?.typeName ?? zodArg._zod?.def?.type).toBeDefined();
  });

  it("SS-08: observe — 返回 elements 列表", async () => {
    const service = await createInitializedService();

    const result = await service.observe({ instruction: "find buttons" });

    expect(mockStagehand.observe).toHaveBeenCalledWith("find buttons");
    expect(result.elements).toHaveLength(2);
    expect(result.elements[0]).toEqual({
      selector: "#btn1",
      description: "Submit button",
      method: "click",
    });
  });

  it("SS-09: agent — 调用 stagehand.agent().execute()", async () => {
    const service = await createInitializedService();

    const result = await service.agent({
      instruction: "search and compare prices",
      maxSteps: 10,
    });

    expect(mockStagehand.agent).toHaveBeenCalled();
    const agentInstance = mockStagehand.agent.mock.results[0].value;
    expect(agentInstance.execute).toHaveBeenCalledWith({
      instruction: "search and compare prices",
      maxSteps: 10,
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe("Task completed");
    expect(result.actions).toHaveLength(2);
  });

  it("SS-10: agent — 默认 maxSteps=20", async () => {
    const service = await createInitializedService();

    await service.agent({ instruction: "do something" });

    const agentInstance = mockStagehand.agent.mock.results[0].value;
    expect(agentInstance.execute).toHaveBeenCalledWith({
      instruction: "do something",
      maxSteps: 20,
    });
  });

  it("SS-11: screenshot — 返回 base64 PNG", async () => {
    const service = await createInitializedService();

    const result = await service.screenshot({});

    expect(mockStagehand._mockPage.screenshot).toHaveBeenCalledWith({
      fullPage: false,
      type: "png",
    });
    expect(result.mimeType).toBe("image/png");
    expect(result.base64).toBe(Buffer.from("fake-png").toString("base64"));
  });

  it("SS-12: screenshot — fullPage=true", async () => {
    const service = await createInitializedService();

    await service.screenshot({ fullPage: true });

    expect(mockStagehand._mockPage.screenshot).toHaveBeenCalledWith({
      fullPage: true,
      type: "png",
    });
  });

  it("SS-13: getUrl — 返回当前页面 URL", async () => {
    const service = await createInitializedService();

    const url = await service.getUrl();

    expect(url).toBe("https://example.com");
  });

  it("SS-14: scroll — 向下滚动默认 500px", async () => {
    const service = await createInitializedService();

    await service.scroll({ direction: "down" });

    expect(mockStagehand._mockPage.evaluate).toHaveBeenCalledWith(
      "window.scrollBy(0, 500)",
    );
  });

  it("SS-15: scroll — 向上滚动自定义 300px", async () => {
    const service = await createInitializedService();

    await service.scroll({ direction: "up", amount: 300 });

    expect(mockStagehand._mockPage.evaluate).toHaveBeenCalledWith(
      "window.scrollBy(0, -300)",
    );
  });

  it("SS-16: close — 调用 stagehand.close + 重置状态", async () => {
    const service = await createInitializedService();

    expect(service.isInitialized()).toBe(true);
    await service.close();
    expect(service.isInitialized()).toBe(false);
    expect(mockStagehand.close).toHaveBeenCalled();
  });

  it("SS-17: close — 未初始化时安全无操作", async () => {
    const { StagehandService } = await import("@/platform/browser/stagehand-service");
    const service = new StagehandService({
      env: "local",
      model: "openai/gpt-4o-mini",
    });

    // 不应抛异常
    await service.close();
    expect(service.isInitialized()).toBe(false);
  });

  it("SS-18: createBrowserService 工厂函数", async () => {
    const { createBrowserService } = await import("@/platform/browser/stagehand-service");

    const service = createBrowserService({
      env: "local",
      model: "openai/gpt-4o-mini",
    });

    expect(service).toBeDefined();
    expect(service.isInitialized()).toBe(false);
  });
});

// ============ Tool Executors Tests ============

describe("Browser Tool Executors", () => {
  let mockStagehand: ReturnType<typeof createMockStagehand>;

  beforeEach(() => {
    mockStagehand = createMockStagehand();
    vi.resetModules();
  });

  async function createExecutors() {
    const { createBrowserToolExecutors } = await import("@/platform/browser/tools");
    const { StagehandService } = await import("@/platform/browser/stagehand-service");
    const service = new StagehandService({
      env: "local",
      model: "openai/gpt-4o-mini",
    });

    // 注入 mock
    (service as unknown as Record<string, unknown>).stagehand = mockStagehand;
    (service as unknown as Record<string, unknown>).initialized = true;

    return createBrowserToolExecutors(service);
  }

  it("TE-01: 返回 8 个 executor", async () => {
    const executors = await createExecutors();

    expect(executors.size).toBe(8);
    expect(executors.has("browser_navigate")).toBe(true);
    expect(executors.has("browser_act")).toBe(true);
    expect(executors.has("browser_extract")).toBe(true);
    expect(executors.has("browser_observe")).toBe(true);
    expect(executors.has("browser_agent")).toBe(true);
    expect(executors.has("browser_screenshot")).toBe(true);
    expect(executors.has("browser_get_url")).toBe(true);
    expect(executors.has("browser_scroll")).toBe(true);
  });

  it("TE-02: browser_navigate executor 调用 service.navigate", async () => {
    const executors = await createExecutors();

    const result = await executors.get("browser_navigate")!({
      url: "https://example.com",
    });

    expect(result).toEqual({ url: "https://example.com", title: "Example Page" });
  });

  it("TE-03: browser_act executor 调用 service.act", async () => {
    const executors = await createExecutors();

    const result = await executors.get("browser_act")!({
      action: "click button",
    });

    expect(result).toEqual({ success: true, message: "Clicked button" });
  });

  it("TE-04: browser_get_url executor 返回 { url }", async () => {
    const executors = await createExecutors();

    const result = await executors.get("browser_get_url")!({});

    expect(result).toEqual({ url: "https://example.com" });
  });

  it("TE-05: browser_scroll executor 返回 { success: true }", async () => {
    const executors = await createExecutors();

    const result = await executors.get("browser_scroll")!({
      direction: "down",
      amount: 300,
    });

    expect(result).toEqual({ success: true });
  });

  it("TE-06: 未初始化时 executor 自动调用 init()", async () => {
    const { createBrowserToolExecutors } = await import("@/platform/browser/tools");

    // 创建一个 mock service 模拟 lazy init
    const mockService = {
      isInitialized: vi.fn().mockReturnValue(false),
      init: vi.fn().mockImplementation(async () => {
        mockService.isInitialized.mockReturnValue(true);
      }),
      getUrl: vi.fn().mockResolvedValue("https://example.com"),
      navigate: vi.fn(),
      act: vi.fn(),
      extract: vi.fn(),
      observe: vi.fn(),
      agent: vi.fn(),
      screenshot: vi.fn(),
      scroll: vi.fn(),
      close: vi.fn(),
    };

    const executors = createBrowserToolExecutors(mockService);
    await executors.get("browser_get_url")!({});

    expect(mockService.init).toHaveBeenCalled();
  });
});

// ============ BrowserUseConfig Schema Tests ============

describe("BrowserUseConfig Schema", () => {
  it("CS-01: 字符串 model 格式通过校验", async () => {
    const { BrowserUseConfigSchema } = await import("@/platform/types/config");

    const result = BrowserUseConfigSchema.safeParse({
      model: "openai/gpt-4o-mini",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toBe("local"); // 默认
      expect(result.data.model).toBe("openai/gpt-4o-mini");
      expect(result.data.selfHeal).toBe(true); // 默认
    }
  });

  it("CS-02: 对象 model 格式通过校验", async () => {
    const { BrowserUseConfigSchema } = await import("@/platform/types/config");

    const result = BrowserUseConfigSchema.safeParse({
      model: {
        modelName: "glm-4-flash",
        apiKey: "test-key",
        baseURL: "https://api.example.com/v4",
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.data.model).toBe("object");
    }
  });

  it("CS-03: 缺少 model 字段拒绝", async () => {
    const { BrowserUseConfigSchema } = await import("@/platform/types/config");

    const result = BrowserUseConfigSchema.safeParse({
      env: "local",
    });

    expect(result.success).toBe(false);
  });

  it("CS-04: 完整配置通过校验", async () => {
    const { BrowserUseConfigSchema } = await import("@/platform/types/config");

    const result = BrowserUseConfigSchema.safeParse({
      env: "local",
      model: "openai/gpt-4o-mini",
      agentModel: "openai/gpt-4o",
      agentExecutionModel: "openai/gpt-4o-mini",
      localBrowserLaunchOptions: { headless: true },
      selfHeal: true,
      domSettleTimeout: 3000,
      verbose: 2,
    });

    expect(result.success).toBe(true);
  });

  it("CS-05: verbose 范围限制 (0-2)", async () => {
    const { BrowserUseConfigSchema } = await import("@/platform/types/config");

    const valid = BrowserUseConfigSchema.safeParse({
      model: "openai/gpt-4o-mini",
      verbose: 2,
    });
    expect(valid.success).toBe(true);

    const invalid = BrowserUseConfigSchema.safeParse({
      model: "openai/gpt-4o-mini",
      verbose: 3,
    });
    expect(invalid.success).toBe(false);
  });

  it("CS-06: PlatformConfig browserUse 可选", async () => {
    const { PlatformConfigSchema } = await import("@/platform/types/config");

    // 不包含 browserUse 的最小配置应该通过
    const minimalConfig = {
      models: {
        providers: [
          {
            id: "test",
            provider: "openai",
            model: "gpt-4o",
            endpoint: "https://api.openai.com/v1",
            secretRef: "OPENAI_API_KEY",
            capabilities: ["chat"],
          },
        ],
        defaults: { chat: "test", embedding: "test" },
      },
      storage: { dataDir: "./data" },
      secrets: { zhipuApiKey: "test-key" },
      scheduler: {},
      context: {},
      permissions: {},
      executor: {},
      gateway: {},
    };

    const result = PlatformConfigSchema.safeParse(minimalConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.browserUse).toBeUndefined();
    }
  });

  it("CS-07: PlatformConfig browserUse 存在时正确解析", async () => {
    const { PlatformConfigSchema } = await import("@/platform/types/config");

    const config = {
      models: {
        providers: [
          {
            id: "test",
            provider: "openai",
            model: "gpt-4o",
            endpoint: "https://api.openai.com/v1",
            secretRef: "OPENAI_API_KEY",
            capabilities: ["chat"],
          },
        ],
        defaults: { chat: "test", embedding: "test" },
      },
      storage: { dataDir: "./data" },
      secrets: { zhipuApiKey: "test-key" },
      scheduler: {},
      context: {},
      permissions: {},
      executor: {},
      gateway: {},
      browserUse: {
        model: "openai/gpt-4o-mini",
      },
    };

    const result = PlatformConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.browserUse).toBeDefined();
      expect(result.data.browserUse?.model).toBe("openai/gpt-4o-mini");
    }
  });
});

// ============ Barrel Exports Tests ============

describe("Browser Module Exports", () => {
  it("EX-01: index.ts 导出所有预期符号", async () => {
    const mod = await import("@/platform/browser/index");

    // Types are not runtime-checkable, but functions/constants are
    expect(mod.DEFAULT_SCROLL_AMOUNT).toBe(500);
    expect(mod.DEFAULT_AGENT_MAX_STEPS).toBe(20);
    expect(mod.DEFAULT_NAVIGATION_TIMEOUT).toBe(15000);
    expect(typeof mod.StagehandService).toBe("function");
    expect(typeof mod.createBrowserService).toBe("function");
    expect(typeof mod.createBrowserToolExecutors).toBe("function");
    expect(mod.BROWSER_TOOL_DEFS).toHaveLength(8);
    expect(mod.BROWSER_NAVIGATE_TOOL).toBeDefined();
    expect(mod.BROWSER_ACT_TOOL).toBeDefined();
    expect(mod.BROWSER_EXTRACT_TOOL).toBeDefined();
    expect(mod.BROWSER_OBSERVE_TOOL).toBeDefined();
    expect(mod.BROWSER_AGENT_TOOL).toBeDefined();
    expect(mod.BROWSER_SCREENSHOT_TOOL).toBeDefined();
    expect(mod.BROWSER_GET_URL_TOOL).toBeDefined();
    expect(mod.BROWSER_SCROLL_TOOL).toBeDefined();
    expect(typeof mod.registerBrowserTools).toBe("function");
  });
});

// ============ registerBrowserTools Tests ============

describe("registerBrowserTools", () => {
  it("RT-01: 注册 8 个 tools 到 ToolRegistry (mock)", async () => {
    const { registerBrowserTools, BROWSER_TOOL_DEFS } = await import(
      "@/platform/browser/tools"
    );

    // 创建 mock registry
    const registered: Array<{ name: string; hasExecutor: boolean }> = [];
    const mockRegistry = {
      register: vi.fn((tool: { name: string }, executor?: unknown) => {
        registered.push({ name: tool.name, hasExecutor: !!executor });
      }),
    };

    // 创建 mock service
    const mockService = {
      isInitialized: vi.fn().mockReturnValue(true),
      init: vi.fn(),
      close: vi.fn(),
      navigate: vi.fn(),
      act: vi.fn(),
      extract: vi.fn(),
      observe: vi.fn(),
      agent: vi.fn(),
      screenshot: vi.fn(),
      getUrl: vi.fn(),
      scroll: vi.fn(),
    };

    registerBrowserTools(mockRegistry as never, mockService);

    expect(mockRegistry.register).toHaveBeenCalledTimes(8);
    // 所有 tools 都应该有 executor
    expect(registered.every((r) => r.hasExecutor)).toBe(true);
    // 验证注册的 tool names 匹配
    const registeredNames = registered.map((r) => r.name);
    for (const def of BROWSER_TOOL_DEFS) {
      expect(registeredNames).toContain(def.name);
    }
  });
});
