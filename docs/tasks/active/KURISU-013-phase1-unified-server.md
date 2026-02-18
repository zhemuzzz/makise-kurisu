# Task: Phase 1 统一 Server + Channel 插件化

## 元信息
- task_id: KURISU-013-Phase1
- type: feature
- priority: high
- layer: L1
- status: completed
- tags: [gateway, channel, server]

## 需求描述

KURISU-013 多平台接入的 Phase 1，目标是：
1. 扩展现有 HTTP Server 支持 Channel 插件化路由
2. 添加 `getRoutes()` 抽象方法让 Channel 自声明路由
3. 为 Phase 2 (Telegram) 和后续平台接入奠定基础

**关键发现**：现有 `src/bin/server.ts` 使用 Node.js 原生 `http` 模块，不是 Express。计划调整为继续使用原生 http 模块以保持一致性。

## 验收标准
- [x] BaseChannel 新增 `getRoutes()` 抽象方法
- [x] BaseChannel 新增 `withTimeout()` 工具方法
- [x] 创建 KurisuServer 统一 HTTP Server
- [x] MockChannel 实现 `getRoutes()` 返回路由
- [x] MockChannel 兼容原生 http 和 Express 风格 API
- [x] 环境变量启用 Channel (`ENABLE_MOCK_CHANNEL=true`)
- [x] 测试覆盖率 >= 80%

## Agent Team Plan
| Agent | 职责 | 状态 |
|-------|------|------|
| planner | 调研规划 | ✓ |
| architect | 架构设计 | □ (跳过，沿用现有架构) |
| tdd-guide | 测试先行 | ✓ |
| 实现 | 编码 | ✓ |
| code-reviewer | 审查 | ✓ |

## 设计决策

**选择：继续使用原生 http 模块**（而非引入 Express）

理由：
- 与现有代码风格一致
- 无新依赖，保持轻量
- 项目规范"先跑通最小闭环"

## 输出汇总

### 文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/gateway/channels/base.ts` | 修改 | 添加 getRoutes, withTimeout |
| `src/gateway/server.ts` | 新建 | KurisuServer 类 |
| `src/gateway/channels/mock.ts` | 修改 | 实现 getRoutes |
| `src/gateway/index.ts` | 修改 | 导出 KurisuServer |
| `src/bin/server.ts` | 修改 | 使用 KurisuServer |
| `tests/gateway/server.test.ts` | 新建 | Server 测试 |
| `tests/gateway/channels/mock.test.ts` | 修改 | 添加 getRoutes 测试 |

### Commit 记录
- `b77697a` feat: KURISU-013 Phase 1 统一 Server + Channel 插件化
- `db25399` docs: 更新 PROGRESS.md - KURISU-013 Phase 1 完成

### 测试结果
- 914 tests passed
- 83.25% coverage

## 踩坑记录

1. **req.body undefined**: KurisuServer 需要先解析 body 再传给 Channel handler
2. **res.status is not a function**: MockChannel 需兼容原生 http 和 Express 风格
3. **healthCheck() async**: `/ready` 端点需用 `Promise.all()` 等待异步健康检查
4. **"Server is not running"**: stop() 需处理 server 未启动的情况

## 下一步

- Phase 2: Telegram 接入
- Phase 2: Cloudflare Tunnel 配置
