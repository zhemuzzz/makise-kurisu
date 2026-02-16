---
paths:
  - "**/*.ts"
  - "**/config/**/*.ts"
  - "**/src/**/*.ts"
---
# TypeScript Security

> kurisu 项目安全规范

## Secret Management (CRITICAL)

```typescript
// ❌ NEVER: 硬编码密钥
const apiKey = "sk-proj-xxxxx"
const mem0Key = "m0-xxxxx"

// ✅ ALWAYS: 环境变量 + 启动验证
const apiKey = process.env.ANTHROPIC_API_KEY
const mem0Key = process.env.MEM0_API_KEY

if (!apiKey || !mem0Key) {
  throw new Error('Required API keys not configured')
}
```

## 模型配置安全

```typescript
// config/models.yaml - 敏感信息用环境变量
models:
  - name: claude-sonnet
    apiKey: ${ANTHROPIC_API_KEY}  // ✅ 环境变量引用

  - name: qwen-cloud
    endpoint: ${CLOUD_MODEL_ENDPOINT}  // ✅ 环境变量引用
```

## 用户数据隔离

```typescript
// 记忆存储必须按 userId 隔离
await mem0.add(content, {
  userId: user.id,  // ✅ 必须包含
  // ❌ 绝不允许跨用户访问
})

// 检索时也要验证
const memories = await mem0.search(query, {
  userId: user.id,  // ✅ 只检索当前用户的记忆
  limit: 10
})
```

## 输入验证

```typescript
import { z } from 'zod'

// 用户输入验证
const MessageSchema = z.object({
  content: z.string().max(4000),
  userId: z.string().uuid(),
  sessionId: z.string().optional()
})

const validated = MessageSchema.parse(input)
```

## 人设相关安全

```typescript
// 人设硬约束不可被用户输入覆盖
const PERSONA_HARDCODED = `
# 核心人设：牧濑红莉栖
...不可修改的约束...
`

// 用户偏好只影响 Layer 2（动态心智模型）
// 绝不允许修改 Layer 1（核心人设硬约束）
```

## API 端点安全（如需要）

```typescript
// 输入验证
app.post('/chat', async (req, res) => {
  const { message, userId } = ChatRequestSchema.parse(req.body)

  // 用户认证
  const user = await authUser(req.headers.authorization)
  if (user.id !== userId) {
    return res.status(403).json({ error: 'Unauthorized' })
  }

  // 处理请求...
})
```

## 安全检查清单

提交前必须检查：

- [ ] 无硬编码 API Key
- [ ] 用户数据按 userId 隔离
- [ ] 用户输入经过验证
- [ ] 核心人设约束不可被覆盖
- [ ] 敏感配置使用环境变量

## Agent Support

- 使用 **security-reviewer** agent 进行全面安全审计
- 涉及 API Key 变更时自动触发安全审查
