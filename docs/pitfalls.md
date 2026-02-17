# Kurisu 项目踩坑记录

> 详细的技术问题和解决方案，供后续开发参考

## LangGraph 踩坑 (2026-02-17)

**版本**: `@langchain/langgraph@0.0.25`

### StateGraph 泛型问题
- **问题**: 节点名称被限制为 `"__start__" | "__end__"`
- **解决**: 使用 `as any` 类型断言
- **channels 格式**: 使用 `null` 表示默认 reducer（直接覆盖）

```typescript
const channels = { field1: null, field2: null } as any;
const workflow: any = new StateGraph({ channels });
```

**参考**: `.claude/skills/langgraph-patterns/SKILL.md`

---

## 人设引擎踩坑 (2026-02-17)

### updateMentalModel 浅合并 Bug
**问题**: 浅合并会导致未传字段变成 undefined

```typescript
// ❌ 错误：浅合并
this.mentalModel = { ...this.mentalModel, ...updates };

// ✅ 正确：防御性深合并
this.mentalModel = {
  user_profile: updates.user_profile
    ? { ...this.mentalModel.user_profile, ...updates.user_profile }
    : this.mentalModel.user_profile,
  // ... 其他字段同理
};
```

### ReDoS 防护
**问题**: 动态构建正则时未转义特殊字符

```typescript
// ❌ 危险
const regex = new RegExp(phrase, "gi");

// ✅ 安全
private escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const regex = new RegExp(this.escapeRegex(phrase), "gi");
```

### 亲密关系阈值逻辑
- **问题**: `checkToneConsistency` 对所有级别都检查亲密表达
- **修复**: 只在 familiarity < 80 时检查

### 傲娇前缀一致性
- **问题**: TSUNDERE_PREFIXES 包含 "..." 开头的前缀
- **修复**: 只保留 "哼" 开头的前缀：`["哼，", "哼 ", "哼"]`

### KURISU-007 常量统一问题

| 问题 | 修复 |
|------|------|
| lore.ts 中文引号 `"凤凰院凶真"` | 改为单引号 `'凤凰院凶真'` |
| searchLore 大小写敏感 | description 也调用 `.toLowerCase()` |
| "人家" 重复定义 | 从 INTIMATE_KEYWORDS 移除 |

---

## ESLint 配置踩坑 (2026-02-18)

**版本**: ESLint 8.56.0 + @typescript-eslint 6.19.0
**配置文件**: `.eslintrc.js` (非 flat config)

### 主要问题
LangGraph 库类型不完善，需要 `as any` 绕过

### 覆盖规则策略

```javascript
overrides: [
  { files: ["src/agents/**/*.ts"], rules: { "@typescript-eslint/no-unsafe-*": "off" } },
  { files: ["src/gateway/**/*.ts"], rules: { "@typescript-eslint/require-await": "off" } },
]
```

### 规则调整
- `@typescript-eslint/no-explicit-any`: "warn" (非 error)
- `@typescript-eslint/explicit-function-return-type`: "off"
- `@typescript-eslint/require-await`: "warn"

---

## TypeScript 严格模式 (2026-02-18)

### 修复的 44 个错误

| 问题类型 | 数量 | 修复方案 |
|----------|------|----------|
| exactOptionalPropertyTypes | 15+ | 显式 `\| undefined` 类型 |
| noPropertyAccessFromIndexSignature | 10+ | 括号访问 `['key']` |
| 未使用导入 | 5+ | 删除 |
| prefer-const | 3 | let → const |
| override 修饰符 | 2 | 添加 override |
