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

1. **Plan First**
   - Use **planner** agent to create implementation plan
   - Identify dependencies and risks
   - Break down into phases

2. **TDD Approach**
   - Use **tdd-guide** agent
   - Write tests first (RED)
   - Implement to pass tests (GREEN)
   - Refactor (IMPROVE)
   - Verify 80%+ coverage

3. **Code Review**
   - Use **code-reviewer** agent immediately after writing code
   - Address CRITICAL and HIGH issues
   - Fix MEDIUM issues when possible

4. **Commit & Push**
   - Detailed commit messages
   - Follow conventional commits format

5. **Post-Commit (MANDATORY)**
   - Update `PROGRESS.md` with changes summary
   - Save key learnings to auto memory (`MEMORY.md`)
   - Execute `/compact` to compress context

## Post-Commit Compact 规范

每次 git commit 后 **必须** 执行以下流程：

```
git commit → 更新 PROGRESS.md → 保存记忆 → /compact
```

### 触发条件

| 条件 | 动作 |
|------|------|
| 每次 git commit 完成后 | **必须** compact |
| Context 达到 65% | **主动** compact（不等 commit） |
| 子任务阶段切换时 | **建议** compact |

### Compact 前必须保存

1. **PROGRESS.md** — 本次变更摘要、模块状态更新
2. **auto memory (MEMORY.md)** — 项目知识、决策、踩坑记录
3. **TodoWrite** — 标记已完成任务，记录待办

### 目的

- 防止长对话 context 溢出导致丢失上下文
- 确保关键信息持久化到文件，而非仅存在于对话中
- 新对话可通过 `PROGRESS.md` + `MEMORY.md` 快速恢复
