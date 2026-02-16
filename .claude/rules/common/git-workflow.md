# Git Workflow

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch

## Feature Implementation Workflow

> 详见 `.claude/TASK.md` 的 TL;DR 执行清单

### 0️⃣ 任务启动 (MANDATORY - 最重要)

```
□ 创建任务文档: docs/tasks/active/KURISU-XXX-[name].md
□ 填写元信息并制定 Agent Team Plan
□ ⛔ 等待用户确认 Plan 后再执行
```

**任务文档模板**: 见 `.claude/TASK.md` 底部

### 1️⃣ Plan First

- Use **planner** agent to create implementation plan
- Identify dependencies and risks
- Break down into phases
- **更新任务文档进度**

### 2️⃣ TDD Approach

- Use **tdd-guide** agent
- Write tests first (RED)
- Implement to pass tests (GREEN)
- Refactor (IMPROVE)
- Verify 80%+ coverage
- **更新任务文档进度**

### 3️⃣ Code Review

- Use **code-reviewer** agent immediately after writing code
- Address CRITICAL and HIGH issues
- Fix MEDIUM issues when possible
- **更新任务文档进度**

### 4️⃣ Commit & Push

- Detailed commit messages
- Follow conventional commits format
- **Push immediately after commit** (不要只 commit 不 push)

### 5️⃣ Post-Commit (MANDATORY)

- Update `PROGRESS.md` with changes summary
- Save key learnings to auto memory (`MEMORY.md`)
- **提醒用户执行 `/compact`**

## Post-Commit Compact 规范

每次 git commit 后 **必须** 执行以下流程：

```
git commit → 更新 PROGRESS.md → 保存记忆 → /compact
```

### 触发条件

| 条件 | 动作 |
|------|------|
| 每次 git commit 完成后 | **必须** compact |
| Context 达到自动阈值 | Claude Code **自动** compact（见下方配置） |
| 子任务阶段切换时 | **建议** 手动 `/compact` |

### 自动 Compact 配置

Claude Code 内置自动 compact，通过环境变量控制触发阈值：

```bash
# 在 shell profile (~/.zshrc 或 ~/.bashrc) 中添加：
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75
```

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `75` | Context 使用达 75% 时自动 compact |
| 默认值（不设置） | `~83.5%` | Claude Code 默认阈值 |
| 取值范围 | `1-100` | 越小越早触发，越大可用 context 越多 |

**推荐 75%**：比默认提前触发，为 post-commit 保存流程预留足够空间。

### Compact 前必须保存

1. **PROGRESS.md** — 本次变更摘要、模块状态更新
2. **auto memory (MEMORY.md)** — 项目知识、决策、踩坑记录
3. **TodoWrite** — 标记已完成任务，记录待办

> 注意：自动 compact 不会等你保存，所以养成 **commit 后立即保存** 的习惯。

### 目的

- 防止长对话 context 溢出导致丢失上下文
- 确保关键信息持久化到文件，而非仅存在于对话中
- 新对话可通过 `PROGRESS.md` + `MEMORY.md` 快速恢复
