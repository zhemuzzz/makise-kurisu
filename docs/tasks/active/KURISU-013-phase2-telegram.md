# Task: KURISU-013 Phase 2 - Telegram Channel

## 元信息
- task_id: KURISU-013
- type: feature
- priority: high
- layer: L1 (Gateway)
- status: pending
- tags: [telegram, channel, webhook, bot]

## 需求描述

实现 Telegram Bot Channel，继承 BaseChannel，实现：
1. Webhook 接收 Telegram 消息
2. 消息格式转换 (Telegram Update → InboundMessage)
3. 发送消息到 Telegram (sendMessage API)
4. 集成到 KurisuServer

### 为什么选择 Telegram 先行

| 因素 | Telegram | QQ | 企业微信 |
|------|----------|-----|----------|
| 签名验证 | 无 | 有 | 有 |
| 消息加密 | 无 | 无 | AES-256-CBC |
| 文档质量 | 优秀 | 一般 | 一般 |
| 预计耗时 | 0.5 天 | 1.5 天 | 1 天 |

## 验收标准

- [ ] TelegramChannel 类继承 BaseChannel
- [ ] handleRequest 正确解析 Telegram Update
- [ ] sendMessage 调用 Telegram API 成功
- [ ] verifySignature 直接返回 true (Telegram 无签名)
- [ ] getRoutes 返回 `POST /telegram/webhook`
- [ ] 单元测试覆盖率 ≥ 80%
- [ ] 集成到 src/bin/server.ts
- [ ] 全链路验证通过

## Agent Team Plan

| Agent | 职责 | 状态 |
|-------|------|------|
| planner | 调研 Telegram API + 设计方案 | □ |
| tdd-guide | 先写测试用例 | □ |
| 实现 | 编码 TelegramChannel | □ |
| code-reviewer | 审查代码质量 | □ |

---

## 输出汇总

### Planner 输出

> 调研 Telegram Bot API，设计方案

### TDD Guide 输出

> 测试用例设计

### 实现输出

> 代码实现记录

### Code Review 输出

> 代码审查结果

---

## 技术设计

### Telegram Update 结构

```typescript
interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: 'private' | 'group' | 'supergroup' | 'channel';
    };
    text?: string;
    date: number;
  };
}
```

### 环境变量

```bash
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
```

### 路由

- `POST /telegram/webhook` - 接收 Telegram Webhook

### 错误处理

- 无效 JSON → 400 Bad Request
- 非 Update 结构 → 400 Bad Request
- 非 text 消息 → 忽略，返回 200 OK
- sendMessage 失败 → 记录日志，不抛出
