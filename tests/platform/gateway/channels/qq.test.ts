/**
 * QQChannel 测试
 * @description KURISU-013 Phase 3 QQ Bot 接入 (NapCat + OneBot11 Polling)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QQChannel, type QQConfig } from "../../../../src/platform/gateway/channels/qq";
import {
  ChannelType,
  type OutboundMessage,
  type GatewayStreamResult,
} from "../../../../src/platform/gateway/types";

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
    // 审批相关方法的 mock
    checkApprovalReply: vi.fn().mockResolvedValue({
      isApprovalReply: false,
    }),
    executeApprovedTool: vi.fn().mockResolvedValue("工具执行完成"),
    // KURISU-020: 目录切换审批
    handleChangeDirApprovalReply: vi.fn().mockResolvedValue({
      isApprovalReply: false,
    }),
    // KURISU-021: 权限切换审批
    handleChangePermissionApprovalReply: vi.fn().mockResolvedValue({
      isApprovalReply: false,
    }),
    // KURISU-023: 删除确认审批
    handleChangeDeleteConfirmApprovalReply: vi.fn().mockResolvedValue({
      isApprovalReply: false,
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
    it("initialize 应该完成（Reverse HTTP 模式）", async () => {
      await channel.initialize();
      // Reverse HTTP 模式不需要 polling，只需 initialize 成功
    });

    it("shutdown 应该正常完成", async () => {
      await channel.initialize();
      await channel.shutdown();
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

    it("应该正确处理群聊消息事件（含 @Bot）", async () => {
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
        message: [
          { type: "at", data: { qq: "111111" } },
          { type: "text", data: { text: "群消息" } },
        ],
        raw_message: "[CQ:at,qq=111111] 群消息",
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
      // KURISU-034: CQ 码应该被清理
      expect(channel.lastInboundMessage?.content).toBe("群消息");
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

  // KURISU-034: @Bot 过滤 + CQ 码清理测试
  describe("群聊 @Bot 过滤", () => {
    it("群聊消息没有 @Bot 时不应该响应", async () => {
      const mockGateway = createMockGateway();
      channel.setGateway(mockGateway);

      const event = {
        time: 1700000500,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "group" as const,
        sub_type: "normal",
        user_id: 123456789,
        group_id: 987654321,
        message_id: "msg010",
        message: [{ type: "text", data: { text: "普通群消息" } }],
        raw_message: "普通群消息",
      };

      await channel.testHandleEvent(event);

      // 不应该调用 Gateway
      expect(mockGateway.processStream).not.toHaveBeenCalled();
      expect(channel.lastInboundMessage).toBeUndefined();
    });

    it("群聊消息 @Bot 时应该响应", async () => {
      const mockGateway = createMockGateway("收到");
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply_at" },
          }),
      });

      const event = {
        time: 1700000501,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "group" as const,
        sub_type: "normal",
        user_id: 123456789,
        group_id: 987654321,
        message_id: "msg011",
        message: [
          { type: "at", data: { qq: "111111" } },
          { type: "text", data: { text: " 帮我查天气" } },
        ],
        raw_message: "[CQ:at,qq=111111] 帮我查天气",
      };

      await channel.testHandleEvent(event);

      // 应该调用 Gateway
      expect(mockGateway.processStream).toHaveBeenCalledWith(
        "qq-group-987654321",
        "帮我查天气",
        "123456789",
      );
    });

    it("群聊消息 @其他人 时不应该响应", async () => {
      const mockGateway = createMockGateway();
      channel.setGateway(mockGateway);

      const event = {
        time: 1700000502,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "group" as const,
        sub_type: "normal",
        user_id: 123456789,
        group_id: 987654321,
        message_id: "msg012",
        message: [
          { type: "at", data: { qq: "999999" } },
          { type: "text", data: { text: " 你好" } },
        ],
        raw_message: "[CQ:at,qq=999999] 你好",
      };

      await channel.testHandleEvent(event);

      expect(mockGateway.processStream).not.toHaveBeenCalled();
    });

    it("私聊消息始终响应（无需 @Bot）", async () => {
      const mockGateway = createMockGateway("私聊回复");
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply_pm" },
          }),
      });

      const event = {
        time: 1700000503,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "private" as const,
        sub_type: "friend",
        user_id: 555666777,
        message_id: "msg013",
        message: "私聊消息",
        raw_message: "私聊消息",
      };

      await channel.testHandleEvent(event);

      expect(mockGateway.processStream).toHaveBeenCalled();
    });
  });

  describe("CQ 码清理", () => {
    it("应该清理 raw_message 中的 CQ 码", async () => {
      const mockGateway = createMockGateway("收到");
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply_cq" },
          }),
      });

      const event = {
        time: 1700000600,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "private" as const,
        sub_type: "friend",
        user_id: 123456789,
        message_id: "msg020",
        message: "[CQ:face,id=178]你好呀[CQ:image,file=abc.jpg]",
        raw_message: "[CQ:face,id=178]你好呀[CQ:image,file=abc.jpg]",
      };

      await channel.testHandleEvent(event);

      expect(channel.lastInboundMessage?.content).toBe("你好呀");
    });

    it("应该清理群聊 @Bot CQ 码后保留干净文本", async () => {
      const mockGateway = createMockGateway("收到");
      channel.setGateway(mockGateway);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "ok",
            retcode: 0,
            data: { message_id: "reply_cq2" },
          }),
      });

      const event = {
        time: 1700000601,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "group" as const,
        sub_type: "normal",
        user_id: 123456789,
        group_id: 987654321,
        message_id: "msg021",
        message: [
          { type: "at", data: { qq: "111111" } },
          { type: "text", data: { text: " 帮我写代码" } },
          { type: "face", data: { id: "178" } },
        ],
        raw_message: "[CQ:at,qq=111111] 帮我写代码[CQ:face,id=178]",
      };

      await channel.testHandleEvent(event);

      // CQ 码应该被清理，只留纯文本
      expect(channel.lastInboundMessage?.content).toBe("帮我写代码");
    });

    it("纯 CQ 码消息清理后为空字符串", async () => {
      const mockGateway = createMockGateway();
      channel.setGateway(mockGateway);

      const event = {
        time: 1700000602,
        self_id: 111111,
        post_type: "message" as const,
        message_type: "private" as const,
        sub_type: "friend",
        user_id: 123456789,
        message_id: "msg022",
        message: "[CQ:image,file=abc.jpg]",
        raw_message: "[CQ:image,file=abc.jpg]",
      };

      await channel.testHandleEvent(event);

      expect(channel.lastInboundMessage?.content).toBe("");
    });
  });
});
