# KURISU-013 多平台接入部署计划

> **任务类型**: Feature Implementation
> **优先级**: P1
> **状态**: Phase 0-2.1 代码完成，待用户配置 + Phase 3-4

---

## 目标

1. 统一 Server 骨架，Channel 插件化接入
2. Telegram 先行验证全链路，再接入 QQ / 企业微信
3. Cloudflare Tunnel 零成本部署

## 当前状态

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 0 | ✅ 完成 | BaseChannel + MockChannel + 统一消息格式 (+40 tests) |
| Phase 1 | ✅ 完成 | KurisuServer 统一 Server + Channel 路由 (+12 tests) |
| Phase 2 | ✅ 完成 | TelegramChannel 实现 (+15 tests) |
| Phase 2.1 | ✅ 完成 | Gateway 集成 (+5 tests) |
| **Phase 2.2** | 🔲 **用户操作** | Cloudflare Tunnel 配置 + 端到端测试 |
| Phase 3 | 🔲 待开发 | QQ Bot 接入 (延后) |
| Phase 4 | 🔲 待开发 | 企业微信接入 (延后) |

---

## Phase 2.2 用户操作 (待完成)

> 代码部分已完成，需要用户配置以下内容：

### 1. Cloudflare Tunnel 配置

```bash
# 安装 cloudflared
brew install cloudflared

# 临时隧道（测试用）
cloudflared tunnel --url http://localhost:3000

# 永久隧道（推荐）
cloudflared tunnel create kurisu
cloudflared tunnel route dns kurisu kurisu.yourdomain.com
cloudflared tunnel run kurisu
```

### 2. Telegram Bot 配置

1. 在 Telegram 中找 @BotFather 创建 Bot，获取 Token
2. 设置环境变量：

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://your-tunnel-url/telegram/webhook
```

### 3. 启动服务

```bash
docker compose up -d
```

### 4. 注册 Webhook

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${TELEGRAM_WEBHOOK_URL}"
```

### 5. 测试验证

- [ ] 向 Telegram Bot 发送消息
- [ ] 收到 Kurisu 的人设化回复
- [ ] 流式响应正常
- [ ] 会话隔离（不同用户独立 session）

---

## Phase 3-4 (延后)

> 等 KURISU-014 核心功能完成后再继续

### Phase 3: QQ Bot 接入 (P1)

| 项目 | 说明 |
|------|------|
| API | QQ Bot API v2，WebSocket + HTTP 回调 |
| 签名 | `x-bot-signature` 验证 |
| 复杂度 | WebSocket 断连重连 + AccessToken 管理 |

### Phase 4: 企业微信接入 (P2)

| 项目 | 说明 |
|------|------|
| API | 企业微信开放平台 |
| 加密 | AES-256-CBC，需 `WecomCrypto` 工具类 |
| 复杂度 | 消息加解密是主要难点 |

---

## 已完成产出

| 文件 | 说明 |
|------|------|
| `src/gateway/types.ts` | ChannelType 枚举 (10 平台) + 消息格式 |
| `src/gateway/channels/base.ts` | BaseChannel 抽象基类 |
| `src/gateway/channels/mock.ts` | MockChannel 测试实现 |
| `src/gateway/channels/telegram.ts` | TelegramChannel 实现 |
| `src/gateway/server.ts` | KurisuServer 统一 HTTP Server |
| `src/bin/server.ts` | 启动入口 |

**测试覆盖**: +72 tests

---

## 参考资源

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [QQ 机器人文档](https://bot.q.qq.com/wiki/develop/api/)
- [企业微信开发文档](https://developer.work.weixin.qq.com/document/)
