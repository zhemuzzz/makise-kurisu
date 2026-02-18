# KURISU-013 多平台接入部署计划

> **任务类型**: Feature Implementation
> **优先级**: P1
> **状态**: Phase 0 已完成，Phase 1 开发中

---

## 目标

1. 统一 Server 骨架，Channel 插件化接入
2. Telegram 先行验证全链路，再接入 QQ / 企业微信
3. Cloudflare Tunnel 零成本部署

## 当前状态

- ✅ Phase 0: BaseChannel 抽象基类 + MockChannel + 统一消息格式 (+40 tests)
- 🔲 Phase 1: 统一 Server 骨架 + Cloudflare Tunnel
- 🔲 Phase 2: Telegram 接入 (P0)
- 🔲 Phase 3: QQ Bot 接入 (P1)
- 🔲 Phase 4: 企业微信接入 (P2)

---

## 平台优先级

> **原则**: 先用最简平台验证全链路 (同 T003 GLM-5 先行策略)

| 优先级 | 平台 | 接入方式 | 难度 | 选择理由 |
|--------|------|----------|------|----------|
| **P0** | **Telegram** | Bot API + Webhook | **低** | API 最简，无签名/加密，0.5 天跑通 |
| P1 | QQ | Bot API v2 / WebSocket | 中 | 国内覆盖最大 |
| P2 | 企业微信 | 官方 API | 中 | 加解密复杂，延后处理 |
| P3 | Discord | Gateway API | 中 | 游戏/社区 |
| P4 | 飞书/钉钉 | 开放平台 API | 中 | 企业用户，按需接入 |

---

## 架构设计

### Channel 插件架构

```
Gateway (src/gateway/index.ts)
    ↓ 依赖注入
KurisuServer (src/gateway/server.ts)
    ↓ 自动注册路由
┌──────────┬──────────┬──────────┬────────────┐
│ Telegram │ QQChannel│  Wecom   │  Future... │
│  (P0)    │  (P1)    │  (P2)    │            │
└──────────┴──────────┴──────────┴────────────┘
    ↑ 继承
BaseChannel (src/gateway/channels/base.ts) ✅ 已实现
```

### 关键设计决策

**1. Channel 自声明路由** (对齐 OpenClaw 运行时插件化)

```typescript
// BaseChannel 新增抽象方法
abstract getRoutes(): Array<{ method: 'get' | 'post'; path: string }>;

// Server 自动注册，无需硬编码 if/else
for (const [name, channel] of Object.entries(this.channels)) {
  for (const route of channel.getRoutes()) {
    this.app[route.method](route.path, (req, res) => channel.handleRequest(req, res));
  }
}
```

**2. Gateway 依赖注入**

```typescript
// BaseChannel 通过 Server 注入 Gateway，而非自行持有
// Server 在路由层负责调用 Gateway.processStream()，Channel 只负责消息转换
```

**3. 超时兜底** (应对 QQ/企业微信 5 秒限制)

```typescript
// BaseChannel 工具方法
protected async withTimeout<T>(promise: Promise<T>, fallback: string): Promise<T | string>
```

### 已实现文件

> Phase 0 产出，详见 [src/gateway/](../../src/gateway/)

| 文件 | 说明 |
|------|------|
| `src/gateway/types.ts` | ChannelType 枚举 (10 平台) + InboundMessage / OutboundMessage |
| `src/gateway/channels/base.ts` | BaseChannel 抽象基类 |
| `src/gateway/channels/mock.ts` | MockChannel 测试实现 |
| `src/gateway/channels/cli.ts` | CLI Channel |
| `src/gateway/index.ts` | Gateway 类 (需 `GatewayDeps { orchestrator }`) |

### 待实现文件

```
src/gateway/
├── server.ts              # 🆕 KurisuServer 统一入口
├── channels/
│   ├── telegram.ts        # 🆕 Phase 2
│   ├── qq.ts              # 🆕 Phase 3
│   └── wecom.ts           # 🆕 Phase 4
├── crypto/
│   ├── wecom-crypto.ts    # 🆕 Phase 4
│   └── qq-crypto.ts       # 🆕 Phase 3
src/bin/
└── server.ts              # 🆕 启动入口
```

---

## Phase 1: 统一 Server + Tunnel (1 天)

### 产出

| 组件 | 说明 |
|------|------|
| `KurisuServer` | Express Server，自动注册 Channel 路由 + 健康检查 |
| `src/bin/server.ts` | 启动入口，按环境变量启用 Channel |
| Cloudflare Tunnel | 开发隧道，Phase 2 Webhook 回调依赖此 |
| Server 测试 | supertest 验证健康检查 + Mock Channel 路由 |

### Cloudflare Tunnel (Phase 2 前置依赖)

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3000  # 临时隧道
# 永久隧道
cloudflared tunnel create kurisu
cloudflared tunnel route dns kurisu kurisu.yourdomain.com
```

---

## Phase 2: Telegram 接入 (0.5 天)

> Telegram API 最简单，无签名验证，适合快速验证全链路

### 核心要点

| 项目 | 说明 |
|------|------|
| API | `https://api.telegram.org/bot{token}/...` |
| 接收 | Webhook POST → `handleRequest` |
| 发送 | `sendMessage` API，支持 Markdown |
| 签名 | 无需验证 (`verifySignature` 直接返回 true) |
| 路由 | `POST /telegram/webhook` |

### 环境变量

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://kurisu.yourdomain.com/telegram/webhook
```

### 验证标准

- [ ] Telegram → Server → Gateway → Orchestrator → 人设回复 全链路跑通
- [ ] 流式响应正常
- [ ] 会话隔离 (不同用户独立 session)

---

## Phase 3: QQ Bot 接入 (1.5 天)

### 核心要点

| 项目 | 说明 |
|------|------|
| API | QQ Bot API v2，WebSocket + HTTP 回调 |
| 接收 | WebSocket 事件 `AT_MESSAGE_CREATE` / `MESSAGE_CREATE` |
| 发送 | REST API `POST /channels/{id}/messages` |
| 签名 | `x-bot-signature` 验证 |
| 认证 | AppID + AppSecret → AccessToken |
| 路由 | `POST /qq/callback` (HTTP 回调备用) |

### 环境变量

```bash
QQ_BOT_APP_ID=your_app_id
QQ_BOT_APP_SECRET=your_app_secret
QQ_BOT_SANDBOX=false
```

### 注意事项

- WebSocket 断连需自动重连 + 心跳检测
- AccessToken 需缓存，过期前刷新
- `@mention` 需清理后再传入 Gateway

---

## Phase 4: 企业微信接入 (1 天)

### 核心要点

| 项目 | 说明 |
|------|------|
| API | 企业微信开放平台 |
| 接收 | GET 验证 URL + POST 接收加密消息 |
| 发送 | `cgi-bin/message/send` API |
| 加密 | AES-256-CBC，需 `WecomCrypto` 工具类 |
| 认证 | CorpID + CorpSecret → AccessToken (2h 有效) |
| 路由 | `GET/POST /wecom/callback` |

### 环境变量

```bash
WECOM_CORP_ID=your_corp_id
WECOM_CORP_SECRET=your_corp_secret
WECOM_AGENT_ID=your_agent_id
WECOM_CALLBACK_TOKEN=your_token
WECOM_CALLBACK_AES_KEY=your_aes_key_43_chars
```

### 注意事项

- XML 消息格式，需解析/构建 XML
- 消息加解密是主要复杂度，需独立 `WecomCrypto` 类 + 充分测试
- 被动回复需在 5 秒内，超时返回兜底消息

---

## 部署方案

> 对齐 T004 决策：当前阶段用最简方案，不搞 setup.sh

| 阶段 | 方案 | 成本 |
|------|------|------|
| **当前** | 本地 Docker + Cloudflare Tunnel | 免费 |
| 多人使用 | 轻量云服务器 (2C2G) + Docker | ~50 元/月 |
| 正式发布 | setup.sh 一键部署 | 参考 OpenClaw |

### docker-compose 扩展

在现有 `docker-compose.yml` 基础上增加各平台环境变量，通过 `.env` 文件注入。不配置的 Channel 不启用。

---

## 风险与缓解

| 风险 | 影响平台 | 缓解措施 |
|------|----------|----------|
| 5 秒超时 | QQ / 企业微信 | `withTimeout` 兜底消息 |
| 消息加解密 | 企业微信 | 独立 `WecomCrypto` + 单元测试 |
| Token 过期 | 全平台 | 提前 5 分钟刷新，缓存到内存 |
| WebSocket 断连 | QQ | 自动重连 + 心跳 |
| 长消息截断 | 全平台 | 自动分割超限消息 |

---

## 参考资源

### 官方文档
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [QQ 机器人文档](https://bot.q.qq.com/wiki/develop/api/)
- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
- [企业微信消息加解密](https://developer.work.weixin.qq.com/document/path/90307)

### 调研参考 (详见 PROGRESS.md)
- [OpenClaw](https://github.com/openclaw/openclaw) — Channel 插件化 + docker-setup.sh 一键部署
- [LangBot](https://github.com/langbot-app/LangBot) — 多平台接入参考
