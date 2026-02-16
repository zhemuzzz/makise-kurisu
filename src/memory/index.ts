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
} from './types';

// Constants
export { DEFAULT_SESSION_CONFIG, DEFAULT_CONTEXT_CONFIG } from './types';

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
} from './errors';

// Core classes
export { SessionMemory } from './session-memory';
export { ShortTermMemory } from './short-term-memory';
export { ContextBuilder } from './context-builder';
export { HybridMemoryEngine } from './hybrid-engine';

// Convenience re-export for default usage
export { HybridMemoryEngine as default } from './hybrid-engine';
