/**
 * TelegramChannel 测试
 * @description KURISU-013 Phase 2 Telegram 接入
 *             Phase 2.1 Gateway 集成
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import * as http from "http";
import {
  TelegramChannel,
  type TelegramConfig,
} from "../../../src/gateway/channels/telegram";
import {
  ChannelType,
  type InboundMessage,
  type OutboundMessage,
  type GatewayStreamResult,
} from "../../../src/gateway/types";

// ===========================================
// Mock Gateway
// ===========================================

/**
 * 创建 Mock Gateway
 * @description 用于测试 Gateway 集成
 */
function createMockGateway(
  responseText: string = "哼，这种事情我早就知道了。",
) {
  return {
    processStream: vi.fn().mockImplementation(async () => {
      // 创建 mock textStream
      async function* textStream() {
        yield responseText;
      }

      // 创建 mock fullStream
      async function* fullStream() {
        yield {
          type: 0, // TEXT_DELTA
          text: responseText,
          isFinal: false,
          timestamp: new Date(),
        };
      }

      const result: GatewayStreamResult = {
        textStream: textStream(),
        fullStream: fullStream(),
        finalResponse: Promise.resolve(responseText),
      };

      return result;
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(true),
    getSession: vi.fn().mockReturnValue(null),
    createSession: vi.fn().mockResolvedValue({
      sessionId: "telegram-999888777",
      userId: "999888777",
      channelType: ChannelType.TELEGRAM,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      metadata: {},
    }),
  };
}

// Mock fetch for sendMessage
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("TelegramChannel", () => {
  let channel: TelegramChannel;
  const defaultConfig: TelegramConfig = {
    botToken: "test-bot-token-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    channel = new TelegramChannel(defaultConfig);
  });

  describe("基础属性", () => {
    it("应该返回正确的 channelType", () => {
      expect(channel.channelType).toBe(ChannelType.TELEGRAM);
    });

    it("应该返回正确的路由定义", () => {
      const routes = channel.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0]).toEqual({
        method: "POST",
        path: "/telegram/webhook",
      });
    });

    it("verifySignature 应该返回 true", () => {
      expect(channel.verifySignature({})).toBe(true);
      expect(channel.verifySignature(null)).toBe(true);
    });
  });

  describe("handleRequest", () => {
    const createMockReq = (
      body: unknown,
    ): http.IncomingMessage & { body: unknown } => {
      return {
        body,
        headers: {},
        method: "POST",
        url: "/telegram/webhook",
      } as http.IncomingMessage & { body: unknown };
    };

    const createMockRes = () => {
      const res = {
        statusCode: 0,
        _headers: {} as Record<string, string>,
        _body: "",
        writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
          res.statusCode = code;
          if (headers) {
            Object.assign(res._headers, headers);
          }
          return res;
        }),
        end: vi.fn((data?: string) => {
          res._body = data ?? "";
          return res;
        }),
      };
      return res as unknown as http.ServerResponse;
    };

    it("应该正确处理文本消息", async () => {
      const update = {
        update_id: 12345,
        message: {
          message_id: 1,
          from: {
            id: 111222333,
            is_bot: false,
            first_name: "Test",
            username: "testuser",
          },
          chat: {
            id: 111222333,
            type: "private",
          },
          text: "Hello Kurisu!",
          date: 1700000000,
        },
      };

      const req = createMockReq(update);
      const res = createMockRes();

      await channel.handleRequest(req, res);

      // 应该返回 200
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      expect(res.end).toHaveBeenCalled();
    });

    it("应该忽略非文本消息", async () => {
      const update = {
        update_id: 12346,
        message: {
          message_id: 2,
          from: {
            id: 111222333,
            is_bot: false,
            first_name: "Test",
          },
          chat: {
            id: 111222333,
            type: "private",
          },
          // 没有 text 字段
          photo: [
            { file_id: "abc", file_unique_id: "def", width: 100, height: 100 },
          ],
          date: 1700000001,
        },
      };

      const req = createMockReq(update);
      const res = createMockRes();

      await channel.handleRequest(req, res);

      // 应该返回 200 但不处理
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
    });

    it("应该处理无效的请求体", async () => {
      const req = createMockReq(null);
      const res = createMockRes();

      await channel.handleRequest(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, {
        "Content-Type": "application/json",
      });
    });

    it("应该处理没有 message 的 update", async () => {
      const update = {
        update_id: 12347,
        // 没有 message
      };

      const req = createMockReq(update);
      const res = createMockRes();

      await channel.handleRequest(req, res);

      // 应该返回 200 (忽略)
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
    });
  });

  describe("sendMessage", () => {
    it("应该成功发送消息", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 100 } }),
      });

      const message: OutboundMessage = {
        channelType: ChannelType.TELEGRAM,
        sessionId: "telegram-111222333",
        content: "哼，这种事情我早就知道了。",
      };

      await channel.sendMessage(message);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token-123/sendMessage",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("哼，这种事情我早就知道了。"),
        }),
      );
    });

    it("应该从 sessionId 提取 chat_id", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 101 } }),
      });

      const message: OutboundMessage = {
        channelType: ChannelType.TELEGRAM,
        sessionId: "telegram-123456789",
        content: "测试消息",
      };

      await channel.sendMessage(message);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.chat_id).toBe("123456789");
    });

    it("应该处理发送失败", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden: bot was blocked by the user",
      });

      const message: OutboundMessage = {
        channelType: ChannelType.TELEGRAM,
        sessionId: "telegram-111222333",
        content: "测试",
      };

      // 不应该抛出异常
      await expect(channel.sendMessage(message)).resolves.not.toThrow();
    });

    it("应该处理网络错误", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const message: OutboundMessage = {
        channelType: ChannelType.TELEGRAM,
        sessionId: "telegram-111222333",
        content: "测试",
      };

      // 不应该抛出异常
      await expect(channel.sendMessage(message)).resolves.not.toThrow();
    });
  });

  describe("生命周期", () => {
    it("initialize 应该设置 isReady", async () => {
      expect(channel["isReady"]).toBe(false);
      await channel.initialize();
      expect(channel["isReady"]).toBe(true);
    });

    it("shutdown 应该清除 isReady", async () => {
      await channel.initialize();
      expect(channel["isReady"]).toBe(true);
      await channel.shutdown();
      expect(channel["isReady"]).toBe(false);
    });

    it("healthCheck 应该返回 isReady 状态", async () => {
      expect(await channel.healthCheck()).toBe(false);
      await channel.initialize();
      expect(await channel.healthCheck()).toBe(true);
    });
  });

  describe("消息格式转换", () => {
    it("应该正确构建 InboundMessage", async () => {
      const update = {
        update_id: 12348,
        message: {
          message_id: 5,
          from: {
            id: 999888777,
            is_bot: false,
            first_name: "Okabe",
            last_name: "Rintaro",
            username: "okarin",
          },
          chat: {
            id: 999888777,
            type: "private",
          },
          text: "@Kurisu 你好",
          date: 1700000002,
        },
      };

      const req = {
        body: update,
        headers: {},
      } as http.IncomingMessage & { body: unknown };
      const res = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as unknown as http.ServerResponse;

      await channel.handleRequest(req, res);

      // 验证 lastInboundMessage 被正确构建
      expect(channel.lastInboundMessage).toBeDefined();
      expect(channel.lastInboundMessage?.sessionId).toBe("telegram-999888777");
      expect(channel.lastInboundMessage?.userId).toBe("999888777");
      expect(channel.lastInboundMessage?.content).toBe("@Kurisu 你好");
      expect(channel.lastInboundMessage?.channelType).toBe(
        ChannelType.TELEGRAM,
      );
      expect(channel.lastInboundMessage?.messageType).toBe("text");
      expect(channel.lastInboundMessage?.metadata?.telegram).toEqual({
        message_id: 5,
        chat_type: "private",
        username: "okarin",
        first_name: "Okabe",
      });
    });
  });

  // ===========================================
  // Phase 2.1: Gateway 集成测试
  // ===========================================

  describe("Gateway 集成", () => {
    const createMockReq = (
      body: unknown,
    ): http.IncomingMessage & { body: unknown } => {
      return {
        body,
        headers: {},
        method: "POST",
        url: "/telegram/webhook",
      } as http.IncomingMessage & { body: unknown };
    };

    const createMockRes = () => {
      const res = {
        statusCode: 0,
        _headers: {} as Record<string, string>,
        _body: "",
        writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
          res.statusCode = code;
          if (headers) {
            Object.assign(res._headers, headers);
          }
          return res;
        }),
        end: vi.fn((data?: string) => {
          res._body = data ?? "";
          return res;
        }),
      };
      return res as unknown as http.ServerResponse;
    };

    it("应该接受 gateway 配置", () => {
      const mockGateway = createMockGateway();
      const configWithGateway: TelegramConfig = {
        botToken: "test-bot-token-123",
        gateway: mockGateway as unknown as { processStream: unknown },
      };

      const channelWithGateway = new TelegramChannel(configWithGateway);
      expect(channelWithGateway).toBeDefined();
      expect(channelWithGateway.channelType).toBe(ChannelType.TELEGRAM);
    });

    it("应该调用 Gateway.processStream 处理消息", async () => {
      const mockGateway = createMockGateway("哼，你在说什么呢。");
      const configWithGateway: TelegramConfig = {
        botToken: "test-bot-token-123",
        gateway: mockGateway as unknown as { processStream: unknown },
      };

      const channelWithGateway = new TelegramChannel(configWithGateway);

      const update = {
        update_id: 20001,
        message: {
          message_id: 10,
          from: {
            id: 123456789,
            is_bot: false,
            first_name: "TestUser",
          },
          chat: {
            id: 123456789,
            type: "private",
          },
          text: "你好 Kurisu",
          date: 1700000100,
        },
      };

      const req = createMockReq(update);
      const res = createMockRes();

      // Mock sendMessage 的 fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 11 } }),
      });

      await channelWithGateway.handleRequest(req, res);

      // 验证 Gateway.processStream 被调用
      expect(mockGateway.processStream).toHaveBeenCalledWith(
        "telegram-123456789", // sessionId
        "你好 Kurisu", // input
        "123456789", // userId
      );
    });

    it("应该发送 Gateway 响应到 Telegram", async () => {
      const expectedResponse = "哼，这种事情我早就知道了。";
      const mockGateway = createMockGateway(expectedResponse);
      const configWithGateway: TelegramConfig = {
        botToken: "test-bot-token-123",
        gateway: mockGateway as unknown as { processStream: unknown },
      };

      const channelWithGateway = new TelegramChannel(configWithGateway);

      const update = {
        update_id: 20002,
        message: {
          message_id: 12,
          from: {
            id: 987654321,
            is_bot: false,
            first_name: "Okarin",
          },
          chat: {
            id: 987654321,
            type: "private",
          },
          text: "你是谁？",
          date: 1700000200,
        },
      };

      const req = createMockReq(update);
      const res = createMockRes();

      // Mock sendMessage 的 fetch
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, result: { message_id: 13 } }),
      });

      await channelWithGateway.handleRequest(req, res);

      // 验证 sendMessage 被调用，内容是 Gateway 的响应
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-bot-token-123/sendMessage",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(expectedResponse),
        }),
      );
    });

    it("没有 Gateway 时应该返回基础响应（向后兼容）", async () => {
      // 没有 gateway 的配置（旧行为）
      const configNoGateway: TelegramConfig = {
        botToken: "test-bot-token-123",
      };

      const channelNoGateway = new TelegramChannel(configNoGateway);

      const update = {
        update_id: 20003,
        message: {
          message_id: 14,
          from: {
            id: 111222333,
            is_bot: false,
            first_name: "Test",
          },
          chat: {
            id: 111222333,
            type: "private",
          },
          text: "Hello",
          date: 1700000300,
        },
      };

      const req = createMockReq(update);
      const res = createMockRes();

      await channelNoGateway.handleRequest(req, res);

      // 应该返回 200，但不调用 Telegram API
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("Gateway 错误时应该优雅处理", async () => {
      const mockGateway = {
        processStream: vi.fn().mockRejectedValue(new Error("Gateway error")),
      };
      const configWithGateway: TelegramConfig = {
        botToken: "test-bot-token-123",
        gateway: mockGateway as unknown as { processStream: unknown },
      };

      const channelWithGateway = new TelegramChannel(configWithGateway);

      const update = {
        update_id: 20004,
        message: {
          message_id: 15,
          from: {
            id: 555666777,
            is_bot: false,
            first_name: "Error",
          },
          chat: {
            id: 555666777,
            type: "private",
          },
          text: "触发错误",
          date: 1700000400,
        },
      };

      const req = createMockReq(update);
      const res = createMockRes();

      // 不应该抛出异常
      await expect(
        channelWithGateway.handleRequest(req, res),
      ).resolves.not.toThrow();

      // 设计决策：先返回 200 避免 Telegram 超时，Gateway 错误不改变 HTTP 状态
      // 错误会被记录但不会传播给 Telegram
      expect(res.writeHead).toHaveBeenCalledWith(200, {
        "Content-Type": "application/json",
      });
    });
  });
});
