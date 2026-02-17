# Task: L1 交互网关

## 元信息
- task_id: KURISU-003
- type: new_module
- priority: high
- layer: L1
- status: planning
- tags: [gateway, streaming, mvp]

## 时间追踪
- created: 2026-02-17
- estimated_time: 8.5h
- actual_time: null

## 依赖
- depends_on: [KURISU-001, KURISU-002, L3-Agent]
- related_tasks: []

## 需求描述

实现 L1 交互网关层，作为 MVP 的最后一环，完成完整对话闭环。

### MVP 范围
- 文本流式处理
- CLI 接入渠道
- 调用 L3 AgentOrchestrator

### 砍掉的功能
- 语音接入、直播平台接入、Web UI

## 验收标准
- [ ] 用户可通过 CLI 进行流式对话
- [ ] 流式输出无乱码，响应延迟 < 100ms 首字
- [ ] `/exit` 命令正常退出
- [ ] Ctrl+C 优雅终止
- [ ] 测试覆盖率 ≥ 80%

## 相关文件
- src/gateway/types.ts
- src/gateway/errors.ts
- src/gateway/session-manager.ts
- src/gateway/stream-handler.ts
- src/gateway/channels/cli.ts
- src/gateway/index.ts
- tests/gateway/

## Agent Team Plan

### Team 组合
| Agent | 职责 | 执行方式 |
|-------|------|----------|
| planner | 分析 + MCP 调研 | ✅ 完成 |
| architect | 设计模块架构 | 待执行 |
| tdd-guide | 测试先行 | 串行 |
| code-reviewer | 代码审查 | 最后 |

### 执行流程
```
✅ planner (含 MCP 调研)
      ↓
   architect
      ↓
   tdd-guide
      ↓
     实现
      ↓
  code-reviewer
```

## 进度
- [x] planner
- [x] architect
- [x] tdd-guide
- [x] 实现
  - [x] types.ts + errors.ts
  - [x] session-manager.ts
  - [x] stream-handler.ts
  - [x] channels/cli.ts
  - [x] index.ts (Gateway 主类)
- [x] code-reviewer
- [ ] 修复 HIGH issues
- [ ] 测试通过 + 覆盖率 ≥ 80%

## 输出汇总

### planner
**时间**: 2026-02-17
**调研参考**: DeepWiki (vercel/ai, langchain-ai/langchainjs)

#### 调研发现

**vercel/ai - 流式处理最佳实践**:
```typescript
// streamText() 返回 textStream + fullStream
const { textStream, fullStream } = streamText({ model, prompt });

// 简单模式：textStream (AsyncIterableStream<string>)
for await (const textPart of textStream) {
  process.stdout.write(textPart);
}

// 完整模式：fullStream (含 tool-call, error 等事件)
for await (const part of fullStream) {
  switch (part.type) {
    case 'text-delta': process.stdout.write(part.text); break;
    case 'tool-call': /* 处理工具调用 */ break;
  }
}

// 回调模式
streamText({
  onChunk({ chunk }) { /* 每个 chunk */ },
  onFinish({ text, usage }) { /* 完成 */ },
  onError({ error }) { /* 错误 */ },
});
```

**langchain-ai/langchainjs - AsyncGenerator 模式**:
```typescript
// _streamResponseChunks() AsyncGenerator
async *_streamResponseChunks() {
  for await (const chunk of apiStream) {
    yield new ChatGenerationChunk({ text: chunk.delta });
  }
}

// streamEvents() 统一事件流
for await (const event of model.streamEvents(input)) {
  // event: on_llm_start | on_llm_stream | on_llm_end
}

// CallbackHandler 处理生命周期
handleLLMNewToken(token) // 每个新 token
```

#### 实现计划

**文件结构**:
```
src/gateway/
├── types.ts              # 类型定义
├── errors.ts             # 错误类
├── session-manager.ts    # 会话管理
├── stream-handler.ts     # 流式处理
├── channels/
│   ├── cli.ts           # CLI 渠道
│   └── index.ts         # 渠道工厂
└── index.ts             # Gateway 主类
```

**实现步骤** (按依赖顺序):
| Phase | 内容 | 预估 |
|-------|------|------|
| 1 | types.ts + errors.ts | 0.5h |
| 2 | session-manager.ts | 1h |
| 3 | stream-handler.ts | 1.5h |
| 4 | channels/cli.ts | 2h |
| 5 | index.ts (Gateway) | 1h |
| 6 | 测试 (80%+) | 2.5h |

**核心接口** (基于调研):
```typescript
// 对齐 Vercel AI SDK 的 textStream/fullStream 模式
interface StreamResult {
  textStream: AsyncIterable<string>;      // 简单消费
  fullStream: AsyncIterable<StreamEvent>; // 完整事件
}

// 事件类型 (参考 Vercel/LangChain)
type StreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'complete'; response: string }
  | { type: 'error'; error: Error };

// 回调模式 (参考 Vercel AI SDK)
interface StreamCallbacks {
  onChunk?(delta: string): void;
  onFinish?(response: string): void;
  onError?(error: Error): void;
}
```

**风险点**:
| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| AsyncGenerator 资源泄漏 | 高 | try-finally + AbortController |
| 流式输出中断 | 中 | 捕获 SIGINT，优雅关闭 |
| 依赖 Orchestrator API 变更 | 中 | 接口抽象，隔离变更 |

### architect
**时间**: [待填写]
[architect 输出]

### tdd-guide
**时间**: [待填写]
[tdd-guide 输出]

### code-reviewer
**时间**: 2026-02-17

**审查结果**: WARNING - 4 HIGH issues

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 4     |
| MEDIUM   | 5     |
| LOW      | 3     |

**HIGH Issues**:
1. `StreamHandler.teeStream` 资源泄漏风险
2. `Gateway.processStream` 返回值类型不一致 (callbacks 路径缺少 fullStream)
3. `CLIChannel` 错误处理后状态不一致
4. `SessionManager` 缺少会话 ID 长度限制

**测试覆盖率**: 98.47% (Statements)

## 审查问题追踪
| ID | 来源 | 问题 | 修复commit | 状态 |
|----|------|------|-----------|------|
| R01 | code-reviewer | teeStream 资源泄漏 | - | 待修复 |
| R02 | code-reviewer | processStream 返回值不一致 | - | 待修复 |
| R03 | code-reviewer | CLIChannel 错误状态恢复 | - | 待修复 |
| R04 | code-reviewer | 会话 ID 长度限制 | - | 待修复 |

## 最终产出
- 文件: src/gateway/ (types.ts, errors.ts, session-manager.ts, stream-handler.ts, channels/cli.ts, index.ts)
- 测试: tests/gateway/ (207 tests, 98.47% coverage)
- 覆盖率: 98.47% statements, 97.34% branches, 90.69% functions
