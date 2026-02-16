# Agent Orchestration

> kurisu 项目 Agent 协作规范

## ⚠️ Agent Team 完整流程

> **重要**: 开发新任务必须遵守 `.claude/TASK.md` 的 TL;DR 执行清单

### 执行检查点 (MANDATORY)

每个 agent 完成后 **必须**:
```
□ 更新任务文档进度 (docs/tasks/active/KURISU-XXX.md)
□ 记录 agent 输出到对应区域
□ 检查 context 使用率，≥65% 时提醒用户 /compact
```

```
planner 完成 → □ 更新 → architect 完成 → □ 更新 → tdd-guide 完成 → □ 更新
                                                    ↓
                                        实现阶段 (每完成一个文件 □ 更新)
                                                    ↓
                                        code-reviewer 完成 → □ 更新
```

---

## Available Agents

| Agent | Purpose | kurisu 使用场景 |
|-------|---------|----------------|
| **planner** | 实现规划 | 新模块设计（人设引擎、记忆系统） |
| **architect** | 架构设计 | 五层架构决策、模块边界划分 |
| **tdd-guide** | TDD 开发 | 核心模块测试（状态机、记忆检索） |
| **code-reviewer** | 代码审查 | 功能完成后自动审查 |
| **security-reviewer** | 安全分析 | API Key 处理、用户数据隔离 |
| **build-error-resolver** | 构建修复 | TypeScript 编译错误 |

## 开发流程 Agent 使用

### 新功能开发

```
1. planner    → 分析需求，制定实现计划
2. architect  → 设计模块架构和接口
3. tdd-guide  → 先写测试，再实现
4. code-reviewer → 代码审查
```

### 核心模块开发（人设引擎、记忆系统）

```
1. planner + architect 并行 → 规划 + 架构设计
2. tdd-guide → 核心逻辑测试先行
3. security-reviewer → 检查 API Key、用户数据安全
4. code-reviewer → 最终审查
```

## Immediate Agent Usage

无需用户提示，主动使用：

| 场景 | Agent |
|------|-------|
| 复杂功能请求（新 Agent、新人设） | planner |
| 代码刚写完/修改完 | code-reviewer |
| Bug 修复或新功能 | tdd-guide |
| 架构决策（五层架构调整） | architect |
| 涉及 API Key、用户数据 | security-reviewer |

## Parallel Task Execution

独立操作必须并行执行：

```typescript
// ✅ GOOD: 并行执行
// 同时启动 3 个 agent
await Promise.all([
  task({ subagent_type: "security-reviewer", prompt: "审查 API Key 处理" }),
  task({ subagent_type: "code-reviewer", prompt: "审查 LangGraph 节点实现" }),
  task({ subagent_type: "architect", prompt: "评估记忆系统架构" })
]);

// ❌ BAD: 不必要的串行
await task(...); // 等 1
await task(...); // 等 2
await task(...); // 等 3
```

## Multi-Perspective Analysis

复杂问题使用多视角子 agent：

| 视角 | 关注点 |
|------|--------|
| 功能正确性 | 逻辑是否正确、边界情况 |
| 代码质量 | 可读性、可维护性、模式使用 |
| 安全性 | API Key、用户数据、注入风险 |
| 人设一致性 | 回复是否符合 Kurisu 人设 |
| 性能 | 响应时间、记忆检索效率 |

## kurisu 项目特定 Agent 场景

### 人设引擎开发

```
architect → 设计三层管控架构
planner → 规划校验规则实现
tdd-guide → 校验逻辑测试
code-reviewer → 检查人设约束代码
```

### 记忆系统集成

```
architect → 设计四层记忆架构
security-reviewer → 检查用户数据隔离
planner → 规划 Mem0AI 集成方案
tdd-guide → 记忆检索测试
```

### Agent 编排开发

```
architect → 设计 LangGraph 状态机
planner → 规划节点和路由
tdd-guide → 状态流转测试
code-reviewer → 检查状态不可变性
```
