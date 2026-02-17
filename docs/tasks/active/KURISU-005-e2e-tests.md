# Task: E2E 测试

## 元信息
- task_id: KURISU-005
- type: test
- priority: high
- layer: E2E
- status: in_progress
- tags: [e2e, testing, integration]

## 时间追踪
- created: 2026-02-17
- estimated_time: 3h
- actual_time: TBD

## 依赖
- depends_on: [KURISU-003, KURISU-004]
- related_tasks: []

## 需求描述

为 kurisu MVP 实现端到端测试，验证完整对话流程：
- L1 Gateway → L2 Persona → L3 Agent → L4 Memory → L5 Infrastructure

## 测试场景

| ID | 场景 | 描述 | 优先级 |
|----|------|------|--------|
| E01 | 基础对话 | 用户输入 → 流式响应 | P0 |
| E02 | 会话管理 | 创建/获取/删除会话 | P0 |
| E03 | 记忆持久化 | 多轮对话上下文保持 | P1 |
| E04 | 人设一致性 | 回复符合 Kurisu 人设 | P1 |
| E05 | 错误恢复 | 异常输入/网络错误处理 | P2 |

## 验收标准
- [ ] E01-E05 测试场景全部通过
- [ ] 使用 Playwright 或 Vitest integration 测试
- [ ] 覆盖 MVP 核心流程
- [ ] 测试可重复执行

## Agent Team Plan

```
planner (调研 E2E 模式)
    ↓
tdd-guide (测试设计)
    ↓
实现
    ↓
code-reviewer
```

## 进度
- [x] planner
- [ ] tdd-guide
- [ ] 实现
- [ ] code-reviewer

## 输出汇总

### planner
**时间**: 2026-02-17
**调研参考**: Vitest integration 测试模式

**决策**: 使用 **Vitest Integration Test** (而非 Playwright)
- kurisu 是纯后端应用，无浏览器 UI
- 已有 Vitest 基础，配置统一
- 原生支持 AsyncGenerator 测试

**目录结构**:
```
tests/e2e/
├── setup.ts                    # 全局 setup/teardown
├── fixtures/
│   └── e2e-fixtures.ts         # Mock 依赖工厂
└── scenarios/
    ├── e01-basic-conversation.test.ts
    ├── e02-session-management.test.ts
    ├── e03-memory-persistence.test.ts
    ├── e04-persona-consistency.test.ts
    └── e05-error-recovery.test.ts
```

**Mock 策略**:
| 依赖 | Mock 策略 |
|------|----------|
| IModelProvider | vi.fn() mock (避免真实 API) |
| PersonaEngine | 真实实例 |
| HybridMemoryEngine | 真实实例 (无 Mem0) |
| Mem0Client | vi.fn() mock |

**预估时间**: 6h

### tdd-guide
**时间**: [待填写]
[tdd-guide 输出]

### code-reviewer
**时间**: [待填写]
[code-reviewer 输出]

## 相关文件
- tests/e2e/ (新建)
- vitest.config.e2e.ts (可选)

## 审查问题追踪
| ID | 问题 | 修复commit | 状态 |
|----|------|-----------|------|
| - | - | - | - |
