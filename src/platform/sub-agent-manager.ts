/**
 * SubAgentManager - Sub-Agent 生命周期管理
 *
 * 实现 SubAgentManagerPort, 管理 Sub-Agent 的 spawn/await/abort 生命周期。
 * 实际任务执行通过 executeTask 回调注入（避免循环依赖）。
 *
 * SA-1: 创建 + ID 生成
 * SA-2: 并发控制（全树计数）
 * SA-3: 超时 + AbortSignal
 * SA-4: 状态追踪
 *
 * @module platform/sub-agent-manager
 * @see sub-agent.md SA-1~SA-11
 */

import type {
  SubAgentManagerPort,
  SubAgentConfig,
  SubAgentResult,
  SubAgentStatus,
} from "../agent/ports/platform-services.js";
import type { AgentStats } from "../agent/types.js";

// ============================================================================
// Types
// ============================================================================

/** 任务执行回调 (由 Bootstrap 注入实际的 Agent 执行逻辑) */
export type ExecuteTaskFn = (
  config: SubAgentConfig,
) => Promise<{ result: unknown; stats: AgentStats }>;

export interface SubAgentManagerOptions {
  /** 任务执行回调 */
  readonly executeTask: ExecuteTaskFn;

  /** 每个 session 最大并发数 (默认 3) */
  readonly maxConcurrentPerSession?: number;
}

/** 内部 Sub-Agent 状态 */
interface SubAgentEntry {
  readonly id: string;
  readonly config: SubAgentConfig;
  readonly sessionId: string;
  readonly abortController: AbortController;
  status: SubAgentStatus;
  resultPromise: Promise<SubAgentResult>;
}

// ============================================================================
// ID Generator
// ============================================================================

let nextId = 0;

function generateSubAgentId(): string {
  nextId++;
  return `sub-${Date.now()}-${nextId}`;
}

// ============================================================================
// Implementation
// ============================================================================

export class SubAgentManager implements SubAgentManagerPort {
  private readonly executeTask: ExecuteTaskFn;
  private readonly maxConcurrent: number;
  private readonly entries = new Map<string, SubAgentEntry>();

  constructor(options: SubAgentManagerOptions) {
    this.executeTask = options.executeTask;
    this.maxConcurrent = options.maxConcurrentPerSession ?? 3;
  }

  // --------------------------------------------------------------------------
  // spawn: 创建 Sub-Agent 并立即开始执行
  // --------------------------------------------------------------------------

  async spawn(config: SubAgentConfig): Promise<string> {
    // SA-2: 并发控制
    const activeCount = this.getActiveCount(config.sessionId);
    if (activeCount >= this.maxConcurrent) {
      throw new Error(
        `Max concurrent sub-agents reached (${this.maxConcurrent}) for session ${config.sessionId}`,
      );
    }

    const id = generateSubAgentId();
    const abortController = new AbortController();

    // Start task execution immediately (non-blocking)
    const resultPromise = this.runTask(id, config, abortController);

    const entry: SubAgentEntry = {
      id,
      config,
      sessionId: config.sessionId,
      abortController,
      status: "running",
      resultPromise,
    };

    this.entries.set(id, entry);
    return id;
  }

  // --------------------------------------------------------------------------
  // awaitResult: 等待 Sub-Agent 完成
  // --------------------------------------------------------------------------

  async awaitResult(
    subAgentId: string,
    signal?: AbortSignal,
  ): Promise<SubAgentResult> {
    const entry = this.entries.get(subAgentId);
    if (!entry) {
      throw new Error(`Sub-Agent not found: ${subAgentId}`);
    }

    // SA-3: Race with AbortSignal for timeout
    if (signal) {
      return Promise.race([
        entry.resultPromise,
        this.abortOnSignal(subAgentId, signal),
      ]);
    }

    return entry.resultPromise;
  }

  // --------------------------------------------------------------------------
  // abort: 中止 Sub-Agent
  // --------------------------------------------------------------------------

  async abort(subAgentId: string): Promise<boolean> {
    const entry = this.entries.get(subAgentId);
    if (!entry) return false;
    if (entry.status !== "running") return false;

    entry.abortController.abort();
    entry.status = "aborted";
    return true;
  }

  // --------------------------------------------------------------------------
  // getActiveCount: 统计活跃 Sub-Agent
  // --------------------------------------------------------------------------

  getActiveCount(sessionId: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.sessionId === sessionId && entry.status === "running") {
        count++;
      }
    }
    return count;
  }

  // --------------------------------------------------------------------------
  // getStatus: 获取状态
  // --------------------------------------------------------------------------

  getStatus(subAgentId: string): SubAgentStatus {
    const entry = this.entries.get(subAgentId);
    return entry?.status ?? "pending";
  }

  // ============================================================================
  // Private
  // ============================================================================

  private async runTask(
    id: string,
    config: SubAgentConfig,
    abortController: AbortController,
  ): Promise<SubAgentResult> {
    try {
      const { result, stats } = await this.executeTask(config);

      // Update status (if not already aborted)
      const entry = this.entries.get(id);
      if (entry && entry.status === "running") {
        entry.status = "completed";
      }

      return {
        subAgentId: id,
        success: true,
        result,
        stats,
      };
    } catch (err) {
      const entry = this.entries.get(id);

      // Check if abort caused the error
      if (abortController.signal.aborted) {
        if (entry && entry.status === "running") {
          entry.status = "aborted";
        }
        return {
          subAgentId: id,
          success: false,
          result: undefined,
          error: { code: "ABORTED", message: "Sub-Agent was aborted" },
          stats: emptyStats(),
        };
      }

      // Update status to failed
      if (entry && entry.status === "running") {
        entry.status = "failed";
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        subAgentId: id,
        success: false,
        result: undefined,
        error: { code: "EXECUTION_FAILED", message },
        stats: emptyStats(),
      };
    }
  }

  private abortOnSignal(
    subAgentId: string,
    signal: AbortSignal,
  ): Promise<SubAgentResult> {
    return new Promise<SubAgentResult>((resolve) => {
      const onAbort = (): void => {
        const entry = this.entries.get(subAgentId);
        if (entry && entry.status === "running") {
          entry.abortController.abort();
          entry.status = "aborted";
        }

        resolve({
          subAgentId,
          success: false,
          result: undefined,
          error: { code: "TIMEOUT", message: "Sub-Agent timed out" },
          stats: emptyStats(),
        });
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

// ============================================================================
// Helper
// ============================================================================

function emptyStats(): SubAgentResult["stats"] {
  return {
    iterations: 0,
    toolCallCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    duration: 0,
    compactCount: 0,
  };
}
