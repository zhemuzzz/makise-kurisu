---
name: langgraph-patterns
description: LangGraph 状态机模式、节点定义、条件路由、Agent 编排最佳实践
---

# LangGraph Patterns

LangGraph 是构建有状态、多角色 AI 应用的框架，特别适合 Agent 编排和人设一致性引擎。

## When to Activate

- 设计 Agent 状态机和流转逻辑
- 实现条件路由和节点跳转
- 构建多 Agent 协作系统
- 处理流式响应和中断恢复

## Core Concepts

### StateGraph 基础

```typescript
import { StateGraph, END } from "@langchain/langgraph";

// 定义状态类型
interface AgentState {
  messages: BaseMessage[];
  currentAgent: string;
  personaValidation: ValidationResult | null;
  taskResult: TaskResult | null;
}

// 创建状态图
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: { value: (x, y) => x.concat(y) },  // 累加消息
    currentAgent: { value: (x) => x },            // 覆盖当前 Agent
    personaValidation: { value: (x) => x },
    taskResult: { value: (x) => x }
  }
});
```

### 节点定义模式

```typescript
// 节点函数签名
type NodeFunction = (state: AgentState) => Promise<Partial<AgentState>>;

// 人设校验节点
async function personaCheckNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const validation = await personaEngine.validate(lastMessage);

  return {
    personaValidation: validation
  };
}

// 对话节点
async function conversationNode(state: AgentState): Promise<Partial<AgentState>> {
  const response = await model.invoke(state.messages);
  const validatedResponse = await personaEngine.enforcePersona(response);

  return {
    messages: [validatedResponse],
    currentAgent: "conversation"
  };
}

// 任务执行节点
async function taskNode(state: AgentState): Promise<Partial<AgentState>> {
  const result = await taskAgent.execute(state.messages);
  return {
    taskResult: result,
    messages: [result.message]
  };
}
```

### 条件路由模式

```typescript
// 路由函数：决定下一个节点
function routeByIntent(state: AgentState): string {
  const lastMessage = state.messages[state.messages.length - 1];

  // 检测用户意图
  if (containsTaskRequest(lastMessage.content)) {
    return "task";
  }

  // 检测人设违规
  if (state.personaValidation?.violations?.length > 0) {
    return "correction";
  }

  return "conversation";
}

// 添加条件边
workflow.addConditionalEdges(
  "persona_check",
  routeByIntent,
  {
    conversation: "conversation",
    task: "task",
    correction: "correction"
  }
);
```

### 完整工作流示例

```typescript
import { StateGraph, END, START } from "@langchain/langgraph";

// Kurisu Agent 工作流
function createKurisuWorkflow() {
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: { value: (x, y) => x.concat(y) },
      currentAgent: { value: (x) => x },
      personaValidation: { value: (x) => x },
      taskResult: { value: (x) => x }
    }
  });

  // 添加节点
  workflow.addNode("persona_check", personaCheckNode);
  workflow.addNode("conversation", conversationNode);
  workflow.addNode("task", taskNode);
  workflow.addNode("correction", correctionNode);
  workflow.addNode("validation", validationNode);

  // 定义入口
  workflow.addEdge(START, "persona_check");

  // 条件路由
  workflow.addConditionalEdges("persona_check", routeByIntent, {
    conversation: "conversation",
    task: "task",
    correction: "correction"
  });

  // 后续流程
  workflow.addEdge("conversation", "validation");
  workflow.addEdge("task", "validation");
  workflow.addEdge("correction", "validation");

  // 条件结束
  workflow.addConditionalEdges("validation", (state) => {
    return state.taskResult?.complete ? END : "persona_check";
  }, {
    [END]: END,
    continue: "persona_check"
  });

  return workflow.compile();
}
```

## Streaming Patterns

### 流式响应处理

```typescript
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  modelName: "gpt-4",
  streaming: true,
  callbacks: [
    {
      handleLLMNewToken(token: string) {
        // 实时输出 token
        process.stdout.write(token);
      }
    }
  ]
});

// 在 LangGraph 中使用流式
async function streamingNode(state: AgentState): Promise<Partial<AgentState>> {
  const stream = await model.stream(state.messages);
  let fullResponse = "";

  for await (const chunk of stream) {
    fullResponse += chunk.content;
    // 可以发送到前端
  }

  return { messages: [new AIMessage(fullResponse)] };
}
```

## Memory Integration

### 与 Mem0AI 集成

```typescript
import { Mem0Client } from "mem0ai";

const mem0 = new Mem0Client({ apiKey: process.env.MEM0_API_KEY });

async function memoryEnhancedNode(state: AgentState): Promise<Partial<AgentState>> {
  const userId = state.userId;

  // 1. 检索相关记忆
  const memories = await mem0.search(state.messages.slice(-1)[0].content, {
    userId,
    limit: 5
  });

  // 2. 构建增强上下文
  const contextPrompt = buildContextFromMemories(memories);
  const enhancedMessages = [
    new SystemMessage(contextPrompt),
    ...state.messages
  ];

  // 3. 生成响应
  const response = await model.invoke(enhancedMessages);

  // 4. 存储新记忆
  await mem0.add(response.content, { userId });

  return { messages: [response] };
}
```

## Error Handling

### 节点错误处理

```typescript
async function resilientNode(state: AgentState): Promise<Partial<AgentState>> {
  try {
    const result = await riskyOperation(state);
    return { taskResult: result };
  } catch (error) {
    // 返回错误状态，不中断流程
    return {
      taskResult: {
        success: false,
        error: error.message,
        fallback: true
      }
    };
  }
}

// 重试路由
function routeWithRetry(state: AgentState): string {
  if (state.taskResult?.error && state.taskResult?.retryCount < 3) {
    return "retry";
  }
  return "continue";
}
```

## Best Practices

1. **状态不可变**：节点返回 Partial<State>，不直接修改状态
2. **单一职责**：每个节点只做一件事
3. **明确路由**：路由函数要简单清晰
4. **错误隔离**：节点内部处理错误，不让异常传播
5. **可观测性**：在关键节点添加日志

## Anti-Patterns

```typescript
// ❌ WRONG: 直接修改状态
async function badNode(state: AgentState) {
  state.messages.push(newMessage);  // 禁止！
}

// ✅ CORRECT: 返回增量
async function goodNode(state: AgentState) {
  return { messages: [newMessage] };
}
```

```typescript
// ❌ WRONG: 复杂的路由逻辑
function complexRouter(state: AgentState): string {
  if (state.a && state.b && !state.c || state.d) {
    return "x";
  }
  // ... 太复杂
}

// ✅ CORRECT: 分解为多个路由节点
function simpleRouter(state: AgentState): string {
  if (state.needsCorrection) return "correction";
  return state.hasTask ? "task" : "conversation";
}
```
