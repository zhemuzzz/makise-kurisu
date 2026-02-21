/**
 * QQChannel 测试
 * @description KURISU-013 Phase 3 QQ Bot 接入 (NapCat + OneBot11 Polling)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QQChannel, type QQConfig } from "../../../src/gateway/channels/qq";
import {
  ChannelType,
  type OutboundMessage,
  type GatewayStreamResult,
} from "../../../src/gateway/types";

// ===========================================
// Mock Gateway
// ===========================================

/**
 * 创建 Mock Gateway
 */
function createMockGateway(
  responseText: string = "哼，这种事情我早就知道了。",
) {
  return {
    processStream: vi.fn().mockImplementation(async () => {
      async function* textStream() {
        yield responseText;
      }

      async function* fullStream() {
        yield {
          type: 0,
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
  };
}

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("QQChannel", () => {
  let channel: QQChannel;
  const defaultConfig: QQConfig = {
    httpUrl: "http://localhost:3001",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    channel = new QQChannel(defaultConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("基础属性", () => {
    it("应该返回正确的 channelType", () => {
      expect(channel.channelType).toBe(ChannelType.QQ);
    });

    it("应该返回 QQ 事件路由（Reverse HTTP 模式）", () => {
      const routes = channel.getRoutes();
      expect(routes).toHaveLength(1);
      expect(routes[0]).toEqual({ method: "POST", path: "/qq/event" });
    });

    it("verifySignature 应该返回 true", () => {
      expect(channel.verifySignature({})).toBe(true);
    });
  });

  describe("配置", () => {
    it("应该使用默认 pollInterval", () => {
      const c = new QQChannel({ httpUrl: "http://test:3001" });
      expect(c).toBeDefined();
    });

    it("应该接受自定义配置", () => {
      const customConfig: QQConfig = {
        httpUrl: "http://custom:4001",
        accessToken: "test-token",
        pollInterval: 2000,
        timeout: 10000,
      };
      const c = new QQChannel(customConfig);
      expect(c).toBeDefined();
    });
  });

  describe("sendMessage", () => {
    it("应该成功发送私聊消息", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "abc123" },
          }),
      });

      const message: OutboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-private-123456789",
        content: "哼，这种事情我早就知道了。",
      };

      await channel.sendMessage(message);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/send_private_msg",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.user_id).toBe(123456789);
      expect(callBody.message).toBe("哼，这种事情我早就知道了。");
    });

    it("应该成功发送群聊消息", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "def456" },
          }),
      });

      const message: OutboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-group-987654321",
        content: "群里大家好",
      };

      await channel.sendMessage(message);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/send_group_msg",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.group_id).toBe(987654321);
    });

    it("应该携带 access_token", async () => {
      const configWithToken: QQConfig = {
        httpUrl: "http://localhost:3001",
        accessToken: "my-secret-token",
      };
      const c = new QQChannel(configWithToken);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: {},
          }),
      });

      const message: OutboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-private-123",
        content: "test",
      };

      await c.sendMessage(message);

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/send_private_msg",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer my-secret-token",
          }),
        }),
      );
    });

    it("应该处理发送失败", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "failed",
            retcode: 100,
            message: "user not found",
          }),
      });

      const message: OutboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-private-999",
        content: "test",
      };

      // 不应该抛出异常
      await expect(channel.sendMessage(message)).resolves.not.toThrow();
    });

    it("应该处理网络错误", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const message: OutboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-private-123",
        content: "test",
      };

      // 不应该抛出异常
      await expect(channel.sendMessage(message)).resolves.not.toThrow();
    });
  });

  describe("生命周期", () => {
    it("initialize 应该启动 polling", async () => {
      // Mock get_latest_events 返回空事件
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { events: [] },
          }),
      });

      await channel.initialize();
      expect(channel["polling"]).toBe(true);

      // 清理
      await channel.shutdown();
    });

    it("shutdown 应该停止 polling", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { events: [] },
          }),
      });

      await channel.initialize();
      expect(channel["polling"]).toBe(true);

      await channel.shutdown();
      expect(channel["polling"]).toBe(false);
    });
  });

  describe("事件处理", () => {
    it("应该正确处理私聊消息事件", async () => {
      const mockGateway = createMockGateway("测试回复");
      channel.setGateway(mockGateway);

      // Mock sendMessage
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply123" },
          }),
      });

      const event = {
        time: 1700000000,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "private" as const,
        sub_type: "friend",
        user_id: 123456789,
        message_id: "msg001",
        message: [{ type: "text", data: { text: "你好" } }],
        raw_message: "你好",
        sender: {
          user_id: 123456789,
          nickname: "测试用户",
        },
      };

      await channel.testHandleEvent(event);

      expect(channel.lastInboundMessage).toBeDefined();
      expect(channel.lastInboundMessage?.sessionId).toBe(
        "qq-private-123456789",
      );
      expect(channel.lastInboundMessage?.userId).toBe("123456789");
      expect(channel.lastInboundMessage?.content).toBe("你好");
      expect(channel.lastInboundMessage?.channelType).toBe(ChannelType.QQ);
    });

    it("应该正确处理群聊消息事件", async () => {
      const mockGateway = createMockGateway("群里回复");
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply456" },
          }),
      });

      const event = {
        time: 1700000100,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "group" as const,
        sub_type: "normal",
        user_id: 123456789,
        group_id: 987654321,
        message_id: "msg002",
        message: [{ type: "text", data: { text: "群消息" } }],
        raw_message: "群消息",
        sender: {
          user_id: 123456789,
          nickname: "群成员",
          card: "群名片",
        },
      };

      await channel.testHandleEvent(event);

      expect(channel.lastInboundMessage?.sessionId).toBe("qq-group-987654321");
      expect(channel.lastInboundMessage?.metadata?.qq?.group_id).toBe(
        987654321,
      );
    });

    it("应该忽略非消息事件", async () => {
      const mockGateway = createMockGateway();
      channel.setGateway(mockGateway);

      // 非消息事件
      const event = {
        time: 1700000200,
        self_id: 111111,
        post_type: "notice",
        notice_type: "group_increase",
        group_id: 123456,
        user_id: 789012,
      };

      await channel.testHandleEvent(event);

      // 不应该调用 Gateway
      expect(mockGateway.processStream).not.toHaveBeenCalled();
      expect(channel.lastInboundMessage).toBeUndefined();
    });

    it("应该调用 Gateway 并发送回复", async () => {
      const expectedResponse = "这是 Kurisu 的回复";
      const mockGateway = createMockGateway(expectedResponse);
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply789" },
          }),
      });

      const event = {
        time: 1700000300,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "private" as const,
        sub_type: "friend",
        user_id: 555666777,
        message_id: "msg003",
        message: "你是谁？",
        raw_message: "你是谁？",
      };

      await channel.testHandleEvent(event);

      // 验证 Gateway 被调用
      expect(mockGateway.processStream).toHaveBeenCalledWith(
        "qq-private-555666777",
        "你是谁？",
        "555666777",
      );

      // 验证 sendMessage 被调用
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/send_private_msg",
        expect.objectContaining({
          body: expect.stringContaining(expectedResponse),
        }),
      );
    });

    it("Gateway 错误时应该优雅处理", async () => {
      const mockGateway = {
        processStream: vi.fn().mockRejectedValue(new Error("Gateway error")),
      };
      channel.setGateway(mockGateway);

      const event = {
        time: 1700000400,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "private" as const,
        sub_type: "friend",
        user_id: 111222333,
        message_id: "msg004",
        message: "触发错误",
        raw_message: "触发错误",
      };

      // 不应该抛出异常
      await expect(channel.testHandleEvent(event)).resolves.not.toThrow();
    });
  });

  describe("Polling 逻辑", () => {
    it("pollEvents 应该调用 get_latest_events API", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { events: [] },
          }),
      });

      await channel["pollEvents"]();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/get_latest_events",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"limit"'),
        }),
      );
    });

    it("pollEvents 应该处理多个事件", async () => {
      const mockGateway = createMockGateway();
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: {
              events: [
                {
                  time: 1700000500,
                  self_id: 111111,
                  post_type: "message",
                  message_type: "private",
                  sub_type: "friend",
                  user_id: 111,
                  message_id: "m1",
                  message: "消息1",
                  raw_message: "消息1",
                },
                {
                  time: 1700000501,
                  self_id: 111111,
                  post_type: "message",
                  message_type: "private",
                  sub_type: "friend",
                  user_id: 222,
                  message_id: "m2",
                  message: "消息2",
                  raw_message: "消息2",
                },
              ],
            },
          }),
      });

      // Mock sendMessage
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply" },
          }),
      });

      await channel["pollEvents"]();

      // 应该处理两个消息事件
      expect(mockGateway.processStream).toHaveBeenCalledTimes(2);
    });
  });
});
