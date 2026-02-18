# Agent Team Task Specification

> kurisu 项目任务规范 - 详细索引见 [INDEX.md](INDEX.md)

---

## ⚡ TL;DR 执行清单 (MANDATORY)

> **开发新任务前必须遵守的流程**

### 1️⃣ 任务启动 (MANDATORY)

```
□ 创建任务文档: docs/tasks/active/KURISU-XXX-[name].md
□ 填写元信息: task_id, type, priority, layer, status
□ planner 调研参考项目 (deepwiki + github MCP)
□ 制定 Agent Team Plan
□ ⛔ 等待用户确认 Plan 后再执行
```

### 2️⃣ 执行检查点 (MANDATORY)

每个 agent 完成后 **必须**:
```
□ 更新任务文档进度 (打勾 ✓)
□ 记录 agent 输出到对应区域
□ 检查 context 使用率，≥65% → 提醒用户 /compact
```

**检查点序列**:
```
planner → □ → architect → □ → tdd-guide → □ → 实现 → □ → code-reviewer → □
```

### 3️⃣ 完成后 (MANDATORY)

```
□ 更新 PROGRESS.md
□ 更新 MEMORY.md (关键决策/踩坑)
□ Git commit + push
□ 提醒用户执行 /compact
```

---

## 五层架构映射

| Layer | 名称 | 前缀 |
|-------|------|------|
| L1 | 交互网关层 (Gateway) | gateway |
| L2 | 人设一致性引擎层 (Persona) | persona |
| L3 | Agent 编排层 (Orchestrator) | agent |
| L4 | 混合记忆引擎层 (Memory) | memory |
| L5 | 基础设施层 (Infrastructure) | infra |

---

## 任务模板

开发新任务时，复制以下模板到 `docs/tasks/active/KURISU-XXX-[name].md`:

```markdown
# Task: [任务名]

## 元信息
- task_id: KURISU-XXX
- type: new_module | feature | bugfix | refactor
- priority: high | medium | low
- layer: L1 | L2 | L3 | L4 | L5
- status: pending
- tags: [tag1, tag2]

## 需求描述
[描述要实现的功能]

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## Agent Team Plan
| Agent | 职责 | 状态 |
|-------|------|------|
| planner | 调研规划 | □ |
| architect | 架构设计 | □ |
| tdd-guide | 测试先行 | □ |
| 实现 | 编码 | □ |
| code-reviewer | 审查 | □ |

## 输出汇总
[各 agent 输出记录区域]
```

---

## Planner 调研要求 (MANDATORY)

planner agent 在规划前 **必须** 使用 MCP 工具调研相关开源项目：

**推荐参考项目**:
| 项目 | 用途 | 调研状态 |
|------|------|----------|
| vercel/ai | 流式处理模式 | |
| langchain-ai/langchainjs | Agent 编排 | |
| openclaw/openclaw | 部署架构、Channel 插件化、Docker 一键部署 | ✅ 已调研 |
| VedalAI/neuro-sdk | Neuro-sama 游戏集成 SDK、WebSocket 协议 | ✅ 已调研 |

**已有调研结论** (详见 PROGRESS.md 调研记录):
- OpenClaw: Gateway 常驻进程 + 运行时 Channel 注册 + docker-setup.sh 一键部署
- Neuro-sama: 2B 自训练模型 + 低延迟本地推理 + 人设微调内化

**调研命令**:
```
mcp__deepwiki__ask_question(repoName, question)
mcp__github__search_code(q, per_page)
```
