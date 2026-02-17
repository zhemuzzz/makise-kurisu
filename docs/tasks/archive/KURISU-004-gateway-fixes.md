# Task: L1 Gateway HIGH Issues 修复

## 元信息
- task_id: KURISU-004
- type: bugfix
- priority: high
- layer: L1
- status: completed
- tags: [gateway, bugfix, streaming]

## 时间追踪
- created: 2026-02-17
- estimated_time: 2h
- actual_time: 0.5h

## 依赖
- depends_on: [KURISU-003]
- related_tasks: []

## 需求描述

修复 L1 交互网关 code-reviewer 发现的 4 个 HIGH issues。

## 问题清单

| ID | 问题 | 文件 | 严重性 |
|----|------|------|--------|
| R01 | teeStream 资源泄漏风险 | stream-handler.ts | HIGH |
| R02 | processStream 返回值不一致 | index.ts | HIGH |
| R03 | CLIChannel 错误状态恢复 | cli.ts | HIGH |
| R04 | 会话 ID 长度限制 | session-manager.ts | HIGH |

## 修复方案

### R01: teeStream 资源泄漏 ✅
**问题**: `chunksPromise` IIFE 立即执行，即使流从未被消费也会读取整个原始流。

**修复**: 使用懒加载模式，只在流被迭代时才消费原始流。

```typescript
// Before: 立即消费
const chunksPromise = (async () => { ... })(); // 立即执行

// After: 懒加载
let chunksCache: Promise<string[]> | null = null;
const getChunks = () => chunksCache ??= (async () => { ... })();
```

### R02: processStream 返回值不一致 ✅
**问题**: callbacks 路径返回 `{ textStream }` 缺少 `fullStream`。

**修复**: 统一使用 `createStreamResult` 方法，确保所有路径返回完整结构。

### R03: CLIChannel 错误状态恢复 ✅
**问题**: 错误后 `_isRunning=true` 但会话可能已失效。

**修复**: 会话相关错误时重置 `currentSessionId`，保持 CLI 可继续使用。

### R04: 会话 ID 长度限制 ✅
**问题**: 无长度限制，可能导致内存问题。

**修复**: 添加最大长度限制 (256 字符)，超长时抛出 `InputValidationError`。

## 验收标准
- [x] R01: teeStream 使用懒加载模式
- [x] R02: processStream 所有路径返回一致
- [x] R03: CLIChannel 错误后可继续使用
- [x] R04: 会话 ID 超长时抛出验证错误
- [x] 测试覆盖率 ≥ 80%
- [x] 所有现有测试通过 (207 tests)

## 相关文件
- src/gateway/stream-handler.ts (R01)
- src/gateway/index.ts (R02)
- src/gateway/channels/cli.ts (R03)
- src/gateway/session-manager.ts (R04)
- tests/gateway/session-manager.test.ts (更新测试用例)

## 进度
- [x] R01 修复
- [x] R02 修复
- [x] R03 修复
- [x] R04 修复
- [x] 测试通过 (207 tests)

## 审查问题追踪
| ID | 问题 | 修复 commit | 状态 |
|----|------|-------------|------|
| R01 | teeStream 资源泄漏 | 456a43b | ✅ 已修复 |
| R02 | processStream 返回值不一致 | 456a43b | ✅ 已修复 |
| R03 | CLIChannel 错误状态恢复 | 456a43b | ✅ 已修复 |
| R04 | 会话 ID 长度限制 | 456a43b | ✅ 已修复 |

## 最终产出
- 修改文件: 4 个源文件 + 1 个测试文件
- 测试状态: 207 通过
- 修复内容: 4 个 HIGH issues 全部修复
