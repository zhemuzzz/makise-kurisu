# kurisu 规范索引

> Claude Code 开发规范的单一入口

## ⚠️ 强制规范 (MANDATORY)

开发任何新任务 **必须** 遵守以下流程：

```
┌─────────────────────────────────────────────────────────┐
│  1. 创建任务文档 → docs/tasks/active/KURISU-XXX.md      │
│  2. 制定 Plan → 等待用户确认                            │
│  3. 执行 → 每个 agent 完成后更新进度                    │
│  4. 完成后 → commit → 更新 PROGRESS.md → /compact       │
└─────────────────────────────────────────────────────────┘
```

**详细流程**: [TASK.md](TASK.md) 的 TL;DR 执行清单

## 规范文档索引

| 文档 | 用途 | 何时参考 |
|------|------|----------|
| [TASK.md](TASK.md) | **任务流程规范** | 开发新任务前必读 |
| [git-workflow.md](rules/common/git-workflow.md) | Git 提交规范 | commit 前参考 |
| [agents.md](rules/common/agents.md) | Agent 协作规范 | 使用 agent 时参考 |
| [testing.md](rules/common/testing.md) | 测试规范 (80%+) | 写测试时参考 |
| [coding-style.md](rules/common/coding-style.md) | 代码风格 | 编码时参考 |
| [security.md](rules/common/security.md) | 安全规范 | commit 前检查 |

## 技术参考

| 文档 | 用途 |
|------|------|
| [langgraph-patterns](skills/langgraph-patterns/SKILL.md) | LangGraph 状态机模式 |
| [mem0-integration](skills/mem0-integration/SKILL.md) | Mem0AI 集成模式 |

## 快速命令

```bash
# 测试
pnpm test              # 运行所有测试
pnpm test:coverage     # 覆盖率报告

# 类型检查
pnpm typecheck         # TypeScript 编译检查

# 提交
git commit -m "feat: 描述"  # 提交后必须更新 PROGRESS.md + /compact
```

## 常见违规

| 违规 | 后果 | 正确做法 |
|------|------|----------|
| 跳过任务文档 | 流程失控 | 先创建文档，等确认 |
| 只 commit 不 push | 远程不同步 | commit 后立即 push |
| 忘记 /compact | 上下文丢失 | commit 后立即执行 |
| 跳过 tdd-guide | 测试不足 | 先写测试再实现 |

## 项目状态文件

| 文件 | 用途 | 更新时机 |
|------|------|----------|
| [PROGRESS.md](../PROGRESS.md) | 项目进度 | 每次 commit 后 |
| [MEMORY.md](../memory/MEMORY.md) | 项目记忆 | 关键决策/踩坑后 |
| [CLAUDE.md](../CLAUDE.md) | 架构设计 | 架构变更时 |
