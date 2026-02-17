/**
 * L1 交互网关 - Channel 抽象基类
 * @description KURISU-013 多平台 Channel 基础设施
 */

import { ChannelType, OutboundMessage } from '../types';

/**
 * Channel 基础配置
 */
export interface ChannelConfig {
  /** 请求超时时间 (毫秒)，默认 5000 */
  timeout?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 是否启用健康检查，默认 true */
  enableHealthCheck?: boolean;
}

/**
 * Channel 抽象基类
 * @description 所有平台 Channel 的基础抽象类，提供通用方法和生命周期管理
 */
export abstract class BaseChannel {
  /** 渠道类型，由子类实现 */
  abstract readonly channelType: ChannelType;

  /** 配置 */
  protected config: Required<ChannelConfig>;

  /** 是否已就绪 */
  protected isReady: boolean = false;

  constructor(config: ChannelConfig = {}) {
    this.config = {
      timeout: config.timeout ?? 5000,
      maxRetries: config.maxRetries ?? 3,
      enableHealthCheck: config.enableHealthCheck ?? true,
    };
  }

  // ===========================================
  // 抽象方法 - 子类必须实现
  // ===========================================

  /**
   * 处理平台请求
   * @param req 平台请求对象
   * @param res 响应对象
   */
  abstract handleRequest(req: unknown, res: unknown): Promise<void>;

  /**
   * 发送消息到平台
   * @param message 统一出站消息
   */
  abstract sendMessage(message: OutboundMessage): Promise<void>;

  /**
   * 验证请求签名
   * @param req 平台请求对象
   * @returns 签名是否有效
   */
  abstract verifySignature(req: unknown): boolean;

  // ===========================================
  // 生命周期方法 - 子类可选覆盖
  // ===========================================

  /**
   * 初始化 Channel
   * @description 子类可覆盖以执行自定义初始化逻辑
   */
  async initialize(): Promise<void> {
    this.isReady = true;
  }

  /**
   * 关闭 Channel
   * @description 子类可覆盖以执行清理逻辑
   */
  async shutdown(): Promise<void> {
    this.isReady = false;
  }

  /**
   * 健康检查
   * @returns Channel 是否健康
   */
  async healthCheck(): Promise<boolean> {
    return this.isReady;
  }

  // ===========================================
  // 工具方法
  // ===========================================

  /**
   * 构建 sessionId
   * @param platform 平台标识
   * @param userId 用户 ID
   * @returns 格式化的 sessionId
   */
  protected buildSessionId(platform: string, userId: string): string {
    return `${platform}-${userId}`;
  }

  /**
   * 获取格式化后的超时时间
   * @description 预留 500ms 缓冲时间
   * @returns 实际可用的超时时间 (毫秒)
   */
  protected formatTimeout(): number {
    return this.config.timeout - 500;
  }
}
