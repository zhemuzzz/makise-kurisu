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

### 📚 Planner 调研要求 (MANDATORY)

planner agent 在规划前 **必须** 使用 MCP 工具调研相关开源项目：

**推荐参考项目**:
| 项目 | 用途 | 调研重点 |
|------|------|----------|
| vercel/ai | 流式处理 | textStream, fullStream 模式 |
| langchain-ai/langchainjs | Agent 编排 | AsyncGenerator, CallbackHandler |
| OpenClaw/OpenClaw | AI VTuber 架构 | Gateway/Channel 多渠道 |
| VedalAI/neuro-game | Neuro-sama | 交互系统、人设管理 |

**调研命令**:
```
# DeepWiki 查询架构
mcp__deepwiki__ask_question(repoName, question)

# GitHub 搜索代码
mcp__github__search_code(q, per_page)

# GitHub 搜索仓库
mcp__github__search_repositories(query, perPage)
```

**调研产出必须包含**:
- 参考项目的关键模式/接口设计
- 与任务相关的最佳实践
- 可复用的设计决策

### 2️⃣ 执行检查点 (MANDATORY)

每个 agent 完成后 **必须**:
```
□ 更新任务文档进度 (打勾 ✓)
□ 记录 agent 输出到对应区域
□ 检查 context 使用率，≥65% → 提醒用户 /compact
```

**检查点序列**:
```
planner → □ 更新 → architect → □ 更新 → tdd-guide → □ 更新
                                           ↓
                               实现 (每文件 □ 更新)
                                           ↓
                               code-reviewer → □ 更新
```

### 3️⃣ 完成后 (MANDATORY)

```
□ 更新 PROGRESS.md
□ 更新 MEMORY.md (关键决策/踩坑)
□ Git commit + push
□ 提醒用户执行 /compact
```

### ⚠️ 常见违规

| 违规 | 正确做法 |
|------|----------|
| 直接编码 | 先创建任务文档，等确认 |
| 跳过 tdd-guide | 必须先写测试 |
| 忘记 compact | 每个子任务完成后检查提醒 |
| 只 commit 不 push | commit 后立即 push |

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

## 时间追踪
- created: YYYY-MM-DD
- estimated_time: Xh
- actual_time: null

## 依赖
- depends_on: []
- related_tasks: []

## 需求描述
[描述要实现的功能]

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## 相关文件
- src/path/to/file.ts
- tests/path/to/test.ts

## Agent Team Plan

### Team 组合
| Agent | 职责 | 执行方式 |
|-------|------|----------|
| planner | 分析 | 并行/串行 |
| architect | 设计 | 并行/串行 |

### 执行流程
并行组 → 串行组 → 实现 → 审查

## 进度
- [ ] planner
- [ ] architect
- [ ] tdd-guide
- [ ] 实现
- [ ] code-reviewer

## 输出汇总

### planner
**时间**: [待填写]
**调研参考**: [使用的 MCP 工具和参考项目]
[planner 输出]

### architect
**时间**: [待填写]
[architect 输出]

### tdd-guide
**时间**: [待填写]
[tdd-guide 输出]

### code-reviewer
**时间**: [待填写]
[code-reviewer 输出]

## 审查问题追踪
| ID | 来源 | 问题 | 修复commit | 状态 |
|----|------|------|-----------|------|
| R01 | code-reviewer | 描述 | abc123 | 待修复 |

## 最终产出
- 文件: [修改的文件列表]
- 测试: [测试文件]
- 覆盖率: X%
```

---

## 相关规范

| 规范 | 文件 |
|------|------|
| Git 提交 | [git-workflow.md](rules/common/git-workflow.md) |
| Agent 协作 | [agents.md](rules/common/agents.md) |
| 测试要求 | [testing.md](rules/common/testing.md) |
| 代码风格 | [coding-style.md](rules/common/coding-style.md) |
