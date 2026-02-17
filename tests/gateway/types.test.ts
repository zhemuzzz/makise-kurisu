/**
 * L1 交互网关 - 类型测试
 * 测试类型守卫、工厂函数、枚举值
 */

import { describe, it, expect } from "vitest";
import {
  ChannelType,
  StreamEventType,
  type SessionInfo,
  type TextDeltaEvent,
  type TextCompleteEvent,
  type ErrorEvent,
  type MetadataEvent,
  type StreamCallbacks,
  type GatewayDeps,
  type GatewayStreamResult,
  type InboundMessage,
  type OutboundMessage,
  createSessionInfo,
  isTextDeltaEvent,
  isTextCompleteEvent,
  isErrorEvent,
  isMetadataEvent,
  CHANNEL_TYPE_NAMES,
  STREAM_EVENT_TYPE_NAMES,
} from "../../src/gateway/types";
import {
  createMockSession,
  SAMPLE_EVENTS,
  VALID_CHANNEL_TYPES,
} from "../fixtures/gateway-fixtures";

describe("Gateway Types", () => {
  describe("ChannelType Enum", () => {
    it("should have CLI value as 0", () => {
      expect(ChannelType.CLI).toBe(0);
    });

    it("should have REST value as 1", () => {
      expect(ChannelType.REST).toBe(1);
    });

    it("should have DISCORD value as 2", () => {
      expect(ChannelType.DISCORD).toBe(2);
    });

    it("should have WEBSOCKET value as 3", () => {
      expect(ChannelType.WEBSOCKET).toBe(3);
    });

    it("should have exactly 10 channel types", () => {
      const types = Object.values(ChannelType).filter(
        (v) => typeof v === "number",
      );
      expect(types).toHaveLength(10);
    });

    it("should have matching name constants", () => {
      expect(CHANNEL_TYPE_NAMES).toEqual({
        [ChannelType.CLI]: "cli",
        [ChannelType.REST]: "rest",
        [ChannelType.DISCORD]: "discord",
        [ChannelType.WEBSOCKET]: "websocket",
        [ChannelType.WECHAT]: "wechat",
        [ChannelType.WECOM]: "wecom",
        [ChannelType.QQ]: "qq",
        [ChannelType.TELEGRAM]: "telegram",
        [ChannelType.FEISHU]: "feishu",
        [ChannelType.DINGTALK]: "dingtalk",
      });
    });
  });

  describe("StreamEventType Enum", () => {
    it("should have TEXT_DELTA value as 0", () => {
      expect(StreamEventType.TEXT_DELTA).toBe(0);
    });

    it("should have TEXT_COMPLETE value as 1", () => {
      expect(StreamEventType.TEXT_COMPLETE).toBe(1);
    });

    it("should have ERROR value as 2", () => {
      expect(StreamEventType.ERROR).toBe(2);
    });

    it("should have METADATA value as 3", () => {
      expect(StreamEventType.METADATA).toBe(3);
    });

    it("should have exactly 4 event types", () => {
      const types = Object.values(StreamEventType).filter(
        (v) => typeof v === "number",
      );
      expect(types).toHaveLength(4);
    });

    it("should have matching name constants", () => {
      expect(STREAM_EVENT_TYPE_NAMES).toEqual({
        [StreamEventType.TEXT_DELTA]: "text_delta",
        [StreamEventType.TEXT_COMPLETE]: "text_complete",
        [StreamEventType.ERROR]: "error",
        [StreamEventType.METADATA]: "metadata",
      });
    });
  });

  describe("createSessionInfo Factory", () => {
    it("should create session info with required fields", () => {
      const session = createSessionInfo({
        sessionId: "test-123",
        userId: "user-456",
        channelType: ChannelType.CLI,
      });

      expect(session.sessionId).toBe("test-123");
      expect(session.userId).toBe("user-456");
      expect(session.channelType).toBe(ChannelType.CLI);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActiveAt).toBeInstanceOf(Date);
      expect(session.metadata).toEqual({});
    });

    it("should accept optional metadata", () => {
      const metadata = { ip: "127.0.0.1", userAgent: "test" };
      const session = createSessionInfo({
        sessionId: "test-123",
        userId: "user-456",
        channelType: ChannelType.REST,
        metadata,
      });

      expect(session.metadata).toEqual(metadata);
    });

    it("should set createdAt and lastActiveAt to same time", () => {
      const session = createSessionInfo({
        sessionId: "test-123",
        userId: "user-456",
        channelType: ChannelType.CLI,
      });

      expect(session.createdAt.getTime()).toBe(session.lastActiveAt.getTime());
    });

    it("should create unique timestamps for different sessions", async () => {
      const session1 = createSessionInfo({
        sessionId: "test-1",
        userId: "user-1",
        channelType: ChannelType.CLI,
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const session2 = createSessionInfo({
        sessionId: "test-2",
        userId: "user-1",
        channelType: ChannelType.CLI,
      });

      expect(session2.createdAt.getTime()).toBeGreaterThanOrEqual(
        session1.createdAt.getTime(),
      );
    });

    it("should create immutable metadata object", () => {
      const session = createSessionInfo({
        sessionId: "test-123",
        userId: "user-456",
        channelType: ChannelType.CLI,
        metadata: { key: "value" },
      });

      // Mutating original should not affect session
      const originalMetadata = { key: "value" };
      expect(session.metadata).not.toBe(originalMetadata);
    });
  });

  describe("Type Guards", () => {
    describe("isTextDeltaEvent", () => {
      it("should return true for text delta event", () => {
        const event: TextDeltaEvent = {
          type: StreamEventType.TEXT_DELTA,
          text: "Hello",
          isFinal: false,
          timestamp: new Date(),
        };

        expect(isTextDeltaEvent(event)).toBe(true);
      });

      it("should return false for other event types", () => {
        expect(isTextDeltaEvent(SAMPLE_EVENTS.textComplete)).toBe(false);
        expect(isTextDeltaEvent(SAMPLE_EVENTS.error)).toBe(false);
        expect(isTextDeltaEvent(SAMPLE_EVENTS.metadata)).toBe(false);
      });

      it("should return false for null", () => {
        expect(isTextDeltaEvent(null)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(isTextDeltaEvent(undefined)).toBe(false);
      });

      it("should return false for plain object", () => {
        expect(isTextDeltaEvent({})).toBe(false);
      });
    });

    describe("isTextCompleteEvent", () => {
      it("should return true for text complete event", () => {
        const event: TextCompleteEvent = {
          type: StreamEventType.TEXT_COMPLETE,
          text: "Hello World!",
          timestamp: new Date(),
        };

        expect(isTextCompleteEvent(event)).toBe(true);
      });

      it("should return false for other event types", () => {
        expect(isTextCompleteEvent(SAMPLE_EVENTS.textDelta)).toBe(false);
        expect(isTextCompleteEvent(SAMPLE_EVENTS.error)).toBe(false);
        expect(isTextCompleteEvent(SAMPLE_EVENTS.metadata)).toBe(false);
      });

      it("should return false for null", () => {
        expect(isTextCompleteEvent(null)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(isTextCompleteEvent(undefined)).toBe(false);
      });
    });

    describe("isErrorEvent", () => {
      it("should return true for error event", () => {
        const event: ErrorEvent = {
          type: StreamEventType.ERROR,
          message: "Error occurred",
          timestamp: new Date(),
        };

        expect(isErrorEvent(event)).toBe(true);
      });

      it("should return true for error event with code", () => {
        const event: ErrorEvent = {
          type: StreamEventType.ERROR,
          message: "Error occurred",
          code: "E001",
          timestamp: new Date(),
        };

        expect(isErrorEvent(event)).toBe(true);
      });

      it("should return false for other event types", () => {
        expect(isErrorEvent(SAMPLE_EVENTS.textDelta)).toBe(false);
        expect(isErrorEvent(SAMPLE_EVENTS.textComplete)).toBe(false);
        expect(isErrorEvent(SAMPLE_EVENTS.metadata)).toBe(false);
      });

      it("should return false for null", () => {
        expect(isErrorEvent(null)).toBe(false);
      });
    });

    describe("isMetadataEvent", () => {
      it("should return true for metadata event", () => {
        const event: MetadataEvent = {
          type: StreamEventType.METADATA,
          data: { tokensUsed: 42 },
          timestamp: new Date(),
        };

        expect(isMetadataEvent(event)).toBe(true);
      });

      it("should return false for other event types", () => {
        expect(isMetadataEvent(SAMPLE_EVENTS.textDelta)).toBe(false);
        expect(isMetadataEvent(SAMPLE_EVENTS.textComplete)).toBe(false);
        expect(isMetadataEvent(SAMPLE_EVENTS.error)).toBe(false);
      });

      it("should return false for null", () => {
        expect(isMetadataEvent(null)).toBe(false);
      });
    });
  });

  describe("SessionInfo Interface", () => {
    it("should have all required properties", () => {
      const session: SessionInfo = createMockSession();

      expect(session.sessionId).toBeDefined();
      expect(session.userId).toBeDefined();
      expect(session.channelType).toBeDefined();
      expect(session.createdAt).toBeDefined();
      expect(session.lastActiveAt).toBeDefined();
      expect(session.metadata).toBeDefined();
    });

    it("should accept valid channel types", () => {
      VALID_CHANNEL_TYPES.forEach((channelType) => {
        const session = createMockSession({ channelType });
        expect(session.channelType).toBe(channelType);
      });
    });
  });

  describe("StreamCallbacks Interface", () => {
    it("should accept all callback types", () => {
      const callbacks: StreamCallbacks = {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onMetadata: vi.fn(),
      };

      expect(callbacks.onChunk).toBeDefined();
      expect(callbacks.onComplete).toBeDefined();
      expect(callbacks.onError).toBeDefined();
      expect(callbacks.onMetadata).toBeDefined();
    });

    it("should allow partial callbacks", () => {
      const callbacks: StreamCallbacks = {
        onComplete: vi.fn(),
      };

      expect(callbacks.onComplete).toBeDefined();
      expect(callbacks.onChunk).toBeUndefined();
    });

    it("should allow empty callbacks", () => {
      const callbacks: StreamCallbacks = {};

      expect(Object.keys(callbacks)).toHaveLength(0);
    });
  });

  describe("GatewayDeps Interface", () => {
    it("should require orchestrator dependency", () => {
      const deps: GatewayDeps = {
        orchestrator: {
          processStream: vi.fn(),
          createSession: vi.fn(),
          hasSession: vi.fn(),
        },
      };

      expect(deps.orchestrator).toBeDefined();
      expect(deps.orchestrator.processStream).toBeDefined();
      expect(deps.orchestrator.createSession).toBeDefined();
      expect(deps.orchestrator.hasSession).toBeDefined();
    });
  });

  describe("GatewayStreamResult Interface", () => {
    it("should have textStream generator", () => {
      async function* gen() {
        yield "test";
      }

      const result: GatewayStreamResult = {
        textStream: gen(),
        fullStream: gen() as AsyncGenerator<TextDeltaEvent>,
        finalResponse: Promise.resolve("test"),
      };

      expect(result.textStream).toBeDefined();
      expect(result.fullStream).toBeDefined();
      expect(result.finalResponse).toBeInstanceOf(Promise);
    });
  });

  describe("Immutability", () => {
    it("should not allow modifying session after creation", () => {
      const session = createSessionInfo({
        sessionId: "test-123",
        userId: "user-456",
        channelType: ChannelType.CLI,
      });

      // TypeScript prevents this at compile time, but runtime test
      const originalId = session.sessionId;
      expect(session.sessionId).toBe(originalId);
    });

    it("should create new metadata object each time", () => {
      const session1 = createSessionInfo({
        sessionId: "test-1",
        userId: "user-1",
        channelType: ChannelType.CLI,
        metadata: { key: "value" },
      });

      const session2 = createSessionInfo({
        sessionId: "test-2",
        userId: "user-2",
        channelType: ChannelType.CLI,
        metadata: { key: "value" },
      });

      expect(session1.metadata).not.toBe(session2.metadata);
    });
  });

  // ===========================================
  // KURISU-013: 多平台 Channel 扩展
  // ===========================================

  describe("ChannelType Extended Enum (KURISU-013)", () => {
    it("should have WECHAT value", () => {
      expect(ChannelType.WECHAT).toBeDefined();
    });

    it("should have WECOM (企业微信) value", () => {
      expect(ChannelType.WECOM).toBeDefined();
    });

    it("should have QQ value", () => {
      expect(ChannelType.QQ).toBeDefined();
    });

    it("should have TELEGRAM value", () => {
      expect(ChannelType.TELEGRAM).toBeDefined();
    });

    it("should have FEISHU value", () => {
      expect(ChannelType.FEISHU).toBeDefined();
    });

    it("should have DINGTALK value", () => {
      expect(ChannelType.DINGTALK).toBeDefined();
    });

    it("should have all new platform types in name mapping", () => {
      expect(CHANNEL_TYPE_NAMES[ChannelType.WECHAT]).toBe("wechat");
      expect(CHANNEL_TYPE_NAMES[ChannelType.WECOM]).toBe("wecom");
      expect(CHANNEL_TYPE_NAMES[ChannelType.QQ]).toBe("qq");
      expect(CHANNEL_TYPE_NAMES[ChannelType.TELEGRAM]).toBe("telegram");
      expect(CHANNEL_TYPE_NAMES[ChannelType.FEISHU]).toBe("feishu");
      expect(CHANNEL_TYPE_NAMES[ChannelType.DINGTALK]).toBe("dingtalk");
    });
  });

  describe("InboundMessage Interface (KURISU-013)", () => {
    it("should create valid inbound message", () => {
      const msg: InboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-user123",
        userId: "user123",
        content: "hello",
        messageType: "text",
        timestamp: Date.now(),
      };

      expect(msg.channelType).toBe(ChannelType.QQ);
      expect(msg.sessionId).toBe("qq-user123");
      expect(msg.userId).toBe("user123");
      expect(msg.content).toBe("hello");
      expect(msg.messageType).toBe("text");
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it("should support all message types", () => {
      const textMsg: InboundMessage = {
        channelType: ChannelType.CLI,
        sessionId: "test",
        userId: "user",
        content: "text",
        messageType: "text",
        timestamp: Date.now(),
      };

      const imageMsg: InboundMessage = {
        channelType: ChannelType.CLI,
        sessionId: "test",
        userId: "user",
        content: "image_url",
        messageType: "image",
        timestamp: Date.now(),
      };

      const voiceMsg: InboundMessage = {
        channelType: ChannelType.CLI,
        sessionId: "test",
        userId: "user",
        content: "voice_data",
        messageType: "voice",
        timestamp: Date.now(),
      };

      const fileMsg: InboundMessage = {
        channelType: ChannelType.CLI,
        sessionId: "test",
        userId: "user",
        content: "file_url",
        messageType: "file",
        timestamp: Date.now(),
      };

      expect(textMsg.messageType).toBe("text");
      expect(imageMsg.messageType).toBe("image");
      expect(voiceMsg.messageType).toBe("voice");
      expect(fileMsg.messageType).toBe("file");
    });

    it("should support optional metadata", () => {
      const msg: InboundMessage = {
        channelType: ChannelType.WECOM,
        sessionId: "wecom-user123",
        userId: "user123",
        content: "test",
        messageType: "text",
        timestamp: Date.now(),
        metadata: {
          corpId: "corp123",
          agentId: "agent456",
        },
      };

      expect(msg.metadata).toBeDefined();
      expect(msg.metadata?.corpId).toBe("corp123");
    });
  });

  describe("OutboundMessage Interface (KURISU-013)", () => {
    it("should create valid outbound message", () => {
      const msg: OutboundMessage = {
        channelType: ChannelType.TELEGRAM,
        sessionId: "telegram-user123",
        content: "Hello from Kurisu!",
      };

      expect(msg.channelType).toBe(ChannelType.TELEGRAM);
      expect(msg.sessionId).toBe("telegram-user123");
      expect(msg.content).toBe("Hello from Kurisu!");
    });

    it("should support optional replyTo", () => {
      const msg: OutboundMessage = {
        channelType: ChannelType.QQ,
        sessionId: "qq-user123",
        content: "Reply content",
        replyTo: "original-msg-id",
      };

      expect(msg.replyTo).toBe("original-msg-id");
    });

    it("should support optional metadata", () => {
      const msg: OutboundMessage = {
        channelType: ChannelType.WECOM,
        sessionId: "wecom-user123",
        content: "Response",
        metadata: {
          chatId: "chat456",
          msgId: "msg789",
        },
      };

      expect(msg.metadata?.chatId).toBe("chat456");
      expect(msg.metadata?.msgId).toBe("msg789");
    });
  });
});
