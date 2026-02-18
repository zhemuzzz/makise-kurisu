/**
 * L1 交互网关 - Mock Channel
 * @description KURISU-013 用于测试的 Mock Channel 实现
 */

import * as http from "http";
import { BaseChannel, ChannelConfig, ChannelRoute } from "./base";
import { ChannelType, InboundMessage, OutboundMessage } from "../types";

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
  async handleRequest(req: unknown, res: unknown): Promise<void> {
    const typedReq = req as { body: { content: string; userId?: string } };
    const { content, userId = "test-user" } = typedReq.body;

    // 构建入站消息
    const inbound: InboundMessage = {
      channelType: this.channelType,
      sessionId: this.buildSessionId("mock", userId),
      userId,
      content,
      messageType: "text",
      timestamp: Date.now(),
    };

    // 记录收到的消息
    this.receivedMessages.push(inbound);

    // 根据配置处理响应
    const reply = this.mockConfig.echo
      ? content
      : await this.processWithGateway(inbound);

    // 发送响应（兼容原生 http.ServerResponse 和 Express 风格 mock）
    this.sendJsonResponse(res as http.ServerResponse, 200, { reply });
  }

  /**
   * 发送 JSON 响应（兼容原生和 Express 风格）
   */
  private sendJsonResponse(
    res: http.ServerResponse & {
      status?: (code: number) => { json: (data: unknown) => void };
    },
    status: number,
    data: unknown,
  ): void {
    // Express 风格（测试 mock）
    if (typeof res.status === "function") {
      res.status(status).json(data);
      return;
    }

    // 原生 http.ServerResponse
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
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
   * 获取路由
   * @description 返回 Mock Channel 的 Webhook 路由
   */
  getRoutes(): ChannelRoute[] {
    return [{ method: "POST", path: "/mock/webhook" }];
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
