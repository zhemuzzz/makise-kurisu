# KURISU-013 Phase 2.1: Telegram Gateway 集成

> 状态: **Step 1-2 完成，Step 3-4 待用户手动操作**
> 创建: 2026-02-19
> 更新: 2026-02-19

## 目标

完成 Telegram 对话闭环：收消息 → Gateway 处理 → 回复

## 背景

Phase 2 已完成 TelegramChannel 的基础实现：
- ✅ Webhook 接收 `/telegram/webhook`
- ✅ InboundMessage 构建
- ✅ sendMessage API 封装
- ❌ **未集成 Gateway** - handleRequest 只存储 lastInboundMessage

## 执行计划

### Step 1: TelegramChannel 注入 Gateway ✅

**修改文件**: `src/gateway/channels/telegram.ts`

1. 扩展 TelegramConfig 接收 Gateway:
```typescript
export interface TelegramConfig extends ChannelConfig {
  botToken: string;
  webhookUrl?: string;
  gateway?: GatewayLike;  // 新增（可选，向后兼容）
}
```

2. handleRequest 调用 Gateway（设计决策：先返回 200 避免 Telegram 超时）

**测试**: 新增 5 个 Gateway 集成测试用例

### Step 2: 修改 server.ts 创建逻辑 ✅

**修改文件**: `src/bin/server.ts`

- `createChannels(gateway: Gateway)` - 接收 Gateway 参数
- 创建 `telegramGateway` 适配器
- main() 中 `createChannels(gateway)` 在创建 Server 之前调用

### Step 3: Cloudflare Tunnel 配置 (待用户操作)

```bash
# 安装 cloudflared
brew install cloudflare/cloudflare/cloudflared

# 启动 tunnel（新终端）
cloudflared tunnel --url http://localhost:3000

# 输出示例：
# Your quick Tunnel has been created! Visit it at:
# https://xxx.trycloudflare.com
```

将 `https://xxx.trycloudflare.com/telegram/webhook` 设为 TELEGRAM_WEBHOOK_URL

### Step 4: Telegram 配置 + 测试 (待用户操作)

1. 从 @BotFather 获取 token（如果还没有）
2. 配置 `.env`:
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_WEBHOOK_URL=https://xxx.trycloudflare.com/telegram/webhook
```

3. 启动 server:
```bash
npm run build
npm run start
```

4. 在 Telegram 发消息测试

## 验收标准

- [x] 代码修改完成，测试通过 (934 tests)
- [ ] 收到 Telegram 消息后 Kurisu 能回复（需 Step 3-4）
- [ ] 回复内容符合人设（傲娇、理智）
- [x] 测试覆盖率维持 80%+

## 风险

| 风险 | 缓解措施 |
|------|----------|
| Gateway.processStream 接口不兼容 | ✅ 检查 IOrchestrator 接口定义 |
| 流式响应处理复杂 | ✅ 先用完整响应，后续优化流式 |
| Cloudflare Tunnel 不稳定 | 备选：ngrok |
