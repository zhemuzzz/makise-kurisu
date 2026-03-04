/**
 * ToolRegistry 连接失败重试测试
 *
 * KURISU-029 Phase 5
 */

import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../../../src/platform/tools/registry";
import type { MCPBridge } from "../../../src/platform/tools/mcp-bridge";
import type { ToolDef, ToolCall } from "../../../src/platform/tools/types";

// ============================================
// Mock 工厂
// ============================================

function createMockMCPBridge(overrides: Partial<MCPBridge> = {}): MCPBridge {
  return {
    callTool: vi.fn().mockResolvedValue("result"),
    reconnect: vi.fn().mockResolvedValue({}),
    listTools: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockReturnValue("connected"),
    ...overrides,
  } as unknown as MCPBridge;
}

function createMCPToolDef(name: string, serverName: string): ToolDef {
  return {
    name,
    description: `Test tool: ${name}`,
    inputSchema: { type: "object", properties: {} },
    permission: "safe",
    source: { type: "mcp", serverName },
  };
}

function createToolCall(name: string): ToolCall {
  return {
    id: `call-${name}`,
    name,
    arguments: {},
  };
}

// ============================================
// 测试
// ============================================

describe("KURISU-029 Phase 5: ToolRegistry 连接失败重试", () => {
  it("T5.3: callTool 连接失败自动重连重试", async () => {
    const callToolFn = vi.fn()
      .mockRejectedValueOnce(new Error("MCP server not connected: test-server"))
      .mockResolvedValueOnce("success result");

    const mcpBridge = createMockMCPBridge({ callTool: callToolFn });
    const registry = new ToolRegistry({ mcpBridge });

    // 注册 MCP 工具
    registry.register(createMCPToolDef("test-tool", "test-server"));

    const result = await registry.execute(createToolCall("test-tool"));

    // 应该重连后重试成功
    expect(result.success).toBe(true);
    expect(result.output).toBe("success result");
    expect(mcpBridge.reconnect).toHaveBeenCalledWith("test-server");
    expect(callToolFn).toHaveBeenCalledTimes(2);
  });

  it("T5.4: 非连接错误不重试", async () => {
    const callToolFn = vi.fn()
      .mockRejectedValueOnce(new Error("Tool execution error: invalid args"));

    const mcpBridge = createMockMCPBridge({ callTool: callToolFn });
    const registry = new ToolRegistry({ mcpBridge });

    registry.register(createMCPToolDef("test-tool", "test-server"));

    const result = await registry.execute(createToolCall("test-tool"));

    // 非连接错误不应该重试
    expect(result.success).toBe(false);
    expect(mcpBridge.reconnect).not.toHaveBeenCalled();
    expect(callToolFn).toHaveBeenCalledTimes(1);
  });

  it("T5.5: 重试后仍失败抛出原始错误", async () => {
    const callToolFn = vi.fn()
      .mockRejectedValue(new Error("MCP server not connected: test-server"));

    const reconnectFn = vi.fn().mockResolvedValue({});
    const mcpBridge = createMockMCPBridge({
      callTool: callToolFn,
      reconnect: reconnectFn,
    });
    const registry = new ToolRegistry({ mcpBridge });

    registry.register(createMCPToolDef("test-tool", "test-server"));

    const result = await registry.execute(createToolCall("test-tool"));

    // 重试后仍然失败
    expect(result.success).toBe(false);
    expect(result.error).toContain("MCP server not connected");
    expect(reconnectFn).toHaveBeenCalledWith("test-server");
    expect(callToolFn).toHaveBeenCalledTimes(2); // 原始 + 重试
  });
});
