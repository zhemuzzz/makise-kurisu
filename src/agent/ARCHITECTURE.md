# Agent Core 架构设计

> 版本: 1.0
> 日期: 2026-03-02
> 状态: ACTIVE
> 设计结论: `.claude/research/conclusions/` (20 份)

---

## 一、架构定位

Agent Core 是 kurisu 的「大脑」，负责推理和决策。Platform Services 是基础设施，负责执行和维护。

**核心关系**: Agent 决策，Platform 执行。

```
┌─────────────────────────────────────────────────────────────┐
│                         Agent Core                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │  Identity   │───▶│   ReAct     │───▶│  AgentEvent 流  │  │
│  │ (不可变)    │    │    Loop     │    │  (AsyncGenerator)│  │
│  └─────────────┘    └──────┬──────┘    └─────────────────┘  │
│                            │                                │
│                     ┌──────▼──────┐                         │
│                     │  Pipeline   │                         │
│                     │ Pre ⇄ Post  │                         │
│                     └──────┬──────┘                         │
└───────────────────────────┼─────────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    Platform Services      │
              │  (通过 Port 接口访问)      │
              │  - ContextManager         │
              │  - ToolExecutor           │
              │  - SkillManager           │
              │  - PermissionService      │
              │  - ApprovalService        │
              │  - TracingService         │
              │  - MemorySystem           │
              │  - LLMProvider            │
              └───────────────────────────┘
```

---

## 二、目录结构

```
src/agent/
├── ports/
│   ├── platform-services.ts   # Port 接口定义 (Agent 侧)
│   └── index.ts               # 导出
├── pipeline/
│   ├── pre-process.ts         # 前处理管线
│   ├── post-process.ts        # 后处理管线
│   └── index.ts               # 导出
├── meta-tools/
│   ├── manage-todo.ts         # Todo 管理 (Phase 4)
│   ├── find-skill.ts          # Skill 搜索 (Phase 4)
│   ├── manage-skill.ts        # Skill 管理 (Phase 4)
│   └── spawn-sub-agent.ts     # Sub-Agent 委派 (Phase 4)
├── types.ts                   # 核心类型定义
├── agent.ts                   # Agent 核心: execute()
├── react-loop.ts              # ReAct 循环实现
└── ARCHITECTURE.md            # 本文档
```

---

## 三、核心类型

### 3.1 Identity (不可变身份)

```typescript
interface Identity {
  readonly roleId: string;      // 角色 ID
  readonly soul: string;        // 灵魂层 (~800 tokens)
  readonly persona: PersonaConfig;  // 表现层 (~400 tokens)
  readonly loreCore: string;    // 世界观核心 (~300 tokens)
}
```

**Token 预算**: ~1600 tokens 固定注入，绝不裁剪

**来源**: agent-core.md 第五节

### 3.2 AgentEvent (6 种事件)

| 事件 | 载荷 | 触发时机 |
|------|------|---------|
| `text_delta` | content: string | ContextManager 处理后的用户可见内容 |
| `tool_start` | toolName, args | Platform 开始执行工具前 |
| `tool_end` | toolName, result | 工具执行完成后 |
| `error` | code, message | SYSTEM_ERROR 降级时 |
| `status` | message | 非内容性状态变化 |
| `complete` | emotionTags, finalResponse | ReAct 循环结束 |

**来源**: react-engineering.md C3-1

### 3.3 AgentConfig (双模式配置)

```typescript
interface AgentConfig {
  readonly mode: "conversation" | "background";
  readonly maxIterations: number;  // Main: 25, Sub: 15
  readonly timeout: number;
  readonly sessionId: string;
  readonly userId: string;
  readonly isSubAgent: boolean;
  readonly debugEnabled: boolean;
}
```

**来源**: agent-core.md D19/BG-1

---

## 四、Port 接口设计

### 4.1 Port-Adapter 模式 (D1)

```
┌──────────────────────────────────────────────────────┐
│                   Agent 侧                           │
│  ┌─────────────────┐     ┌──────────────────────┐   │
│  │    Agent.ts     │────▶│ PlatformServices     │   │
│  │                 │     │  (接口定义)          │   │
│  └─────────────────┘     └──────────┬───────────┘   │
└─────────────────────────────────────┼───────────────┘
                                      │
                                      │ 依赖
                                      ▼
┌──────────────────────────────────────────────────────┐
│                   Platform 侧                        │
│  ┌─────────────────────────────────────────────┐    │
│  │ PlatformServicesAdapter                      │    │
│  │  - ContextManagerAdapter                     │    │
│  │  - ToolExecutorAdapter                       │    │
│  │  - SkillManagerAdapter                       │    │
│  │  - ...                                       │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

**原则**:
- Agent 在 `src/agent/ports/` 定义 Port 接口
- Platform 在 `src/platform/` 实现 Adapter
- Agent 仅依赖 Port 接口，可独立运行和测试

### 4.2 构造器注入 (D2)

```typescript
// Bootstrap 阶段组装
const services: PlatformServices = {
  context: new ContextManagerAdapter(config),
  tools: new ToolExecutorAdapter(dockerSandbox, permissionService),
  skills: new SkillManagerAdapter(skillRegistry),
  // ...
};

const agent = new Agent(identity, services);
```

**不使用 DI 框架** (tsyringe / InversifyJS)

### 4.3 Port 接口列表

| Port | 职责 | 设计来源 |
|------|------|---------|
| `ContextManagerPort` | Prompt 组装 + Token 预算 + Compact | CM-1~CM-7 |
| `ToolExecutorPort` | 工具沙箱执行 + 权限校验 | D11 |
| `SkillManagerPort` | Skill 注册/搜索/激活 | D7, D14, D15 |
| `SubAgentManagerPort` | Sub-Agent 生命周期 | SA-1~SA-11 |
| `PermissionPort` | 统一权限判定 | PS-1~PS-4 |
| `ApprovalPort` | 用户确认流程 | PS-3 |
| `TracingPort` | 事件日志 + 指标 | TS-1~TS-5 |
| `MemoryPort` | 记忆召回/写入 | — |
| `LLMProviderPort` | LLM 调用 + 流式 | — |

---

## 五、Pipeline 设计

### 5.1 执行流程

```
execute(input: AgentInput): AsyncGenerator<AgentEvent>
    │
    ├─▶ [1. PreProcess]
    │     ├─ assemblePrompt (ContextManager)
    │     ├─ checkBudget
    │     └─ 获取工具定义
    │
    ├─▶ [2. ReAct Loop]
    │     │
    │     │  while (iterations < maxIterations && !shouldStop)
    │     │     │
    │     │     ├─▶ LLM.stream()
    │     │     │     ├─ text_delta → yield
    │     │     │     └─ tool_calls → 收集
    │     │     │
    │     │     ├─▶ if (tool_calls)
    │     │     │     ├─ 权限检查 (PermissionPort)
    │     │     │     ├─ 用户确认 (ApprovalPort, confirm 级工具)
    │     │     │     ├─ 执行工具 (ToolExecutorPort)
    │     │     │     ├─ PersonaWrapper 视角转换
    │     │     │     └─ 注入 messages → 继续循环
    │     │     │
    │     │     └─▶ else (纯文本)
    │     │           └─ break
    │     │
    │     └─ checkBudget → compact if needed
    │
    └─▶ [3. PostProcess]
          ├─ processLLMOutput (剥离 thinking, 提取 emotion_tags)
          ├─ ILE.processTurn (更新情绪/心境/关系)
          ├─ 记忆写入 (MemoryPort)
          ├─ Session 状态更新
          ├─ Tracing 日志
          └─ yield complete event
```

### 5.2 PreProcess 职责

| 步骤 | 调用 | 说明 |
|------|------|------|
| 组装 Prompt | `context.assemblePrompt()` | 按 9 级优先队列组装 |
| 检查预算 | `context.checkBudget()` | 返回 shouldCompact / shouldDegrade |
| 获取工具 | `tools.getToolDefinitions()` | 激活 Skills 的工具定义 |
| 权限标注 | `permission.getToolAnnotations()` | 工具权限信息注入 Prompt |

### 5.3 PostProcess 职责

| 步骤 | 调用 | 说明 |
|------|------|------|
| 处理输出 | `context.processLLMOutput()` | 剥离 `<thinking>`, 提取 `emotion_tags` |
| ILE 更新 | `ile.processTurn()` | 更新 mood/relationship (Platform 负责) |
| 记忆写入 | `memory.store()` | 用户信息 + 角色状态变化 + 角色承诺 |
| 追踪日志 | `tracing.log()` | 事件记录 |
| Session 更新 | — | 更新会话状态 |

---

## 六、ReAct Loop 设计

### 6.1 迭代限制

| Agent 类型 | 最大迭代 | 来源 |
|-----------|---------|------|
| Main Agent | 25 | CM-1 |
| Sub-Agent | 15 | CM-1 |

### 6.2 错误处理 (C1-1)

```
错误分类:
├─ TOOL_ERROR
│    ├─ 参数错误
│    ├─ 执行失败
│    ├─ 权限被拒
│    ├─ 用户拒绝
│    └─ 工具超时
│
├─ TRANSIENT (自动重试 1 次, 间隔 2s)
│    ├─ 网络超时
│    ├─ API 速率限制
│    └─ MCP 连接中断
│
└─ SYSTEM_ERROR (不持久化到 history)
     ├─ LLM API 错误
     ├─ Context 溢出
     └─ 模型不可用
```

### 6.3 降级方案 (C1-2)

**场景 1: 达到 maxIterations**
1. 保留所有已完成工具结果
2. 向 LLM 发最后一轮，追加降级指令
3. LLM 生成角色视角回复
4. 最后一轮失败 → 静态降级模板

**场景 2: Token 预算耗尽**
1. ContextManager 执行 compact
2. 成功 → 恢复 ReAct
3. 失败或已 compact 2 次 → 按场景 1 处理

**场景 3: SYSTEM_ERROR**
1. 不写入 history
2. 直接使用静态降级模板
3. Session 保持，下条消息正常处理

### 6.4 流式输出

```typescript
async function* reactLoop(
  messages: LLMMessage[],
  tools: Tool[],
  config: AgentConfig,
  services: PlatformServices,
  signal: AbortSignal
): AsyncGenerator<AgentEvent, AgentResult, unknown> {

  let iterations = 0;

  while (iterations < config.maxIterations) {
    // 检查中断
    if (signal.aborted) {
      yield { type: "status", message: "canceled", timestamp: Date.now() };
      return { aborted: true, ... };
    }

    // 检查预算
    const budget = services.context.checkBudget(messages);
    if (budget.shouldDegrade) {
      // 降级路径
      yield* degrade(budget, messages, services);
      return;
    }
    if (budget.shouldCompact) {
      const compacted = await services.context.compact(messages);
      messages = compacted.messages;
      yield { type: "status", message: "compacted", ... };
    }

    // LLM 调用
    const stream = services.llm.stream(messages, tools, config, signal);

    let fullContent = "";
    let toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      if (chunk.delta) {
        fullContent += chunk.delta;
        yield { type: "text_delta", content: chunk.delta, ... };
      }
      if (chunk.toolCalls) {
        // 收集工具调用
      }
    }

    // 有工具调用 → 执行 → 继续循环
    if (toolCalls.length > 0) {
      for (const tc of toolCalls) {
        yield { type: "tool_start", toolName: tc.name, args: tc.args, ... };
        const result = await executeTool(tc, services);
        yield { type: "tool_end", toolName: tc.name, result: brief(result), ... };
      }
      // 注入工具结果到 messages
      // ...
      iterations++;
      continue;
    }

    // 纯文本 → 结束
    break;
  }

  // 返回最终结果
  return { finalResponse: fullContent, ... };
}
```

### 6.5 Abort 传播 (C3-5)

```
用户取消 (/stop)
    ↓
Gateway.abort(sessionId)
    ↓
Platform:
  1. AbortController.abort()
  2. LLM 流中断
  3. 当前工具收到 AbortSignal
    ↓
Agent Core:
  - AsyncGenerator.return()
  - 未返回的 tool_call 标记 "canceled"
    ↓
工具层:
  - Docker: docker kill
  - MCP: cancel notification
  - 长工具: 定期检查 signal.aborted
```

---

## 七、双模式实现

### 7.1 会话模式 vs 后台模式

| 维度 | 会话模式 | 后台模式 |
|------|---------|---------|
| **触发** | 用户消息 → Gateway | Scheduler → RoutineRegistry |
| **上下文** | Identity + 对话历史 + 记忆 | Identity + 任务目标 + 相关记忆 |
| **元工具** | 全部 4 个 | spawn-sub-agent + manage-todo |
| **流式** | 是 | 否 |
| **优先级** | 高 | 低 |

### 7.2 同一 ReAct 引擎

```typescript
// 会话模式
const conversationInput: AgentInput = {
  userMessage: "...",
  activatedSkills: [...],
  recalledMemories: [...],
  conversationHistory: [...],
  mentalModel: ile.buildContext(userId),
  todoState: currentTodo,
};

// 后台模式
const backgroundInput: AgentInput = {
  userMessage: "",  // 无用户消息
  taskGoal: "...",  // 任务目标
  activatedSkills: taskRelatedSkills,
  recalledMemories: [...],
  conversationHistory: [],  // 无历史
  mentalModel: ile.buildContext(userId),
};

// 同一 execute()
const events = agent.execute(input, config);
```

### 7.3 ContextManager 组装差异

```typescript
// 会话模式
assemblePrompt(input, config) {
  return [
    { role: "system", content: identity.soul },
    { role: "system", content: formatPersona(identity.persona) },
    { role: "system", content: identity.loreCore },
    { role: "system", content: input.mentalModel.formattedText },
    { role: "system", content: metaToolsPrompt },
    { role: "system", content: formatSkills(input.activatedSkills) },
    ...input.conversationHistory,  // 对话历史
    { role: "user", content: input.userMessage },
  ];
}

// 后台模式
assemblePrompt(input, config) {
  return [
    { role: "system", content: identity.soul },
    { role: "system", content: formatPersona(identity.persona) },
    { role: "system", content: identity.loreCore },
    { role: "system", content: input.mentalModel.formattedText },
    { role: "system", content: metaToolsPrompt },  // 限制元工具
    { role: "system", content: formatSkills(input.activatedSkills) },
    { role: "system", content: `任务目标: ${input.taskGoal}` },
  ];
}
```

### 7.4 后台模式约束

| 约束 | 规则 |
|------|------|
| confirm 工具 | 所有 confirm → deny (用户不在线) |
| 并发 | 同一时间最多 1 个后台任务 |
| 会话冲突 | 用户发消息时，后台任务暂停或排队 |
| 超时 | 300s (可配置) |

---

## 八、Platform Services 集成

### 8.1 ContextManager (CM-1~CM-7)

| 功能 | 接口 | 说明 |
|------|------|------|
| Prompt 组装 | `assemblePrompt()` | 9 级优先队列 |
| Token 预算 | `checkBudget()` | shouldCompact / shouldDegrade |
| 输出处理 | `processLLMOutput()` | 剥离 thinking, 提取 emotion_tags |
| 工具结果 | `processToolResult()` | shell tail-preserve / default head-preserve |
| Compact | `compact()` | pinned + recent-N 策略 |

### 8.2 PermissionService (PS-1~PS-4)

| 功能 | 接口 | 说明 |
|------|------|------|
| 权限检查 | `check()` | deny > confirm > allow > defaultLevel |
| 工具标注 | `getToolAnnotations()` | 注入 Prompt |

### 8.3 ApprovalService (PS-3)

| 功能 | 接口 | 说明 |
|------|------|------|
| 请求确认 | `requestApproval()` | suspend ReAct |
| 等待响应 | `awaitResponse()` | confirm / reject / timeout |
| 清理 | `rejectAllPending()` | 会话结束/Abort |

### 8.4 TracingService (TS-1~TS-5)

| 功能 | 接口 | 说明 |
|------|------|------|
| 事件日志 | `log()` | 分级事件 |
| 指标 | `logMetric()` | 性能数据 |
| Span | `startSpan()` / `endSpan()` | 分布式追踪 |

---

## 九、测试策略

### 9.1 单元测试

```typescript
// Port 接口可独立 mock
const mockServices: PlatformServices = {
  context: createMockContextManager(),
  tools: createMockToolExecutor(),
  // ...
};

const agent = new Agent(testIdentity, mockServices);
```

### 9.2 集成测试

- Pipeline 执行顺序
- ReAct 迭代限制
- 错误分类与降级
- Abort 传播
- AgentEvent 流

### 9.3 覆盖率目标

- 核心模块: 80%+
- Port 接口: 100% (契约测试)

---

## 十、实现计划

| 步骤 | 文件 | 状态 |
|------|------|------|
| 3a.1 | ARCHITECTURE.md, types.ts, ports/ | ✅ 完成 |
| 3a.2 | tests/agent/*.test.ts | □ |
| 3a.3 | agent.ts | □ |
| 3a.4 | react-loop.ts | □ |
| 3a.5 | pipeline/*.ts | □ |
| 3a.6 | code-review | □ |

---

## 参考文档

- [agent-core.md](/.claude/research/conclusions/agent-core.md) - D1~D6, D13, D19/BG-1
- [react-engineering.md](/.claude/research/conclusions/react-engineering.md) - C1~C4
- [platform-execution.md](/.claude/research/conclusions/platform-execution.md) - D1, D2, D9, D11, D16
- [context-manager.md](/.claude/research/conclusions/context-manager.md) - CM-1~CM-7
- [permission-service.md](/.claude/research/conclusions/permission-service.md) - PS-1~PS-4
- [meta-tools.md](/.claude/research/conclusions/meta-tools.md) - 4 个元工具
- [sub-agent.md](/.claude/research/conclusions/sub-agent.md) - SA-1~SA-11
