/**
 * L1 交互网关 - Telegram Channel
 * @description KURISU-013 Phase 2 Telegram Bot 接入
 */

import * as http from "http";
import { BaseChannel, ChannelConfig, ChannelRoute } from "./base";
import { ChannelType, InboundMessage, OutboundMessage } from "../types";

// ===========================================
// Telegram API 类型定义
// ===========================================

/**
 * Telegram User
 */
interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/**
 * Telegram Chat
 */
interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
}

/**
 * Telegram Message
 */
interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  // 其他可选字段
  photo?: unknown[];
  document?: unknown;
  sticker?: unknown;
}

/**
 * Telegram Update
 * @description Webhook 接收的顶层对象
 */
interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  callback_query?: unknown;
}

/**
 * Telegram sendMessage 请求参数
 */
interface TelegramSendMessageParams {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
}

/**
 * Telegram sendMessage 响应
 */
interface TelegramSendMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    chat: TelegramChat;
    date: number;
    text: string;
  };
  description?: string;
  error_code?: number;
}

// ===========================================
// TelegramChannel 配置
// ===========================================

/**
 * Gateway 接口（避免循环依赖）
 */
interface GatewayLike {
  processStream(
    sessionId: string,
    input: string,
    userId?: string,
  ): Promise<{
    textStream: AsyncGenerator<string>;
    finalResponse: Promise<string>;
  }>;
}

/**
 * TelegramChannel 配置
 */
export interface TelegramConfig extends ChannelConfig {
  /** Bot Token (从 BotFather 获取) */
  botToken: string;
  /** Webhook URL (可选，用于设置 Webhook) */
  webhookUrl?: string;
  /** Gateway 实例（KURISU-013 Phase 2.1） */
  gateway?: GatewayLike;
}

// ===========================================
// TelegramChannel 实现
// ===========================================

/**
 * Telegram Bot Channel
 * @description 实现 Telegram Bot API Webhook 接入
 */
export class TelegramChannel extends BaseChannel {
  readonly channelType = ChannelType.TELEGRAM;

  private telegramConfig: TelegramConfig;

  constructor(config: TelegramConfig) {
    super(config);
    this.telegramConfig = config;
  }

  // ===========================================
  // 抽象方法实现
  // ===========================================

  /**
   * 获取路由
   * @description 返回 Telegram Webhook 路由
   */
  getRoutes(): ChannelRoute[] {
    return [{ method: "POST", path: "/telegram/webhook" }];
  }

  /**
   * 验证签名
   * @description Telegram 无强制签名验证，直接返回 true
   */
  verifySignature(_req: unknown): boolean {
    return true;
  }

  /**
   * 处理请求
   * @description 解析 Telegram Update，转换为 InboundMessage
   */
  async handleRequest(req: unknown, res: unknown): Promise<void> {
    const typedReq = req as http.IncomingMessage & { body: unknown };
    const typedRes = res as http.ServerResponse;

    try {
      const update = typedReq.body as TelegramUpdate;

      // 验证 update 结构
      if (!update || typeof update.update_id !== "number") {
        this.sendJsonResponse(typedRes, 400, { error: "Invalid update" });
        return;
      }

      // 获取消息 (支持 message, edited_message, channel_post)
      const message =
        update.message ?? update.edited_message ?? update.channel_post;

      // 没有消息或非文本消息，返回 200 但不处理
      if (!message || typeof message.text !== "string") {
        this.sendJsonResponse(typedRes, 200, { status: "ignored" });
        return;
      }

      // 构建入站消息
      const inbound: InboundMessage = {
        channelType: this.channelType,
        sessionId: this.buildSessionId("telegram", String(message.chat.id)),
        userId: String(message.from?.id ?? message.chat.id),
        content: message.text,
        messageType: "text",
        timestamp: message.date * 1000, // Telegram 是秒，转毫秒
        metadata: {
          telegram: {
            message_id: message.message_id,
            chat_type: message.chat.type,
            username: message.from?.username,
            first_name: message.from?.first_name,
          },
        },
      };

      // 供测试和日志使用
      this.lastInboundMessage = inbound;

      // Phase 2.1: Gateway 集成
      if (this.telegramConfig.gateway) {
        // 先返回 200，避免 Telegram 超时重试
        this.sendJsonResponse(typedRes, 200, { status: "ok" });

        try {
          // 调用 Gateway 处理
          const result = await this.telegramConfig.gateway.processStream(
            inbound.sessionId,
            inbound.content,
            inbound.userId,
          );

          // 累积流式响应
          let responseText = "";
          for await (const chunk of result.textStream) {
            responseText += chunk;
          }

          // 发送回复到 Telegram
          if (responseText.trim()) {
            const outbound: OutboundMessage = {
              channelType: this.channelType,
              sessionId: inbound.sessionId,
              content: responseText,
            };
            await this.sendMessage(outbound);
          }
        } catch (error) {
          console.error("TelegramChannel Gateway error:", error);
          // 错误已记录，不影响 HTTP 响应（已经返回 200）
        }
      } else {
        // 没有 Gateway 配置时，返回基础确认（向后兼容）
        this.sendJsonResponse(typedRes, 200, {
          status: "ok",
          message: "Received",
        });
      }
    } catch (error) {
      console.error("TelegramChannel handleRequest error:", error);
      this.sendJsonResponse(typedRes, 500, {
        error: "Internal server error",
      });
    }
  }

  /**
   * 发送消息
   * @description 调用 Telegram sendMessage API
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const chatId = this.extractChatId(message.sessionId);

    const params: TelegramSendMessageParams = {
      chat_id: chatId,
      text: message.content,
      // 可选: 支持 Markdown 格式
      // parse_mode: "Markdown",
    };

    const url = `https://api.telegram.org/bot${this.telegramConfig.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const result = (await response.json()) as TelegramSendMessageResponse;

      if (!result.ok) {
        console.error("Telegram sendMessage failed:", result.description);
      }
    } catch (error) {
      // 网络错误，记录但不抛出
      console.error("Telegram sendMessage error:", error);
    }
  }

  // ===========================================
  // 生命周期覆盖
  // ===========================================

  /**
   * 初始化
   * @description 可选设置 Webhook URL
   */
  override async initialize(): Promise<void> {
    if (this.telegramConfig.webhookUrl) {
      await this.setWebhook(this.telegramConfig.webhookUrl);
    }
    await super.initialize();
  }

  // ===========================================
  // 工具方法
  // ===========================================

  /**
   * 设置 Webhook
   * @description 通知 Telegram 发送更新到此 URL
   */
  private async setWebhook(webhookUrl: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.telegramConfig.botToken}/setWebhook`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      });

      const result = (await response.json()) as {
        ok: boolean;
        description?: string;
      };

      if (result.ok) {
        console.log(`Telegram webhook set: ${webhookUrl}`);
      } else {
        console.error("Failed to set Telegram webhook:", result.description);
      }
    } catch (error) {
      console.error("Error setting Telegram webhook:", error);
    }
  }

  /**
   * 从 sessionId 提取 chat_id
   * @param sessionId 格式: telegram-{chatId}
   */
  private extractChatId(sessionId: string): string {
    const parts = sessionId.split("-");
    // telegram-123456 -> 123456
    return parts.length >= 2 ? parts.slice(1).join("-") : sessionId;
  }

  /**
   * 发送 JSON 响应
   */
  private sendJsonResponse(
    res: http.ServerResponse,
    status: number,
    data: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  // ===========================================
  // 测试辅助
  // ===========================================

  /** 最后收到的消息 (供测试使用) */
  public lastInboundMessage?: InboundMessage;
}
