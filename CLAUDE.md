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

## 模型配置化

> 配置文件: [config/models.yaml](config/models.yaml)

| 模型 | 用途 |
|------|------|
| GLM-5 | conversation, code, embedding |
| MiniMax-M2.5 | reasoning |

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

## 参考资源

- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [SillyTavern Prompt Engineering](https://www.reddit.com/r/SillyTavernAI/)
