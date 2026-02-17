/**
 * L1 交互网关 - Mock Channel
 * @description KURISU-013 用于测试的 Mock Channel 实现
 */

import { BaseChannel, ChannelConfig } from './base';
import { ChannelType, InboundMessage, OutboundMessage } from '../types';

/**
 * Mock Channel 配置
 */
export interface MockConfig extends ChannelConfig {
  /** 是否启用回显模式，默认 false */
  echo?: boolean;
}

/**
 * Mock Channel
 * @description 用于测试 Server 和 Gateway 的模拟 Channel
 */
export class MockChannel extends BaseChannel {
  readonly channelType = ChannelType.CLI; // 复用 CLI 类型

  private mockConfig: MockConfig;

  /** 收到的消息列表 */
  public receivedMessages: InboundMessage[] = [];

  /** 发送的消息列表 */
  public sentMessages: OutboundMessage[] = [];

  constructor(config: MockConfig = {}) {
    super(config);
    this.mockConfig = config;
  }

  /**
   * 处理请求
   */
  async handleRequest(
    req: { body: { content: string; userId?: string } },
    res: {
      status: (code: number) => { json: (data: unknown) => void };
      json: (data: unknown) => void;
      send: (data: unknown) => void;
    },
  ): Promise<void> {
    const { content, userId = 'test-user' } = req.body;

    // 构建入站消息
    const inbound: InboundMessage = {
      channelType: this.channelType,
      sessionId: this.buildSessionId('mock', userId),
      userId,
      content,
      messageType: 'text',
      timestamp: Date.now(),
    };

    // 记录收到的消息
    this.receivedMessages.push(inbound);

    // 根据配置处理响应
    if (this.mockConfig.echo) {
      // 回显模式：直接返回原始内容
      res.status(200).json({ reply: content });
    } else {
      // 非 echo 模式：模拟 Gateway 处理
      const reply = await this.processWithGateway(inbound);
      res.status(200).json({ reply });
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  /**
   * 验证签名 (Mock 不验证)
   */
  verifySignature(_req: unknown): boolean {
    return true;
  }

  /**
   * 模拟 Gateway 处理
   * @description 后续会注入真实 Gateway
   */
  private async processWithGateway(inbound: InboundMessage): Promise<string> {
    // TODO: Phase 1 注入 Gateway 实例
    return `Mock reply: ${inbound.content}`;
  }

  // ===========================================
  // 测试辅助方法
  // ===========================================

  /**
   * 清除所有记录的消息
   */
  clearMessages(): void {
    this.receivedMessages = [];
    this.sentMessages = [];
  }
}
