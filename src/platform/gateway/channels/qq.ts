/**
 * L1 交互网关 - QQ Channel
 * @description KURISU-013 Phase 3 QQ Bot 接入 (NapCat + OneBot11)
 * @description 支持 Reverse HTTP 模式（NapCat 推送事件到 Kurisu）
 */

import { BaseChannel, ChannelConfig, ChannelRoute } from "./base.js";
import { ChannelType, InboundMessage, OutboundMessage } from "../types.js";
import {
  ApprovalHandler,
  createApprovalHandler,
  type ApprovalGatewayLike,
} from "./approval-handler.js";

// ===========================================
// OneBot11 类型定义
// ===========================================

/**
 * OneBot11 消息段类型
 */
interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

/**
 * OneBot11 消息事件
 */
interface OneBotMessageEvent {
  time: number;
  self_id: number;
  post_type: "message";
  message_type: "private" | "group";
  sub_type: string;
  user_id: number;
  group_id?: number;
  message_id: string;
  message: OneBotMessageSegment[] | string;
  raw_message: string;
  sender?: {
    user_id: number;
    nickname?: string;
    card?: string;
  };
}

/**
 * OneBot11 事件 (通用)
 */
type OneBotEvent = OneBotMessageEvent | Record<string, unknown>;

/**
 * OneBot11 API 响应
 */
interface OneBotApiResponse<T = unknown> {
  status: "ok" | "failed";
  retcode: number;
  data: T;
  message?: string;
}

// ===========================================
// QQChannel 配置
// ===========================================

/**
 * Gateway 接口（避免循环依赖）
 * @description 继承 ApprovalGatewayLike 以支持统一审批处理
 */
interface GatewayLike extends ApprovalGatewayLike {
  processStream(
    sessionId: string,
    input: string,
    userId?: string,
  ): Promise<{
    textStream: AsyncGenerator<string>;
    finalResponse: Promise<string>;
    approvalRequired?: boolean;
    approvalMessage?: string;
    pendingToolCall?: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    };
  }>;
}

/**
 * QQChannel 配置
 */
export interface QQConfig extends ChannelConfig {
  /** NapCat OneBot11 HTTP API 地址 */
  httpUrl: string;
  /** OneBot11 access_token (可选) */
  accessToken?: string;
  /** Polling 间隔 (毫秒)，默认 1000 */
  pollInterval?: number;
  /** Gateway 实例 */
  gateway?: GatewayLike;
}

// ===========================================
// QQChannel 实现
// ===========================================

/**
 * QQ Bot Channel
 * @description 实现 NapCat OneBot11 Polling 接入
 */
export class QQChannel extends BaseChannel {
  readonly channelType = ChannelType.QQ;

  private qqConfig: {
    httpUrl: string;
    accessToken: string;
    timeout: number;
    maxRetries: number;
    enableHealthCheck: boolean;
    gateway?: GatewayLike;
  };
  constructor(config: QQConfig) {
    super(config);
    this.qqConfig = {
      httpUrl: config.httpUrl,
      accessToken: config.accessToken ?? "",
      timeout: config.timeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      enableHealthCheck: config.enableHealthCheck ?? true,
      ...(config.gateway && { gateway: config.gateway }),
    };
  }

  // ===========================================
  // 抽象方法实现
  // ===========================================

  /**
   * 获取路由
   * @description Reverse HTTP 模式：接收 NapCat 推送的事件
   */
  getRoutes(): ChannelRoute[] {
    return [{ method: "POST", path: "/qq/event" }];
  }

  /**
   * 验证签名
   * @description OneBot11 使用 access_token 验证，在请求头中携带
   */
  verifySignature(req: unknown): boolean {
    // 检查 Authorization header
    const reqWithHeaders = req as { headers?: { authorization?: string } };
    if (!this.qqConfig.accessToken) {
      return true; // 未配置 token 时跳过验证
    }
    const authHeader = reqWithHeaders.headers?.authorization ?? "";
    return authHeader === `Bearer ${this.qqConfig.accessToken}`;
  }

  /**
   * 处理请求
   * @description 处理 NapCat 推送的事件
   */
  async handleRequest(req: unknown, res: unknown): Promise<void> {
    const reqWithBody = req as { body: OneBotEvent };
    const resObj = res as {
      writeHead: (code: number, headers?: Record<string, string>) => void;
      end: (data?: string) => void;
    };

    try {
      await this.handleEvent(reqWithBody.body);
      resObj.writeHead(200, { "Content-Type": "application/json" });
      resObj.end(JSON.stringify({ status: "ok" }));
    } catch (error) {
      console.error("QQ handleRequest error:", error);
      resObj.writeHead(500, { "Content-Type": "application/json" });
      resObj.end(
        JSON.stringify({ status: "error", message: "Internal error" }),
      );
    }
  }

  /**
   * 发送消息到 QQ
   * @param message 统一出站消息
   */
  async sendMessage(message: OutboundMessage): Promise<void> {
    const { chatType, targetId } = this.parseSessionId(message.sessionId);

    // NapCat 使用 send_private_msg / send_group_msg 而不是 send_message
    const endpoint =
      chatType === "private" ? "send_private_msg" : "send_group_msg";
    const params = {
      message: message.content,
      ...(chatType === "private" ? { user_id: Number(targetId) } : {}),
      ...(chatType === "group" ? { group_id: Number(targetId) } : {}),
    };

    const url = `${this.qqConfig.httpUrl}/${endpoint}`;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.qqConfig.accessToken) {
        headers["Authorization"] = `Bearer ${this.qqConfig.accessToken}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });

      const result = (await response.json()) as OneBotApiResponse;

      if (result.status !== "ok") {
        console.error(
          "QQ sendMessage failed:",
          result.message ?? result.retcode,
        );
      }
    } catch (error) {
      console.error("QQ sendMessage error:", error);
    }
  }

  // ===========================================
  // 生命周期覆盖
  // ===========================================

  /**
   * 初始化
   * @description Reverse HTTP 模式：NapCat 推送事件到 /qq/event，无需 Polling
   */
  override async initialize(): Promise<void> {
    await super.initialize();
    console.log(
      "QQ Channel ready (Reverse HTTP mode, waiting for NapCat push events)",
    );
  }

  /**
   * 处理单个事件
   */
  private async handleEvent(event: OneBotEvent): Promise<void> {
    // 只处理消息事件
    if (!this.isMessageEvent(event)) {
      return;
    }

    const messageEvent = event;

    // KURISU-034: 群聊消息需要 @Bot 才响应
    if (!this.shouldRespondToGroupMessage(messageEvent)) {
      return;
    }

    // 构建入站消息
    const inbound = this.parseMessageEvent(messageEvent);

    // 供测试使用
    this.lastInboundMessage = inbound;

    // 调用 Gateway 处理
    if (this.qqConfig.gateway) {
      try {
        // KURISU-023: 使用 ApprovalHandler 统一处理审批
        const approvalHandler = createApprovalHandler(this.qqConfig.gateway);
        const approvalResult = await approvalHandler.handleApproval(
          inbound.sessionId,
          inbound.content,
        );

        if (approvalResult.handled) {
          // 处理审批结果
          if (approvalResult.message) {
            await this.sendMessage({
              channelType: this.channelType,
              sessionId: inbound.sessionId,
              content: approvalResult.message,
            });
          }

          // 工具审批：执行已批准的工具
          if (
            approvalResult.type === "tool" &&
            approvalResult.approved &&
            approvalResult.toolCall
          ) {
            await this.executeToolAndRespond(
              inbound,
              approvalResult.toolCall,
              approvalHandler,
            );
          } else if (
            approvalResult.type === "tool" &&
            !approvalResult.approved
          ) {
            // 工具被拒绝
            await this.sendMessage({
              channelType: this.channelType,
              sessionId: inbound.sessionId,
              content: "好的，已取消操作。",
            });
          }
          return;
        }

        // 正常处理流程
        const result = await this.qqConfig.gateway.processStream(
          inbound.sessionId,
          inbound.content,
          inbound.userId,
        );

        const responseText = await result.finalResponse;

        if (responseText.trim()) {
          const outbound: OutboundMessage = {
            channelType: this.channelType,
            sessionId: inbound.sessionId,
            content: responseText,
          };
          await this.sendMessage(outbound);
        }

        // 检查是否需要审批
        if (result.approvalRequired && result.approvalMessage) {
          const approvalOutbound: OutboundMessage = {
            channelType: this.channelType,
            sessionId: inbound.sessionId,
            content: result.approvalMessage,
          };
          await this.sendMessage(approvalOutbound);
        }
      } catch (error) {
        console.error("QQ Channel Gateway error:", error);
        await this.sendMessage({
          channelType: this.channelType,
          sessionId: inbound.sessionId,
          content: "抱歉，出了点问题，请稍后再试。",
        });
      }
    }
  }

  /**
   * 执行已批准的工具并发送响应
   * @description KURISU-023 使用 ApprovalHandler 执行工具
   */
  private async executeToolAndRespond(
    inbound: InboundMessage,
    toolCall: { id: string; name: string; arguments: Record<string, unknown> },
    approvalHandler: ApprovalHandler,
  ): Promise<void> {
    try {
      const responseText = await approvalHandler.executeApprovedTool(
        inbound.sessionId,
        toolCall,
      );

      if (responseText.trim()) {
        await this.sendMessage({
          channelType: this.channelType,
          sessionId: inbound.sessionId,
          content: responseText,
        });
      }
    } catch (error) {
      console.error("QQChannel executeApprovedTool error:", error);
      await this.sendMessage({
        channelType: this.channelType,
        sessionId: inbound.sessionId,
        content: "执行工具时出错了，请稍后重试。",
      });
    }
  }

  /**
   * 类型守卫: 判断是否为消息事件
   */
  private isMessageEvent(event: OneBotEvent): event is OneBotMessageEvent {
    return (
      typeof event === "object" &&
      event !== null &&
      "post_type" in event &&
      event.post_type === "message"
    );
  }

  /**
   * 解析消息事件
   */
  private parseMessageEvent(event: OneBotMessageEvent): InboundMessage {
    const isGroup = event.message_type === "group";
    const chatType = isGroup ? "group" : "private";
    const targetId = isGroup ? event.group_id : event.user_id;

    // 提取消息文本：优先 raw_message，回退到从 message 数组提取
    let content = event.raw_message;
    if (!content && event.message) {
      if (typeof event.message === "string") {
        content = event.message;
      } else if (Array.isArray(event.message)) {
        content = event.message
          .filter((seg) => seg.type === "text")
          .map((seg) => seg.data["text"] as string)
          .join("");
      }
    }

    // KURISU-034: 去除 CQ 码（[CQ:at,qq=xxx]、[CQ:face,id=xxx] 等）
    const cleanContent = (content ?? "").replace(/\[CQ:[^\]]+\]/g, "").trim();

    return {
      channelType: this.channelType,
      sessionId: this.buildSessionId(`qq-${chatType}`, String(targetId)),
      userId: String(event.user_id),
      content: cleanContent,
      messageType: "text",
      timestamp: event.time * 1000,
      metadata: {
        qq: {
          message_id: event.message_id,
          message_type: event.message_type,
          group_id: event.group_id,
          sender: event.sender,
        },
      },
    };
  }

  /**
   * KURISU-034: 群聊消息过滤 — 仅 @Bot 时响应
   * 私聊消息始终响应
   */
  private shouldRespondToGroupMessage(
    event: OneBotMessageEvent,
  ): boolean {
    // 私聊始终响应
    if (event.message_type !== "group") {
      return true;
    }

    const selfId = event.self_id;

    // 优先检查结构化 message 数组中的 at 段
    if (Array.isArray(event.message)) {
      return event.message.some(
        (seg) => seg.type === "at" && Number(seg.data["qq"]) === selfId,
      );
    }

    // fallback: 检查 raw_message 中的 CQ 码
    return event.raw_message.includes(`[CQ:at,qq=${selfId}]`);
  }

  /**
   * 解析 sessionId
   * @param sessionId 格式: qq-{private|group}-{targetId}
   */
  private parseSessionId(sessionId: string): {
    chatType: "private" | "group";
    targetId: string;
  } {
    const parts = sessionId.split("-");
    // qq-private-123456 -> ["qq", "private", "123456"]
    if (parts.length >= 3) {
      const chatType = parts[1] as "private" | "group";
      const targetId = parts.slice(2).join("-");
      return { chatType, targetId };
    }
    // 兼容旧格式: qq-123456
    return { chatType: "private", targetId: parts[1] ?? "" };
  }

  /**
   * 构建 sessionId
   */
  protected override buildSessionId(platform: string, userId: string): string {
    // 格式: qq-{private|group}-{targetId}
    return `${platform}-${userId}`;
  }

  // ===========================================
  // 测试辅助
  // ===========================================

  /** 最后收到的消息 (供测试使用) */
  public lastInboundMessage?: InboundMessage;

  /**
   * 手动触发事件处理 (供测试使用)
   */
  public async testHandleEvent(event: OneBotEvent): Promise<void> {
    await this.handleEvent(event);
  }

  /**
   * 设置 Gateway (供测试使用)
   */
  public setGateway(gateway: GatewayLike): void {
    this.qqConfig.gateway = gateway;
  }
}
