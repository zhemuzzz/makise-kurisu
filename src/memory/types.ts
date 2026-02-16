/**
 * Memory System Type Definitions
 * 记忆系统核心类型定义
 */

// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface MessageInput {
  role: MessageRole;
  content: string;
  timestamp?: number;
}

// ============================================
// Memory Types
// ============================================

export interface MemoryMetadata {
  timestamp: number;
  importance: number;
  role: MessageRole;
  sessionId: string;
  [key: string]: unknown;
}

export interface Memory {
  id: string;
  content: string;
  metadata: MemoryMetadata;
}

export interface MemoryInput {
  content: string;
  metadata?: Partial<MemoryMetadata>;
}

export interface MemorySearchResult extends Memory {
  score: number;
}

// ============================================
// Session Types
// ============================================

export interface SessionConfig {
  maxMessages: number;
  ttl: number;
}

export interface SessionState {
  sessionId: string;
  messages: readonly Message[];
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

// ============================================
// Context Builder Types
// ============================================

export interface ContextBuildOptions {
  maxTokens: number;
  maxMessages: number;
  includePersonaPrompt: boolean;
  includeMemories: boolean;
  template?: string;
}

export interface BuildContext {
  systemPrompt: string;
  relevantMemories: MemorySearchResult[];
  recentMessages: Message[];
  fullContext: string;
  tokenCount: number;
}

// ============================================
// Mem0 Client Types
// ============================================

export interface Mem0Client {
  add: (data: unknown, options?: Mem0Options) => Promise<Mem0Memory[]>;
  search: (query: string, options?: Mem0SearchOptions) => Promise<Mem0Memory[]>;
  delete: (id: string) => Promise<void>;
  getAll: (options?: Mem0Options) => Promise<Mem0Memory[]>;
  update?: (id: string, text: string) => Promise<Mem0Memory[]>;
}

export interface Mem0Options {
  user_id?: string;
  agent_id?: string;
  app_id?: string;
  metadata?: Record<string, unknown>;
  filters?: Record<string, unknown>;
}

export interface Mem0SearchOptions extends Mem0Options {
  limit?: number;
  threshold?: number;
  top_k?: number;
}

export interface Mem0Memory {
  id: string;
  memory?: string;
  data?: { memory: string };
  score?: number;
  metadata?: Record<string, unknown>;
  user_id?: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// Short Term Memory Types
// ============================================

export interface ShortTermMemoryConfig {
  mem0Client: Mem0Client;
  sessionId: string;
  defaultImportance?: number;
}

// ============================================
// Hybrid Engine Types
// ============================================

export interface HybridMemoryEngineConfig {
  sessionConfig?: Partial<SessionConfig>;
  contextConfig?: Partial<ContextBuildOptions>;
  mem0ApiKey?: string;
}

export interface PersonaEngineLike {
  getSystemPrompt(): string;
  getHardcodedPersona(): { content: string };
  getMentalModel(): {
    user_profile: {
      name: string;
      relationship: string;
      preferences: string[];
    };
    relationship_graph: {
      trust_level: number;
      familiarity: number;
      emotional_state: string;
    };
    shared_memories: {
      key_events: string[];
      inside_jokes: string[];
      repeated_topics: string[];
    };
  };
}

// ============================================
// Constants
// ============================================

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxMessages: 100,
  ttl: 3600000, // 1 hour in ms
};

export const DEFAULT_CONTEXT_CONFIG: ContextBuildOptions = {
  maxTokens: 4096,
  maxMessages: 20,
  includePersonaPrompt: true,
  includeMemories: true,
};
