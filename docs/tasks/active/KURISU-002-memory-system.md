# Task: 记忆系统核心模块

## 元信息
- task_id: KURISU-002
- type: new_module
- priority: high
- milestone: MVP
- layer: L4
- status: planning
- tags: [memory, mem0, session]

## 时间追踪
- created: 2026-02-16
- estimated_time: 2h
- actual_time: null

## 依赖
- depends_on: [KURISU-001]
- related_tasks: []

## 需求描述

实现 L4 混合记忆引擎层的 MVP 版本，包含：

1. **瞬时记忆** - 会话内的上下文（当前对话）
2. **短期记忆** - 最近 20 轮对话（使用 Mem0）
3. **四层记忆架构准备** - 为后续长期记忆预留接口

### MVP 范围
- ✅ 瞬时记忆 (SessionMemory)
- ✅ 短期记忆 (Mem0 集成)
- ❌ 长期记忆 (知识图谱)
- ❌ 技能记忆

### 核心功能

```typescript
interface HybridMemoryEngine {
  // 瞬时记忆 - 当前会话
  getSessionMemory(sessionId: string): SessionMemory;

  // 短期记忆 - Mem0
  addMemory(sessionId: string, content: string, metadata?: MemoryMetadata): Promise<void>;
  searchMemory(sessionId: string, query: string, limit?: number): Promise<Memory[]>;

  // 上下文构建
  buildContext(sessionId: string, currentMessage: string): Promise<string>;
}
```

## 验收标准
- [ ] SessionMemory 类实现完成
- [ ] Mem0 客户端集成完成
- [ ] HybridMemoryEngine 主类完成
- [ ] buildContext() 方法能构建完整上下文
- [ ] 单元测试覆盖率 >= 80%
- [ ] 无硬编码敏感信息

## 相关文件
- src/memory/index.ts (新建)
- src/memory/types.ts (新建)
- src/memory/session.ts (新建)
- src/memory/mem0-client.ts (新建)
- tests/memory/session.test.ts (新建)
- tests/memory/mem0-client.test.ts (新建)

## Agent Team Plan

### Team 组合
| Agent | 职责 | 执行方式 |
|-------|------|----------|
| planner | 分析任务拆分 | 并行 |
| architect | 设计模块架构 | 并行 |
| tdd-guide | 设计测试用例 | 串行 |
| 实现 | 编写代码 | 串行 |
| code-reviewer | 代码审查 | 并行 |
| security-reviewer | 安全审查 | 并行 |

### 执行流程
```
planner + architect (并行) → tdd-guide → 实现 → code-reviewer + security-reviewer (并行) → 完成
```

## 进度
- [ ] planner
- [ ] architect
- [ ] tdd-guide
- [ ] 实现
- [ ] code-reviewer
- [ ] security-reviewer

## 输出汇总

### planner
**时间**: [待填写]
```markdown
[planner 输出内容]
```

### architect
**时间**: [待填写]
```markdown
[architect 输出内容]
```

### tdd-guide
**时间**: [待填写]
```markdown
[tdd-guide 输出内容]
```

### code-reviewer
**时间**: [待填写]
```markdown
[code-reviewer 输出内容]
```

### security-reviewer
**时间**: [待填写]
```markdown
[security-reviewer 输出内容]
```

## 审查问题追踪
| ID | 来源 | 问题 | 修复commit | 状态 |
|----|------|------|-----------|------|
| - | - | - | - | - |

## 最终产出
- 文件: [待填写]
- 测试: [待填写]
- 覆盖率: [待填写]
- 备注: [待填写]

## 回顾总结
[任务完成后的经验总结]
