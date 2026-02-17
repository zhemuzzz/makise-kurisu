# Kurisu 项目进度追踪

> 最后更新: 2026-02-17
> 状态: 开发中

## 当前状态

**阶段**: MVP 开发
**焦点**: E2E 测试 - ✅ 完成

## 已完成

### ✅ E2E 端到端测试 (2026-02-17)

**任务**: KURISU-005

**架构**: Vitest Integration Test + Mock 策略

**文件结构**:
```
tests/e2e/
├── setup.ts                      # 全局工具函数
├── fixtures/
│   └── e2e-fixtures.ts           # Mock 工厂 + 测试数据
└── scenarios/
    ├── e01-basic-conversation.test.ts   # 基础对话 (7 tests)
    ├── e02-session-management.test.ts   # 会话管理 (18 tests)
    ├── e03-memory-persistence.test.ts   # 记忆持久化 (11 tests)
    ├── e04-persona-consistency.test.ts  # 人设一致性 (14 tests)
    └── e05-error-recovery.test.ts       # 错误恢复 (17 tests)
```

**测试状态**: ✅ 67 通过

**Mock 策略**:
- ✅ 真实: PersonaEngine, HybridMemoryEngine (核心逻辑)
- 🔧 Mock: IModelProvider, Mem0Client (外部服务)

**Code Review** (2026-02-17):
- CRITICAL: 0
- HIGH: 4 → 0 (已修复)
  - Gateway config 传参错误 → 修复为 `(deps, config)` 格式
  - 清理测试缺少断言 → 添加 `toBeNull()` 断言
- MEDIUM: 5 (文档性建议)
- LOW: 3

**覆盖场景**:
| 场景 | 测试数 | 描述 |
|------|--------|------|
| E01 基础对话 | 7 | 流式响应、多轮对话、并发请求 |
| E02 会话管理 | 18 | CRUD、TTL 清理、会话限制 |
| E03 记忆持久化 | 11 | 会话记忆、上下文构建、流式存储 |
| E04 人设一致性 | 14 | 系统提示词、校验、强化、OOC 检测 |
| E05 错误恢复 | 17 | 输入校验、API 错误、会话错误、恢复 |

### ✅ L1 交互网关层 (2026-02-17)

**架构**: Gateway + Channel 双层抽象，流式处理

**文件结构**:
```
src/gateway/
├── types.ts              # 类型定义 (ChannelType, SessionInfo, StreamEvent)
├── errors.ts             # 错误类 (GatewayError, InputValidationError)
├── session-manager.ts    # 会话管理器 (CRUD + TTL 清理)
├── stream-handler.ts     # 流式处理器 (textStream/fullStream)
├── channels/
│   └── cli.ts           # CLI 渠道 (readline + 流式输出)
└── index.ts              # Gateway 主类
```

**测试状态**: ✅ 207 通过, 98.47% coverage

**Code Review** (2026-02-17):
- CRITICAL: 0
- HIGH: 4 ✅ **已修复** (KURISU-004)
  - ~~teeStream 资源泄漏风险~~ → 懒加载模式
  - ~~processStream 返回值不一致~~ → 统一 createStreamResult
  - ~~CLIChannel 错误状态恢复~~ → 会话重置逻辑
  - ~~会话 ID 长度限制~~ → 256 字符限制
- MEDIUM: 5
- LOW: 3

**API**:
```typescript
const gateway = new Gateway({ orchestrator });
await gateway.start();
const { textStream, finalResponse } = await gateway.processStream(sessionId, input);
```

**MVP 闭环完成**: L1→L2→L3→L4→L5 全链路打通

### ✅ L1 Gateway HIGH Issues 修复 (2026-02-17)

**任务**: KURISU-004

**修复内容**:
| ID | 问题 | 修复方案 |
|----|------|----------|
| R01 | teeStream 资源泄漏 | 懒加载模式，避免立即消费流 |
| R02 | processStream 返回值不一致 | 统一使用 createStreamResult |
| R03 | CLIChannel 错误状态恢复 | 会话相关错误时重置 sessionId |
| R04 | 会话 ID 长度限制 | 添加 256 字符限制 |

**修改文件**: stream-handler.ts, index.ts, cli.ts, session-manager.ts

**测试状态**: ✅ 207 通过

### ✅ L3 Agent 编排层 (2026-02-17)

**架构**: LangGraph 状态机 + 依赖注入

**文件结构**:
```
src/agents/
├── types.ts              # 类型定义 (AgentState, AgentRole, etc.)
├── errors.ts             # 错误类
├── state.ts              # 状态通道 + 辅助函数
├── nodes/                # 状态机节点
│   ├── context-build.ts  # 上下文构建
│   ├── route.ts          # 意图路由
│   ├── generate.ts       # 响应生成
│   ├── validate.ts       # 人设校验
│   └── enforce.ts        # 人设强化
├── routers/              # 条件路由
│   └── intent-router.ts
├── workflow.ts           # LangGraph 工作流
├── orchestrator.ts       # 编排器主类
└── index.ts              # 导出
```

**状态流转**:
```
START → context_build → route → conversation/task → validate → enforce → END
                                         ↑                    |
                                         └────────────────────┘ (retry)
```

**集成**:
- L2 人设引擎: `PersonaEngine.validate()`, `enforcePersona()`, `getSystemPrompt()`
- L4 记忆系统: `HybridMemoryEngine.buildContext()`, `getRecentMessages()`, `addSessionMessage()`
- L5 模型配置: `ModelProvider.getByTask('conversation')`

**测试状态**: ✅ 21 通过

**Code Review** (2026-02-17):
- CRITICAL: 0
- HIGH: 3 (测试覆盖率不足, 意图路由简单, enforce mutation 风险 - 已修复)
- MEDIUM: 5 (待后续优化)
- LOW: 3 (LangGraph as any 已知问题)

**API**:
```typescript
const orchestrator = new AgentOrchestrator(deps, config);
const result = await orchestrator.process(sessionId, userId, input);
```

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

### ✅ L2 人设引擎 - PersonaValidator (2026-02-17)

**任务**: KURISU-006

**文件**:
- `src/core/persona/validator.ts` - PersonaValidator 类
- `tests/unit/persona/validator.test.ts` - 单元测试 (76 tests)

**核心功能**:
- `detectOOC()` - 检测 OOC (Out of Character) 关键词
- `checkToneConsistency()` - 检查语气一致性
- `checkRelationshipConsistency()` - 检查关系一致性
- `validate()` - 综合校验，返回详细结果

**Code Review 修复**:
- 添加输入验证处理 null/undefined
- 统一大小写不敏感匹配
- 添加关键词设计说明注释

**测试状态**: ✅ 76 通过

### ✅ L2 人设引擎 - PersonaEnforcer (2026-02-17)

**任务**: KURISU-006

**文件**:
- `src/core/persona/enforcer.ts` - PersonaEnforcer 类
- `tests/unit/persona/enforcer.test.ts` - 单元测试 (45 tests)

**核心功能**:
- `enforce()` - 主方法：傲娇转换 + OOC 移除 + 关系感知
- `addTsunderePrefix()` - 添加傲娇前缀
- `convertToRhetorical()` - 转换为反问句
- `addEmotionalHesitation()` - 添加情感犹豫
- `removeOOCPhrases()` - 移除 OOC 短语（含 ReDoS 防护）

**Code Review 修复**:
- 添加正则转义防止 ReDoS
- 移除死代码（空分支）
- 统一输入验证返回值

**测试状态**: ✅ 45 通过

## 进行中

### 🔄 下一个任务

**当前**: L2 人设引擎扩展 - PersonaEnforcer ✅ 完成

**剩余模块**:
1. **PromptBuilder** - 40 tests (P2)
2. **集成测试** - 14 tests (P2)

## 待办

### L2 人设引擎 - 待实现模块

**源文件** (测试已就绪，待实现):
| 文件 | 类 | 测试数 | 优先级 | 状态 |
|------|-----|--------|--------|------|
| `src/core/persona/validator.ts` | PersonaValidator | 76 tests | P2 | ✅ 完成 |
| `src/core/persona/enforcer.ts` | PersonaEnforcer | 45 tests | P2 | ✅ 完成 |
| `src/core/persona/prompt-builder.ts` | PromptBuilder | 40 tests | P2 | 待实现 |
| 集成测试 `persona-flow.test.ts` | - | 14 tests | P2 | 待实现 |

**说明**: 上述测试文件已使用 `describe.skip()` 跳过，待源文件实现后启用。

**开发流程** (实现每个模块时):
1. 在测试文件中将 `describe.skip()` 改为 `describe()`
2. 实现源码让测试通过
3. 删除测试文件顶部的 TODO 注释和 `any` 类型声明

### MVP 范围

| 模块 | 范围 | 状态 | 优先级 |
|------|------|------|--------|
| L2 人设引擎 | 核心硬约束 + 基础校验 | ✅ 已完成 | P0 |
| L3 Agent 编排 | 单 Agent 对话 | ✅ 已完成 | P1 |
| L4 记忆系统 | 瞬时 + 短期记忆 | ✅ 已完成 | P1 |
| L1 交互网关 | 文本流式 | ✅ 已完成 | P2 |

**🎉 MVP 核心功能全部完成！**

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

### ✅ 规范文档优化 (2026-02-17)

**变更**:
- 新增 `.claude/INDEX.md` 作为规范单一入口
- 精简 `.claude/TASK.md` (488→162行)
- 精简 `.claude/rules/common/agents.md` 和 `git-workflow.md`
- `CLAUDE.md` 添加规范索引入口

**文档结构**:
```
CLAUDE.md (架构)
    ↓
.claude/INDEX.md (规范索引)
    ├── TASK.md (任务流程)
    └── rules/common/ (详细规范)
```

## 快速恢复上下文

新对话时，请让我读取以下文件：
1. `PROGRESS.md` - 项目进度
2. `CLAUDE.md` - 项目规范
3. `.claude/INDEX.md` - **规范索引 (新增)**
4. `.claude/TASK.md` - Agent Team 流程
5. `docs/tasks/active/` - 当前任务详情
