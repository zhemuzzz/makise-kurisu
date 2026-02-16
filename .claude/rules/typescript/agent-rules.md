---
paths:
  - "**/*.ts"
  - "**/agents/**/*.ts"
  - "**/src/**/*.ts"
---
# Agent 编排规则

> kurisu 项目 Agent 架构专用规则

## 核心原则

1. **单一职责**：每个 Agent 只做一件事
2. **状态不可变**：节点返回 Partial<State>，不直接修改
3. **错误隔离**：节点内部处理错误，不让异常传播
4. **依赖注入**：所有外部依赖通过构造函数注入

## Agent 职责划分

| Agent | 职责 | 占比 |
|-------|------|------|
| Lead Agent | 人设维护 + 任务委派 | - |
| Conversation Agent | 日常对话 | 80% |
| Task Agent | 工具调用 + 任务执行 | 20% |

## 状态机规范

### 状态定义

```typescript
interface AgentState {
  // 消息历史（累加）
  messages: BaseMessage[];
  // 当前活跃 Agent
  currentAgent: "lead" | "conversation" | "task";
  // 人设校验结果
  personaValidation: ValidationResult | null;
  // 任务执行结果
  taskResult: TaskResult | null;
}
```

### 节点函数签名

```typescript
type NodeFunction = (state: AgentState) => Promise<Partial<AgentState>>;

// ✅ CORRECT: 返回增量
async function conversationNode(state: AgentState): Promise<Partial<AgentState>> {
  const response = await this.model.invoke(state.messages);
  return {
    messages: [response],
    currentAgent: "conversation"
  };
}

// ❌ WRONG: 直接修改状态
async function badNode(state: AgentState) {
  state.messages.push(response);  // 禁止！
}
```

### 路由函数规范

```typescript
// 路由函数必须返回字符串（下一个节点名称）
function routeByIntent(state: AgentState): string {
  // 保持简单，最多 3 个分支
  if (hasTaskIntent(state)) return "task";
  if (needsCorrection(state)) return "correction";
  return "conversation";
}
```

## 错误处理

```typescript
async function safeNode(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const result = await this.execute(state);
    return { taskResult: result };
  } catch (error) {
    // 返回错误状态，不抛出异常
    return {
      taskResult: {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error"
      }
    };
  }
}
```

## 相关 Skills

- [langgraph-patterns](../skills/langgraph-patterns/SKILL.md) - 详细实现模式
