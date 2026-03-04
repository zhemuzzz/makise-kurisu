/**
 * MCP 自动重连管理器
 *
 * KURISU-029 Phase 2: 指数退避 + AbortController 取消 + 并发保护
 * 从 mcp-bridge.ts 提取，降低文件复杂度
 */

import type { MCPServerConfig } from "../skills/types";

/**
 * MCP 连接状态
 */
export type MCPConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "reconnecting";

/**
 * 自动重连回调接口
 *
 * MCPBridge 通过闭包实现此接口，MCPAutoReconnect 通过它回调
 */
export interface AutoReconnectBridge {
  /** 获取连接信息（状态 + 配置） */
  readonly getConnectionForReconnect: (serverName: string) => {
    readonly status: MCPConnectionStatus;
    readonly config: MCPServerConfig;
  } | undefined;

  /** 更新连接状态 */
  readonly setConnectionStatus: (
    serverName: string,
    status: MCPConnectionStatus,
    error?: string,
  ) => void;

  /** 执行重连 */
  readonly reconnect: (
    serverName: string,
    config: MCPServerConfig,
  ) => Promise<unknown>;

  /** 发射 connectionRestored 事件 */
  readonly emitConnectionRestored: (
    serverName: string,
    attempt: number,
  ) => void;
}

export interface AutoReconnectConfig {
  readonly maxRetries: number;
  readonly baseDelay: number;
  readonly maxDelay: number;
}

/**
 * MCP 自动重连管理器
 *
 * 管理 MCP Server 的自动重连任务，使用指数退避策略
 * 支持并发保护（同一 Server 只允许一个重连任务）和取消功能
 */
export class MCPAutoReconnect {
  private readonly tasks = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly config: AutoReconnectConfig,
    private readonly bridge: AutoReconnectBridge,
  ) {}

  /**
   * 调度自动重连（并发保护：同一 Server 只允许一个重连任务）
   */
  schedule(serverName: string): void {
    if (this.tasks.has(serverName)) return;

    const controller = new AbortController();
    this.controllers.set(serverName, controller);

    const task = this.execute(serverName, controller.signal);
    this.tasks.set(serverName, task);
    void task.finally(() => {
      this.tasks.delete(serverName);
      this.controllers.delete(serverName);
    });
  }

  /**
   * 取消所有进行中的自动重连任务
   *
   * 通过 AbortController.abort() 实际停止正在等待的重连循环
   */
  cancelAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }
    this.controllers.clear();
    this.tasks.clear();
  }

  /**
   * 执行自动重连（指数退避）
   */
  private async execute(
    serverName: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { maxRetries, baseDelay, maxDelay } = this.config;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // 检查是否已被取消
      if (signal.aborted) return;

      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await this.sleep(delay);

      // 再次检查取消状态（delay 之后）
      if (signal.aborted) return;

      // 检查是否已被手动断开
      const current = this.bridge.getConnectionForReconnect(serverName);
      if (!current || current.status === "disconnected") return;

      try {
        this.bridge.setConnectionStatus(serverName, "reconnecting");
        await this.bridge.reconnect(serverName, current.config);
        this.bridge.emitConnectionRestored(serverName, attempt);
        return; // 重连成功
      } catch {
        // 继续重试
      }
    }

    // 全部重试失败（检查取消状态）
    if (signal.aborted) return;

    this.bridge.setConnectionStatus(
      serverName,
      "error",
      `Auto-reconnect failed after ${maxRetries} attempts`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
