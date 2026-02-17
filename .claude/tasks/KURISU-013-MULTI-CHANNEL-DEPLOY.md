# KURISU-013 多平台接入部署计划

> **任务类型**: Feature Implementation
> **优先级**: P1
> **预估时间**: 5-7 天

---

## Context

### 背景

MVP 核心功能已完成 (862 tests, 83.25% 覆盖率)，需要部署到生产环境并接入多个即时通讯平台。

### 当前状态

- ✅ L1 交互网关层 - Gateway + Channel 双层抽象
- ✅ L2 人设引擎 - 三层管控架构
- ✅ L3 Agent 编排 - LangGraph 状态机
- ✅ L4 记忆系统 - 四层记忆
- ✅ CLI Channel 实现完成

### 目标

1. 实现多平台渠道接入 (QQ/企业微信/Telegram/Discord)
2. 通用 Channel 插件架构
3. 生产级部署方案

---

## 平台优先级

| 优先级 | 平台 | 接入方式 | 难度 | 用户覆盖 |
|--------|------|----------|------|----------|
| P0 | **QQ** | Bot API v2 / WebSocket | 中 | 国内最大 |
| P1 | **企业微信** | 官方 API + 插件 | 中 | 微信生态 |
| P2 | **Telegram** | Bot API | 低 | 海外主流 |
| P3 | **Discord** | Gateway API | 中 | 游戏/社区 |
| P4 | **飞书** | 开放平台 API | 中 | 企业用户 |
| P5 | **钉钉** | 机器人 API | 中 | 企业用户 |

---

## 平台对比分析

### 国内平台

| 对比项 | QQ Bot | 企业微信 | 飞书 | 钉钉 |
|--------|--------|----------|------|------|
| ICP备案 | ❌ 不需要 | ❌ 不需要 | ❌ 不需要 | ❌ 不需要 |
| 个人用户 | ✅ 原生支持 | ✅ 插件接入 | ❌ 企业限定 | ❌ 企业限定 |
| API 稳定性 | ⚠️ 较新 | ✅ 稳定 | ✅ 稳定 | ✅ 稳定 |
| 免费额度 | ✅ 免费 | ✅ 免费 | ✅ 免费 | ✅ 免费 |
| 消息格式 | Markdown | XML/JSON | Card | Markdown |
| 速率限制 | 较宽松 | 严格 | 中等 | 中等 |

### 海外平台

| 对比项 | Telegram | Discord |
|--------|----------|---------|
| 国内访问 | ❌ 需代理 | ❌ 需代理 |
| API 友好度 | ✅ 极佳 | ✅ 良好 |
| Webhook | ✅ 支持 | ✅ 支持 |
| 文件支持 | ✅ 50MB | ✅ 25MB |
| 社区生态 | ✅ 活跃 | ✅ 活跃 |

---

## 架构设计

### Channel 插件架构

```
┌─────────────────────────────────────────────────────────┐
│                    Gateway (统一网关)                     │
│                  src/gateway/Gateway.ts                  │
├─────────────────────────────────────────────────────────┤
│                  Channel Plugin System                    │
│                src/gateway/channels/*.ts                 │
├──────────┬──────────┬──────────┬──────────┬────────────┤
│ QQChannel│  Wecom   │Telegram  │ Discord  │  Future... │
│  (P0)    │  (P1)    │  (P2)    │  (P3)    │            │
└──────────┴──────────┴──────────┴──────────┴────────────┘
                          │
                ┌─────────┴─────────┐
                │   Core Services   │
                ├───────────────────┤
                │  Persona Engine   │
                │  Agent Orchestr.  │
                │  Memory System    │
                └───────────────────┘
```

### 统一消息格式

```typescript
// src/gateway/types.ts - 扩展

export enum ChannelType {
  CLI = 1,
  WECHAT = 2,      // 微信公众号
  WECOM = 3,       // 企业微信
  QQ = 4,          // QQ Bot
  TELEGRAM = 5,    // Telegram
  DISCORD = 6,     // Discord
  FEISHU = 7,      // 飞书
  DINGTALK = 8,    // 钉钉
}

// 统一入站消息
export interface InboundMessage {
  channelType: ChannelType;
  sessionId: string;      // 格式: {platform}-{userId}
  userId: string;
  content: string;
  messageType: 'text' | 'image' | 'voice' | 'file';
  metadata?: Record<string, unknown>;
  timestamp: number;
}

// 统一出站消息
export interface OutboundMessage {
  channelType: ChannelType;
  sessionId: string;
  content: string;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}
```

---

## 开发原则：骨架优先

> **核心原则**: 先搭骨架 → 每加一个 Channel 就能立即验证

```
Phase 0: 基础设施     → BaseChannel + types.ts
Phase 1: 统一 Server  → Server 骨架 + Mock Channel (可测试)
Phase 2: QQ Bot      → 实现 QQChannel，注册到 Server，立即可测试 ✓
Phase 3: 企业微信    → 实现 WecomChannel，注册到 Server，立即可测试 ✓
Phase 4: Telegram    → 实现 TelegramChannel，注册到 Server，立即可测试 ✓
Phase 5: 部署        → Docker + Cloudflare Tunnel
```

---

## Phase 0: 基础设施准备 (0.5 天)

### 0.1 新增目录结构

```
src/gateway/
├── channels/
│   ├── base.ts          # 抽象基类
│   ├── mock.ts          # 🆕 Mock Channel (用于测试)
│   ├── cli.ts           # ✅ 已完成
│   ├── qq.ts            # 🆕 QQ Bot
│   ├── wecom.ts         # 🆕 企业微信
│   ├── telegram.ts      # 🆕 Telegram
│   └── discord.ts       # 🆕 Discord
├── crypto/
│   ├── wecom-crypto.ts  # 企业微信加解密
│   └── qq-crypto.ts     # QQ 签名验证
├── server.ts            # 🆕 统一 Server 入口
└── types.ts             # 类型定义扩展
```

### 0.2 Channel 抽象基类

```typescript
// src/gateway/channels/base.ts

import { Channel, ChannelType, InboundMessage, OutboundMessage } from '../types';

export interface ChannelConfig {
  timeout?: number;         // 默认 5000ms
  maxRetries?: number;      // 默认 3
  enableHealthCheck?: boolean;
}

export abstract class BaseChannel implements Channel {
  abstract readonly channelType: ChannelType;

  protected config: ChannelConfig;
  protected isReady: boolean = false;

  constructor(config: ChannelConfig = {}) {
    this.config = {
      timeout: 5000,
      maxRetries: 3,
      enableHealthCheck: true,
      ...config,
    };
  }

  // 必须实现的方法
  abstract handleRequest(req: any, res: any): Promise<void>;
  abstract sendMessage(message: OutboundMessage): Promise<void>;
  abstract verifySignature(req: any): boolean;

  // 可选覆盖的方法
  async initialize(): Promise<void> {
    this.isReady = true;
  }

  async shutdown(): Promise<void> {
    this.isReady = false;
  }

  async healthCheck(): Promise<boolean> {
    return this.isReady;
  }

  // 工具方法
  protected buildSessionId(platform: string, userId: string): string {
    return `${platform}-${userId}`;
  }

  protected formatTimeout(): number {
    return this.config.timeout! - 500; // 预留 500ms 缓冲
  }
}
```

---

## Phase 1: 统一 Server 骨架 (0.5 天) ⭐ 基础

> **目标**: 先搭好 Server 骨架，后续每实现一个 Channel 就能立即测试

### 1.1 Server 核心设计

```typescript
// src/gateway/server.ts

import express, { Express } from 'express';
import { BaseChannel } from './channels/base';
import { Gateway } from './Gateway';

export interface ServerConfig {
  port: number;
  channels: Record<string, BaseChannel>;
  gateway: Gateway;
}

export class KurisuServer {
  private app: Express;
  private config: ServerConfig;
  private channels: Record<string, BaseChannel>;

  constructor(config: ServerConfig) {
    this.app = express();
    this.config = config;
    this.channels = config.channels;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.text({ type: 'text/xml' }));
    this.app.use(express.raw({ type: 'application/octet-stream', limit: '10mb' }));
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', async (req, res) => {
      const channelStatus: Record<string, boolean> = {};

      for (const [name, channel] of Object.entries(this.channels)) {
        channelStatus[name] = await channel.healthCheck();
      }

      const allHealthy = Object.values(channelStatus).every(v => v);

      res.status(allHealthy ? 200 : 503).json({
        status: allHealthy ? 'ok' : 'degraded',
        channels: channelStatus,
        timestamp: new Date().toISOString(),
      });
    });

    // 动态注册 Channel 路由
    this.registerChannelRoutes();
  }

  private registerChannelRoutes(): void {
    // 为每个 Channel 自动注册路由
    // 子类可以覆盖 getRoutes() 方法自定义路由

    if (this.channels.qq) {
      this.app.post('/qq/callback', async (req, res) => {
        await this.channels.qq.handleRequest(req, res);
      });
    }

    if (this.channels.wecom) {
      this.app.route('/wecom/callback')
        .get(async (req, res) => await this.channels.wecom.handleRequest(req, res))
        .post(async (req, res) => await this.channels.wecom.handleRequest(req, res));
    }

    if (this.channels.telegram) {
      this.app.post('/telegram/webhook', async (req, res) => {
        await this.channels.telegram.handleRequest(req, res);
      });
    }
  }

  async start(): Promise<void> {
    // 初始化所有 Channel
    for (const [name, channel] of Object.entries(this.channels)) {
      try {
        await channel.initialize();
        console.log(`✅ Channel [${name}] initialized`);
      } catch (error) {
        console.error(`❌ Channel [${name}] failed to initialize:`, error);
      }
    }

    // 启动 HTTP 服务
    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(`🚀 Kurisu Bot server running on port ${this.config.port}`);
        console.log(`📡 Active channels: ${Object.keys(this.channels).join(', ')}`);
        resolve();
      });
    });
  }

  getApp(): Express {
    return this.app;
  }
}
```

### 1.2 Mock Channel (用于测试 Server)

```typescript
// src/gateway/channels/mock.ts

import { BaseChannel, ChannelConfig } from './base';
import { ChannelType, InboundMessage, OutboundMessage } from '../types';

export interface MockConfig extends ChannelConfig {
  echo?: boolean;  // 是否回显消息
}

export class MockChannel extends BaseChannel {
  readonly channelType = ChannelType.CLI;  // 复用 CLI 类型

  private config: MockConfig;
  public receivedMessages: InboundMessage[] = [];
  public sentMessages: OutboundMessage[] = [];

  constructor(config: MockConfig = {}) {
    super(config);
    this.config = config;
  }

  async handleRequest(req: any, res: any): Promise<void> {
    const { content, userId = 'test-user' } = req.body;

    const inbound: InboundMessage = {
      channelType: this.channelType,
      sessionId: this.buildSessionId('mock', userId),
      userId,
      content,
      messageType: 'text',
      timestamp: Date.now(),
    };

    this.receivedMessages.push(inbound);

    // 回显或调用 Gateway
    if (this.config.echo) {
      res.json({ reply: content });
    } else {
      const reply = await this.processWithGateway(inbound);
      res.json({ reply });
    }
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  verifySignature(req: any): boolean {
    return true;  // Mock 不验证签名
  }

  private async processWithGateway(inbound: InboundMessage): Promise<string> {
    // TODO: 注入 Gateway
    return `Mock reply: ${inbound.content}`;
  }

  // 测试辅助方法
  clearMessages(): void {
    this.receivedMessages = [];
    this.sentMessages = [];
  }
}
```

### 1.3 Server 入口文件

```typescript
// src/bin/server.ts

import { KurisuServer } from '../gateway/server';
import { Gateway } from '../gateway/Gateway';
import { MockChannel } from '../gateway/channels/mock';
// import { QQChannel } from '../gateway/channels/qq';      // Phase 2
// import { WecomChannel } from '../gateway/channels/wecom'; // Phase 3
// import { TelegramChannel } from '../gateway/channels/telegram'; // Phase 4

async function main() {
  const gateway = new Gateway();

  // Phase 1: 使用 Mock Channel 测试 Server 骨架
  const channels = {
    mock: new MockChannel({ echo: true }),
  };

  // Phase 2+: 替换为真实 Channel
  // if (process.env.QQ_BOT_APP_ID) {
  //   channels.qq = new QQChannel({ ... });
  // }

  const server = new KurisuServer({
    port: parseInt(process.env.PORT || '3000'),
    channels,
    gateway,
  });

  await server.start();
}

main().catch(console.error);
```

### 1.4 Server 单元测试

```typescript
// tests/gateway/server.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { KurisuServer } from '../../src/gateway/server';
import { MockChannel } from '../../src/gateway/channels/mock';
import { Gateway } from '../../src/gateway/Gateway';
import request from 'supertest';

describe('KurisuServer', () => {
  let server: KurisuServer;
  let mockChannel: MockChannel;

  beforeAll(async () => {
    mockChannel = new MockChannel({ echo: true });

    server = new KurisuServer({
      port: 3001,  // 测试端口
      channels: { mock: mockChannel },
      gateway: new Gateway(),
    });

    await server.start();
  });

  it('should return healthy status', async () => {
    const res = await request(server.getApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.channels.mock).toBe(true);
  });

  it('should handle mock channel message', async () => {
    const res = await request(server.getApp())
      .post('/mock/callback')
      .send({ content: 'hello', userId: 'test' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('hello');
    expect(mockChannel.receivedMessages).toHaveLength(1);
  });
});
```

### 1.5 验证 Server 骨架

```bash
# 1. 运行测试
npm test -- server.test.ts

# 2. 启动 Server
npm run dev:server

# 3. 健康检查
curl http://localhost:3000/health

# 4. 测试 Mock Channel
curl -X POST http://localhost:3000/mock/callback \
  -H "Content-Type: application/json" \
  -d '{"content": "hello", "userId": "test"}'
```

---

## Phase 2: QQ Bot 接入 (1.5 天) ⭐ P0

### 2.1 QQ Bot API v2 概述

QQ Bot API v2 是腾讯官方提供的机器人接口，支持：
- 频道 (Guild) 消息
- 群聊消息
- 私聊消息

**参考资源**:
- [QQ 机器人文档](https://bot.q.qq.com/wiki/develop/api/)
- [hlcc/Qbot](https://github.com/hlcc/Qbot) - OpenClaw QQ 插件
- [corrinehu/qqbot-openclaw](https://github.com/corrinehu/qqbot-openclaw)

### 2.2 新增文件

| 文件 | 用途 |
|------|------|
| `src/gateway/channels/qq.ts` | QQ Bot 渠道核心 |
| `src/gateway/crypto/qq-crypto.ts` | 签名验证 |
| `tests/gateway/channels/qq.test.ts` | 单元测试 |
| `tests/gateway/crypto/qq-crypto.test.ts` | 签名测试 |

### 2.3 QQ Channel 设计

```typescript
// src/gateway/channels/qq.ts

import { BaseChannel, ChannelConfig } from './base';
import { ChannelType, InboundMessage, OutboundMessage } from '../types';

export interface QQConfig extends ChannelConfig {
  appId: string;
  appSecret: string;
  sandbox?: boolean;        // 沙箱环境
}

export interface QQMessage {
  id: string;
  channel_id: string;
  guild_id: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  content: string;
  timestamp: string;
  mentions?: Array<{ id: string; username: string }>;
}

export class QQChannel extends BaseChannel {
  readonly channelType = ChannelType.QQ;

  private config: QQConfig;
  private accessToken: string | null = null;
  private ws?: WebSocket;   // WebSocket 连接

  constructor(config: QQConfig) {
    super(config);
    this.config = config;
  }

  async initialize(): Promise<void> {
    await this.getAccessToken();
    await this.connectWebSocket();
    await super.initialize();
  }

  // 核心 HTTP 回调处理 (可选)
  async handleRequest(req: Request, res: Response): Promise<void> {
    // 验证签名
    if (!this.verifySignature(req)) {
      res.status(401).send('Invalid signature');
      return;
    }

    const body = req.body;
    const op = body.op;

    switch (op) {
      case 13: // AT_VERIFY_HTTP
        res.json({ op: 12, d: { challenge: body.d.challenge } });
        break;
      default:
        await this.handleEvent(body.d);
        res.status(204).send();
    }
  }

  // WebSocket 事件处理
  private async handleEvent(event: QQEvent): Promise<void> {
    if (event.t === 'AT_MESSAGE_CREATE' || event.t === 'MESSAGE_CREATE') {
      const message = event.d as QQMessage;
      await this.handleMessage(message);
    }
  }

  private async handleMessage(message: QQMessage): Promise<void> {
    const inbound: InboundMessage = {
      channelType: ChannelType.QQ,
      sessionId: this.buildSessionId('qq', message.author.id),
      userId: message.author.id,
      content: this.cleanContent(message.content),
      messageType: 'text',
      metadata: {
        channelId: message.channel_id,
        guildId: message.guild_id,
        msgId: message.id,
      },
      timestamp: Date.now(),
    };

    // 调用 Gateway 处理
    const reply = await this.processWithGateway(inbound);
    await this.sendMessage({
      channelType: ChannelType.QQ,
      sessionId: inbound.sessionId,
      content: reply,
      metadata: { channelId: message.channel_id, msgId: message.id },
    });
  }

  // 发送消息
  async sendMessage(message: OutboundMessage): Promise<void> {
    const channelId = message.metadata?.channelId as string;
    const url = `https://api.sgroup.qq.com/channels/${channelId}/messages`;

    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${this.config.appId}.${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: message.content,
        msg_id: message.metadata?.msgId,
      }),
    });
  }

  // WebSocket 连接
  private async connectWebSocket(): Promise<void> {
    const wsUrl = this.config.sandbox
      ? 'wss://sandbox.api.sgroup.qq.com/websocket'
      : 'wss://api.sgroup.qq.com/websocket';

    this.ws = new WebSocket(wsUrl);

    this.ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      this.handleEvent(event);
    });

    this.ws.on('close', () => {
      // 自动重连
      setTimeout(() => this.connectWebSocket(), 5000);
    });
  }

  // 清理 @mention
  private cleanContent(content: string): string {
    return content.replace(/<@!\d+>/g, '').trim();
  }

  // 获取 Access Token
  private async getAccessToken(): Promise<void> {
    const url = 'https://bots.qq.com/app/getAppAccessToken';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: this.config.appId,
        clientSecret: this.config.appSecret,
      }),
    });
    const data = await res.json();
    this.accessToken = data.access_token;
  }

  verifySignature(req: Request): boolean {
    // QQ Bot 签名验证逻辑
    const signature = req.headers['x-bot-signature'];
    const timestamp = req.headers['x-bot-timestamp'];
    // ... 验证逻辑
    return true;
  }

  private async processWithGateway(inbound: InboundMessage): Promise<string> {
    // 调用 Gateway 处理消息
    // TODO: 注入 Gateway 实例
    return '处理中...';
  }
}
```

### 2.4 环境变量

```bash
# .env.example 新增

# QQ Bot 配置
QQ_BOT_APP_ID=your_app_id
QQ_BOT_APP_SECRET=your_app_secret
QQ_BOT_SANDBOX=false
```

---

## Phase 3: 企业微信接入 (1 天) ⭐ P1

### 3.1 新增文件

| 文件 | 用途 |
|------|------|
| `src/gateway/channels/wecom.ts` | 企业微信渠道核心 |
| `src/gateway/crypto/wecom-crypto.ts` | 消息加解密 |
| `tests/gateway/channels/wecom.test.ts` | 单元测试 |
| `tests/gateway/crypto/wecom-crypto.test.ts` | 加解密测试 |

### 3.2 WecomConfig 设计

```typescript
// src/gateway/channels/wecom.ts

import { BaseChannel, ChannelConfig } from './base';
import { ChannelType, InboundMessage, OutboundMessage } from '../types';
import { WecomCrypto } from '../crypto/wecom-crypto';

export interface WecomConfig extends ChannelConfig {
  corpId: string;
  corpSecret: string;
  agentId: string;
  callbackToken: string;
  callbackAesKey: string;  // 43位
}

export interface WecomMessage {
  ToUserName: string;    // 企业微信 CorpID
  FromUserName: string;  // 成员 UserID
  CreateTime: number;
  MsgType: 'text' | 'image' | 'voice' | 'event';
  Content?: string;
  PicUrl?: string;
  MediaId?: string;
  Event?: string;        // subscribe, unsubscribe, enter_agent
  EventKey?: string;
}

export class WecomChannel extends BaseChannel {
  readonly channelType = ChannelType.WECOM;

  private config: WecomConfig;
  private crypto: WecomCrypto;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: WecomConfig) {
    super(config);
    this.config = config;
    this.crypto = new WecomCrypto(
      config.callbackToken,
      config.callbackAesKey,
      config.corpId
    );
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    const { msg_signature, timestamp, nonce, echostr } = req.query;

    // GET: 验证 URL
    if (req.method === 'GET') {
      if (this.crypto.verifySignature(msg_signature as string, timestamp as string, nonce as string, echostr as string)) {
        const decrypted = this.crypto.decrypt(echostr as string);
        res.send(decrypted);
      } else {
        res.status(403).send('Invalid signature');
      }
      return;
    }

    // POST: 处理消息
    if (!this.verifySignature(req)) {
      res.status(403).send('Invalid signature');
      return;
    }

    const encrypted = this.parseEncryptedBody(req.body);
    const decrypted = this.crypto.decrypt(encrypted);
    const message = this.parseXmlMessage(decrypted);

    const reply = await this.handleMessage(message);

    // 加密回复
    const encryptedReply = this.crypto.encrypt(reply, nonce as string, timestamp as string);
    const signature = this.crypto.sign(encryptedReply, nonce as string, timestamp as string);

    res.send(this.buildEncryptedResponse(encryptedReply, signature, timestamp as string, nonce as string));
  }

  private async handleMessage(message: WecomMessage): Promise<string> {
    switch (message.MsgType) {
      case 'text':
        return this.handleTextMessage(message);
      case 'image':
        return this.handleImageMessage(message);
      case 'event':
        return this.handleEvent(message);
      default:
        return '暂不支持此类型消息';
    }
  }

  private async handleTextMessage(message: WecomMessage): Promise<string> {
    const inbound: InboundMessage = {
      channelType: ChannelType.WECOM,
      sessionId: this.buildSessionId('wecom', message.FromUserName),
      userId: message.FromUserName,
      content: message.Content!,
      messageType: 'text',
      timestamp: message.CreateTime,
    };

    // 调用 Gateway 处理
    return this.processWithGateway(inbound);
  }

  private async handleImageMessage(message: WecomMessage): Promise<string> {
    // 图片消息处理
    return '收到图片了，但我还看不懂呢...';
  }

  private async handleEvent(message: WecomMessage): Promise<string> {
    switch (message.Event) {
      case 'subscribe':
        return '欢迎关注！我是牧濑红莉栖，有什么想问的吗？';
      case 'enter_agent':
        return '哼，你来找我有什么事？';
      default:
        return '';
    }
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    const userId = message.sessionId.replace('wecom-', '');
    await this.sendTextMessage(userId, message.content);
  }

  private async sendTextMessage(userId: string, content: string): Promise<void> {
    const token = await this.getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: userId,
        msgtype: 'text',
        agentid: this.config.agentId,
        text: { content },
      }),
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.config.corpId}&corpsecret=${this.config.corpSecret}`;
    const res = await fetch(url);
    const data = await res.json();

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 300) * 1000; // 提前5分钟过期

    return this.accessToken!;
  }

  verifySignature(req: Request): boolean {
    const { msg_signature, timestamp, nonce } = req.query;
    const encrypted = this.parseEncryptedBody(req.body);
    return this.crypto.verifySignature(msg_signature as string, timestamp as string, nonce as string, encrypted);
  }

  private parseEncryptedBody(body: string): string {
    // 从 XML 中提取 Encrypt 字段
    const match = body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    return match ? match[1] : '';
  }

  private parseXmlMessage(xml: string): WecomMessage {
    // 简单 XML 解析
    const result: any = {};
    const regex = /<(\w+)>(?:<!\[CDATA\[(.*?)\]\]>|(.*?))<\/\1>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      result[match[1]] = match[2] || match[3];
      if (result[match[1]] && !isNaN(Number(result[match[1]]))) {
        result[match[1]] = Number(result[match[1]]);
      }
    }
    return result as WecomMessage;
  }

  private buildEncryptedResponse(encrypted: string, signature: string, timestamp: string, nonce: string): string {
    return `<xml>
  <Encrypt><![CDATA[${encrypted}]]></Encrypt>
  <MsgSignature><![CDATA[${signature}]]></MsgSignature>
  <TimeStamp>${timestamp}</TimeStamp>
  <Nonce><![CDATA[${nonce}]]></Nonce>
</xml>`;
  }

  private async processWithGateway(inbound: InboundMessage): Promise<string> {
    // TODO: 注入 Gateway 实例
    return '处理中...';
  }
}
```

### 3.3 WecomCrypto 工具类

```typescript
// src/gateway/crypto/wecom-crypto.ts

import crypto from 'crypto';

export class WecomCrypto {
  private token: string;
  private aesKey: Buffer;
  private corpId: string;

  constructor(token: string, encodingAESKey: string, corpId: string) {
    this.token = token;
    this.aesKey = Buffer.from(encodingAESKey + '=', 'base64');
    this.corpId = corpId;
  }

  verifySignature(signature: string, timestamp: string, nonce: string, encrypted?: string): boolean {
    const arr = encrypted
      ? [this.token, timestamp, nonce, encrypted]
      : [this.token, timestamp, nonce];
    arr.sort();
    const sha1 = crypto.createHash('sha1').update(arr.join('')).digest('hex');
    return sha1 === signature;
  }

  decrypt(encrypted: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.aesKey.slice(0, 16));
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()]);

    // 移除 PKCS7 填充
    const pad = decrypted[decrypted.length - 1];
    decrypted = decrypted.slice(0, -pad);

    // 移除随机字符串和消息长度
    const content = decrypted.slice(20);
    const len = content.readUInt32BE(0);
    const message = content.slice(4, 4 + len).toString();
    const corpId = content.slice(4 + len).toString();

    if (corpId !== this.corpId) {
      throw new Error('CorpID mismatch');
    }

    return message;
  }

  encrypt(message: string, nonce: string, timestamp: string): string {
    const random = crypto.randomBytes(16);
    const msgBuffer = Buffer.from(message);
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32BE(msgBuffer.length, 0);
    const corpIdBuffer = Buffer.from(this.corpId);

    const content = Buffer.concat([random, lenBuffer, msgBuffer, corpIdBuffer]);

    // PKCS7 填充
    const blockSize = 32;
    const padLen = blockSize - (content.length % blockSize);
    const padBuffer = Buffer.alloc(padLen, padLen);
    const padded = Buffer.concat([content, padBuffer]);

    const cipher = crypto.createCipheriv('aes-256-cbc', this.aesKey, this.aesKey.slice(0, 16));
    cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);

    return encrypted.toString('base64');
  }

  sign(encrypted: string, nonce: string, timestamp: string): string {
    const arr = [this.token, timestamp, nonce, encrypted];
    arr.sort();
    return crypto.createHash('sha1').update(arr.join('')).digest('hex');
  }
}
```

### 3.4 环境变量

```bash
# .env.example 新增

# 企业微信配置
WECOM_CORP_ID=your_corp_id
WECOM_CORP_SECRET=your_corp_secret
WECOM_AGENT_ID=your_agent_id
WECOM_CALLBACK_TOKEN=your_token
WECOM_CALLBACK_AES_KEY=your_aes_key_43_chars
```

---

## Phase 4: Telegram 接入 (0.5 天) ⭐ P2

### 4.1 新增文件

| 文件 | 用途 |
|------|------|
| `src/gateway/channels/telegram.ts` | Telegram Bot 渠道 |
| `tests/gateway/channels/telegram.test.ts` | 单元测试 |

### 4.2 Telegram Channel 设计

```typescript
// src/gateway/channels/telegram.ts

import { BaseChannel, ChannelConfig } from './base';
import { ChannelType, InboundMessage, OutboundMessage } from '../types';

export interface TelegramConfig extends ChannelConfig {
  botToken: string;
  webhookUrl?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: 'private' | 'group' | 'supergroup' };
    text?: string;
    photo?: Array<{ file_id: string; width: number; height: number }>;
    date: number;
  };
}

export class TelegramChannel extends BaseChannel {
  readonly channelType = ChannelType.TELEGRAM;

  private config: TelegramConfig;
  private readonly apiUrl: string;

  constructor(config: TelegramConfig) {
    super(config);
    this.config = config;
    this.apiUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  async initialize(): Promise<void> {
    if (this.config.webhookUrl) {
      await this.setWebhook(this.config.webhookUrl);
    }
    await super.initialize();
  }

  async handleRequest(req: Request, res: Response): Promise<void> {
    const update: TelegramUpdate = req.body;

    if (update.message) {
      await this.handleMessage(update.message);
    }

    res.status(200).send('OK');
  }

  private async handleMessage(message: TelegramUpdate['message']): Promise<void> {
    if (!message?.text) return;

    const inbound: InboundMessage = {
      channelType: ChannelType.TELEGRAM,
      sessionId: this.buildSessionId('telegram', message.from.id.toString()),
      userId: message.from.id.toString(),
      content: message.text,
      messageType: 'text',
      metadata: {
        chatId: message.chat.id,
        messageId: message.message_id,
        username: message.from.username,
      },
      timestamp: message.date * 1000,
    };

    const reply = await this.processWithGateway(inbound);
    await this.sendMessage({
      channelType: ChannelType.TELEGRAM,
      sessionId: inbound.sessionId,
      content: reply,
      metadata: { chatId: message.chat.id },
    });
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    const chatId = message.metadata?.chatId;
    await fetch(`${this.apiUrl}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.content,
        parse_mode: 'Markdown',
      }),
    });
  }

  private async setWebhook(url: string): Promise<void> {
    await fetch(`${this.apiUrl}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }

  verifySignature(req: Request): boolean {
    // Telegram 无需签名验证
    return true;
  }

  private async processWithGateway(inbound: InboundMessage): Promise<string> {
    // TODO: 注入 Gateway 实例
    return '处理中...';
  }
}
```

### 4.3 环境变量

```bash
# .env.example 新增

# Telegram Bot 配置
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
```

---

## Phase 5: Channel 集成与测试 (0.5 天)

### 5.1 更新 server.ts 集成真实 Channel

完成 Phase 2-4 后，更新 `src/bin/server.ts` 启用真实 Channel：

```typescript
// src/bin/server.ts

import { KurisuServer } from '../gateway/server';
import { Gateway } from '../gateway/Gateway';
import { QQChannel, QQConfig } from '../gateway/channels/qq';
import { WecomChannel, WecomConfig } from '../gateway/channels/wecom';
import { TelegramChannel, TelegramConfig } from '../gateway/channels/telegram';

async function main() {
  const gateway = new Gateway();
  const channels: Record<string, BaseChannel> = {};

  // QQ Bot (Phase 2)
  if (process.env.QQ_BOT_APP_ID) {
    channels.qq = new QQChannel({
      appId: process.env.QQ_BOT_APP_ID,
      appSecret: process.env.QQ_BOT_APP_SECRET!,
      sandbox: process.env.QQ_BOT_SANDBOX === 'true',
    });
  }

  // 企业微信 (Phase 3)
  if (process.env.WECOM_CORP_ID) {
    channels.wecom = new WecomChannel({
      corpId: process.env.WECOM_CORP_ID,
      corpSecret: process.env.WECOM_CORP_SECRET!,
      agentId: process.env.WECOM_AGENT_ID!,
      callbackToken: process.env.WECOM_CALLBACK_TOKEN!,
      callbackAesKey: process.env.WECOM_CALLBACK_AES_KEY!,
    });
  }

  // Telegram (Phase 4)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    channels.telegram = new TelegramChannel({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
    });
  }

  const server = new KurisuServer({
    port: parseInt(process.env.PORT || '3000'),
    channels,
    gateway,
  });

  await server.start();
}

main().catch(console.error);
```

### 5.2 集成测试

```bash
# 运行所有 Channel 测试
npm test -- channels/

# 集成测试
npm test -- server.test.ts

# E2E 测试 (需要配置真实环境变量)
npm run test:e2e
```

---

## Phase 6: 部署方案 (1 天)

### 6.1 部署方案对比

| 方案 | 成本 | 适用场景 | 优点 |
|------|------|----------|------|
| **Cloudflare Tunnel** | 免费 | 开发/测试/个人 | 零成本、快速 |
| **云服务器** | 50-100元/月 | 稳定生产 | 可扩展 |
| **Docker + VPS** | 按用量 | 大规模 | 弹性伸缩 |

### 6.2 Docker 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  kurisu:
    build: .
    container_name: kurisu-bot
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production

      # QQ Bot
      - QQ_BOT_APP_ID=${QQ_BOT_APP_ID}
      - QQ_BOT_APP_SECRET=${QQ_BOT_APP_SECRET}
      - QQ_BOT_SANDBOX=${QQ_BOT_SANDBOX:-false}

      # 企业微信
      - WECOM_CORP_ID=${WECOM_CORP_ID}
      - WECOM_CORP_SECRET=${WECOM_CORP_SECRET}
      - WECOM_AGENT_ID=${WECOM_AGENT_ID}
      - WECOM_CALLBACK_TOKEN=${WECOM_CALLBACK_TOKEN}
      - WECOM_CALLBACK_AES_KEY=${WECOM_CALLBACK_AES_KEY}

      # Telegram
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - TELEGRAM_WEBHOOK_URL=${TELEGRAM_WEBHOOK_URL}

      # 模型配置
      - CLOUD_MODEL_QWEN3=${CLOUD_MODEL_QWEN3}
    volumes:
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 6.3 Cloudflare Tunnel 快速部署

```bash
# 1. 安装 cloudflared
brew install cloudflared

# 2. 快速测试
cloudflared tunnel --url http://localhost:3000

# 3. 永久隧道
cloudflared tunnel create kurisu
cloudflared tunnel route dns kurisu kurisu.yourdomain.com
cloudflared tunnel run kurisu
```

---

## 完整时间线

```
Day 0.5: 基础设施 (Phase 0)
├── 创建 BaseChannel 抽象类
├── 扩展 types.ts
└── 目录结构准备

Day 1: 统一 Server 骨架 (Phase 1) ⭐ 关键
├── 实现 KurisuServer 类
├── 实现 Mock Channel
├── 健康检查端点
├── Server 单元测试
└── 验证骨架可用 ✓

Day 2-3: QQ Bot 接入 (Phase 2)
├── 实现 QQChannel
├── 实现 WebSocket 连接
├── 注册到 Server
├── 编写单元测试
└── 立即可测试 ✓

Day 4: 企业微信接入 (Phase 3)
├── 实现 WecomChannel
├── 实现消息加解密
├── 注册到 Server
├── 企业微信配置
└── 端到端测试 ✓

Day 5: Telegram 接入 (Phase 4)
├── 实现 TelegramChannel
├── Webhook 配置
├── 注册到 Server
└── 测试 ✓

Day 5.5: 集成测试 (Phase 5)
├── 更新 server.ts 启用真实 Channel
├── 多 Channel 并行测试
└── E2E 测试

Day 6: 部署 (Phase 6)
├── Docker 配置
├── Cloudflare Tunnel
└── 生产验证
```

---

## 风险与注意事项

| 风险 | 平台 | 缓解措施 |
|------|------|----------|
| 5秒超时 | QQ/企业微信 | 设置4.5秒超时，返回兜底消息 |
| 消息加解密错误 | 企业微信 | 严格按文档实现，充分测试 |
| Access Token 过期 | 全平台 | 提前5分钟刷新，缓存到内存 |
| 长消息截断 | 全平台 | 自动分割超过限制的消息 |
| WebSocket 断连 | QQ | 自动重连 + 心跳检测 |
| Webhook 失效 | Telegram | 定期检查 Webhook 状态 |
| 速率限制 | 全平台 | 实现请求队列和限流 |

---

## 参考资源

### 官方文档
- [QQ 机器人文档](https://bot.q.qq.com/wiki/develop/api/)
- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Discord Developer Portal](https://discord.com/developers/docs)

### 社区项目
- [hlcc/Qbot](https://github.com/hlcc/Qbot) - OpenClaw QQ 插件
- [OpenClaw-Wechat](https://github.com/dingxiang-me/OpenClaw-Wechat) - 企业微信插件
- [LangBot](https://github.com/langbot-app/LangBot) - 多平台参考
- [AstrBot](https://github.com/AstrBotDevs/AstrBot) - OpenClaw 替代品

### 部署
- [Cloudflare Tunnel 文档](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [企业微信消息加解密](https://developer.work.weixin.qq.com/document/path/90307)
