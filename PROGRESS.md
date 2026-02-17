# Kurisu 项目进度追踪

> 最后更新: 2026-02-18
> 状态: 开发中

## 当前状态

**阶段**: 生产部署准备
**焦点**: Docker + CI/CD 配置完成

## 已完成

### ✅ KURISU-012 Snyk 安全扫描配置 (2026-02-18)

**任务**: 启用 GitHub Actions 中的 Snyk 安全扫描

**配置内容**:
| 配置项 | 说明 |
|--------|------|
| SNYK_TOKEN secret | Snyk PAT (90天过期，需 2026-05-19 轮换) |
| 扫描触发条件 | Push + PR (原仅 PR) |
| npm audit | 高危级别审计 |

**修改文件**:
- `.github/workflows/ci.yml` - 移除 PR-only 限制

### ✅ KURISU-011 生产部署配置 (2026-02-18)

**任务**: 添加 Docker 容器化 + GitHub Actions CI/CD

**新增文件**:
| 文件 | 用途 |
|------|------|
| `Dockerfile` | 多阶段构建，非 root 用户，健康检查 |
| `docker-compose.yml` | 容器编排配置 |
| `.dockerignore` | Docker 构建排除 |
| `.github/workflows/ci.yml` | CI/CD 流水线 |
| `src/bin/cli.ts` | CLI 命令行入口 |
| `src/bin/server.ts` | HTTP API 服务入口 |

**HTTP API 端点**:
| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/ready` | GET | 就绪检查 |
| `/api/sessions` | POST | 创建会话 |
| `/api/sessions/:id/messages` | POST | 发送消息 |
| `/api/sessions/:id/stream` | POST | 流式消息 (SSE) |

**新增 npm 脚本**:
- `dev:cli` / `dev:server` - 开发模式
- `start:cli` / `start:server` - 生产模式
- `docker:build` / `docker:run` / `docker:compose` - Docker 操作

**CI/CD 流水线**:
- Push 到 main: 自动测试 + 构建 Docker 镜像
- PR: 测试 + 安全扫描

### ✅ KURISU-010 人设文档修正 (2026-02-17)

**任务**: 更新 CLAUDE.md 核心人设硬约束

**修改内容**:
- 去掉"病娇"，Kurisu 只有傲娇（非病娇）
- 添加维克多·孔多利亚大学、Lab Mem No.004、网名等身份信息
- 添加 KURISU_PERSONA_REFERENCE.md 参考链接
- 完善性格核心、说话习惯、禁止行为描述

**相关文件**:
- `CLAUDE.md` - 人设约束示例更新
- `docs/persona/KURISU_PERSONA_REFERENCE.md` - 详细人设参考

### ✅ KURISU-009 TRIGGER_KEYWORDS 触发词功能 (2026-02-17)

**任务**: 实现触发词检测和响应机制

**触发类型**:
| 类型 | 示例 | 反应 | 强度 |
|------|------|------|------|
| nickname | "Christina" | 傲娇否认 | mild |
| tsundere_call | "你真傲娇" | 反驳 | moderate |
| compliment | "你真是个天才" | 害羞否认 | mild |
| chest | "你胸部好小" | 暴怒 | strong |
| cockroach | "有蟑螂！" | 恐惧 | strong |

**实现内容**:
- `constants.ts`: 新增 `TriggerType`, `TriggerMatch`, `TRIGGER_RESPONSES` (20 模板)
- `enforcer.ts`: 新增 `detectTrigger()`, `applyTriggerResponse()`
- `index.ts`: `enforcePersona()` 新增可选 `userInput` 参数

**优先级机制**: cockroach > chest > tsundere_call > nickname > compliment

**测试状态**: ✅ 862 通过 (+29 tests)

### ✅ Code Review 5 个 HIGH 级别问题修复 (2026-02-17)

**任务**: 修复人设引擎代码质量问题

**修复内容**:
| ID | 问题 | 修复方案 |
|----|------|----------|
| H1 | PersonaEngine 与子模块职责重叠 | 改为 facade 模式，委托给 Validator/Enforcer/PromptBuilder |
| H2 | enforcePersona 使用 Math.random() | 委托给 enforcer（确定性 seededRandom） |
| H3 | reflectsRelationshipLevel 硬编码亲密词 | 删除方法，使用 INTIMATE_KEYWORDS 常量 |
| H4 | enforce 使用 let 可变模式 | 新增 `pipe()` 管道函数，改为不可变模式 |
| H5 | checkRelationshipConsistency 硬编码 | 改用 INTIMATE_KEYWORDS 常量 |

**新增功能**:
- `PersonaEnforcer.pipe<T>()` - 管道函数，支持不可变数据流

**修改文件**:
- `src/core/persona/index.ts` - facade 模式重构
- `src/core/persona/enforcer.ts` - 管道模式 + 不可变
- `src/core/persona/validator.ts` - 使用常量

**测试状态**: ✅ 304 通过 (7 files)

### ✅ KURISU-008 Lore 集成 PromptBuilder (2026-02-17)

**任务**: 将 Steins;Gate 术语库集成到 RP 提示词

**修改文件**:
| 文件 | 变更 |
|------|------|
| `src/core/persona/prompt-builder.ts` | 新增 `buildLoreSection()` + `formatLoreTerm()` |
| `tests/unit/persona/prompt-builder.test.ts` | 新增 8 个 lore 集成测试 |

**实现方案**: 两层独立 Lore 注入
- **静态背景**: 高重要性术语 (importance >= 4)，最多 8 个
- **上下文相关**: 根据用户输入 `searchLore()` 匹配，去重 + 按重要性排序，最多 3 个

**Code Review 修复**:
- 消除双重 `getHighImportanceLore()` 调用
- 两层独立组合（不再互相阻断）
- `let line +=` 改为 immutable ternary
- 搜索查询截断 500 字符

**测试状态**: ✅ 839 passed (原 831 + 新增 8)

### ✅ Kurisu 人设参考文档 (2026-02-17)

**任务**: 人设资料收集与文档化

**数据来源**:
- Steins;Gate Wiki (Fandom)
- 萌娘百科、灰机百科
- dialogue.moe 台词库

**文件**: `docs/persona/KURISU_PERSONA_REFERENCE.md`

**内容概要**:
| 章节 | 内容 |
|------|------|
| 基础信息 | 年龄、职业、学历、昵称 |
| 外貌特征 | 发色、体型、着装 |
| 性格特征 | 理智×傲娇×好强×内向 |
| 背景故事 | 父女关系、学术成就 |
| 人际关系 | Lab Members、Maho |
| 说话习惯 | 口头禅、语气变化规则 |
| 经典台词 | 名言、对话示例 (中英) |
| 行为禁忌 | OOC 列表 |
| 世界观设定 | 术语、Gadgets |
| 配置示例 | System Prompt、YAML 配置 |

**用途**: 为 PersonaEngine 提供详细的人设参考，支持 Lore 扩展

### ✅ KURISU-007 人设引擎增强 (2026-02-17)

**任务**: OOC 列表统一 + Lore 术语库 + PERSONA_HARDCODED 增强

**修改文件**:
| 文件 | 变更 |
|------|------|
| `src/core/persona/constants.ts` | 统一常量定义 (OOC, MOE, INTIMATE, TSUNDERE 等) |
| `src/core/persona/lore.ts` | 新增 Steins;Gate 术语库 (15 terms / 5 categories) |
| `src/core/persona/validator.ts` | 改为从 constants.ts 导入 |
| `src/core/persona/enforcer.ts` | 改为从 constants.ts 导入 |
| `src/core/persona/index.ts` | 改为从 constants.ts 导入 |

**新增测试**:
- `tests/unit/persona/constants.test.ts` - 24 tests
- `tests/unit/persona/lore.test.ts` - 33 tests

**Lore 术语库结构**:
```
LORE_TERMS
├── world_mechanism (3): world-line, attractor-field, reading-steiner
├── technology (3): d-mail, time-leap, amadeus
├── organization (2): future-gadget-lab, sern
├── item (3): phone-microwave, ibn-5100, fork-spoon
└── character (5): okabe, mayuri, maho, shouichi, kurisu
```

**修复问题**:
| 问题 | 修复 |
|------|------|
| lore.ts 中文引号语法错误 | 改为单引号 |
| searchLore 大小写敏感 | description 也转小写 |
| "人家" 重复定义 | 移除自 INTIMATE_KEYWORDS |

**Code Review**: APPROVED (0 CRITICAL/HIGH/MEDIUM, 1 LOW)

**测试状态**: ✅ 831 通过, 28 files

**任务**: 人设资料收集与文档化

**数据来源**:
- Steins;Gate Wiki (Fandom)
- 萌娘百科、灰机百科
- dialogue.moe 台词库

**文件**: `docs/persona/KURISU_PERSONA_REFERENCE.md`

**内容概要**:
| 章节 | 内容 |
|------|------|
| 基础信息 | 年龄、职业、学历、昵称 |
| 外貌特征 | 发色、体型、着装 |
| 性格特征 | 理智×傲娇×好强×内向 |
| 背景故事 | 父女关系、学术成就 |
| 人际关系 | Lab Members、Maho |
| 说话习惯 | 口头禅、语气变化规则 |
| 经典台词 | 名言、对话示例 (中英) |
| 行为禁忌 | OOC 列表 |
| 世界观设定 | 术语、Gadgets |
| 配置示例 | System Prompt、YAML 配置 |

**用途**: 为 PersonaEngine 提供详细的人设参考，支持 Lore 扩展

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

### ✅ L2 人设引擎 - PromptBuilder (2026-02-17)

**任务**: KURISU-006

**文件**:
- `src/core/persona/prompt-builder.ts` - PromptBuilder 类
- `tests/unit/persona/prompt-builder.test.ts` - 单元测试 (40 tests)

**核心功能**:
- `build()` - 构建 RP 提示词（人设→状态→记忆→对话→输入→要求）
- `updateMentalModel()` - 更新心智模型（防御性深合并）
- `getMentalModel()` - 获取深拷贝

**Code Review 修复**:
- 修复 updateMentalModel 浅合并 bug

**测试状态**: ✅ 40 通过

## 进行中

### 🔄 下一个任务

**当前**: L2 人设引擎扩展 - 全部完成 ✅

**剩余模块**: 无

## 待办

### L2 人设引擎 - 扩展模块 (全部完成)

| 文件 | 类 | 测试数 | 优先级 | 状态 |
|------|-----|--------|--------|------|
| `src/core/persona/validator.ts` | PersonaValidator | 76 tests | P2 | ✅ 完成 |
| `src/core/persona/enforcer.ts` | PersonaEnforcer | 45 tests | P2 | ✅ 完成 |
| `src/core/persona/prompt-builder.ts` | PromptBuilder | 40 tests | P2 | ✅ 完成 |
| `tests/integration/persona/persona-flow.test.ts` | 集成测试 | 14 tests | P2 | ✅ 完成 |

**总计**: 217 tests (56 + 76 + 45 + 40 = 217)

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
