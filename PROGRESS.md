# Kurisu 项目进度追踪

> 最后更新: 2026-02-17
> 状态: 开发中

## 当前状态

**阶段**: MVP 开发
**焦点**: L4 记忆系统 - ✅ 测试修复完成

## 已完成

### ✅ L2 人设引擎 - 核心模块 (2026-02-16)

**文件**:
- `src/core/persona/index.ts` - PersonaEngine 主类
  - `validate()` - 人设校验
  - `enforcePersona()` - 人设强化
  - `getSystemPrompt()` - 系统提示词生成
- `tests/core/persona/engine.test.ts` - 单元测试 (28 tests)
- `docs/tasks/active/KURISU-001-persona-engine.md` - 任务跟踪

**测试覆盖**: 28 tests passing

### ✅ L4 记忆系统 - 完成 (2026-02-16)

**文件**:
- `src/memory/types.ts` - 类型定义
- `src/memory/errors.ts` - 错误类
- `src/memory/session-memory.ts` - 瞬时记忆 SessionMemory
- `src/memory/short-term-memory.ts` - 短期记忆 Mem0 适配器
- `src/memory/context-builder.ts` - 上下文构建器
- `src/memory/hybrid-engine.ts` - 混合引擎主类
- `src/memory/index.ts` - 导出

**测试状态**: ✅ 184 通过 / 3 todo

**修复内容**:
- 重写 ContextBuilder 测试匹配实现 API
- 修复 HybridMemoryEngine mock 配置
- 修复 ShortTermMemory 验证期望
- 修复 SessionMemory 时间戳测试
- 添加 fixture 注释说明测试用假 key

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

### ✅ 配置文件治理 (2026-02-17)

**修复内容**:
- `.mcp.json`: filesystem server 路径从绝对路径 `/Users/wangcheng/...` 改为相对路径 `.`
- `.gitignore`: 添加 `.claude/settings.local.json` 排除规则（本地权限配置不入库）
- `.claude.json`: 保留为项目级 Claude Code 配置占位（空 `{}`，可提交）
- `.mcp.json`: 提交到 git，供团队共享 MCP Server 配置

**配置文件职责划分**:
| 位置 | 文件 | 是否提交 | 说明 |
|------|------|----------|------|
| 根目录 | `.claude.json` | ✅ | 项目级 Claude Code 配置 |
| 根目录 | `.mcp.json` | ✅ | MCP Server 配置（团队共享） |
| `.claude/` | `settings.local.json` | ❌ | 本地权限/沙箱配置 |
| `.claude/` | `rules/`, `agents/`, etc. | ✅ | Claude Code 行为规则 |

## 进行中

### 🔄 下一个任务

**待确认**: 请指定下一个开发任务

**建议优先级** (按依赖顺序):
1. **L3 Agent 编排** - 单 Agent 对话
2. **L1 交互网关** - 文本流式

## 待办

### L2 人设引擎 - 待实现模块

**源文件** (测试已就绪，待实现):
| 文件 | 类 | 测试数 | 优先级 |
|------|-----|--------|--------|
| `src/core/persona/validator.ts` | PersonaValidator | 76 tests | P2 |
| `src/core/persona/enforcer.ts` | PersonaEnforcer | 45 tests | P2 |
| `src/core/persona/prompt-builder.ts` | PromptBuilder | 40 tests | P2 |
| 集成测试 `persona-flow.test.ts` | - | 14 tests | P2 |

**说明**: 上述测试文件已使用 `describe.skip()` 跳过，待源文件实现后启用。

**开发流程** (实现每个模块时):
1. 在测试文件中将 `describe.skip()` 改为 `describe()`
2. 实现源码让测试通过
3. 删除测试文件顶部的 TODO 注释和 `any` 类型声明

### MVP 范围

| 模块 | 范围 | 状态 | 优先级 |
|------|------|------|--------|
| L2 人设引擎 | 核心硬约束 + 基础校验 | ✅ 已完成 | P0 |
| L3 Agent 编排 | 单 Agent 对话 | ⏳ 待开始 | P1 |
| L4 记忆系统 | 瞬时 + 短期记忆 | ✅ 已完成 | P1 |
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
