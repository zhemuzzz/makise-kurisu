# Kurisu 项目进度追踪

> 最后更新: 2026-02-18
> 状态: MVP 完成，多平台接入开发中

## 当前状态

**阶段**: KURISU-013 多平台接入
**焦点**: Phase 0 完成，Phase 1 统一 Server 开发中

### 近期变更

- **CLAUDE.md 更新**: 同步多平台接入进展，添加 Cloudflare Tunnel 部署方案
- **MEMORY.md 更新**: 调整部署演进路线，添加平台优先级

## 已完成模块

### MVP 核心功能 ✅

| 层级 | 模块 | 测试数 | 覆盖率 |
|------|------|--------|--------|
| L2 | 人设引擎 | 288 | - |
| L3 | Agent 编排 | 21 | - |
| L4 | 记忆系统 | 184 | - |
| L1 | 交互网关 | 207 | 98.47% |
| E2E | 端到端测试 | 67 | - |
| L5 | 基础设施 | - | - |

**总计**: 902 tests, 83.25% coverage

### KURISU-013 多平台接入 (2026-02-18)

**Phase 0 完成** ✅
- 扩展 `ChannelType` 枚举: WECHAT/WECOM/QQ/TELEGRAM/FEISHU/DINGTALK
- 统一消息格式: `InboundMessage`/`OutboundMessage` 接口
- `BaseChannel` 抽象基类: 生命周期管理 + 工具方法
- `MockChannel` 实现: 用于测试 Server 和 Gateway
- +40 测试用例

**下一步**: Phase 1 统一 Server + Cloudflare Tunnel → Phase 2 Telegram 接入

### 近期完成 (2026-02-17~18)

- **TypeScript 严格模式**: 修复 44 个类型错误
- **ESLint 配置**: `.eslintrc.js` + 覆盖规则
- **Snyk 安全扫描**: GitHub Actions 集成
- **Docker 容器化**: Dockerfile + docker-compose
- **HTTP API**: `/health`, `/ready`, `/api/sessions/*`
- **人设引擎增强**: Lore 术语库、TRIGGER_KEYWORDS、Code Review 修复

## 关键文件

```
kurisu/
├── CLAUDE.md              # 项目规范
├── PROGRESS.md            # 本文件
├── config/models.yaml     # 模型配置
├── src/
│   ├── core/persona/      # L2 人设引擎
│   ├── agents/            # L3 Agent 编排
│   ├── memory/            # L4 记忆系统
│   ├── gateway/           # L1 交互网关
│   └── config/models/     # L5 基础设施
└── .claude/
    ├── INDEX.md           # 规范索引
    └── TASK.md            # 任务流程
```

## 技术决策

| ID | 决策 | 日期 |
|----|------|------|
| T001 | YAML 配置 + 环境变量注入 | 2026-02-16 |
| T002 | Anthropic 兼容 API 优先 | 2026-02-16 |
| T003 | GLM-5 API 先行，跑通全流程后再切本地模型 | 2026-02-18 |
| T004 | setup.sh 部署脚本延后，等多平台跑通后再实现 | 2026-02-18 |
| T005 | 对话质量优化方向：降低延迟 + 人设微调，而非换更大模型 | 2026-02-18 |

## 调研记录 (2026-02-18)

### OpenClaw vs Neuro-sama 对比调研

**Neuro-sama**:
- 自训练 2B 模型 + q2_k 量化，本地推理 <1s
- 核心优势是低延迟和人设内化（微调），非模型规模
- 闭源，仅公开游戏集成 SDK

**OpenClaw**:
- Docker Gateway + CLI + Sandbox 三层架构
- `docker-setup.sh` 一键 onboarding
- 运行时插件化 Channel，WebSocket 常驻 Gateway

**对 Kurisu 的启示**:
- 模型演进路线：API 验证 → 本地部署 → LoRA 微调 → 量化优化
- 部署演进路线：手动配置 → setup.sh → 交互式向导 → Control UI
- 延迟优化：validate 异步化，不阻塞流式输出

## 下一步

### 近期（KURISU-013 继续）
- Phase 1 统一 Server 骨架 + Cloudflare Tunnel
- Phase 2 Telegram 接入 (P0，最简平台先验证全链路)
- Phase 3 QQ Bot 接入 (P1)
- 启用 Redis，session 持久化

### 中期（Post-MVP）
- 流式响应异步校验
- WebSocket Gateway 长连接
- LongTermMemory 实现
- Channel 运行时注册

### 远期
- 本地模型部署 + LoRA 微调
- setup.sh 一键部署
- TTS 语音合成
- Control UI 管理面板
