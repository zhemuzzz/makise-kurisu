/**
 * TelegramChannel 测试
 * @description KURISU-013 Phase 2 Telegram 接入
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
} from "../../../src/gateway/types";

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
});
