/**
 * BaseChannel 测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BaseChannel, ChannelConfig } from '../../../src/gateway/channels/base';
import { ChannelType, InboundMessage, OutboundMessage } from '../../../src/gateway/types';

// 创建具体的测试实现类
class TestChannel extends BaseChannel {
  readonly channelType = ChannelType.CLI;
  public lastSentMessage: OutboundMessage | null = null;
  public handleRequestCalled = false;
  public verifySignatureResult = true;

  async handleRequest(_req: unknown, res: { status: (code: number) => { json: (data: unknown) => void }; send: (data: unknown) => void }): Promise<void> {
    this.handleRequestCalled = true;
    res.status(200).json({ success: true });
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.lastSentMessage = message;
  }

  verifySignature(_req: unknown): boolean {
    return this.verifySignatureResult;
  }

  // 暴露 protected 方法供测试
  public testBuildSessionId(platform: string, userId: string): string {
    return this.buildSessionId(platform, userId);
  }

  public testFormatTimeout(): number {
    return this.formatTimeout();
  }
}

describe('BaseChannel', () => {
  let channel: TestChannel;

  describe('构造函数和配置', () => {
    it('应该使用默认配置创建实例', () => {
      channel = new TestChannel();
      expect(channel).toBeDefined();
    });

    it('应该合并自定义配置', () => {
      const config: ChannelConfig = {
        timeout: 10000,
        maxRetries: 5,
        enableHealthCheck: false,
      };
      channel = new TestChannel(config);
      // 配置应该被应用，通过行为验证
      expect(channel.testFormatTimeout()).toBe(9500); // 10000 - 500 缓冲
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      channel = new TestChannel();
    });

    it('应该将 isReady 设置为 true', async () => {
      await channel.initialize();
      expect(await channel.healthCheck()).toBe(true);
    });
  });

  describe('shutdown', () => {
    beforeEach(() => {
      channel = new TestChannel();
    });

    it('应该将 isReady 设置为 false', async () => {
      await channel.initialize();
      expect(await channel.healthCheck()).toBe(true);

      await channel.shutdown();
      expect(await channel.healthCheck()).toBe(false);
    });
  });

  describe('healthCheck', () => {
    it('初始化前应该返回 false', async () => {
      channel = new TestChannel();
      expect(await channel.healthCheck()).toBe(false);
    });

    it('初始化后应该返回 true', async () => {
      channel = new TestChannel();
      await channel.initialize();
      expect(await channel.healthCheck()).toBe(true);
    });

    it('关闭后应该返回 false', async () => {
      channel = new TestChannel();
      await channel.initialize();
      await channel.shutdown();
      expect(await channel.healthCheck()).toBe(false);
    });
  });

  describe('buildSessionId', () => {
    beforeEach(() => {
      channel = new TestChannel();
    });

    it('应该生成正确格式的 sessionId', () => {
      const sessionId = channel.testBuildSessionId('qq', 'user123');
      expect(sessionId).toBe('qq-user123');
    });

    it('应该处理不同平台标识', () => {
      expect(channel.testBuildSessionId('wecom', 'user456')).toBe('wecom-user456');
      expect(channel.testBuildSessionId('telegram', '789')).toBe('telegram-789');
    });
  });

  describe('formatTimeout', () => {
    it('应该返回配置超时减去 500ms 缓冲', () => {
      channel = new TestChannel({ timeout: 8000 });
      expect(channel.testFormatTimeout()).toBe(7500);
    });

    it('应该使用默认超时 5000ms', () => {
      channel = new TestChannel();
      expect(channel.testFormatTimeout()).toBe(4500);
    });
  });

  describe('handleRequest', () => {
    beforeEach(() => {
      channel = new TestChannel();
    });

    it('应该能够处理请求', async () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        send: vi.fn(),
      };

      await channel.handleRequest({}, mockRes);
      expect(channel.handleRequestCalled).toBe(true);
      expect(mockRes.status).toHaveBeenCalledWith(200);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      channel = new TestChannel();
    });

    it('应该保存发送的消息', async () => {
      const message: OutboundMessage = {
        channelType: ChannelType.CLI,
        sessionId: 'test-session',
        content: 'Hello',
      };

      await channel.sendMessage(message);
      expect(channel.lastSentMessage).toEqual(message);
    });
  });

  describe('verifySignature', () => {
    beforeEach(() => {
      channel = new TestChannel();
    });

    it('应该返回配置的验证结果', () => {
      channel.verifySignatureResult = true;
      expect(channel.verifySignature({})).toBe(true);

      channel.verifySignatureResult = false;
      expect(channel.verifySignature({})).toBe(false);
    });
  });
});
