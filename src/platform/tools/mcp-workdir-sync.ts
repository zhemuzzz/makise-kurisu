/**
 * MCP 工作目录同步器
 *
 * KURISU-026 Phase 2:
 * 负责在会话工作目录变化时，重启受影响的 MCP Server
 */

import type { MCPBridge } from "./mcp-bridge.js";
import type { MCPServerConfigLoader } from "../skills/mcp-server-config.js";

/**
 * 工作目录同步结果
 */
export interface WorkDirSyncResult {
  /** 同步是否成功（所有 Server 都重启成功） */
  readonly success: boolean;
  /** 新的工作目录 */
  readonly workDir: string;
  /** 重启成功的 Server */
  readonly restarted: readonly string[];
  /** 重启失败的 Server */
  readonly failed: readonly WorkDirSyncFailure[];
  /** 配置不存在的 Server（跳过） */
  readonly skipped: readonly string[];
  /** 总耗时（毫秒） */
  readonly elapsedMs: number;
}

export interface WorkDirSyncFailure {
  readonly serverName: string;
  readonly error: string;
}

/**
 * MCP 工作目录同步器
 *
 * 协调 SessionWorkDirManager 和 MCPBridge，
 * 在会话工作目录变化时重启受影响的 MCP Server
 */
export class MCPWorkDirSync {
  constructor(
    private readonly mcpBridge: MCPBridge,
    private readonly configLoader: MCPServerConfigLoader,
  ) {}

  /**
   * 当会话工作目录变化时调用
   *
   * 1. 查找受工作目录影响的 Server
   * 2. 用新工作目录解析配置
   * 3. 重启受影响的 Server
   *
   * @param _sessionId 会话 ID（预留多会话隔离）
   * @param newWorkDir 新的工作目录
   */
  async onWorkDirChanged(
    _sessionId: string,
    newWorkDir: string,
  ): Promise<WorkDirSyncResult> {
    const startTime = Date.now();

    // 1. 查找受影响的 Server
    const dependentServers =
      await this.configLoader.getWorkDirDependentServers();

    if (dependentServers.length === 0) {
      return {
        success: true,
        workDir: newWorkDir,
        restarted: [],
        failed: [],
        skipped: [],
        elapsedMs: Date.now() - startTime,
      };
    }

    // 2. 并行重启（KURISU-029: 从串行改为并行）
    const restarted: string[] = [];
    const failed: WorkDirSyncFailure[] = [];
    const skipped: string[] = [];

    const runtimeVars = { WORKING_DIR: newWorkDir };

    // 先解析所有配置
    const configEntries: Array<{
      serverName: string;
      config: import("../skills/types").MCPServerConfig | undefined;
    }> = await Promise.all(
      dependentServers.map(async (serverName) => ({
        serverName,
        config: await this.configLoader.getResolvedServerConfig(serverName, {
          runtimeVars,
        }),
      })),
    );

    // 分离可重启和需跳过的
    const toRestart: Array<{
      serverName: string;
      config: import("../skills/types").MCPServerConfig;
    }> = [];

    for (const entry of configEntries) {
      if (!entry.config) {
        skipped.push(entry.serverName);
      } else {
        toRestart.push({
          serverName: entry.serverName,
          config: entry.config,
        });
      }
    }

    // 并行重启所有 Server
    const results = await Promise.allSettled(
      toRestart.map(async ({ serverName, config }) => {
        await this.mcpBridge.reconnect(serverName, config);
        return serverName;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        restarted.push(result.value);
      } else {
        // 从 toRestart 列表中找到对应的 serverName
        const idx = results.indexOf(result);
        const entry = toRestart[idx] ?? { serverName: "unknown" };
        failed.push({
          serverName: entry.serverName,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    }

    return {
      success: failed.length === 0,
      workDir: newWorkDir,
      restarted,
      failed,
      skipped,
      elapsedMs: Date.now() - startTime,
    };
  }

  /**
   * 格式化同步结果为用户提示消息
   */
  static formatSyncMessage(result: WorkDirSyncResult): string {
    const { workDir, restarted, failed } = result;

    // 全部成功或无受影响 Server
    if (failed.length === 0) {
      if (restarted.length === 0) {
        return `好的，工作目录已切换到 \`${workDir}\``;
      }
      const tools = restarted.join("、");
      return `好的，工作目录已切换到 \`${workDir}\`，${tools} 工具已就绪。`;
    }

    // 部分失败
    const failedNames = failed.map((f) => f.serverName).join("、");
    if (restarted.length > 0) {
      const successNames = restarted.join("、");
      return (
        `工作目录已切换到 \`${workDir}\`。` +
        `${successNames} 工具已就绪，但 ${failedNames} 工具重启失败。`
      );
    }

    // 全部失败
    return (
      `工作目录已切换到 \`${workDir}\`，但 ${failedNames} 工具重启失败。`
    );
  }
}
