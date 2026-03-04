/**
 * MCP 工作目录同步器测试
 *
 * KURISU-026 Phase 2
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MCPWorkDirSync,
  type WorkDirSyncResult,
} from "../../../src/platform/tools/mcp-workdir-sync";
import type { MCPBridge } from "../../../src/platform/tools/mcp-bridge";
import type { MCPServerConfigLoader } from "../../../src/platform/skills/mcp-server-config";
import type { MCPServerConfig } from "../../../src/platform/skills/types";

// ============================================
// Mock 工厂
// ============================================

function createMockBridge(
  overrides: Partial<MCPBridge> = {},
): MCPBridge {
  return {
    reconnect: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as MCPBridge;
}

function createMockConfigLoader(
  overrides: Partial<MCPServerConfigLoader> = {},
): MCPServerConfigLoader {
  return {
    getWorkDirDependentServers: vi
      .fn()
      .mockResolvedValue(["filesystem", "git"]),
    getResolvedServerConfig: vi.fn().mockResolvedValue({
      command: "npx",
      args: ["-y", "server", "/new/path"],
      cwd: "/new/path",
    }),
    ...overrides,
  } as unknown as MCPServerConfigLoader;
}

// ============================================
// 测试
// ============================================

describe("MCPWorkDirSync", () => {
  let sync: MCPWorkDirSync;
  let mockBridge: MCPBridge;
  let mockConfigLoader: MCPServerConfigLoader;

  beforeEach(() => {
    mockBridge = createMockBridge();
    mockConfigLoader = createMockConfigLoader();
    sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);
  });

  describe("onWorkDirChanged", () => {
    it("应该重启所有受工作目录影响的 Server", async () => {
      const result = await sync.onWorkDirChanged(
        "session-1",
        "/home/user/project",
      );

      expect(result.success).toBe(true);
      expect(result.workDir).toBe("/home/user/project");
      expect(result.restarted).toContain("filesystem");
      expect(result.restarted).toContain("git");
      expect(result.failed).toHaveLength(0);
    });

    it("应该用正确的运行时变量调用 getResolvedServerConfig", async () => {
      await sync.onWorkDirChanged("session-1", "/my/project");

      expect(mockConfigLoader.getResolvedServerConfig).toHaveBeenCalledWith(
        "filesystem",
        { runtimeVars: { WORKING_DIR: "/my/project" } },
      );
      expect(mockConfigLoader.getResolvedServerConfig).toHaveBeenCalledWith(
        "git",
        { runtimeVars: { WORKING_DIR: "/my/project" } },
      );
    });

    it("应该调用 mcpBridge.reconnect 并传入解析后的配置", async () => {
      const resolvedConfig: MCPServerConfig = {
        command: "npx",
        args: ["-y", "server", "/resolved"],
        cwd: "/resolved",
      };

      mockConfigLoader = createMockConfigLoader({
        getResolvedServerConfig: vi.fn().mockResolvedValue(resolvedConfig),
      });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      await sync.onWorkDirChanged("session-1", "/resolved");

      expect(mockBridge.reconnect).toHaveBeenCalledWith(
        "filesystem",
        resolvedConfig,
      );
      expect(mockBridge.reconnect).toHaveBeenCalledWith(
        "git",
        resolvedConfig,
      );
    });

    it("没有受影响的 Server 时应跳过全部", async () => {
      mockConfigLoader = createMockConfigLoader({
        getWorkDirDependentServers: vi.fn().mockResolvedValue([]),
      });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      const result = await sync.onWorkDirChanged(
        "session-1",
        "/some/path",
      );

      expect(result.success).toBe(true);
      expect(result.restarted).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(mockBridge.reconnect).not.toHaveBeenCalled();
    });

    it("部分 Server 重启失败时应记录失败信息", async () => {
      const reconnectFn = vi
        .fn()
        .mockResolvedValueOnce({}) // filesystem 成功
        .mockRejectedValueOnce(new Error("Connection refused")); // git 失败

      mockBridge = createMockBridge({ reconnect: reconnectFn });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      const result = await sync.onWorkDirChanged(
        "session-1",
        "/some/path",
      );

      expect(result.success).toBe(false);
      expect(result.restarted).toContain("filesystem");
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].serverName).toBe("git");
      expect(result.failed[0].error).toContain("Connection refused");
    });

    it("全部 Server 重启失败时 success 应为 false", async () => {
      mockBridge = createMockBridge({
        reconnect: vi.fn().mockRejectedValue(new Error("timeout")),
      });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      const result = await sync.onWorkDirChanged(
        "session-1",
        "/some/path",
      );

      expect(result.success).toBe(false);
      expect(result.restarted).toHaveLength(0);
      expect(result.failed).toHaveLength(2);
    });

    it("应该记录耗时", async () => {
      const result = await sync.onWorkDirChanged(
        "session-1",
        "/some/path",
      );

      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("配置解析返回 undefined 时应跳过该 Server", async () => {
      const getResolvedFn = vi
        .fn()
        .mockResolvedValueOnce({
          command: "npx",
          args: ["/path"],
          cwd: "/path",
        })
        .mockResolvedValueOnce(undefined); // git 配置不存在

      mockConfigLoader = createMockConfigLoader({
        getResolvedServerConfig: getResolvedFn,
      });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      const result = await sync.onWorkDirChanged(
        "session-1",
        "/path",
      );

      expect(result.success).toBe(true);
      expect(result.restarted).toContain("filesystem");
      expect(result.skipped).toContain("git");
      expect(mockBridge.reconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe("formatSyncMessage", () => {
    it("全部成功应返回简洁消息", () => {
      const result: WorkDirSyncResult = {
        success: true,
        workDir: "/home/user/project",
        restarted: ["filesystem", "git"],
        failed: [],
        skipped: [],
        elapsedMs: 1200,
      };

      const message = MCPWorkDirSync.formatSyncMessage(result);

      expect(message).toContain("/home/user/project");
      expect(message).toContain("已就绪");
    });

    it("部分失败应包含失败信息", () => {
      const result: WorkDirSyncResult = {
        success: false,
        workDir: "/tmp",
        restarted: ["filesystem"],
        failed: [{ serverName: "git", error: "Connection timeout" }],
        skipped: [],
        elapsedMs: 3000,
      };

      const message = MCPWorkDirSync.formatSyncMessage(result);

      expect(message).toContain("git");
      expect(message).toContain("失败");
    });

    it("无受影响 Server 应返回简单消息", () => {
      const result: WorkDirSyncResult = {
        success: true,
        workDir: "/tmp",
        restarted: [],
        failed: [],
        skipped: [],
        elapsedMs: 5,
      };

      const message = MCPWorkDirSync.formatSyncMessage(result);

      expect(message).toContain("/tmp");
    });
  });

  // ============================================
  // KURISU-029 Phase 5: 并行重启
  // ============================================

  describe("并行重启 (KURISU-029)", () => {
    it("T5.1: 应该并行重启多个 Server", async () => {
      const callOrder: { name: string; time: number }[] = [];
      const startTime = Date.now();

      const reconnectFn = vi.fn().mockImplementation(async (serverName: string) => {
        callOrder.push({ name: serverName, time: Date.now() - startTime });
        // 模拟每个 Server 重启需要 50ms
        await new Promise((r) => setTimeout(r, 50));
      });

      mockBridge = createMockBridge({ reconnect: reconnectFn });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      const result = await sync.onWorkDirChanged("session-1", "/parallel/path");

      expect(result.success).toBe(true);
      expect(result.restarted).toHaveLength(2);

      // 如果是并行的，两个 Server 的启动时间应该非常接近
      if (callOrder.length >= 2) {
        const timeDiff = Math.abs(callOrder[0].time - callOrder[1].time);
        // 并行情况下两个调用应该几乎同时开始（<30ms 差异）
        expect(timeDiff).toBeLessThan(30);
      }
    });

    it("T5.2: 部分 Server 重启失败不影响其他", async () => {
      const reconnectFn = vi
        .fn()
        .mockImplementation(async (serverName: string) => {
          if (serverName === "git") {
            throw new Error("git server crashed");
          }
          return {};
        });

      mockBridge = createMockBridge({ reconnect: reconnectFn });
      sync = new MCPWorkDirSync(mockBridge, mockConfigLoader);

      const result = await sync.onWorkDirChanged("session-1", "/some/path");

      expect(result.success).toBe(false);
      expect(result.restarted).toContain("filesystem");
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].serverName).toBe("git");
    });
  });
});
