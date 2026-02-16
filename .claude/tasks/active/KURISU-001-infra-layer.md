# Task: 基础设施层 (L5)

## 元信息
- task_id: KURISU-001
- task_name: 基础设施层 - 模型配置化
- type: new_module
- priority: high
- milestone: MVP
- layer: L5
- status: planning
- tags: [infra, config, model]
- created: 2026-02-16
- estimated_time: 1h

## 需求描述
实现模型配置化架构，支持：
- 从 config/models.yaml 加载模型配置
- IModel 统一接口（chat/stream）
- IModelProvider 模型提供者
- 环境变量注入

## 验收标准
- [ ] 类型定义完整（IModel, IModelProvider, ModelConfig）
- [ ] 配置加载器实现（YAML 解析）
- [ ] 模型适配器实现（当前使用 glm-5）
- [ ] 单元测试覆盖率 ≥ 80%

## 相关文件
- src/config/models/types.ts
- src/config/models/loader.ts
- src/config/models/provider.ts
- src/config/models/index.ts
- tests/config/models.test.ts

## Agent Team Plan

### Team 组合
| Agent | 职责 | 执行方式 |
|-------|------|----------|
| planner | 分析需求、规划模块 | 并行 A |
| architect | 设计接口 | 并行 A |
| tdd-guide | 测试用例 | 串行 B |
| code-reviewer | 代码审查 | 串行 C |

### 执行流程 + Git 提交
```
阶段 1: 分析设计 (planner + architect 并行)
  → [不提交，输出填入本文档]

阶段 2: 测试设计 (tdd-guide)
  → 创建测试骨架
  → git commit -m "test(infra): 添加模型配置测试用例"

阶段 3: 实现
  → 类型定义
  → git commit -m "feat(infra): 定义模型接口类型"

  → 配置加载器
  → git commit -m "feat(infra): 实现 YAML 配置加载器"

  → 模型适配器
  → git commit -m "feat(infra): 实现模型适配器"

  → 测试通过
  → git commit -m "feat(infra): 测试通过"

阶段 4: 审查 (code-reviewer)
  → 修复问题（如有）
  → git commit -m "fix(infra): 修复审查问题"

  → git push
```

## 进度
- [x] planner ✓
- [x] architect ✓
- [ ] tdd-guide
- [ ] 实现 - 类型定义
- [ ] 实现 - 配置加载
- [ ] 实现 - 模型适配器
- [ ] code-reviewer
- [ ] git push

## 输出汇总

### planner
**时间**: 2026-02-16
**关键产出**:
- 任务拆分: 9个子任务，预估 4h15min
- 核心文件: loader.ts, env.ts, providers/*.ts, models.yaml
- 风险: API 格式不一致、流式输出复杂、环境变量缺失
- 技术决策: YAML配置、${VAR}语法、Provider独立文件、AsyncGenerator流式

### architect
**时间**: 2026-02-16
**关键产出**:
- 目录结构: src/config/models/{types,loader,env,providers/}
- 核心接口: IModel, IModelProvider, IConfigLoader
- 依赖关系: L5 → L2/L3/L4
- ADR记录: 5个架构决策
- 数据流: 配置加载 → Provider创建 → 模型调用

### tdd-guide
**时间**: [待执行]
```markdown
[待填写]
```

### code-reviewer
**时间**: [待执行]
```markdown
[待填写]
```

## Git 提交记录
| Commit | 描述 | 时间 |
|--------|------|------|
| - | 任务开始 | 2026-02-16 |

## 最终产出
- 文件: [待填写]
- 测试覆盖率: [待填写]
- 备注: [待填写]
