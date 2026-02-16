# Task: 人设引擎核心模块

## 元信息
- task_id: KURISU-001
- type: new_module
- priority: high
- milestone: MVP
- layer: L2
- status: planning
- tags: [persona, core, validation]

## 时间追踪
- created: 2026-02-16
- estimated_time: 2h
- actual_time: null

## 依赖
- depends_on: []
- related_tasks: [KURISU-002, KURISU-003]

## 需求描述

实现 L2 人设一致性引擎层的 MVP 版本，包含：

1. **核心人设硬约束** - 牧濑红莉栖的角色定义（不可修改）
2. **基础校验器** - 检测人设违规
3. **人设强化器** - 在响应中强化人设特征

### 核心功能

```typescript
interface PersonaEngine {
  // 校验消息是否符合人设
  validate(message: Message): ValidationResult;

  // 强化响应的人设特征
  enforcePersona(response: string): string;

  // 获取系统提示词
  getSystemPrompt(): string;
}
```

## 验收标准
- [ ] 核心人设常量定义完成
- [ ] ValidationResult 类型定义完成
- [ ] validate() 方法实现并测试
- [ ] enforcePersona() 方法实现并测试
- [ ] getSystemPrompt() 方法实现
- [ ] 单元测试覆盖率 >= 80%
- [ ] 无硬编码敏感信息

## 相关文件
- src/persona/engine.ts (新建)
- src/persona/validator.ts (新建)
- src/persona/types.ts (新建)
- src/persona/constants.ts (新建)
- src/persona/index.ts (新建)
- tests/persona/engine.test.ts (新建)
- tests/persona/validator.test.ts (新建)

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
