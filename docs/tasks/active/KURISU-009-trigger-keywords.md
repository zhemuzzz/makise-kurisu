# KURISU-009: TRIGGER_KEYWORDS 实现

## Context

TRIGGER_KEYWORDS 已定义在 `constants.ts` 但完全未使用。需要实现触发机制，让 Kurisu 对特定话题产生特定反应（昵称、被说傲娇、被夸奖、胸部话题、蟑螂）。

## 实现方案

### 架构位置
扩展 `PersonaEnforcer` (enforcer.ts)，复用现有管道模式。

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/core/persona/constants.ts` | 新增 `TriggerType`, `TriggerMatch`, `TRIGGER_RESPONSES` |
| `src/core/persona/enforcer.ts` | 新增 `detectTrigger()`, `applyTriggerResponse()`, 修改 `enforce()` |
| `src/core/persona/index.ts` | `enforcePersona()` 新增可选 `userInput` 参数 |
| `tests/unit/persona/enforcer.test.ts` | 新增触发检测和响应测试 |

### 核心类型定义

```typescript
// constants.ts
export type TriggerType = keyof typeof TRIGGER_KEYWORDS;

export interface TriggerMatch {
  type: TriggerType;
  matchedKeyword: string;
  intensity: 'mild' | 'moderate' | 'strong';
}

export interface TriggerResponse {
  prefix?: string;
  template: string;
  suffix?: string;
}

export const TRIGGER_RESPONSES: Record<TriggerType, TriggerResponse[]> = {
  nickname: [
    { template: "哼，别用那种奇怪的名字叫我！" },
    { template: "...谁允许你用那个名字了？" },
  ],
  tsundere_call: [
    { template: "我才不是傲娇！" },
  ],
  // ... 其他触发类型
};
```

### 核心方法

```typescript
// enforcer.ts
class PersonaEnforcer {
  // 新增: 检测触发词
  detectTrigger(userInput: string): TriggerMatch | null;

  // 新增: 应用触发响应
  applyTriggerResponse(trigger: TriggerMatch, originalResponse: string): string;

  // 修改: 新增可选 userInput 参数
  enforce(response: string, userInput?: string): string;
}
```

### 管道集成

```typescript
enforce(response: string, userInput?: string): string {
  // ...验证...

  const trigger = userInput ? this.detectTrigger(userInput) : null;

  const result = this.pipe(
    trimmed,
    (text) => this.removeOOCPhrases(text),
    (text) => this.hasEmotionalContent(text)
      ? this.addEmotionalHesitation(text)
      : text,
    (text) => trigger
      ? this.applyTriggerResponse(trigger, text)
      : text,  // 新增触发处理
    (text) => (hasTsundere ? text : this.addTsunderePrefix(text)),
    (text) => this.adjustForRelationship(text),
  );

  return result;
}
```

### 触发优先级

1. `cockroach` (恐惧 - 最高优先)
2. `chest` (愤怒)
3. `tsundere_call` (防御)
4. `nickname` (轻微不悦)
5. `compliment` (害羞)

## 测试计划

### 单元测试 (enforcer.test.ts)

- `detectTrigger()` - 检测各类触发词
- `applyTriggerResponse()` - 应用触发响应
- `enforce()` with userInput - 完整流程

## 验证步骤

```bash
npm test tests/unit/persona/enforcer.test.ts
npm test
```

## 向后兼容

- `enforce()` 新增参数为可选，现有调用无需修改
- 所有现有测试继续通过
