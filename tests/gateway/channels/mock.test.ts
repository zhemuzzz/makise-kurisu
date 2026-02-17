/**
 * MockChannel 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockChannel, MockConfig } from '../../../src/gateway/channels/mock';
import { ChannelType, InboundMessage, OutboundMessage } from '../../../src/gateway/types';

describe('MockChannel', () => {
  let channel: MockChannel;

  describe('构造函数', () => {
    it('应该使用默认配置创建实例', () => {
      channel = new MockChannel();
      expect(channel).toBeDefined();
      expect(channel.channelType).toBe(ChannelType.CLI);
    });

    it('应该接受自定义配置', () => {
      const config: MockConfig = {
        echo: true,
        timeout: 10000,
      };
      channel = new MockChannel(config);
      expect(channel).toBeDefined();
    });
  });

  describe('initialize 和 healthCheck', () => {
    beforeEach(() => {
      channel = new MockChannel();
    });

    it('初始化后应该通过健康检查', async () => {
      await channel.initialize();
      expect(await channel.healthCheck()).toBe(true);
    });

    it('关闭后应该不通过健康检查', async () => {
      await channel.initialize();
      await channel.shutdown();
      expect(await channel.healthCheck()).toBe(false);
    });
  });

  describe('handleRequest', () => {
    describe('echo 模式', () => {
      beforeEach(() => {
        channel = new MockChannel({ echo: true });
      });

      it('应该回显消息内容', async () => {
        const mockRes = {
          status: function(code: number) { this.statusCode = code; return this; },
          json: function(data: unknown) { this.body = data; return this; },
          statusCode: 0,
          body: null as unknown,
        };

        await channel.handleRequest(
          { body: { content: 'hello world', userId: 'user1' } },
          mockRes
        );

        expect(mockRes.statusCode).toBe(200);
        expect(mockRes.body).toEqual({ reply: 'hello world' });
      });

      it('应该使用默认 userId', async () => {
        const mockRes = {
          status: function(code: number) { this.statusCode = code; return this; },
          json: function(data: unknown) { this.body = data; return this; },
          statusCode: 0,
          body: null as unknown,
        };

        await channel.handleRequest(
          { body: { content: 'test' } },
          mockRes
        );

        expect(channel.receivedMessages).toHaveLength(1);
        expect(channel.receivedMessages[0].userId).toBe('test-user');
      });
    });

    describe('非 echo 模式 (Gateway 处理)', () => {
      beforeEach(() => {
        channel = new MockChannel({ echo: false });
      });

      it('应该返回 Mock reply 前缀的响应', async () => {
        const mockRes = {
          status: function(code: number) { this.statusCode = code; return this; },
          json: function(data: unknown) { this.body = data; return this; },
          statusCode: 0,
          body: null as unknown,
        };

        await channel.handleRequest(
          { body: { content: 'hello', userId: 'user1' } },
          mockRes
        );

        expect(mockRes.body).toEqual({ reply: 'Mock reply: hello' });
      });
    });
  });

  describe('消息记录', () => {
    beforeEach(() => {
      channel = new MockChannel({ echo: true });
    });

    it('应该记录接收到的消息', async () => {
      const mockRes = {
        status: function(code: number) { this.statusCode = code; return this; },
        json: function(data: unknown) { this.body = data; return this; },
        statusCode: 0,
        body: null as unknown,
      };

      await channel.handleRequest(
        { body: { content: 'message 1', userId: 'user1' } },
        mockRes
      );

      await channel.handleRequest(
        { body: { content: 'message 2', userId: 'user2' } },
        mockRes
      );

      expect(channel.receivedMessages).toHaveLength(2);
      expect(channel.receivedMessages[0].content).toBe('message 1');
      expect(channel.receivedMessages[1].content).toBe('message 2');
    });

    it('应该生成正确的 InboundMessage', async () => {
      const mockRes = {
        status: function(code: number) { this.statusCode = code; return this; },
        json: function(data: unknown) { this.body = data; return this; },
        statusCode: 0,
        body: null as unknown,
      };

      await channel.handleRequest(
        { body: { content: 'test content', userId: 'user123' } },
        mockRes
      );

      const msg: InboundMessage = channel.receivedMessages[0];
      expect(msg.channelType).toBe(ChannelType.CLI);
      expect(msg.sessionId).toBe('mock-user123');
      expect(msg.userId).toBe('user123');
      expect(msg.content).toBe('test content');
      expect(msg.messageType).toBe('text');
      expect(msg.timestamp).toBeGreaterThan(0);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      channel = new MockChannel();
    });

    it('应该记录发送的消息', async () => {
      const message: OutboundMessage = {
        channelType: ChannelType.CLI,
        sessionId: 'test-session',
        content: 'response message',
      };

      await channel.sendMessage(message);

      expect(channel.sentMessages).toHaveLength(1);
      expect(channel.sentMessages[0]).toEqual(message);
    });

    it('应该支持多条消息记录', async () => {
      await channel.sendMessage({
        channelType: ChannelType.CLI,
        sessionId: 'session1',
        content: 'message 1',
      });

      await channel.sendMessage({
        channelType: ChannelType.CLI,
        sessionId: 'session2',
        content: 'message 2',
      });

      expect(channel.sentMessages).toHaveLength(2);
    });
  });

  describe('verifySignature', () => {
    beforeEach(() => {
      channel = new MockChannel();
    });

    it('应该始终返回 true (Mock 不验证签名)', () => {
      expect(channel.verifySignature({})).toBe(true);
      expect(channel.verifySignature({ headers: { signature: 'invalid' } })).toBe(true);
    });
  });

  describe('clearMessages', () => {
    beforeEach(() => {
      channel = new MockChannel({ echo: true });
    });

    it('应该清除所有记录的消息', async () => {
      const mockRes = {
        status: function(code: number) { this.statusCode = code; return this; },
        json: function(data: unknown) { this.body = data; return this; },
        statusCode: 0,
        body: null as unknown,
      };

      // 添加一些消息
      await channel.handleRequest({ body: { content: 'test' } }, mockRes);
      await channel.sendMessage({
        channelType: ChannelType.CLI,
        sessionId: 'test',
        content: 'reply',
      });

      expect(channel.receivedMessages).toHaveLength(1);
      expect(channel.sentMessages).toHaveLength(1);

      // 清除
      channel.clearMessages();

      expect(channel.receivedMessages).toHaveLength(0);
      expect(channel.sentMessages).toHaveLength(0);
    });
  });
});
