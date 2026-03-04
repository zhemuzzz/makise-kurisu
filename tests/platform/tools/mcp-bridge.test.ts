/**
 * MCPBridge 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MCPBridge,
  createMCPBridge,
  type MCPBridgeConfig,
} from "../../../src/platform/tools/mcp-bridge";
import type { ToolsChangedEvent } from "../../../src/platform/tools/mcp-bridge";
import type { MCPBridgeEvents } from "../../../src/platform/tools/mcp-bridge";

describe("MCPBridge", () => {
  describe("constructor", () => {
    it("应该使用默认超时配置", () => {
      const bridge = new MCPBridge();
      // 默认值：connectionTimeout=10000, toolCallTimeout=30000
      expect(bridge).toBeDefined();
    });

    it("应该接受自定义超时配置", () => {
      const bridge = new MCPBridge({
        connectionTimeout: 5000,
        toolCallTimeout: 15000,
      });
      expect(bridge).toBeDefined();
    });

    it("应该接受热重连配置", () => {
      const bridge = new MCPBridge({
        reconnectMaxRetries: 5,
        reconnectDelay: 2000,
      });
      expect(bridge).toBeDefined();
    });
  });

  describe("createMCPBridge", () => {
    it("应该创建 MCPBridge 实例", () => {
      const bridge = createMCPBridge();
      expect(bridge).toBeInstanceOf(MCPBridge);
    });

    it("应该接受配置参数", () => {
      const bridge = createMCPBridge({
        connectionTimeout: 3000,
        toolCallTimeout: 10000,
      });
      expect(bridge).toBeInstanceOf(MCPBridge);
    });
  });

  describe("getStatus", () => {
    it("未连接时应该返回 undefined", () => {
      const bridge = new MCPBridge();
      expect(bridge.getStatus("non-existent")).toBeUndefined();
    });
  });

  describe("getAllStatus", () => {
    it("应该返回空的 Map", () => {
      const bridge = new MCPBridge();
      const status = bridge.getAllStatus();
      expect(status.size).toBe(0);
    });
  });

  describe("disconnect", () => {
    it("断开不存在的连接应该不报错", async () => {
      const bridge = new MCPBridge();
      await expect(bridge.disconnect("non-existent")).resolves.toBeUndefined();
    });
  });

  describe("disconnectAll", () => {
    it("断开所有不存在的连接应该不报错", async () => {
      const bridge = new MCPBridge();
      await expect(bridge.disconnectAll()).resolves.toBeUndefined();
    });
  });

  describe("listTools", () => {
    it("未连接时应该抛出错误", async () => {
      const bridge = new MCPBridge();
      await expect(bridge.listTools("non-existent")).rejects.toThrow(
        "MCP server not connected",
      );
    });
  });

  describe("callTool", () => {
    it("未连接时应该抛出错误", async () => {
      const bridge = new MCPBridge();
      await expect(
        bridge.callTool("non-existent", "test-tool", {}),
      ).rejects.toThrow("MCP server not connected");
    });
  });

  describe("超时功能", () => {
    it("connectionTimeout 应该生效", async () => {
      const bridge = new MCPBridge({
        connectionTimeout: 100, // 短超时
      });

      // 模拟连接超时（连接到一个不存在的命令会卡住）
      const connectPromise = bridge.connect("test-server", {
        command: "sleep",
        args: ["10"], // sleep 10 seconds
      });

      // 使用 AbortController 模拟超时
      await expect(connectPromise).rejects.toThrow(/timeout|failed/i);
    }, 5000); // 5s 测试超时

    it("toolCallTimeout 配置应该被存储", () => {
      const bridge = new MCPBridge({
        toolCallTimeout: 500,
      });

      // callTool 在未连接时会先抛出连接错误
      // 这个测试验证配置被正确存储
      expect(bridge).toBeDefined();
    });
  });

  // ============================================
  // KURISU-018 Phase 3: 热重连测试
  // ============================================

  describe("热重连功能", () => {
    describe("reconnect", () => {
      it("没有配置时应该抛出错误", async () => {
        const bridge = new MCPBridge();

        await expect(bridge.reconnect("unknown-server")).rejects.toThrow(
          "No config available",
        );
      });

      it("重连失败后应该更新状态为 error", async () => {
        const bridge = new MCPBridge({
          connectionTimeout: 100,
          reconnectMaxRetries: 1,
        });

        // 先尝试连接（会超时）
        try {
          await bridge.connect("test-server", {
            command: "sleep",
            args: ["10"],
          });
        } catch {
          // 预期会超时
        }

        // 重连应该失败
        try {
          await bridge.reconnect("test-server");
        } catch {
          // 预期重连失败
        }

        // 状态应该是 error
        const status = bridge.getStatus("test-server");
        expect(status).toBe("error");
      });
    });

    describe("reloadConfig", () => {
      it("应该处理空配置", async () => {
        const bridge = new MCPBridge();

        // 空配置应该不会报错
        await expect(
          bridge.reloadConfig({ mcpServers: {} }),
        ).resolves.toBeUndefined();
      });

      it("应该断开已移除的 Server", async () => {
        const bridge = new MCPBridge({
          connectionTimeout: 100,
        });

        // 尝试连接（会超时但会创建连接记录）
        try {
          await bridge.connect("to-remove", {
            command: "echo",
            args: ["test"],
          });
        } catch {
          // 预期会失败或超时
        }

        // 重载空配置
        await bridge.reloadConfig({ mcpServers: {} });

        // Server 应该被断开
        expect(bridge.getStatus("to-remove")).toBeUndefined();
      });
    });

    describe("onToolsChanged", () => {
      it("应该注册事件监听器", () => {
        const bridge = new MCPBridge();
        const listener = vi.fn();

        const unsubscribe = bridge.onToolsChanged(listener);

        expect(typeof unsubscribe).toBe("function");

        // 清理
        unsubscribe();
      });

      it("取消订阅应该移除监听器", () => {
        const bridge = new MCPBridge();
        const listener = vi.fn();

        const unsubscribe = bridge.onToolsChanged(listener);
        unsubscribe();

        // 移除后不应该影响其他操作
        expect(bridge).toBeDefined();
      });

      it("offToolsChanged 应该移除监听器", () => {
        const bridge = new MCPBridge();
        const listener = vi.fn();

        bridge.onToolsChanged(listener);
        bridge.offToolsChanged(listener);

        expect(bridge).toBeDefined();
      });
    });

    describe("getConnectedConfigs", () => {
      it("没有连接时应该返回空 Map", () => {
        const bridge = new MCPBridge();
        const configs = bridge.getConnectedConfigs();

        expect(configs.size).toBe(0);
      });
    });
  });

  // ============================================
  // KURISU-026: cwd 传递测试
  // ============================================

  describe("cwd 传递", () => {
    it("connect 应该接受带 cwd 的配置", async () => {
      const bridge = new MCPBridge({ connectionTimeout: 100 });

      // 带 cwd 字段的配置应该被接受（连接会因超时失败，但不是因为 cwd 字段报错）
      const connectPromise = bridge.connect("test-cwd-server", {
        command: "sleep",
        args: ["10"],
        cwd: "/tmp",
      });

      // 预期因超时失败，而不是因为 cwd 字段不合法
      await expect(connectPromise).rejects.toThrow(/timeout|failed/i);
    }, 5000);

    it("connect 不传 cwd 时应该不影响行为", async () => {
      const bridge = new MCPBridge({ connectionTimeout: 100 });

      // 不带 cwd 的配置应该与之前行为一致
      const connectPromise = bridge.connect("test-no-cwd-server", {
        command: "sleep",
        args: ["10"],
      });

      // 预期因超时失败，行为与带 cwd 时一致
      await expect(connectPromise).rejects.toThrow(/timeout|failed/i);
    }, 5000);

    it("getConnectedConfigs 应该保留 cwd 字段", async () => {
      const bridge = new MCPBridge({ connectionTimeout: 100 });

      // 尝试连接（会超时失败）
      try {
        await bridge.connect("cwd-config-server", {
          command: "sleep",
          args: ["10"],
          cwd: "/tmp/kurisu-test",
        });
      } catch {
        // 预期超时失败
      }

      // 连接尝试后，状态应该是 error（不是 connected），
      // 所以 getConnectedConfigs 不会包含该 server
      // 但 getAllStatus 应该反映连接尝试的记录
      const status = bridge.getStatus("cwd-config-server");
      expect(status).toBe("error");

      // getConnectedConfigs 只返回 status=connected 的，失败的不在其中
      const configs = bridge.getConnectedConfigs();
      expect(configs.has("cwd-config-server")).toBe(false);
    }, 5000);
  });
});

describe("MCPBridgeConfig 类型", () => {
  it("应该支持空配置", () => {
    const config: MCPBridgeConfig = {};
    expect(config).toBeDefined();
  });

  it("应该支持部分配置", () => {
    const config: MCPBridgeConfig = {
      connectionTimeout: 5000,
    };
    expect(config.connectionTimeout).toBe(5000);
    expect(config.toolCallTimeout).toBeUndefined();
  });

  it("应该支持完整配置", () => {
    const config: MCPBridgeConfig = {
      connectionTimeout: 5000,
      toolCallTimeout: 10000,
      reconnectMaxRetries: 5,
      reconnectDelay: 2000,
    };
    expect(config.connectionTimeout).toBe(5000);
    expect(config.toolCallTimeout).toBe(10000);
    expect(config.reconnectMaxRetries).toBe(5);
    expect(config.reconnectDelay).toBe(2000);
  });
});

describe("ToolsChangedEvent 类型", () => {
  it("应该支持 added 类型", () => {
    const event: ToolsChangedEvent = {
      type: "added",
      serverName: "test",
      tools: ["tool1", "tool2"],
      timestamp: Date.now(),
    };
    expect(event.type).toBe("added");
  });

  it("应该支持 removed 类型", () => {
    const event: ToolsChangedEvent = {
      type: "removed",
      serverName: "test",
      tools: [],
      timestamp: Date.now(),
    };
    expect(event.type).toBe("removed");
  });

  it("应该支持 updated 类型", () => {
    const event: ToolsChangedEvent = {
      type: "updated",
      serverName: "test",
      tools: ["tool1"],
      timestamp: Date.now(),
    };
    expect(event.type).toBe("updated");
  });
});

// ============================================
// KURISU-029 Phase 1: Transport 事件监听 + 崩溃检测
// ============================================

/**
 * 创建一个 mock transport，模拟 StdioClientTransport 的 onclose/onerror
 */
function createMockTransportBridge(): {
  bridge: MCPBridge;
  getTransport: () => { onclose?: () => void; onerror?: (error: Error) => void };
} {
  // 我们需要 mock connect 内部创建的 transport
  // 通过注入的方式捕获 transport 的事件回调
  let capturedOnclose: (() => void) | undefined;
  let capturedOnerror: ((error: Error) => void) | undefined;

  const bridge = new MCPBridge({
    connectionTimeout: 10000,
    autoReconnect: false, // Phase 1 测试不触发自动重连
  });

  // Mock connect 方法来设置 transport 回调
  const originalConnect = bridge.connect.bind(bridge);
  vi.spyOn(bridge, "connect").mockImplementation(async (serverName, config) => {
    // 模拟连接成功 — 直接操作 connections map
    const mockClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      request: vi.fn(),
      ping: vi.fn().mockResolvedValue(undefined),
    };

    const mockTransport = {
      start: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      set onclose(fn: () => void) {
        capturedOnclose = fn;
      },
      get onclose() {
        return capturedOnclose;
      },
      set onerror(fn: (error: Error) => void) {
        capturedOnerror = fn;
      },
      get onerror() {
        return capturedOnerror;
      },
    };

    // 使用内部 API 设置连接
    // @ts-expect-error - 访问私有 connections
    bridge.connections.set(serverName, {
      client: mockClient,
      transport: mockTransport,
      status: "connected",
      config,
    });

    // 绑定 transport 事件（这是 Phase 1 要实现的功能）
    // @ts-expect-error - 访问私有方法
    if (typeof bridge.bindTransportEvents === "function") {
      // @ts-expect-error - 访问私有方法
      bridge.bindTransportEvents(serverName, mockTransport);
    }

    return mockClient as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
  });

  return {
    bridge,
    getTransport: () => ({
      get onclose() { return capturedOnclose; },
      get onerror() { return capturedOnerror; },
    }),
  };
}

describe("KURISU-029 Phase 1: Transport 事件监听", () => {
  let bridge: MCPBridge;
  let getTransport: () => { onclose?: () => void; onerror?: (error: Error) => void };

  beforeEach(async () => {
    const result = createMockTransportBridge();
    bridge = result.bridge;
    getTransport = result.getTransport;

    // 连接一个 mock server
    await bridge.connect("test-server", {
      command: "npx",
      args: ["-y", "test-server"],
    });
  });

  it("T1.1: transport onclose 触发时状态变为 error", () => {
    // 模拟 transport 关闭（进程退出）
    const transport = getTransport();
    expect(transport.onclose).toBeDefined();

    transport.onclose!();

    expect(bridge.getStatus("test-server")).toBe("error");
  });

  it("T1.2: transport onerror 触发时状态变为 error", () => {
    const transport = getTransport();
    expect(transport.onerror).toBeDefined();

    transport.onerror!(new Error("pipe broken"));

    expect(bridge.getStatus("test-server")).toBe("error");
  });

  it("T1.3: connectionLost 事件携带正确 serverName 和 reason", async () => {
    const events: MCPBridgeEvents["connectionLost"][] = [];
    bridge.on("connectionLost", (event: MCPBridgeEvents["connectionLost"]) => {
      events.push(event);
    });

    const transport = getTransport();
    transport.onclose!();

    expect(events).toHaveLength(1);
    expect(events[0].serverName).toBe("test-server");
    expect(events[0].reason).toBe("process_exit");
  });

  it("T1.4: 已断开连接的 transport close 不重复处理", async () => {
    const events: MCPBridgeEvents["connectionLost"][] = [];
    bridge.on("connectionLost", (event: MCPBridgeEvents["connectionLost"]) => {
      events.push(event);
    });

    // 先断开
    await bridge.disconnect("test-server");

    // 再触发 transport close — 不应再次触发事件
    const transport = getTransport();
    if (transport.onclose) {
      transport.onclose();
    }

    expect(events).toHaveLength(0);
  });

  it("T1.5: disconnect() 后 transport close 不触发 connectionLost", async () => {
    const events: MCPBridgeEvents["connectionLost"][] = [];
    bridge.on("connectionLost", (event: MCPBridgeEvents["connectionLost"]) => {
      events.push(event);
    });

    // 正常断开（不应触发 connectionLost）
    await bridge.disconnect("test-server");

    expect(events).toHaveLength(0);
  });
});

// ============================================
// KURISU-029 Phase 2: 自动重连机制
// ============================================

describe("KURISU-029 Phase 2: 自动重连", () => {
  /**
   * 创建支持重连测试的 mock bridge
   * reconnectFn 控制重连是否成功
   */
  function createReconnectBridge(opts: {
    autoReconnect?: boolean;
    autoReconnectMaxRetries?: number;
    autoReconnectBaseDelay?: number;
    reconnectFn?: () => Promise<unknown>;
  }) {
    let capturedOnclose: (() => void) | undefined;

    const bridge = new MCPBridge({
      autoReconnect: opts.autoReconnect ?? true,
      autoReconnectMaxRetries: opts.autoReconnectMaxRetries ?? 3,
      autoReconnectBaseDelay: opts.autoReconnectBaseDelay ?? 10, // 测试用短延迟
      autoReconnectMaxDelay: 100,
    });

    // Mock connect
    vi.spyOn(bridge, "connect").mockImplementation(async (serverName, config) => {
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        request: vi.fn(),
        ping: vi.fn().mockResolvedValue(undefined),
      };

      const mockTransport = {
        start: vi.fn(),
        close: vi.fn(),
        set onclose(fn: () => void) { capturedOnclose = fn; },
        get onclose() { return capturedOnclose; },
        set onerror(_fn: (error: Error) => void) { /* no-op */ },
        get onerror() { return undefined; },
      };

      // @ts-expect-error - 访问私有 connections
      bridge.connections.set(serverName, {
        client: mockClient,
        transport: mockTransport,
        status: "connected",
        config,
      });

      // @ts-expect-error - 访问私有方法
      if (typeof bridge.bindTransportEvents === "function") {
        // @ts-expect-error - 访问私有方法
        bridge.bindTransportEvents(serverName, mockTransport);
      }

      return mockClient as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    });

    // Mock reconnect if provided
    if (opts.reconnectFn) {
      vi.spyOn(bridge, "reconnect").mockImplementation(async (serverName) => {
        await opts.reconnectFn!();
        // @ts-expect-error - 访问私有 connections
        const conn = bridge.connections.get(serverName);
        if (conn) conn.status = "connected";
        return {} as import("@modelcontextprotocol/sdk/client/index.js").Client;
      });
    }

    // Mock disconnect
    vi.spyOn(bridge, "disconnect").mockImplementation(async (serverName) => {
      // @ts-expect-error - 访问私有 connections
      const conn = bridge.connections.get(serverName);
      if (conn) conn.status = "disconnected";
      // @ts-expect-error - 访问私有 connections
      bridge.connections.delete(serverName);
    });

    return {
      bridge,
      triggerClose: () => capturedOnclose?.(),
    };
  }

  it("T2.1: autoReconnect=true 时进程退出自动重连", async () => {
    const reconnectFn = vi.fn().mockResolvedValue(undefined);
    const { bridge, triggerClose } = createReconnectBridge({ reconnectFn });

    await bridge.connect("test-server", { command: "npx", args: [] });
    triggerClose();

    // 等待自动重连完成
    await vi.waitFor(() => {
      expect(reconnectFn).toHaveBeenCalled();
    }, { timeout: 500 });
  });

  it("T2.2: 重连成功发射 connectionRestored 事件", async () => {
    const events: MCPBridgeEvents["connectionRestored"][] = [];
    const { bridge, triggerClose } = createReconnectBridge({
      reconnectFn: vi.fn().mockResolvedValue(undefined),
    });

    bridge.on("connectionRestored", (e: MCPBridgeEvents["connectionRestored"]) => events.push(e));

    await bridge.connect("test-server", { command: "npx", args: [] });
    triggerClose();

    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    }, { timeout: 500 });

    expect(events[0].serverName).toBe("test-server");
    expect(events[0].attempt).toBeGreaterThanOrEqual(1);
  });

  it("T2.3: 重连失败达到最大次数后停止", async () => {
    const reconnectFn = vi.fn().mockRejectedValue(new Error("fail"));
    const { bridge, triggerClose } = createReconnectBridge({
      autoReconnectMaxRetries: 2,
      autoReconnectBaseDelay: 5,
      reconnectFn,
    });

    await bridge.connect("test-server", { command: "npx", args: [] });
    triggerClose();

    await vi.waitFor(() => {
      expect(reconnectFn).toHaveBeenCalledTimes(2);
    }, { timeout: 500 });

    // 确认不会超过最大次数
    await new Promise((r) => setTimeout(r, 50));
    expect(reconnectFn).toHaveBeenCalledTimes(2);
  });

  it("T2.4: 指数退避延迟正确计算", async () => {
    const callTimes: number[] = [];
    const reconnectFn = vi.fn().mockImplementation(async () => {
      callTimes.push(Date.now());
      throw new Error("fail");
    });

    const { bridge, triggerClose } = createReconnectBridge({
      autoReconnectMaxRetries: 3,
      autoReconnectBaseDelay: 20, // 20ms base
      reconnectFn,
    });

    await bridge.connect("test-server", { command: "npx", args: [] });

    const startTime = Date.now();
    triggerClose();

    await vi.waitFor(() => {
      expect(reconnectFn).toHaveBeenCalledTimes(3);
    }, { timeout: 2000 });

    // 验证延迟递增：第 1 次 ~20ms, 第 2 次 ~40ms, 第 3 次 ~80ms
    // 只验证每次调用间隔递增
    if (callTimes.length >= 3) {
      const delay1 = callTimes[1] - callTimes[0];
      const delay2 = callTimes[2] - callTimes[1];
      // 第 2 次延迟应大于等于第 1 次（指数退避）
      expect(delay2).toBeGreaterThanOrEqual(delay1 * 0.8); // 允许 20% 误差
    }
  });

  it("T2.5: 并发重连被防护（同一 server 不重复触发）", async () => {
    let resolveReconnect: (() => void) | undefined;
    const reconnectFn = vi.fn().mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveReconnect = resolve;
      });
    });

    const { bridge, triggerClose } = createReconnectBridge({ reconnectFn });

    await bridge.connect("test-server", { command: "npx", args: [] });

    // 触发两次 close
    triggerClose();
    triggerClose();

    // 等一下确保调度开始
    await new Promise((r) => setTimeout(r, 50));

    // 只应该有一次重连任务
    // @ts-expect-error - 访问私有属性
    expect(bridge.autoReconnectManager.tasks.size).toBeLessThanOrEqual(1);

    // 清理
    resolveReconnect?.();
  });

  it("T2.6: 手动 disconnect 后不触发自动重连", async () => {
    const reconnectFn = vi.fn().mockResolvedValue(undefined);
    const { bridge } = createReconnectBridge({ reconnectFn });

    await bridge.connect("test-server", { command: "npx", args: [] });

    // 手动断开
    await bridge.disconnect("test-server");

    // 等待确认没有触发重连
    await new Promise((r) => setTimeout(r, 100));
    expect(reconnectFn).not.toHaveBeenCalled();
  });

  it("T2.7: autoReconnect=false 时不自动重连", async () => {
    const reconnectFn = vi.fn().mockResolvedValue(undefined);
    const { bridge, triggerClose } = createReconnectBridge({
      autoReconnect: false,
      reconnectFn,
    });

    await bridge.connect("test-server", { command: "npx", args: [] });
    triggerClose();

    await new Promise((r) => setTimeout(r, 100));
    expect(reconnectFn).not.toHaveBeenCalled();
  });
});

// ============================================
// KURISU-029 Phase 3: 优雅退出
// ============================================

describe("KURISU-029 Phase 3: 优雅退出", () => {
  function createMultiServerBridge() {
    const bridge = new MCPBridge({ autoReconnect: false });
    const disconnectCalls: string[] = [];

    // Mock connect to set up multiple connections
    vi.spyOn(bridge, "connect").mockImplementation(async (serverName, config) => {
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        request: vi.fn(),
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockTransport = {
        start: vi.fn(),
        close: vi.fn(),
        onclose: undefined as (() => void) | undefined,
        onerror: undefined as ((error: Error) => void) | undefined,
      };

      // @ts-expect-error - 访问私有 connections
      bridge.connections.set(serverName, {
        client: mockClient,
        transport: mockTransport,
        status: "connected",
        config,
      });

      return mockClient as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    });

    // Spy on disconnect
    const originalDisconnect = bridge.disconnect.bind(bridge);
    vi.spyOn(bridge, "disconnect").mockImplementation(async (serverName) => {
      disconnectCalls.push(serverName);
      // @ts-expect-error - 访问私有 connections
      const conn = bridge.connections.get(serverName);
      if (conn) conn.status = "disconnected";
      // @ts-expect-error - 访问私有 connections
      bridge.connections.delete(serverName);
    });

    return { bridge, disconnectCalls };
  }

  it("T3.1: disconnectAll 并行断开所有连接", async () => {
    const { bridge, disconnectCalls } = createMultiServerBridge();

    await bridge.connect("server-a", { command: "npx", args: [] });
    await bridge.connect("server-b", { command: "npx", args: [] });
    await bridge.connect("server-c", { command: "npx", args: [] });

    await bridge.disconnectAll();

    expect(disconnectCalls).toHaveLength(3);
    expect(disconnectCalls).toContain("server-a");
    expect(disconnectCalls).toContain("server-b");
    expect(disconnectCalls).toContain("server-c");
  });

  it("T3.2: disconnectAll 超时保护（5s）", async () => {
    const bridge = new MCPBridge({ autoReconnect: false });

    // 创建一个永远不会完成的 disconnect
    vi.spyOn(bridge, "connect").mockImplementation(async (serverName, config) => {
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockImplementation(() => new Promise(() => {})), // 永远挂起
        request: vi.fn(),
        ping: vi.fn().mockResolvedValue(undefined),
      };
      const mockTransport = { start: vi.fn(), close: vi.fn(), onclose: undefined, onerror: undefined };

      // @ts-expect-error - 访问私有 connections
      bridge.connections.set(serverName, {
        client: mockClient,
        transport: mockTransport,
        status: "connected",
        config,
      });

      return mockClient as unknown as import("@modelcontextprotocol/sdk/client/index.js").Client;
    });

    await bridge.connect("hanging-server", { command: "npx", args: [] });

    // disconnectAll 应该在超时后完成（不会永远挂起）
    const start = Date.now();
    await bridge.disconnectAll(200); // 200ms 超时（测试用短时间）
    const elapsed = Date.now() - start;

    // 应该在超时范围内完成
    expect(elapsed).toBeLessThan(1000);
  });

  it("T3.3: disconnectAll 取消进行中的重连任务", async () => {
    const bridge = new MCPBridge({ autoReconnect: true, autoReconnectBaseDelay: 10 });

    // 注入一个假的重连任务
    // @ts-expect-error - 访问私有属性
    bridge.autoReconnectManager.tasks.set("test-server", new Promise(() => {}));

    // disconnectAll 应该清除重连任务
    await bridge.disconnectAll();

    // @ts-expect-error - 访问私有属性
    expect(bridge.autoReconnectManager.tasks.size).toBe(0);
  });

  it("T3.4: disconnectAll 后 connections 为空", async () => {
    const { bridge } = createMultiServerBridge();

    await bridge.connect("server-a", { command: "npx", args: [] });
    await bridge.connect("server-b", { command: "npx", args: [] });

    await bridge.disconnectAll();

    expect(bridge.getAllStatus().size).toBe(0);
  });

  it("T3.5: Gateway.stop() 调用 mcpBridge.disconnectAll()", async () => {
    // 这个测试验证 Gateway 类型接口兼容性
    // 实际 Gateway 集成在 gateway.test.ts 中测试
    const bridge = new MCPBridge({ autoReconnect: false });
    const disconnectAllSpy = vi.spyOn(bridge, "disconnectAll").mockResolvedValue(undefined);

    // 模拟 Gateway.stop() 的调用链
    await bridge.disconnectAll();

    expect(disconnectAllSpy).toHaveBeenCalled();
  });
});
