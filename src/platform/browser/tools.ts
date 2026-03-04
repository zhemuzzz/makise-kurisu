/**
 * Browser Tools — 8 个 ToolDef 定义
 *
 * WB-3: browser_navigate/act/extract/observe/agent/screenshot/get_url/scroll
 * 权限: act/agent = confirm, 其余 = safe
 */

import type { ToolDef } from "../tools/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { IBrowserService } from "./types.js";
import {
  DEFAULT_SCROLL_AMOUNT,
  DEFAULT_AGENT_MAX_STEPS,
  type BrowserNavigateParams,
  type BrowserActParams,
  type BrowserExtractParams,
  type BrowserObserveParams,
  type BrowserAgentParams,
  type BrowserScreenshotParams,
  type BrowserScrollParams,
} from "./types.js";

// ============ ToolDef Definitions ============

export const BROWSER_NAVIGATE_TOOL: ToolDef = {
  name: "browser_navigate",
  description: "导航到指定 URL，打开网页。返回页面 URL 和标题。",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "要访问的 URL" },
      waitUntil: {
        type: "string",
        description: "等待条件: load | domcontentloaded | networkidle",
        enum: ["load", "domcontentloaded", "networkidle"],
        default: "domcontentloaded",
      },
    },
    required: ["url"],
  },
  permission: "safe",
  source: { type: "native", nativeId: "browser_navigate" },
};

export const BROWSER_ACT_TOOL: ToolDef = {
  name: "browser_act",
  description:
    "用自然语言在网页上执行单步操作（点击按钮、输入文字、选择选项等）。适合明确的单步操作。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", description: "自然语言操作指令，如 'click the login button'" },
    },
    required: ["action"],
  },
  permission: "confirm",
  source: { type: "native", nativeId: "browser_act" },
};

export const BROWSER_EXTRACT_TOOL: ToolDef = {
  name: "browser_extract",
  description:
    "从当前网页中结构化提取信息。返回符合 schema 的数据，或纯文本。适合读取页面内容。",
  inputSchema: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "提取指令，如 'extract the article title and author'" },
      schema: {
        type: "object",
        description: "可选的 JSON Schema，用于结构化提取结果",
      },
    },
    required: ["instruction"],
  },
  permission: "safe",
  source: { type: "native", nativeId: "browser_extract" },
};

export const BROWSER_OBSERVE_TOOL: ToolDef = {
  name: "browser_observe",
  description: "识别当前页面上的可交互元素（按钮、链接、输入框等）。返回元素列表。",
  inputSchema: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "识别指令，如 'find all clickable buttons'" },
    },
    required: ["instruction"],
  },
  permission: "safe",
  source: { type: "native", nativeId: "browser_observe" },
};

export const BROWSER_AGENT_TOOL: ToolDef = {
  name: "browser_agent",
  description:
    "执行多步骤自主浏览任务（搜索并比较、填写多页表单、复杂网页操作）。Agent 自主规划和执行。",
  inputSchema: {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "任务指令，如 '搜索并比较 iPhone 16 和 Pixel 9 的价格'",
      },
      maxSteps: {
        type: "number",
        description: `最大步骤数（默认 ${DEFAULT_AGENT_MAX_STEPS}）`,
        default: DEFAULT_AGENT_MAX_STEPS,
      },
    },
    required: ["instruction"],
  },
  permission: "confirm",
  source: { type: "native", nativeId: "browser_agent" },
};

export const BROWSER_SCREENSHOT_TOOL: ToolDef = {
  name: "browser_screenshot",
  description: "对当前页面截图，返回 base64 编码的 PNG 图片。",
  inputSchema: {
    type: "object",
    properties: {
      fullPage: { type: "boolean", description: "是否截取完整页面（默认仅可见区域）" },
    },
  },
  permission: "safe",
  source: { type: "native", nativeId: "browser_screenshot" },
};

export const BROWSER_GET_URL_TOOL: ToolDef = {
  name: "browser_get_url",
  description: "获取当前页面的 URL。",
  inputSchema: {
    type: "object",
    properties: {},
  },
  permission: "safe",
  source: { type: "native", nativeId: "browser_get_url" },
};

export const BROWSER_SCROLL_TOOL: ToolDef = {
  name: "browser_scroll",
  description: "滚动页面，不消耗 LLM 调用。",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        description: "滚动方向",
        enum: ["up", "down"],
      },
      amount: {
        type: "number",
        description: `滚动像素数（默认 ${DEFAULT_SCROLL_AMOUNT}）`,
        default: DEFAULT_SCROLL_AMOUNT,
      },
    },
    required: ["direction"],
  },
  permission: "safe",
  source: { type: "native", nativeId: "browser_scroll" },
};

/** 全部 8 个 browser ToolDef */
export const BROWSER_TOOL_DEFS: readonly ToolDef[] = [
  BROWSER_NAVIGATE_TOOL,
  BROWSER_ACT_TOOL,
  BROWSER_EXTRACT_TOOL,
  BROWSER_OBSERVE_TOOL,
  BROWSER_AGENT_TOOL,
  BROWSER_SCREENSHOT_TOOL,
  BROWSER_GET_URL_TOOL,
  BROWSER_SCROLL_TOOL,
];

// ============ Tool Executors ============

/**
 * 创建 browser tool executor map
 *
 * 将每个 tool name 映射到 IBrowserService 方法调用
 */
export function createBrowserToolExecutors(
  service: IBrowserService,
): ReadonlyMap<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const ensureInitialized = async (): Promise<void> => {
    if (!service.isInitialized()) {
      await service.init();
    }
  };

  return new Map([
    [
      "browser_navigate",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        return service.navigate(args as unknown as BrowserNavigateParams);
      },
    ],
    [
      "browser_act",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        return service.act(args as unknown as BrowserActParams);
      },
    ],
    [
      "browser_extract",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        return service.extract(args as unknown as BrowserExtractParams);
      },
    ],
    [
      "browser_observe",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        return service.observe(args as unknown as BrowserObserveParams);
      },
    ],
    [
      "browser_agent",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        return service.agent(args as unknown as BrowserAgentParams);
      },
    ],
    [
      "browser_screenshot",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        return service.screenshot(args as unknown as BrowserScreenshotParams);
      },
    ],
    [
      "browser_get_url",
      async (_args: Record<string, unknown>) => {
        await ensureInitialized();
        return { url: await service.getUrl() };
      },
    ],
    [
      "browser_scroll",
      async (args: Record<string, unknown>) => {
        await ensureInitialized();
        await service.scroll(args as unknown as BrowserScrollParams);
        return { success: true };
      },
    ],
  ]);
}

// ============ Registry Integration ============

/**
 * 注册 8 个 browser tools 到 ToolRegistry
 *
 * 6a.8: 将 ToolDef + executor 一起注册
 */
export function registerBrowserTools(
  registry: ToolRegistry,
  service: IBrowserService,
): void {
  const executors = createBrowserToolExecutors(service);
  for (const def of BROWSER_TOOL_DEFS) {
    const executor = executors.get(def.name);
    registry.register(def, executor);
  }
}
