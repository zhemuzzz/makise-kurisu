# Agent Team Task Specification

> kurisu 项目 Agent Team 任务规范

## 任务元信息

```yaml
task_id: KURISU-001
task_name: 人设引擎核心模块
task_type: new_module | feature | bugfix | review | refactor
priority: high | medium | low
milestone: MVP | v1.0 | v1.1

# 时间追踪
created: 2026-02-16
started: null
completed: null
estimated_time: 2h
actual_time: null

# 分配与关联
assignee: agent_team
related_tasks: [KURISU-002, KURISU-003]
depends_on: []

# 标签分类
tags: [persona, core, langgraph]
layer: L2  # 五层架构中的哪一层

# 状态
status: pending | planning | executing | reviewing | completed | blocked
```

## 五层架构映射

| Layer | 名称 | 前缀标签 |
|-------|------|----------|
| L1 | 交互网关层 (Gateway) | gateway |
| L2 | 人设一致性引擎层 (Persona Engine) | persona |
| L3 | Agent 编排层 (Agent Orchestrator) | agent |
| L4 | 混合记忆引擎层 (Hybrid Memory) | memory |
| L5 | 基础设施层 (Infrastructure) | infra |

## Agent 输出规范

### planner 输出格式

```markdown
# 实现计划: [任务名]

## 元信息
- generated_at: 2026-02-16 10:30
- model: opus | sonnet | haiku

## 需求摘要
[一句话描述]

## 任务拆分
| 序号 | 子任务 | 文件 | 复杂度 | 依赖 | 预估时间 |
|------|--------|------|--------|------|----------|
| 1 | 定义类型 | src/types.ts | 低 | - | 10min |
| 2 | 实现核心 | src/core.ts | 高 | 1 | 30min |

## 风险点
| 风险 | 概率 | 影响 | 缓解方案 |
|------|------|------|----------|
| API 变更 | 低 | 高 | 封装适配层 |

## 技术决策
- 决策 1: 原因
- 决策 2: 原因

## 建议的 Agent Team
- 并行: [agent列表]
- 串行: [agent列表]
```

### architect 输出格式

```markdown
# 架构设计: [任务名]

## 元信息
- generated_at: 2026-02-16 10:35
- model: opus | sonnet | haiku

## 模块位置
```
src/
├── persona/
│   ├── engine.ts      # 人设引擎核心
│   ├── validator.ts   # 校验器
│   └── types.ts       # 类型定义
```

## 核心接口

\`\`\`typescript
interface PersonaEngine {
  validate(message: Message): ValidationResult;
  enforcePersona(response: string): string;
}
\`\`\`

## 依赖关系
| 依赖类型 | 模块 | 说明 |
|----------|------|------|
| 内部 | agent-orchestrator | 状态机集成 |
| 外部 | @langchain/langgraph | 状态管理 |
| 配置 | models.yaml | 模型配置 |

## 数据流
```
用户输入 → 校验 → 处理 → 人设强化 → 输出
```

## 设计决策记录 (ADR)
### ADR-001: [决策标题]
- 背景: [为什么需要这个决策]
- 决策: [选择了什么方案]
- 备选: [考虑过的其他方案]
- 后果: [决策的影响]
```

### tdd-guide 输出格式

```markdown
# 测试设计: [任务名]

## 元信息
- generated_at: 2026-02-16 10:40
- model: sonnet | haiku

## 测试文件
| 文件 | 描述 | 用例数 |
|------|------|--------|
| tests/persona/engine.test.ts | 核心逻辑测试 | 5 |
| tests/persona/validator.test.ts | 校验器测试 | 8 |

## 测试用例
| ID | 用例 | 描述 | 输入 | 预期输出 | 优先级 |
|----|------|------|------|----------|--------|
| TC01 | 校验合规消息 | 正常对话 | 正常文本 | isCompliant: true | P0 |
| TC02 | 检测人设违规 | 卖萌内容 | 卖萌文本 | isCompliant: false | P0 |
| TC03 | 边界情况 | 空消息 | 空字符串 | 抛出错误 | P1 |

## 测试策略
- 单元测试: 核心逻辑
- 集成测试: 与 LangGraph 集成
- E2E 测试: 完整对话流程（后续）

## 覆盖目标
- 行覆盖率: 80%+
- 分支覆盖率: 75%+
- 关键路径: 100%
```

### code-reviewer 输出格式

```markdown
# 代码审查: [任务名]

## 元信息
- generated_at: 2026-02-16 11:00
- model: sonnet
- files_reviewed: 3

## 审查摘要
- 审查文件: [文件列表]
- 总体评价: 优秀 | 良好 | 需改进 | 不通过
- 可合并: 是 | 否 | 需修改

## 问题列表
| ID | 级别 | 文件 | 行号 | 问题 | 建议 | 状态 |
|----|------|------|------|------|------|------|
| R01 | HIGH | x.ts | 42 | 直接修改状态 | 使用展开运算符 | 待修复 |
| R02 | MEDIUM | y.ts | 15 | 缺少类型 | 添加类型注解 | 待修复 |

## 检查清单
- [ ] 代码可读性
- [ ] 函数长度 (<50行)
- [ ] 文件长度 (<800行)
- [ ] 无深层嵌套 (>4层)
- [ ] 错误处理完整
- [ ] 无硬编码值
- [ ] 状态不可变

## 优点
- 良好的错误处理
- 清晰的函数命名

## 建议改进
- 建议 1
```

### security-reviewer 输出格式

```markdown
# 安全审查: [任务名]

## 元信息
- generated_at: 2026-02-16 11:05
- model: sonnet

## 安全检查清单
- [ ] 无硬编码密钥
- [ ] 用户数据隔离
- [ ] 输入验证完整
- [ ] 核心约束不可篡改
- [ ] 错误信息不泄露敏感数据
- [ ] 依赖无已知漏洞

## 发现的问题
| ID | 级别 | 位置 | 问题 | 修复建议 | 状态 |
|----|------|------|------|----------|------|
| S01 | HIGH | config.ts:10 | API Key 硬编码 | 使用环境变量 | 待修复 |

## 安全建议
- 建议 1

## 合规性
- [ ] 符合 kurisu 安全规范
- [ ] 无敏感信息泄露风险
```

## 任务状态流转

```
pending → planning → executing → reviewing → completed
   │         │          │           │          │
   │         │          │           │          └─ 任务完成
   │         │          │           └─ 审查阶段
   │         │          └─ 实现阶段
   │         └─ 分析设计阶段
   └─ 等待开始

特殊状态:
- blocked: 被阻塞（依赖未完成）
- cancelled: 已取消
```

## 任务模板

开发新任务时，复制以下模板：

```markdown
# Task: [任务名]

## 元信息
- task_id: KURISU-XXX
- type: new_module | feature | bugfix | review | refactor
- priority: high | medium | low
- milestone: MVP | v1.0
- layer: L1 | L2 | L3 | L4 | L5
- status: pending
- tags: [tag1, tag2]

## 时间追踪
- created: YYYY-MM-DD
- estimated_time: Xh
- actual_time: null

## 依赖
- depends_on: [task_id]
- related_tasks: [task_id]

## 需求描述
[描述要实现的功能]

## 验收标准
- [ ] 标准 1
- [ ] 标准 2

## 相关文件
- src/path/to/file.ts
- tests/path/to/test.ts

## Agent Team Plan
[待确认后填写]

### Team 组合
| Agent | 职责 | 执行方式 |
|-------|------|----------|
| planner | 分析 | 并行 |
| architect | 设计 | 并行 |

### 执行流程
```
并行组 → 串行组 → 实现 → 审查
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
| R01 | code-reviewer | 描述 | abc123 | 已修复 |

## 最终产出
- 文件: [修改的文件列表]
- 测试: [测试文件]
- 覆盖率: X%
- 备注: [其他说明]

## 回顾总结
[任务完成后的经验总结]
```

## 使用流程

1. **创建任务**：复制模板，填写需求和元信息
2. **确认 Plan**：展示 Agent Team Plan，等待用户确认
3. **执行阶段**：按顺序执行 agent，更新进度和时间戳
4. **问题追踪**：审查问题记录到追踪表
5. **汇总输出**：将各 agent 输出填入对应区域
6. **完成归档**：填写实际耗时、回顾总结

## 任务归档

完成的任务建议移动到 `docs/tasks/archive/` 目录：
```
docs/tasks/
├── active/
│   └── KURISU-001-persona-engine.md
├── archive/
│   └── 2026-02/
│       └── KURISU-001-persona-engine.md
└── TASK-TEMPLATE.md
```
