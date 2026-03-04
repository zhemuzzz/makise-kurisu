/**
 * Memory System Test Fixtures
 * 记忆系统测试数据
 */

import { vi } from "vitest";

// ============================================
// Message Fixtures
// ============================================

export const SAMPLE_MESSAGES = {
  user: {
    role: "user" as const,
    content: "你好，Kurisu",
    timestamp: Date.now(),
  },
  assistant: {
    role: "assistant" as const,
    content: "哼，有什么事吗？",
    timestamp: Date.now(),
  },
  system: {
    role: "system" as const,
    content: "System message",
    timestamp: Date.now(),
  },
};

export const CONVERSATION_MESSAGES = [
  {
    role: "user" as const,
    content: "你好",
    timestamp: Date.now() - 5000,
  },
  {
    role: "assistant" as const,
    content: "哼，有什么事？",
    timestamp: Date.now() - 4000,
  },
  {
    role: "user" as const,
    content: "你在研究什么？",
    timestamp: Date.now() - 3000,
  },
  {
    role: "assistant" as const,
    content: "时间旅行理论...这与你无关吧。",
    timestamp: Date.now() - 2000,
  },
  {
    role: "user" as const,
    content: "我觉得时间旅行很酷",
    timestamp: Date.now() - 1000,
  },
  {
    role: "assistant" as const,
    content: "酷？这是严肃的科学话题，不是什么酷不酷的问题。",
    timestamp: Date.now(),
  },
];

export const LONG_MESSAGE = {
  role: "user" as const,
  content: "测试".repeat(10000),
  timestamp: Date.now(),
};

export const SPECIAL_CHARS_MESSAGE = {
  role: "user" as const,
  content: '<script>alert("xss")</script> 你好世界 🌍 مرحبا こんにちは',
  timestamp: Date.now(),
};

// ============================================
// Session Fixtures
// ============================================

export const SAMPLE_SESSION_ID = "session-test-123";
export const SAMPLE_SESSIONS = [
  "session-user-1",
  "session-user-2",
  "session-user-3",
];

export const INVALID_SESSION_IDS = ["", "   ", null, undefined];

// ============================================
// Memory Fixtures
// ============================================

export const SAMPLE_MEMORIES = [
  {
    id: "mem-1",
    content: "User asked about time travel",
    metadata: {
      timestamp: Date.now() - 5000,
      importance: 0.8,
      role: "user",
      sessionId: SAMPLE_SESSION_ID,
    },
  },
  {
    id: "mem-2",
    content: "Kurisu explained quantum mechanics",
    metadata: {
      timestamp: Date.now() - 4000,
      importance: 0.9,
      role: "assistant",
      sessionId: SAMPLE_SESSION_ID,
    },
  },
  {
    id: "mem-3",
    content: "User mentioned El Psy Kongroo",
    metadata: {
      timestamp: Date.now() - 3000,
      importance: 0.95,
      role: "user",
      sessionId: SAMPLE_SESSION_ID,
    },
  },
];

export const MEMORY_SEARCH_RESULTS = [
  {
    id: "mem-search-1",
    content: "时间旅行相关的讨论",
    score: 0.92,
    metadata: {
      timestamp: Date.now() - 1000,
      sessionId: SAMPLE_SESSION_ID,
    },
  },
  {
    id: "mem-search-2",
    content: "量子力学的解释",
    score: 0.85,
    metadata: {
      timestamp: Date.now() - 2000,
      sessionId: SAMPLE_SESSION_ID,
    },
  },
];

// ============================================
// Configuration Fixtures
// ============================================

export const DEFAULT_SESSION_CONFIG = {
  maxMessages: 100,
  ttl: 3600000, // 1 hour in ms
};

export const CUSTOM_SESSION_CONFIG = {
  maxMessages: 50,
  ttl: 7200000, // 2 hours in ms
};

// NOTE: This is a test fixture with a fake API key - NOT a real credential
export const MOCK_MEM0_CONFIG = {
  apiKey: "test-api-key-12345", // Fake key for testing only
  baseUrl: "https://api.mem0.ai/v1",
};

export const MOCK_CONTEXT_CONFIG = {
  maxTokens: 4096,
  template: "default",
};

// ============================================
// Context Fixtures
// ============================================

export const SAMPLE_PERSONA_PROMPT = `
# 核心人设：牧濑红莉栖 (Makise Kurisu)

## 身份
- 18岁天才少女科学家
- 时间旅行理论研究者

## 性格核心
- 傲娇：嘴上毒舌，内心关心
- 理性：崇尚科学，讨厌迷信
`;

export const SAMPLE_CONTEXT_OUTPUT = `${SAMPLE_PERSONA_PROMPT}

## Recent Conversation
User: 你好
Assistant: 哼，有什么事？

## Memories
- User asked about time travel
- Kurisu explained quantum mechanics
`;

// ============================================
// Error Fixtures
// ============================================

export const MEM0_ERROR_RESPONSES = {
  networkError: new Error("Network error: ECONNREFUSED"),
  timeout: new Error("Request timeout after 30000ms"),
  unauthorized: new Error("Unauthorized: Invalid API key"),
  rateLimit: new Error("Rate limit exceeded"),
  invalidResponse: "Invalid JSON response",
  notFound: new Error("Memory not found"),
};

export const VALIDATION_ERRORS = {
  invalidMessage: "Invalid message structure: missing required fields",
  invalidSessionId: "Invalid session ID: must be non-empty string",
  invalidContent: "Invalid content: must be non-empty string",
  invalidMetadata: "Invalid metadata: must be an object",
};

// ============================================
// Mock Factories
// ============================================

export const createMockMem0Client = () => ({
  add: vi.fn().mockResolvedValue({ id: "mem-new-1" }),
  search: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockResolvedValue([]),
  update: vi.fn().mockResolvedValue(undefined),
});

export const createMockShortTermMemory = () => ({
  addMemory: vi.fn().mockResolvedValue(undefined),
  searchMemory: vi.fn().mockResolvedValue([]),
  getAllMemories: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn().mockResolvedValue(undefined),
  clear: vi.fn().mockResolvedValue(undefined),
});

export const createMockPersonaEngine = () => ({
  getHardcodedPersona: vi.fn().mockReturnValue({
    content: SAMPLE_PERSONA_PROMPT,
  }),
  getSystemPrompt: vi.fn().mockReturnValue(SAMPLE_PERSONA_PROMPT),
  getMentalModel: vi.fn().mockReturnValue({
    user_profile: {
      name: "冈部",
      relationship: "friend",
      preferences: ["科学", "时间旅行"],
    },
    relationship_graph: {
      trust_level: 60,
      familiarity: 65,
      emotional_state: "warm",
    },
    shared_memories: {
      key_events: ["第一次见面", "实验室参观"],
      inside_jokes: ["香蕉"],
      repeated_topics: ["时间机器", "SERN"],
    },
  }),
  buildRPPrompt: vi.fn().mockReturnValue(SAMPLE_CONTEXT_OUTPUT),
  validate: vi.fn().mockReturnValue({ isValid: true }),
  enforcePersona: vi.fn().mockImplementation((text: string) => text),
});

export const createMockSessionMemory = () => ({
  addMessage: vi.fn().mockReturnThis(),
  getMessages: vi.fn().mockReturnValue([]),
  getRecentMessages: vi.fn().mockReturnValue([]),
  getMessagesByRole: vi.fn().mockReturnValue([]),
  getMessagesByTimeRange: vi.fn().mockReturnValue([]),
  clear: vi.fn().mockReturnThis(),
  getMessageCount: vi.fn().mockReturnValue(0),
  isEmpty: vi.fn().mockReturnValue(true),
});

// ============================================
// Helper Functions
// ============================================

export const generateMessages = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `Message ${i + 1}`,
    timestamp: Date.now() - (count - i) * 1000,
  }));
};

export const generateSessionId = (prefix: string = "session") => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
};

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// Boundary Test Data
// ============================================

export const BOUNDARY_TEST_DATA = {
  emptyString: "",
  whitespaceOnly: "   \n\t  ",
  veryLongText: "测试".repeat(10000),
  specialCharacters: '<script>alert("xss")</script>',
  unicodeEmojis: "Hello World!",
  mixedLanguages: "Hello 世界 مرحبا こんにちは",
  sqlInjection: "'; DROP TABLE users; --",
  htmlTags: '<div onclick="alert(1)">click me</div>',
  markdownContent: "# Header\n\n**bold** and *italic*",
  jsonContent: '{"key": "value", "nested": {"a": 1}}',
};

// ============================================
// Performance Test Data
// ============================================

export const PERFORMANCE_TEST_DATA = {
  largeMessageCount: 1000,
  largeSessionCount: 100,
  largeMemoryCount: 500,
  largeContextSize: 10000,
};
