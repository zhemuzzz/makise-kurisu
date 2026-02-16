---
name: mem0-integration
description: Mem0AI 记忆系统集成模式 - 记忆存储、检索、上下文注入、会话管理
---

# Mem0AI Integration

Mem0AI 是一个智能记忆层，为 AI 应用提供持久化的用户偏好和上下文记忆。

## When to Activate

- 实现短期/长期记忆存储
- 构建个性化对话体验
- 设计记忆检索和上下文增强
- 处理多用户记忆隔离

## Core Concepts

### 客户端初始化

```typescript
import { Mem0Client } from "mem0ai";

// 云端版本
const mem0 = new Mem0Client({
  apiKey: process.env.MEM0_API_KEY
});

// 自托管版本（可选）
const mem0Local = new Mem0Client({
  apiKey: process.env.MEM0_API_KEY,
  baseUrl: "http://localhost:8000"
});
```

### 基础操作

```typescript
// 添加记忆
await mem0.add("用户喜欢吃抹茶口味的甜点", {
  userId: "kurisu_user_001",
  metadata: {
    category: "preference",
    confidence: 0.9
  }
});

// 搜索记忆
const results = await mem0.search("用户喜欢什么食物", {
  userId: "kurisu_user_001",
  limit: 5
});

// 获取所有记忆
const allMemories = await mem0.getAll({
  userId: "kurisu_user_001"
});

// 删除记忆
await mem0.delete(memoryId);
```

## Kurisu 集成模式

### 记忆增强对话节点

```typescript
interface ConversationContext {
  userId: string;
  sessionId: string;
  recentMessages: Message[];
  retrievedMemories: Memory[];
}

class MemoryEnhancedConversation {
  private mem0: Mem0Client;
  private sessionMemory: Map<string, Message[]> = new Map();

  constructor(mem0Client: Mem0Client) {
    this.mem0 = mem0Client;
  }

  async processMessage(
    userId: string,
    userMessage: string
  ): Promise<ConversationContext> {
    // 1. 检索相关记忆
    const memories = await this.mem0.search(userMessage, {
      userId,
      limit: 5,
      // 可选：按时间范围过滤
      filters: {
        created_at: { gte: "2024-01-01" }
      }
    });

    // 2. 获取会话瞬时记忆
    const sessionId = this.getActiveSession(userId);
    const recentMessages = this.sessionMemory.get(sessionId) || [];

    // 3. 构建上下文
    return {
      userId,
      sessionId,
      recentMessages,
      retrievedMemories: memories
    };
  }

  async saveInteraction(
    userId: string,
    userMessage: string,
    assistantResponse: string
  ): Promise<void> {
    // 提取需要记住的信息
    const memoryContent = this.extractMemoryWorthy(userMessage, assistantResponse);

    if (memoryContent) {
      await this.mem0.add(memoryContent, {
        userId,
        metadata: {
          type: "interaction",
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  private extractMemoryWorthy(userMsg: string, asstMsg: string): string | null {
    // 简单规则：检测用户偏好、事实陈述
    const preferencePatterns = [
      /我喜欢|我讨厌|我偏好|我通常|我的/,
      /记住|别忘了|记得/
    ];

    for (const pattern of preferencePatterns) {
      if (pattern.test(userMsg)) {
        return userMsg;
      }
    }

    return null;
  }
}
```

### 四层记忆架构

```typescript
class HybridMemoryEngine {
  // L1: 瞬时记忆（当前会话）
  private sessionMemory: Map<string, Message[]>;

  // L2: 短期记忆（Mem0AI，约 20 轮）
  private shortTermMemory: Mem0Client;

  // L3: 长期记忆（知识图谱，后续实现）
  private longTermMemory?: KnowledgeGraphClient;

  // L4: 技能记忆（特定能力）
  private skillMemory?: SkillDatabase;

  async recall(userId: string, query: string, context: RecallContext): Promise<RecallResult> {
    const results: Memory[] = [];

    // 1. 从瞬时记忆获取最近消息
    if (context.sessionId) {
      const recent = this.sessionMemory.get(context.sessionId) || [];
      results.push(...this.filterRelevant(recent, query));
    }

    // 2. 从短期记忆检索
    const shortTerm = await this.shortTermMemory.search(query, {
      userId,
      limit: 10
    });
    results.push(...shortTerm);

    // 3. 长期记忆（可选）
    if (this.longTermMemory && context.needLongTerm) {
      const longTerm = await this.longTermMemory.query(query, userId);
      results.push(...longTerm);
    }

    // 4. 按相关性排序并返回
    return this.rankAndDedupe(results, context.maxResults || 10);
  }

  async remember(
    userId: string,
    content: string,
    metadata: MemoryMetadata
  ): Promise<void> {
    const { importance = "normal", type = "fact" } = metadata;

    // 根据重要性决定存储层级
    if (importance === "critical" || type === "preference") {
      // 重要信息：同时存短期和长期
      await this.shortTermMemory.add(content, {
        userId,
        metadata: { importance, type }
      });

      if (this.longTermMemory) {
        await this.longTermMemory.addEntity(content, userId);
      }
    } else {
      // 普通信息：只存短期
      await this.shortTermMemory.add(content, {
        userId,
        metadata: { importance, type }
      });
    }
  }
}
```

## 人设相关记忆

### Kurisu 人设记忆管理

```typescript
interface KurisuMemory {
  // 用户相关的记忆
  userPreferences: string[];      // "用户喜欢科学话题"
  conversationHistory: string[];  // "上次讨论了时间旅行"
  emotionalState: string[];       // "用户今天心情不好"

  // 人设相关的记忆
  personaReinforcement: string[]; // "用户觉得傲娇表现不错"
  correctionsMade: string[];      // "之前人设偏移被纠正过"
}

class KurisuMemoryManager {
  private mem0: Mem0Client;

  async buildContextPrompt(userId: string): Promise<string> {
    // 检索与当前用户相关的所有记忆
    const memories = await this.mem0.getAll({ userId });

    // 分类整理
    const categorized = this.categorizeMemories(memories);

    // 构建上下文提示词
    return `
## 关于用户的记忆

### 偏好
${categorized.preferences.map(p => `- ${p}`).join("\n")}

### 最近话题
${categorized.topics.slice(-5).map(t => `- ${t}`).join("\n")}

### 情感状态
${categorized.emotions.slice(-3).map(e => `- ${e}`).join("\n")}
`;
  }

  async recordPersonaFeedback(
    userId: string,
    feedback: "positive" | "negative",
    context: string
  ): Promise<void> {
    const content = feedback === "positive"
      ? `用户对这种表现满意：${context}`
      : `用户不喜欢这种表现：${context}`;

    await this.mem0.add(content, {
      userId,
      metadata: {
        type: "persona_feedback",
        sentiment: feedback,
        timestamp: new Date().toISOString()
      }
    });
  }
}
```

## 记忆检索优化

### 语义搜索增强

```typescript
async function enhancedSearch(
  mem0: Mem0Client,
  query: string,
  userId: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, includeScore = true, minScore = 0.5 } = options;

  // 1. 基础搜索
  const results = await mem0.search(query, {
    userId,
    limit: limit * 2 // 多取一些用于过滤
  });

  // 2. 后处理：过滤低相关性结果
  const filtered = results.filter(r =>
    !includeScore || (r.score ?? 1) >= minScore
  );

  // 3. 按新鲜度加权
  const weighted = filtered.map(r => ({
    ...r,
    finalScore: this.calculateFinalScore(r)
  }));

  // 4. 排序并返回
  return weighted
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}

function calculateFinalScore(result: SearchResult): number {
  const baseScore = result.score ?? 0.5;
  const age = Date.now() - new Date(result.createdAt).getTime();
  const ageDays = age / (1000 * 60 * 60 * 24);

  // 新记忆权重更高
  const freshnessFactor = Math.exp(-ageDays / 30); // 30天衰减

  return baseScore * 0.7 + freshnessFactor * 0.3;
}
```

## Best Practices

1. **分层存储**：瞬时 → 短期 → 长期，按重要性升级
2. **分类管理**：偏好、事实、情感、反馈分开存储
3. **定期清理**：过时或低价值记忆及时清理
4. **隐私隔离**：用户间记忆严格隔离
5. **延迟写入**：会话结束后批量写入，减少 API 调用

## Anti-Patterns

```typescript
// ❌ WRONG: 每条消息都存储
await mem0.add(userMessage, { userId });  // 太频繁

// ✅ CORRECT: 只存储有价值的信息
if (isWorthyOfMemory(userMessage)) {
  await mem0.add(extractKeyInfo(userMessage), { userId });
}
```

```typescript
// ❌ WRONG: 检索所有记忆
const all = await mem0.getAll({ userId });
const relevant = all.filter(m => m.includes(query));  // 低效

// ✅ CORRECT: 使用语义搜索
const relevant = await mem0.search(query, { userId, limit: 10 });
```
