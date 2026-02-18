# Makise Kurisu - 项目指令

> Claude Code 项目专用配置和设计文档

## ⚠️ 开发规范

> **开发任何新任务前必须阅读**: [.claude/INDEX.md](.claude/INDEX.md)

**强制流程**:
```
创建任务文档 → 制定 Plan → 等待用户确认 → 执行 → commit → /compact
```

---

## 核心架构

五层分层解耦架构：

```
L1. 交互网关层 (Gateway) - 多渠道接入，流式处理
L2. 人设一致性引擎层 (Persona Engine) ⭐核心 - 三层管控
L3. Agent 编排层 (Agent Orchestrator) - LangGraph 状态机
L4. 混合记忆引擎层 (Hybrid Memory) - 四层记忆
L5. 基础设施层 (Infrastructure) - 模型配置化 + MCP
```

## 人设一致性引擎

> 详细配置: [docs/persona/KURISU_PERSONA_REFERENCE.md](docs/persona/KURISU_PERSONA_REFERENCE.md)

### 三层管控架构

```
Layer 1: 核心人设硬约束（不可修改）
    ↓
Layer 2: 动态心智模型（持续更新）
    ↓
Layer 3: 实时合规校验（每轮检查）
```

### 核心人设 (牧濑红莉栖)

- 18岁天才少女科学家，维克多·孔多利亚大学研究员
- 性格：理智 × 傲娇 × 好强 × 内向
- 说话习惯：用"哼"开头，反问句，被说傲娇会反驳

## 模型策略

> 配置文件: [config/models.yaml](config/models.yaml)

### 当前阶段：GLM-5 API 验证

| 模型 | 用途 |
|------|------|
| GLM-5 | conversation, code, embedding |
| MiniMax-M2.5 | reasoning |

### 模型演进路线

```
Phase 1: GLM-5 API 跑通全流程（当前）
    ↓ 收集基准数据（人设遵循率、validate 重试率、端到端延迟）
Phase 2: 本地部署开源模型（Qwen2.5-7B / GLM-4-9B）
    ↓ 对比基准线，验证本地部署可行性
Phase 3: LoRA 微调 Kurisu 人设
    ↓ 人设内化，减少 validate/enforce 干预
Phase 4: 量化压缩 + 延迟优化
```

**核心原则**：先用 API 模型跑通全流程建立基准线，再逐步切换本地模型。不同时引入多个变量。

## Agent 架构

> 实现: [src/agents/](src/agents/)

| Agent | 职责 | 占比 |
|-------|------|------|
| Lead Agent | 人设维护 + 任务委派 | - |
| Conversation Agent | 日常对话 | 80% |
| Task Agent | 工具调用 + 任务执行 | 20% |

状态流转: `START → context_build → route → generate → validate → enforce → END`

## 记忆系统

> 实现: [src/memory/](src/memory/)

四层记忆：SessionMemory(瞬时) → ShortTermMemory(短期) → LongTermMemory(长期) → SkillDatabase(技能)

## 部署策略

### 当前阶段：本地 Docker + Cloudflare Tunnel

```
git clone → 配置 .env → docker compose up → cloudflared tunnel
```

### 部署演进路线

| 阶段 | 内容 | 触发时机 |
|------|------|----------|
| **当前** | 本地 Docker + Cloudflare Tunnel | 免费，多平台 Webhook 验证 |
| 多人使用 | 轻量云服务器 (2C2G) + Docker | ~50 元/月 |
| 多平台稳定后 | 基础 `setup.sh`：依赖检查 → .env 生成 → 构建 → 启动 | 准备给第二个人用时 |
| 正式发布 | 完整 onboarding + Control UI | 面向普通用户时 |

**参考**：OpenClaw 的 `docker-setup.sh` 一键部署流程

## 多平台接入 (KURISU-013)

> 详细计划: [.claude/tasks/KURISU-013-MULTI-CHANNEL-DEPLOY.md](.claude/tasks/KURISU-013-MULTI-CHANNEL-DEPLOY.md)

### 当前状态

- ✅ Phase 0: BaseChannel 抽象基类 + MockChannel + 统一消息格式
- 🔲 Phase 1: 统一 Server 骨架 + Cloudflare Tunnel
- 🔲 Phase 2: Telegram 接入 (P0，最简平台先行)
- 🔲 Phase 3: QQ Bot 接入 (P1)
- 🔲 Phase 4: 企业微信接入 (P2)

### 平台优先级

> **原则**: 先用最简平台验证全链路 (同 T003 GLM-5 先行策略)

| 优先级 | 平台 | 理由 |
|--------|------|------|
| **P0** | Telegram | API 最简，无签名验证，0.5 天跑通 |
| P1 | QQ | 国内覆盖最大 |
| P2 | 企业微信 | 加解密复杂，延后处理 |

## MVP 范围

| 模块 | MVP 范围 | 砍掉的功能 |
|------|----------|-----------|
| 人设引擎 | 核心硬约束 + 基础校验 | 动态心智模型 |
| Agent 编排 | 单 Agent 对话 | Agent Teams |
| 记忆系统 | 瞬时 + 短期记忆 | 长期记忆 |
| 交互网关 | 文本流式 | 语音 + 直播 |

## 开发规范

1. 先跑通最小闭环，再堆功能
2. 所有模块接口抽象，强依赖注入
3. TypeScript 严格类型，禁止 any
4. 核心模块先写测试，再写业务代码
5. 敏感信息禁止硬编码
6. **每次 git commit 后必须**：更新 PROGRESS.md → 保存记忆 → 执行 `/compact`

## Post-MVP 路线图

| 优先级 | 改动 | 依赖 | 状态 |
|--------|------|------|------|
| P0 | 多平台接入 (Telegram/QQ/企业微信) | L1 | 进行中 |
| P0 | 流式响应异步校验（validate 不阻塞输出） | L3 | - |
| P0 | 启用 Redis，session 持久化 | L5 | - |
| P1 | WebSocket Gateway 长连接支持 | L1 | - |
| P1 | LongTermMemory 实现 | L4 | - |
| P1 | Channel 运行时注册（替代编译时枚举） | L1 | - |
| P2 | 本地模型部署 + 基准线对比 | L5 | - |
| P2 | LoRA 微调 Kurisu 人设 | L5 | - |
| P3 | TTS 语音合成（Azure TTS） | L1 | - |
| P3 | setup.sh 一键部署脚本 | L5 | 延后 |
| P3 | Control UI 管理面板 | L5 | - |

## 调研结论

### Neuro-sama（对话质量参考）
- 自训练 2B 参数模型，q2_k 量化，非 GPT/Claude
- 核心优势是**低延迟**（本地推理 <1s）和**人设深度内化**（微调而非工程兜底）
- 启示：对话质量瓶颈在延迟和人设内化，不在模型大小

### OpenClaw（部署体验参考）
- Docker Gateway + CLI + Sandbox 三层架构
- `docker-setup.sh` 一键部署：依赖检查 → Token 生成 → 镜像构建 → Channel 配置 → 启动
- 运行时插件化 Channel，WebSocket 常驻 Gateway
- 启示：部署体验核心在自动化 onboarding

## 参考资源

- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Neuro-sama Wikipedia](https://en.wikipedia.org/wiki/Neuro-sama)
- [SillyTavern Prompt Engineering](https://www.reddit.com/r/SillyTavernAI/)
