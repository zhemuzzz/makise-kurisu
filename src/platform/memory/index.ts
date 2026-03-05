/**
 * Memory System - 混合记忆引擎
 * 四层记忆架构：瞬时 → 短期 → 长期 → 技能
 *
 * MVP 范围：
 * - L1 瞬时记忆 (SessionMemory)
 * - L2 短期记忆 (ShortTermMemory with Mem0)
 */

// Core types
export type {
  Message,
  MessageInput,
  MessageRole,
  Memory,
  MemoryInput,
  MemoryMetadata,
  MemorySearchResult,
  SessionConfig,
  SessionState,
  ContextBuildOptions,
  BuildContext,
  Mem0Client,
  Mem0Options,
  Mem0SearchOptions,
  Mem0Memory,
  ShortTermMemoryConfig,
  HybridMemoryEngineConfig,
  PersonaEngineLike,
} from './types.js';

// Constants
export { DEFAULT_SESSION_CONFIG, DEFAULT_CONTEXT_CONFIG } from './types.js';

// Error classes
export {
  MemoryError,
  SessionNotFoundError,
  InvalidSessionIdError,
  InvalidMessageError,
  Mem0APIError,
  Mem0AuthError,
  ContextBuildError,
  MemoryLimitExceededError,
  ValidationError,
} from './errors.js';

// Core classes
export { SessionMemory } from './session-memory.js';
export { ShortTermMemory } from './short-term-memory.js';
export { ContextBuilder } from './context-builder.js';
export { HybridMemoryEngine } from './hybrid-engine.js';

// Convenience re-export for default usage
export { HybridMemoryEngine as default } from './hybrid-engine.js';
