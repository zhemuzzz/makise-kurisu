# KURISU-008: Lore 集成 PromptBuilder

## 概要

将 `lore.ts` 的 Steins;Gate 术语库集成到 `PromptBuilder`，让 RP 提示词包含世界观知识。

## 修改文件

| 文件 | 变更 |
|------|------|
| `src/core/persona/prompt-builder.ts` | 新增 `buildLoreSection()` 方法 |
| `tests/unit/persona/prompt-builder.test.ts` | 新增 ~10 个 lore 相关测试 |

## 实现方案

两层 Lore 注入：
1. **静态背景** — 高重要性术语 (importance >= 4)
2. **上下文相关** — 根据用户输入搜索匹配的低重要性术语

## 状态

- [ ] 测试编写 (TDD RED)
- [ ] 实现 (GREEN)
- [ ] 全量回归
- [ ] Code Review
