# Common Patterns

> kurisu 项目通用设计模式

## Repository Pattern

封装数据访问，提供一致接口：

```typescript
interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(filters?: Filters): Promise<T[]>;
  create(data: CreateDTO): Promise<T>;
  update(id: string, data: UpdateDTO): Promise<T>;
  delete(id: string): Promise<void>;
}
```

好处：
- 业务逻辑与存储解耦
- 便于测试（可 mock）
- 支持存储切换

## Result Pattern

统一结果封装：

```typescript
type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

// 使用示例
function divide(a: number, b: number): Result<number> {
  if (b === 0) {
    return { success: false, error: new Error("Division by zero") };
  }
  return { success: true, data: a / b };
}
```

## Factory Pattern

创建复杂对象：

```typescript
interface AgentFactory {
  createConversationAgent(config: AgentConfig): ConversationAgent;
  createTaskAgent(config: AgentConfig): TaskAgent;
}
```
