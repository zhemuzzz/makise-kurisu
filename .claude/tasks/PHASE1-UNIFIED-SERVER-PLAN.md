# Phase 1: 统一 Server + Channel 插件化 - 实现计划

## Context

KURISU-013 多平台接入的 Phase 1，目标是：
1. 扩展现有 HTTP Server 支持 Channel 插件化路由
2. 添加 `getRoutes()` 抽象方法让 Channel 自声明路由
3. 为 Phase 2 (Telegram) 和后续平台接入奠定基础

**关键发现**：现有 `src/bin/server.ts` 使用 Node.js 原生 `http` 模块，不是 Express。计划需要调整以保持一致性。

---

## Design Decision

**选择：继续使用原生 http 模块**（而非引入 Express）

理由：
- 与现有代码风格一致
- 无新依赖，保持轻量
- 项目规范"先跑通最小闭环"

---

## Implementation Plan

### Step 1: 扩展 BaseChannel 抽象类

**文件**: `src/gateway/channels/base.ts`

添加抽象方法和路由类型：

```typescript
// 新增路由定义接口
export interface ChannelRoute {
  method: 'GET' | 'POST';
  path: string;
}

// BaseChannel 新增抽象方法
abstract getRoutes(): ChannelRoute[];

// 新增工具方法
protected async withTimeout<T>(
  promise: Promise<T>,
  fallback: string
): Promise<T | string>
```

### Step 2: 创建 KurisuServer 类

**文件**: `src/gateway/server.ts` (新建)

职责：
- 管理多个 Channel 实例
- 自动注册 Channel 路由
- 统一健康检查端点
- 优雅关闭

```typescript
export class KurisuServer {
  private channels: Map<string, BaseChannel>;
  private gateway: Gateway;
  private server?: http.Server;

  constructor(deps: { gateway: Gateway });

  // 注册 Channel
  registerChannel(name: string, channel: BaseChannel): void;

  // 自动注册所有 Channel 路由
  private setupRoutes(): void;

  // 启动/停止
  start(port: number, host: string): Promise<void>;
  stop(): Promise<void>;
}
```

### Step 3: 更新 MockChannel 实现

**文件**: `src/gateway/channels/mock.ts`

- 实现 `getRoutes()` 返回 `POST /mock/webhook`
- 使用 `withTimeout` 工具方法

### Step 4: 重构启动入口

**文件**: `src/bin/server.ts`

- 替换 `SimpleHttpServer` 为 `KurisuServer`
- 根据环境变量启用 Channel:
  - `ENABLE_MOCK_CHANNEL=true` → MockChannel
  - `TELEGRAM_BOT_TOKEN` → TelegramChannel (Phase 2)
  - `QQ_BOT_APP_ID` → QQChannel (Phase 3)

### Step 5: 添加 Server 测试

**文件**: `tests/gateway/server.test.ts` (新建)

测试覆盖：
- 健康检查端点
- Channel 路由注册
- MockChannel 请求处理
- 优雅关闭

---

## Files to Modify

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/gateway/channels/base.ts` | 修改 | 添加 getRoutes, withTimeout |
| `src/gateway/server.ts` | 新建 | KurisuServer 类 |
| `src/gateway/channels/mock.ts` | 修改 | 实现 getRoutes |
| `src/gateway/index.ts` | 修改 | 导出 KurisuServer |
| `src/bin/server.ts` | 修改 | 使用 KurisuServer |
| `tests/gateway/server.test.ts` | 新建 | Server 测试 |
| `tests/gateway/channels/mock.test.ts` | 修改 | 添加 getRoutes 测试 |

---

## Verification

### 1. 单元测试
```bash
pnpm test tests/gateway/server.test.ts
pnpm test tests/gateway/channels/mock.test.ts
```

### 2. 手动验证
```bash
# 启动服务
ENABLE_MOCK_CHANNEL=true pnpm start:server

# 健康检查
curl http://localhost:3000/health

# Mock Channel 测试
curl -X POST http://localhost:3000/mock/webhook \
  -H "Content-Type: application/json" \
  -d '{"content": "hello", "userId": "test"}'
```

### 3. 测试覆盖率
```bash
pnpm test:coverage
# 确保覆盖率 >= 80%
```

---

## Out of Scope (Phase 2+)

- TelegramChannel 实现
- Cloudflare Tunnel 配置
- 实际平台接入
