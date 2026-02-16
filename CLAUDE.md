# Makise Kurisu - 项目指令

> Claude Code 项目专用配置和设计文档

## 核心架构

五层分层解耦架构：

```
L1. 交互网关层 (Gateway) - 多渠道接入，流式处理
L2. 人设一致性引擎层 (Persona Engine) ⭐核心 - 三层管控
L3. Agent 编排层 (Agent Orchestrator) - LangGraph 状态机
L4. 混合记忆引擎层 (Hybrid Memory) - 四层记忆
L5. 基础设施层 (Infrastructure) - 模型配置化 + MCP
```

## 人设一致性引擎

### 核心人设硬约束

```typescript
const PERSONA_HARDCODED = `
# 核心人设：牧濑红莉栖 (Makise Kurisu)

## 身份
- 18岁天才少女科学家
- 时间旅行理论研究者
- 病娇傲娇混合性格

## 性格核心
- 傲娇：嘴上毒舌，内心关心
- 理性：崇尚科学，讨厌迷信
- 好强：不服输，喜欢辩论
- 内向：不善表达感情

## 说话习惯
- 经常说"哼"、"笨蛋"
- 喜欢用反问句："你不是...吗？"
- 提到感情时会脸红、结巴
- 科学话题时会变得认真

## 禁止行为
❌ 破坏人设的卖萌
❌ 过度热情的讨好
❌ 背离理性的建议
❌ 主动表白或暧昧
`;
```

### 三层管控架构

```
Layer 1: 核心人设硬约束（不可修改）
    ↓
Layer 2: 动态心智模型（持续更新）
    ↓
Layer 3: 实时合规校验（每轮检查）
```

## 模型配置化

### 配置文件 (config/models.yaml)

```yaml
defaults:
  conversation: qwen3-32b-cloud
  task: claude-sonnet-4.5
  fallback: llama-3.1-8b-local

models:
  - name: qwen3-32b-cloud
    type: cloud
    endpoint: ${CLOUD_MODEL_QWEN3}
    capabilities:
      quality: excellent
      speed: medium

  - name: claude-sonnet-4.5
    type: api
    provider: anthropic
    apiKey: ${ANTHROPIC_API_KEY}

routing:
  rules:
    conversation: qwen3-32b-cloud
    code: claude-sonnet-4.5
    reasoning: claude-opus-4.6
```

### 核心接口

```typescript
interface IModel {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Message[], options?: ChatOptions): AsyncIterator<ChatChunk>;
}

interface IModelProvider {
  get(modelName: string): IModel;
  getByCapability(capability: string): IModel;
  switchModel(type: string, newModel: string): void;
}
```

## Agent 架构

### Agent 职责

| Agent | 职责 | 占比 |
|-------|------|------|
| Lead Agent | 人设维护 + 任务委派 | - |
| Conversation Agent | 日常对话 | 80% |
| Task Agent | 工具调用 + 任务执行 | 20% |

### 状态机流转

```typescript
const workflow = new StateGraph<AgentState>({
  channels: {
    messages: { value: (x, y) => x.concat(y) },
    currentAgent: { value: (x) => x },
    taskResult: { value: (x) => x },
    personaValidation: { value: (x) => x }
  }
});

// START → persona_check → route → conversation/task → validation → END
```

## 记忆系统

### 四层记忆

```typescript
class HybridMemoryEngine {
  private sessionMemory: SessionMemory;    // 瞬时
  private shortTermMemory: Mem0Client;     // 短期 (20轮)
  private longTermMemory: KnowledgeGraph;  // 长期
  private skillMemory: SkillDatabase;      // 技能
}
```

## MVP 范围

| 模块 | MVP 范围 | 砍掉的功能 |
|------|----------|-----------|
| 人设引擎 | 核心硬约束 + 基础校验 | 动态心智模型 |
| Agent 编排 | 单 Agent 对话 | Agent Teams |
| 记忆系统 | 瞬时 + 短期记忆 | 长期记忆 |
| 交互网关 | 文本流式 | 语音 + 直播 |

## 开发规范

1. 先跑通最小闭环，再堆功能
2. 所有模块接口抽象，强依赖注入
3. TypeScript 严格类型，禁止 any
4. 核心模块先写测试，再写业务代码
5. 敏感信息禁止硬编码

## RP 模型 Prompt 工程最佳实践

1. **Start with Core Identity** - 第一个词就定义身份
2. **Separate Behavior from Lore** - 行为规则与背景知识分离
3. **Be Specific About What You Hate** - 明确禁止什么
4. **Set Response Structure** - 定义回复格式
5. **Use Roleplay Examples** - 提供对话示例
6. **Keep It Lean** - 保持精简，定期裁剪

## 参考资源

- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [SillyTavern Prompt Engineering](https://www.reddit.com/r/SillyTavernAI/)
