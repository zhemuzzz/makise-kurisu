/**
 * IBrowserService — Browser Service Port Interface
 *
 * WB-2: Agent → browser_* tools → IBrowserService → Stagehand SDK V3
 * WB-3: 8 native tools (navigate/act/extract/observe/agent/screenshot/get_url/scroll)
 */

// ============ Configuration ============

/**
 * Stagehand model 配置（WB-4: Provider 无关）
 *
 * 方式1: 字符串 — Vercel AI SDK 内置 provider
 *   例: "openai/gpt-4o-mini", "anthropic/claude-3-5-sonnet-20241022"
 *
 * 方式2: 对象 — 自定义 endpoint（OpenAI 兼容）
 *   例: { modelName: "glm-4-flash", apiKey: "...", baseURL: "..." }
 */
export type StagehandModelConfig =
  | string
  | {
      readonly modelName: string;
      readonly apiKey: string;
      readonly baseURL: string;
    };

/**
 * BrowserUse 配置（config/system/platform.yaml → browserUse）
 */
export interface BrowserUseConfig {
  /** 运行环境: "local" | "browserbase" */
  readonly env: "local" | "browserbase";
  /** Stagehand 模型配置 */
  readonly model: StagehandModelConfig;
  /** Agent 专用模型（可选，默认使用 model） */
  readonly agentModel?: StagehandModelConfig;
  /** Agent 执行模型（可选，默认使用 model） */
  readonly agentExecutionModel?: StagehandModelConfig;
  /** 本地浏览器启动选项 */
  readonly localBrowserLaunchOptions?: {
    readonly headless?: boolean;
  };
  /** action 失败自动修复 */
  readonly selfHeal?: boolean;
  /** DOM 稳定等待时间 (ms) */
  readonly domSettleTimeout?: number;
  /** 日志级别: 0=静默, 1=信息, 2=调试 */
  readonly verbose?: number;
}

// ============ Tool Parameters ============

export interface BrowserNavigateParams {
  readonly url: string;
  readonly waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

export interface BrowserActParams {
  readonly action: string;
}

export interface BrowserExtractParams {
  readonly instruction: string;
  readonly schema?: Record<string, unknown>;
}

export interface BrowserObserveParams {
  readonly instruction: string;
}

export interface BrowserAgentParams {
  readonly instruction: string;
  readonly maxSteps?: number;
}

export interface BrowserScreenshotParams {
  readonly fullPage?: boolean;
}

export interface BrowserScrollParams {
  readonly direction: "up" | "down";
  readonly amount?: number;
}

// ============ Tool Results ============

export interface BrowserNavigateResult {
  readonly url: string;
  readonly title: string;
}

export interface BrowserActResult {
  readonly success: boolean;
  readonly message?: string;
}

export interface BrowserObserveResult {
  readonly elements: ReadonlyArray<{
    readonly selector: string;
    readonly description: string;
    readonly method?: string;
  }>;
}

export interface BrowserAgentResult {
  readonly success: boolean;
  readonly message: string;
  readonly actions: ReadonlyArray<{
    readonly type: string;
    readonly description?: string;
  }>;
}

export interface BrowserScreenshotResult {
  readonly base64: string;
  readonly mimeType: "image/png";
}

// ============ IBrowserService Port ============

/**
 * IBrowserService — Browser 操作 Port 接口
 *
 * Adapter: StagehandService (stagehand-service.ts)
 */
export interface IBrowserService {
  /** 初始化浏览器（启动 Stagehand + Chromium） */
  init(): Promise<void>;

  /** 关闭浏览器（graceful shutdown） */
  close(): Promise<void>;

  /** 是否已初始化 */
  isInitialized(): boolean;

  /** 导航到 URL */
  navigate(params: BrowserNavigateParams): Promise<BrowserNavigateResult>;

  /** 自然语言单步操作 */
  act(params: BrowserActParams): Promise<BrowserActResult>;

  /** 结构化提取 */
  extract(params: BrowserExtractParams): Promise<unknown>;

  /** 识别页面元素 */
  observe(params: BrowserObserveParams): Promise<BrowserObserveResult>;

  /** 多步骤自主浏览任务 */
  agent(params: BrowserAgentParams): Promise<BrowserAgentResult>;

  /** 截图 */
  screenshot(params: BrowserScreenshotParams): Promise<BrowserScreenshotResult>;

  /** 获取当前 URL */
  getUrl(): Promise<string>;

  /** 滚动页面 */
  scroll(params: BrowserScrollParams): Promise<void>;
}

// ============ Constants ============

/** 默认滚动像素 */
export const DEFAULT_SCROLL_AMOUNT = 500;

/** 默认 agent maxSteps */
export const DEFAULT_AGENT_MAX_STEPS = 20;

/** 默认导航超时 (ms) */
export const DEFAULT_NAVIGATION_TIMEOUT = 15000;
