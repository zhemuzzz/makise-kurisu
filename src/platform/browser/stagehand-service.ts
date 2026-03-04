/**
 * StagehandService — Stagehand V3 Adapter
 *
 * WB-2: IBrowserService 实现，封装 Stagehand SDK V3
 * WB-4: Provider 无关 LLM 配置，透传 Stagehand 原生格式
 * WB-6: selfHeal 默认启用
 */

import type { V3 as StagehandV3, V3Options, ActResult, AgentResult } from "@browserbasehq/stagehand";
import { z } from "zod";

import type {
  IBrowserService,
  BrowserUseConfig,
  BrowserNavigateParams,
  BrowserNavigateResult,
  BrowserActParams,
  BrowserActResult,
  BrowserExtractParams,
  BrowserObserveParams,
  BrowserObserveResult,
  BrowserAgentParams,
  BrowserAgentResult,
  BrowserScreenshotParams,
  BrowserScreenshotResult,
  BrowserScrollParams,
  StagehandModelConfig,
} from "./types.js";
import {
  DEFAULT_SCROLL_AMOUNT,
  DEFAULT_AGENT_MAX_STEPS,
  DEFAULT_NAVIGATION_TIMEOUT,
} from "./types.js";

// ============ Config → Stagehand Options ============

/**
 * BrowserUseConfig → V3Options 变换
 *
 * Provider 无关: 字符串或对象格式直接透传给 Stagehand
 */
function toStagehandOptions(config: BrowserUseConfig): V3Options {
  const base: V3Options = {
    env: config.env === "local" ? "LOCAL" : "BROWSERBASE",
    model: toModelConfiguration(config.model),
    selfHeal: config.selfHeal ?? true,
    verbose: (config.verbose ?? 1) as 0 | 1 | 2,
    disablePino: true, // 使用自己的日志系统
  };

  // exactOptionalPropertyTypes: 逐个合并非 undefined 的可选属性
  let result = base;
  if (config.localBrowserLaunchOptions) {
    result = { ...result, localBrowserLaunchOptions: config.localBrowserLaunchOptions };
  }
  if (config.domSettleTimeout !== undefined) {
    result = { ...result, domSettleTimeout: config.domSettleTimeout };
  }
  return result;
}

/**
 * StagehandModelConfig → Stagehand ModelConfiguration
 */
function toModelConfiguration(
  model: StagehandModelConfig,
): string | { modelName: string; apiKey?: string; baseURL?: string } {
  if (typeof model === "string") {
    return model;
  }
  return {
    modelName: model.modelName,
    apiKey: model.apiKey,
    baseURL: model.baseURL,
  };
}

// ============ StagehandService ============

/**
 * StagehandService — IBrowserService 的 Stagehand V3 实现
 *
 * 生命周期:
 * - init(): 启动 Stagehand + Chromium (lazy, 首次工具调用时触发)
 * - close(): graceful shutdown
 *
 * 注意:
 * - 所有方法确保 init() 已调用
 * - extract() 的 schema 参数从 JSON Schema 转为 Zod
 * - scroll() 直接用 Playwright API, 不走 LLM
 */
export class StagehandService implements IBrowserService {
  private stagehand: StagehandV3 | null = null;
  private readonly config: BrowserUseConfig;
  private initialized = false;

  constructor(config: BrowserUseConfig) {
    this.config = config;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 动态导入避免未安装时 crash
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const options = toStagehandOptions(this.config);

    this.stagehand = new Stagehand(options);
    await this.stagehand.init();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.stagehand) {
      await this.stagehand.close();
      this.stagehand = null;
      this.initialized = false;
    }
  }

  // ============ Tool Methods ============

  async navigate(params: BrowserNavigateParams): Promise<BrowserNavigateResult> {
    const sh = this.ensureStagehand();
    const page = this.getPage(sh);
    await page.goto(params.url, {
      waitUntil: params.waitUntil ?? "domcontentloaded",
      timeoutMs: DEFAULT_NAVIGATION_TIMEOUT,
    });
    const title = await page.title();
    return { url: page.url(), title };
  }

  async act(params: BrowserActParams): Promise<BrowserActResult> {
    const sh = this.ensureStagehand();
    const result: ActResult = await sh.act(params.action);
    return {
      success: result.success,
      message: result.message,
    };
  }

  async extract(params: BrowserExtractParams): Promise<unknown> {
    const sh = this.ensureStagehand();

    if (params.schema) {
      // JSON Schema → Zod schema (简单转换)
      const zodSchema = jsonSchemaToZodObject(params.schema);
      return sh.extract(params.instruction, zodSchema);
    }

    return sh.extract(params.instruction);
  }

  async observe(params: BrowserObserveParams): Promise<BrowserObserveResult> {
    const sh = this.ensureStagehand();
    const elements = await sh.observe(params.instruction);
    return {
      elements: elements.map((e) => {
        const base = { selector: e.selector, description: e.description };
        return e.method ? { ...base, method: e.method } : base;
      }),
    };
  }

  async agent(params: BrowserAgentParams): Promise<BrowserAgentResult> {
    const sh = this.ensureStagehand();

    const agentConfig: Record<string, unknown> = {
      mode: "dom" as const,
    };

    // Agent 可选独立模型
    if (this.config.agentModel) {
      agentConfig["model"] = toModelConfiguration(this.config.agentModel);
    }
    if (this.config.agentExecutionModel) {
      agentConfig["executionModel"] = toModelConfiguration(this.config.agentExecutionModel);
    }

    const agentInstance = sh.agent(agentConfig);
    const result: AgentResult = await agentInstance.execute({
      instruction: params.instruction,
      maxSteps: params.maxSteps ?? DEFAULT_AGENT_MAX_STEPS,
    });

    return {
      success: result.success,
      message: result.message,
      actions: result.actions.map((a) => {
        const base = { type: a.type };
        const desc = a.action ?? a.reasoning;
        return desc ? { ...base, description: desc } : base;
      }),
    };
  }

  async screenshot(params: BrowserScreenshotParams): Promise<BrowserScreenshotResult> {
    const sh = this.ensureStagehand();
    const page = this.getPage(sh);
    const buffer = await page.screenshot({
      fullPage: params.fullPage ?? false,
      type: "png",
    });
    return {
      base64: buffer.toString("base64"),
      mimeType: "image/png",
    };
  }

  async getUrl(): Promise<string> {
    const sh = this.ensureStagehand();
    const page = this.getPage(sh);
    return page.url();
  }

  async scroll(params: BrowserScrollParams): Promise<void> {
    const sh = this.ensureStagehand();
    const page = this.getPage(sh);
    const amount = params.amount ?? DEFAULT_SCROLL_AMOUNT;
    const y = params.direction === "down" ? amount : -amount;
    // evaluate 内的代码运行在浏览器环境，window 可用
    await page.evaluate(`window.scrollBy(0, ${y})`);
  }

  // ============ Internal ============

  private ensureStagehand(): StagehandV3 {
    if (!this.stagehand || !this.initialized) {
      throw new Error("StagehandService not initialized. Call init() first.");
    }
    return this.stagehand;
  }

  private getPage(sh: StagehandV3) {
    const page = sh.context.pages()[0];
    if (!page) {
      throw new Error("No browser page available.");
    }
    return page;
  }
}

// ============ JSON Schema → Zod (简化版) ============

/**
 * 将简单 JSON Schema 对象转为 Zod schema
 *
 * 只支持 flat object + string/number/boolean/array 字段
 * 复杂 schema 回退为 z.record(z.unknown())
 */
function jsonSchemaToZodObject(
  schema: Record<string, unknown>,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const properties = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
  if (!properties) {
    return z.object({});
  }

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(properties)) {
    shape[key] = jsonSchemaPropertyToZod(prop);
  }

  return z.object(shape);
}

function jsonSchemaPropertyToZod(prop: Record<string, unknown>): z.ZodTypeAny {
  const type = prop["type"] as string | undefined;
  const description = prop["description"] as string | undefined;

  let zodType: z.ZodTypeAny;
  switch (type) {
    case "string":
      zodType = z.string();
      break;
    case "number":
    case "integer":
      zodType = z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "array":
      zodType = z.array(z.unknown());
      break;
    default:
      zodType = z.unknown();
  }

  if (description) {
    zodType = zodType.describe(description);
  }

  return zodType;
}

// ============ Factory ============

/**
 * 创建 StagehandService 实例
 */
export function createBrowserService(config: BrowserUseConfig): IBrowserService {
  return new StagehandService(config);
}
