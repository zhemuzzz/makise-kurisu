# Git Workflow

> **任务流程**: 开发新任务必须遵守 [TASK.md](../../TASK.md) 的 TL;DR 执行清单

---

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: feat, fix, refactor, docs, test, chore, perf, ci

Note: Attribution disabled globally via ~/.claude/settings.json.

## Post-Commit (MANDATORY)

每次 git commit 后 **必须** 执行：

```
git commit → 更新 PROGRESS.md → 保存记忆 → 提醒用户 /compact
```

### 触发条件

| 条件 | 动作 |
|------|------|
| 每次 commit 完成后 | **提醒用户** /compact |
| Context ≥ 65% | **提醒用户** /compact |
| 自动 compact | 75% 时 Claude Code 自动触发 |

### 自动 Compact 配置

```bash
# 在 ~/.zshrc 中添加：
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75
```

| 配置项 | 说明 |
|--------|------|
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75` | Context 达 75% 时自动 compact |

### Compact 前必须保存

1. **PROGRESS.md** — 本次变更摘要
2. **MEMORY.md** — 关键决策/踩坑记录

## Pull Request Workflow

When creating PRs:
1. Analyze full commit history (not just latest commit)
2. Use `git diff [base-branch]...HEAD` to see all changes
3. Draft comprehensive PR summary
4. Include test plan with TODOs
5. Push with `-u` flag if new branch
