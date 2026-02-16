# Kurisu 项目进度追踪

> 最后更新: 2026-02-16
> 状态: 开发中

## 当前状态

**阶段**: MVP 开发
**焦点**: 模型配置化已完成，准备开始核心模块开发

## 已完成

### ✅ L5 基础设施层 - 模型配置化 (2026-02-16)

**文件**:
- `config/models.yaml` - 模型配置
- `src/config/models/` - 模型管理模块
  - `types.ts` - 类型定义
  - `index.ts` - ModelProvider
  - `loader.ts` - YAML 加载器
  - `env.ts` - 环境变量解析
  - `providers/anthropic.ts` - Anthropic 兼容 API
  - `providers/openai-compatible.ts` - OpenAI 兼容 API

**模型配置**:
| 模型 | 用途 | 状态 |
|------|------|------|
| GLM-5 | conversation, code, embedding | ✅ 可用 |
| MiniMax-M2.5 | reasoning | ✅ 可用 |
| claude-opus-4-6 | 备用 | ⏳ 需要 API Key |
| claude-sonnet-4-5 | 备用 | ⏳ 需要 API Key |

**路由规则**:
```yaml
conversation: glm-5
code: glm-5
reasoning: MiniMax-M2.5
embedding: glm-5
```

## 进行中

### 🔄 下一个任务

**待确认**: 请指定下一个开发任务

**建议优先级** (按依赖顺序):
1. **L2 人设引擎** - 核心硬约束 + 基础校验
2. **L4 记忆系统** - 瞬时 + 短期记忆
3. **L3 Agent 编排** - 单 Agent 对话
4. **L1 交互网关** - 文本流式

## 待办

### MVP 范围

| 模块 | 范围 | 状态 | 优先级 |
|------|------|------|--------|
| L2 人设引擎 | 核心硬约束 + 基础校验 | ⏳ 待开始 | P0 |
| L3 Agent 编排 | 单 Agent 对话 | ⏳ 待开始 | P1 |
| L4 记忆系统 | 瞬时 + 短期记忆 | ⏳ 待开始 | P1 |
| L1 交互网关 | 文本流式 | ⏳ 待开始 | P2 |

## 技术决策记录

### T001: 模型配置化架构
- **日期**: 2026-02-16
- **决策**: 使用 YAML 配置 + 环境变量注入
- **原因**: 支持多模型切换，敏感信息不入库
- **影响**: 所有模型调用通过 ModelProvider

### T002: Anthropic 兼容 API 优先
- **日期**: 2026-02-16
- **决策**: 优先实现 Anthropic 兼容格式
- **原因**: GLM-5、MiniMax 都支持此格式
- **影响**: 减少适配工作

## 开发规范

### Agent Team 模型策略
- **Claude Code 开发**: opus-4.6 → sonnet-4-5 → glm-5
- **kurisu 内部调用**: GLM-5 + MiniMax-M2.5

详见: `CLAUDE.md` → 模型使用策略

## 相关文件

```
kurisu/
├── CLAUDE.md           # 项目规范
├── PROGRESS.md         # 本文件 - 进度追踪
├── config/
│   └── models.yaml     # 模型配置
├── docs/
│   └── tasks/          # 任务记录
│       ├── active/     # 进行中的任务
│       └── archive/    # 已完成的任务
└── src/
    └── config/models/  # 模型管理模块
```

## 快速恢复上下文

新对话时，请让我读取以下文件：
1. `PROGRESS.md` - 项目进度
2. `CLAUDE.md` - 项目规范
3. `.claude/TASK.md` - Agent Team 流程
4. `docs/tasks/active/` - 当前任务详情
