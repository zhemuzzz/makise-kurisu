/**
 * Browser Module — Barrel Exports
 *
 * src/platform/browser/
 */

// Types
export type {
  IBrowserService,
  BrowserUseConfig,
  StagehandModelConfig,
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
} from "./types.js";

// Constants
export {
  DEFAULT_SCROLL_AMOUNT,
  DEFAULT_AGENT_MAX_STEPS,
  DEFAULT_NAVIGATION_TIMEOUT,
} from "./types.js";

// Service
export { StagehandService, createBrowserService } from "./stagehand-service.js";

// Tools
export {
  BROWSER_TOOL_DEFS,
  BROWSER_NAVIGATE_TOOL,
  BROWSER_ACT_TOOL,
  BROWSER_EXTRACT_TOOL,
  BROWSER_OBSERVE_TOOL,
  BROWSER_AGENT_TOOL,
  BROWSER_SCREENSHOT_TOOL,
  BROWSER_GET_URL_TOOL,
  BROWSER_SCROLL_TOOL,
  createBrowserToolExecutors,
  registerBrowserTools,
} from "./tools.js";
