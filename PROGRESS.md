# Kurisu 项目进度追踪

> 最后更新: 2026-02-22
> 状态: MVP 完成，角色灵魂系统完成，L6+L7 工具层开发中

---

## 🎯 项目定位

> **"用户只需创建角色，就能得到能聊天语音视频 + 能用工具操控电脑的个人助手"**

### 核心能力目标

| 能力 | 目标体验 | 状态 |
|------|---------|------|
| **对话真实感** | 用户感受到的是真正的角色 | Phase D 待开发 |
| **语音对话** | 角色专属声音，实时语音交流 | Phase A 待开发 |
| **视频形象** | Live2D 虚拟形象，可直播 | Phase F 待开发 |
| **工具使用** | 能搜索、写代码、操控电脑 | **Phase B 开发中 ← 当前** |
| **零门槛入口** | 创建角色 = 完整助手 | Phase C 待开发 |

---

## 📊 整体进度

```
MVP 阶段 ████████████████████ 100% ✅
  ├── L1 Gateway       ✅
  ├── L2 Persona 1.0   ✅
  ├── L3 Agent         ✅
  ├── L4 Memory        ✅
  └── L5 Infrastructure✅

Telegram 接入 ████████████████░░░░ 80% (KURISU-013)
  ├── Phase 0-2.2 文字对话  ✅ 端到端测试通过
  └── Phase 3 语音消息      🔲 依赖 Phase A

2.0 核心能力 ██████████░░░░░░░░░░ 50%
  ├── Phase A: 基础语音     🔲 P0
  ├── Phase B: 工具沙箱     🔄 开发中 ← 当前（KURISU-016+017 Phase 4 完成）
  ├── Phase C: 角色创建向导 🔲 P0
  ├── Phase D: Persona 2.0  🔲 P1
  ├── Phase E: 实时语音     🔲 P1
  ├── Phase F: 虚拟形象     🔲 P2
  └── Phase G: 自进化       🔲 P2
```

---

## 最近完成

### KURISU-016+017 Phase 4: 审批流程集成（2026-02-22）

**目标**: confirm 级工具需要用户审批，审批流程完整集成到 Channel 层

**完成**:
- ✅ 类型扩展：AgentResult/StreamResult/GatewayStreamResult 添加审批字段
  - `approvalRequired`: 是否需要审批
  - `approvalMessage`: 审批消息（发送给用户）
  - `pendingToolCall`: 待审批的工具调用
- ✅ Gateway 集成 ApprovalManager
  - `hasPendingApproval(sessionId)`: 检查是否有待审批
  - `checkApprovalReply(sessionId, userMessage)`: 检查用户回复是否是审批指令
  - `executeApprovedTool(sessionId, toolCall)`: 执行已批准的工具
- ✅ Orchestrator 暴露审批状态
  - `process()` 返回 `approvalRequired/approvalMessage/pendingToolCall`
  - 新增 `executeTool(sessionId, toolCall)` 方法
- ✅ TelegramChannel 审批处理
  - `handleApprovalReply()`: 处理 approved/rejected/timeout
  - 用户回复「确认」→ 执行工具并发送结果
  - 用户回复「取消」→ 发送"已取消操作"
  - 超时 → 发送"审批已超时"
- ✅ QQChannel 审批处理（同上）
- ✅ 测试修复：Mock Gateway 添加新方法，298 tests 通过

**审批流程架构**:
```
confirm 级工具调用
    ↓
Orchestrator.process() 返回 approvalRequired=true + approvalMessage
    ↓
Channel 发送审批消息给用户（Telegram/QQ）
    ↓
用户回复「确认」/「取消」
    ↓
Channel.handleRequest() → Gateway.checkApprovalReply()
    ↓
approved → executeApprovedTool() → 发送工具执行结果
rejected → 发送"已取消操作"
```

### KURISU-016+017 Phase 3: Docker 沙箱（2026-02-22）

**目标**: confirm 级工具在 Docker 沙箱中安全执行

**完成**:
- ✅ `Dockerfile.sandbox` - 最小化 Alpine 镜像，非 root 用户，安全限制
- ✅ `SandboxExecutor` (src/tools/sandbox.ts) - Docker 容器执行器
  - 资源限制（CPU、内存）
  - 网络隔离
  - 只读根文件系统
  - 超时处理
- ✅ `config/system/sandbox.yaml` - 沙箱配置文件
- ✅ `ToolRegistry.execute()` 集成沙箱执行
- ✅ 单元测试（10 tests）

**架构**:
```
confirm 级工具 → shouldUseSandbox → SandboxExecutor.execute()
                                       ↓
                                  Docker 容器（隔离网络 + 资源限制）
```

### MCP Bridge CI 修复（2026-02-22）

**问题**: ESLint 报 5 个 error 导致 CI 失败

**修复**:
- 使用 MCP SDK 官方 schema (`ListToolsResultSchema`, `CompatibilityCallToolResultSchema`)
- 正确处理 union 类型 `CompatibilityCallToolResult` 的类型断言
- 添加 eslint-disable 注释处理 MCP SDK 复杂类型的 unsafe 操作
- `ToolRegistry`: 移除不必要的非空断言

**结果**: CI 全部通过 (build ✓, docker ✓, security ✓)

### Agent 层 function calling 集成（2026-02-22）

**Phase 2 完成** ✅

- 模型层类型定义：OpenAIToolDefinition、LLMToolCall、Message 联合类型
- OpenAI 兼容 Provider 支持 tools 参数和 tool_calls 响应解析
- Agent 层 ToolRegistryLike 接口抽象
- generate 节点支持工具调用结果构建和 pendingToolCalls 返回
- 新增 generateRouter、toolCallRouter 路由
- 工作流实现 ReAct 循环：generate → tool_call → generate（最大 5 次迭代）

**架构图**:
```
conversation/task → generateRouter → tool_call (如果有 tool_calls)
                                       ↓
                              toolCallRouter → conversation/task (继续生成)
                                              → validate (完成或超过迭代上限)
```

### KURISU-016+017: 工具执行层 + Skill System（2026-02-22）

> 详细文档: `.claude/tasks/KURISU-016-017-TOOL-SKILL-SYSTEM.md`

**Phase 1 完成** ✅
- 工具类型定义 (ToolDef, ToolCall, ToolResult, PermissionLevel)
- Skill 类型定义 (SkillConfig, TriggerRule)
- 扩展 AgentState 添加工具相关字段
- skill_activate 节点 + workflow 集成

**Phase 2 完成** ✅
- ✅ MCP SDK 集成 (@modelcontextprotocol/sdk + dockerode)
- ✅ MCPBridge: MCP 客户端连接池
- ✅ ToolRegistry: 工具注册表 + OpenAI 格式转换
- ✅ PermissionChecker: safe/confirm/deny 三级权限
- ✅ ApprovalManager: 审批流程管理
- ✅ tool_call 节点
- ✅ generate 节点支持 tools 参数
- ✅ ReAct 循环集成（generate → tool_call → generate，最大 5 次迭代）
- ✅ OpenAI-compatible Provider 支持 function calling
- ✅ 新增 generateRouter、toolCallRouter 路由

**Phase 4 完成** ✅ (2026-02-22)
- ✅ 类型扩展：AgentResult/StreamResult/GatewayStreamResult 添加审批字段
- ✅ Gateway 集成 ApprovalManager：hasPendingApproval, checkApprovalReply, executeApprovedTool
- ✅ Orchestrator 暴露审批状态：process() 返回 approvalRequired/approvalMessage/pendingToolCall
- ✅ Orchestrator 添加 executeTool() 方法：执行已批准的工具
- ✅ TelegramChannel 审批处理：handleApprovalReply 方法处理确认/取消/超时
- ✅ QQChannel 审批处理：handleApprovalReply 方法处理确认/取消/超时
- ✅ 测试修复：Mock Gateway 添加 checkApprovalReply + executeApprovedTool

**审批流程架构**:
```
confirm 级工具 → Orchestrator 返回 approvalRequired + approvalMessage
                          ↓
                    Channel 发送审批消息给用户
                          ↓
用户回复「确认」/「取消」 → Gateway.checkApprovalReply()
                          ↓
                    approved/rejected/timeout
                          ↓
           approved → Gateway.executeApprovedTool() → 发送结果
```

**待完成**
- Phase 5: Skill Loader/Registry 实现
- Phase 6: 人设化包装 + 单元测试

### 角色灵魂系统优化（2026-02-21）

参考 OpenClaw SOUL.md 行为密度原则，优化角色配置文件：

- **soul.md** 精简 74%（1600词 → 420词），删除叙事填充，保留行为密度
  - 新增"先行动，再开口"原则 — 解决拒绝使用工具的问题
  - 解释"哼"是情绪防御非开场白 — 解决傲娇泛滥问题
- **persona.yaml** 拆分 when_refusing 为三类，新增 when_using_tools，移除 max_sentences 硬限制
- **prompt-builder.ts** 删除外部字数规则（由灵魂内在动机驱动简洁性）
- **ROLE-SOUL-SPEC.md** 升至 v1.1，补充 OpenClaw 行为密度原则

---

## 当前任务

### KURISU-015: 基础语音能力 [P0] ← 下一步

> 详细文档: 待创建 `docs/tasks/active/KURISU-015-VOICE-BASIC.md`

**状态**: 待启动

| 任务 | 状态 | 说明 |
|------|------|------|
| Whisper STT 集成 | 🔲 | 本地语音识别，接收 Telegram 语音消息 |
| Fish Audio TTS 集成 | 🔲 | API 语音合成，合成角色声音 |
| Telegram 语音消息收发 | 🔲 | 接收语音 → STT → 处理 → TTS → 发送 |
| 流式 TTS 输出 | 🔲 | 边生成边播放，降低延迟 |
| 角色音色配置 | 🔲 | role.yaml 中 voice 字段 |

---

### KURISU-016: 工具执行沙箱 [P0] ← 可与 015 并行

> 详细文档: 待创建 `docs/tasks/active/KURISU-016-TOOL-SANDBOX.md`

**状态**: 待启动

| 任务 | 状态 | 说明 |
|------|------|------|
| Docker 工具沙箱设计 | 🔲 | 隔离执行环境 |
| 工具权限分级系统 | 🔲 | 安全/确认/禁止三级 |
| 内置工具: web_search | 🔲 | 搜索网页 |
| 内置工具: file_read | 🔲 | 读取文件 |
| 内置工具: screenshot | 🔲 | 截图+理解 |
| 内置工具: browser | 🔲 | Playwright 浏览器控制 |
| 内置工具: shell | 🔲 | 沙箱内 Shell 执行 |
| 工具输出人设化包装 | 🔲 | PersonaEngine.wrapToolOutput() |

---

### KURISU-017: 角色创建向导 + Skill System [P0]

> 详细文档: `.claude/tasks/KURISU-017-ROLE-WIZARD-SKILL.md` ✅ 已创建

**状态**: 待启动（依赖 015 和 016 完成）

**Phase 1: Skill System（优先）**

| 任务 | 状态 | 说明 |
|------|------|------|
| Skill 类型定义（types.ts） | 🔲 | SkillConfig, TriggerRule |
| skill.yaml 解析器 | 🔲 | 加载并验证 YAML |
| SkillRegistry 实现 | 🔲 | 注册/查询/意图匹配 |
| 知识注入到 Prompt | 🔲 | context + examples 注入 System Prompt |
| coding-assistant 内置 Skill | 🔲 | 第一个 Skill，验证设计 |

**Phase 2: 创建向导**

| 任务 | 状态 | 说明 |
|------|------|------|
| role.yaml 格式定义（含 skills 字段） | 🔲 | 角色配置包含 Skill 绑定 |
| 5步创建向导 CLI | 🔲 | Step 4 = Skill 选择 |
| Kurisu 内置模板 | 🔲 | 包含默认 Skills |

**Phase 3: Skill Store CLI**

| 任务 | 状态 | 说明 |
|------|------|------|
| kurisu skill list/install/remove | 🔲 | 像 npm 一样管理 Skill |

---

### KURISU-014 重新规划：Persona Engine 2.0 [P1]

> 状态: Phase A/B/C 完成后启动

| 任务 | 状态 | 说明 |
|------|------|------|
| 角色知识库 YAML 格式 | 🔲 | config/personas/kurisu/ |
| 10+ 对话示例编写 | 🔲 | Few-Shot 学习基础 |
| Few-Shot 注入机制 | 🔲 | 动态匹配 + Prompt 注入 |
| 情感状态追踪 | 🔲 | 影响 TTS 语调 + Live2D 表情 |

---

## 并行任务

### KURISU-013: 多平台接入

**状态**: QQ Channel Reverse HTTP 模式完成 (2026-02-21)

| Phase | 状态 | 说明 |
|-------|------|------|
| Telegram 文字 | ✅ | 端到端通过 (2026-02-19) |
| **QQ 文字** | ✅ **完成** | Reverse HTTP 模式 + 19 tests (2026-02-21) |
| QQ 端到端 | 🔄 **测试中** | NapCat 已配置，待验证消息收发 |
| QQ 语音 | 🔲 | 依赖 KURISU-015 完成 |
| Telegram 语音 | 🔲 暂缓 | 依赖 KURISU-015 完成 |
| Discord 语音 | 🔲 延后 | 依赖 Phase E |

**技术要点**:
- NapCat 不支持 `get_latest_events` Polling，改用 Reverse HTTP
- NapCat 使用 `send_private_msg`/`send_group_msg` 而非 `send_message`
- 配置：HTTP Server (3001) + HTTP Client (推送事件到 Kurisu)

### 启动方式变化

```bash
# 以前（两个终端）
# terminal 1: cloudflared tunnel --url http://localhost:3000
# terminal 2: pnpm dev 或 docker compose up

# 现在（一条命令）
docker compose --profile qq up       # QQ 测试，无需 Tunnel
docker compose --profile tunnel up   # Telegram Webhook 模式
```

---

## 已完成模块

### MVP 核心功能 ✅

| 层级 | 模块 | 测试数 | 覆盖率 |
|------|------|--------|--------|
| L1 | 交互网关 | 264 | 98%+ |
| L2 | 人设引擎 1.0 | 288 | - |
| L3 | Agent 编排 | 21 | - |
| L4 | 记忆系统 | 184 | - |
| E2E | 端到端测试 | 67 | - |
| L5 | 基础设施 | - | - |
| **新增** | **角色灵魂系统** | **34** | **-** |

**总计**: 963 tests, 83%+ coverage

### CI 修复 (2026-02-21)

- 修复 TypeScript 类型检查错误：移除未使用的类型导入
- 适配三层架构测试：所有测试在调用依赖 roleConfig 的方法前先加载角色
- 修复 `PersonaEngine.updateMentalModel()` 保留 roleConfig 的 bug

### 灵魂系统加载修复 (2026-02-21)

- **关键 Bug**：server.ts 未调用 `loadRole()`，灵魂系统根本没有加载
- 修复：添加 `await personaEngine.loadRole(defaultRole)`
- CLI 重构为静态工厂方法 `KurisuCLI.create()`
- 消除硬编码：`defaults.role` 从配置读取
- soul.md 新增"我说话的方式"章节（内在动机驱动简洁回复）
- persona.yaml 移除 `max_sentences: 3` 硬性限制，改用 `style.brevity`

### 角色灵魂系统 ✅ (2026-02-21)

> 详细设计: `docs/design/ROLE-SOUL-SPEC.md`

三层架构（T017）:
- **L-1 系统安全层**: SilentSafetyInterceptor 静默拦截，返回结构化错误
- **L0 灵魂层**: soul.md 第一人称定义（价值观、矛盾、情感深度）
- **L1 表现层**: persona.yaml 说话习惯、行为倾向、格式化规则

| 模块 | 文件 | 说明 |
|------|------|------|
| 类型定义 | soul-types.ts | SoulConfig, PersonaConfig, RoleConfig |
| 配置加载 | role-loader.ts | 加载 soul.md + persona.yaml + lore.md + memories/ |
| 安全拦截 | silent-interceptor.ts | 静默返回结构化错误，不产生对话输出 |
| 错误表达 | response-builder.ts | 将安全错误转为角色化表达 |
| Kurisu 配置 | config/personas/kurisu/ | 完整灵魂配置（soul.md + persona.yaml）|

---

## 架构演进

### MVP (五层) ✅

```
L1 Gateway → L2 Persona 1.0 → L3 Agent → L4 Memory → L5 Infrastructure
```

### 2.0 目标 (九层)

```
L1 Gateway（多渠道：文字/语音/视频）
    ↓
L2 Multimodal（STT/图像理解/实时流）⭐新增
    ↓
L3 Persona Engine 2.0（角色一致性+情感状态）
    ↓
L4 Agent Orchestrator
    ↓
L5 Memory System（+用户画像）
    ↓
L6 Tool Executor（Docker沙箱+权限管理）⭐重设计
    ↓
L7 Self-Evolution（MCP优先+插件发现）
    ↓
L8 Presentation（TTS+Live2D+虚拟摄像头）⭐新增
    ↓
L9 Role Config（一站式创建向导）⭐重设计
```

---

## 技术决策

| ID | 决策 | 日期 |
|----|------|------|
| T001 | YAML 配置 + 环境变量注入 | 2026-02-16 |
| T002 | Anthropic 兼容 API 优先 | 2026-02-16 |
| T003 | GLM-5 API 先行 | 2026-02-18 |
| T004 | setup.sh 延后 | 2026-02-18 |
| T005 | 对话质量：降低延迟 + 人设微调 | 2026-02-18 |
| T006 | 两大核心能力：角色真实感 + 自进化 | 2026-02-19 |
| T007 | AstrBot 插件桥接，MCP 优先 | 2026-02-19 |
| T008 | 工具输出人设化包装 | 2026-02-19 |
| T009 | 九层架构：补充多模态+表现+工具沙箱层 | 2026-02-19 |
| T010 | 路线图重排：语音+工具沙箱优先于 Persona 2.0 | 2026-02-19 |
| **T017** | **角色灵魂系统：安全层(静默)+灵魂层+表现层** | **2026-02-21** |

---

## 关键文件

```
kurisu/
├── CLAUDE.md              # 项目规范（九层架构）
├── PROGRESS.md            # 本文件
├── config/
│   ├── models.yaml        # 模型配置
│   ├── personas/          # 角色配置目录（L9）
│   │   └── kurisu/
│   │       ├── soul.md        # 灵魂层（第一人称）✅
│   │       ├── persona.yaml   # 表现层（说话习惯）✅
│   │       ├── lore.md        # 世界观 ✅
│   │       └── memories/      # 记忆配置 ✅
│   └── system/            # 系统配置
│       └── safety.yaml        # 安全规则 ✅
├── src/
│   ├── gateway/           # L1 交互网关 ✅
│   ├── multimodal/        # L2 多模态处理 🔲 待新增
│   ├── core/
│   │   ├── persona/       # L3 人设引擎 ✅（含灵魂系统）
│   │   └── safety/        # L-1 安全层 ✅ 新增
│   ├── agents/            # L4 Agent 编排 ✅
│   ├── memory/            # L5 记忆系统 ✅
│   ├── tools/             # L6 工具执行层 🔲 待新增
│   ├── skills/            # L7 Skill System 🔲 待新增
│   └── presentation/      # L8 表现输出层 🔲 待新增
└── docs/
    ├── design/ROLE-SOUL-SPEC.md  # 灵魂系统设计 ✅
    └── tasks/active/             # 任务文档
```

---

## 下一步（按优先级）

### KURISU-016+017 Phase 5-6（继续）

1. **Phase 5: Skill System** — SkillLoader + SkillRegistry + IntentMatcher + KnowledgeInjector
2. **Phase 6: 人设包装 + 测试** — PersonaWrapper + 单元测试 80%+ 覆盖率

### 可并行启动（P0）

3. **KURISU-015** — 基础语音：Whisper STT + Fish Audio TTS + Telegram 语音消息

### 016+017 完成后

4. **KURISU-017** — 角色创建向导：5步 CLI 向导 + role.yaml 格式
