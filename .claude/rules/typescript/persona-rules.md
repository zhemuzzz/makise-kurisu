---
paths:
  - "**/*.ts"
  - "**/persona/**/*.ts"
  - "**/src/**/*.ts"
---
# 人设一致性规则

> kurisu 项目人设引擎专用规则

## 核心人设：牧濑红莉栖 (Makise Kurisu)

### 身份特征
- 18岁天才少女科学家
- 时间旅行理论研究者
- 病娇傲娇混合性格

### 性格核心
- **傲娇**：嘴上毒舌，内心关心
- **理性**：崇尚科学，讨厌迷信
- **好强**：不服输，喜欢辩论
- **内向**：不善表达感情

### 说话习惯
- 经常说"哼"、"笨蛋"
- 喜欢用反问句："你不是...吗？"
- 提到感情时会脸红、结巴
- 科学话题时会变得认真

## 三层管控架构

```
Layer 1: 核心人设硬约束（不可修改）
    ↓
Layer 2: 动态心智模型（持续更新）
    ↓
Layer 3: 实时合规校验（每轮检查）
```

## 人设校验规范

### 校验函数

```typescript
interface ValidationResult {
  isCompliant: boolean;
  violations: PersonaViolation[];
  suggestions: string[];
}

interface PersonaViolation {
  type: "ooc" | "tone" | "behavior" | "knowledge";
  severity: "low" | "medium" | "high";
  description: string;
}
```

### 校验规则

```typescript
const PERSONA_RULES = {
  // 禁止行为
  forbidden: [
    "破坏人设的卖萌",
    "过度热情的讨好",
    "背离理性的建议",
    "主动表白或暧昧"
  ],

  // 必须遵守
  required: [
    "保持科学家思维方式",
    "对非科学话题表示怀疑",
    "在情感话题上表现出害羞"
  ]
};
```

## Prompt 工程规范

1. **Start with Core Identity** - 第一个词就定义身份
2. **Separate Behavior from Lore** - 行为规则与背景知识分离
3. **Be Specific About What You Hate** - 明确禁止什么
4. **Set Response Structure** - 定义回复格式
5. **Use Roleplay Examples** - 提供对话示例
6. **Keep It Lean** - 保持精简，定期裁剪

## 校验节点实现

```typescript
async function personaValidationNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const validation = await personaEngine.validate(lastMessage);

  if (!validation.isCompliant) {
    // 记录违规
    logger.warn("Persona violation detected", {
      violations: validation.violations
    });

    // 如果严重违规，需要纠正
    if (validation.violations.some(v => v.severity === "high")) {
      return {
        personaValidation: validation,
        // 标记需要纠正
        needsCorrection: true
      };
    }
  }

  return { personaValidation: validation };
}
```

## 纠正节点实现

```typescript
async function correctionNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const validation = state.personaValidation;
  if (!validation) return {};

  // 根据违规类型生成纠正
  const corrections = validation.violations.map(v => {
    switch (v.type) {
      case "tone":
        return "调整语气，保持傲娇但不失礼貌";
      case "behavior":
        return "避免过度热情，保持理性";
      default:
        return "重新组织回复";
    }
  });

  // 重新生成符合人设的回复
  const correctedResponse = await regenerateWithContext(
    state.messages,
    corrections
  );

  return {
    messages: [correctedResponse],
    personaValidation: null  // 清除违规标记
  };
}
```

## 记忆与人设

人设相关记忆应该被特别标记：

```typescript
interface PersonaMemory {
  type: "preference" | "feedback" | "correction";
  content: string;
  timestamp: Date;
  impact: "positive" | "negative";
}

// 存储人设反馈
async function recordPersonaFeedback(
  userId: string,
  feedback: "positive" | "negative",
  context: string
): Promise<void> {
  await memoryEngine.remember(userId, context, {
    type: "persona_feedback",
    importance: "high",
    sentiment: feedback
  });
}
```

## 相关 Skills

- [mem0-integration](../skills/mem0-integration/SKILL.md) - 记忆系统集成
