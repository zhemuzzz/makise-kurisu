/**
 * Gateway Test Fixtures
 * L1 交互网关测试数据
 */

import { vi } from "vitest";
import {
  ChannelType,
  SessionInfo,
  StreamEventType,
  TextDeltaEvent,
  TextCompleteEvent,
  ErrorEvent,
  MetadataEvent,
} from "../../src/platform/gateway/types";

// ===========================================
// Channel Type Fixtures
// ===========================================

export const VALID_CHANNEL_TYPES: ChannelType[] = [
  ChannelType.CLI,
  ChannelType.REST,
  ChannelType.DISCORD,
  ChannelType.WEBSOCKET,
  ChannelType.WECHAT,
  ChannelType.WECOM,
  ChannelType.QQ,
  ChannelType.TELEGRAM,
  ChannelType.FEISHU,
  ChannelType.DINGTALK,
];

// ===========================================
// Session Fixtures
// ===========================================

export const createMockSession = (
  overrides: Partial<SessionInfo> = {},
): SessionInfo => ({
  sessionId: "session-test-123",
  userId: "user-test-456",
  channelType: ChannelType.CLI,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  lastActiveAt: new Date("2024-01-01T00:00:00Z"),
  metadata: {},
  ...overrides,
});

export const SAMPLE_SESSIONS: Record<string, SessionInfo> = {
  cli: createMockSession({
    sessionId: "cli-session-1",
    channelType: ChannelType.CLI,
  }),
  rest: createMockSession({
    sessionId: "rest-session-1",
    channelType: ChannelType.REST,
    metadata: { ip: "127.0.0.1" },
  }),
  discord: createMockSession({
    sessionId: "discord-session-1",
    channelType: ChannelType.DISCORD,
    metadata: { guildId: "guild-123", channelId: "channel-456" },
  }),
  websocket: createMockSession({
    sessionId: "ws-session-1",
    channelType: ChannelType.WEBSOCKET,
    metadata: { connectionId: "conn-789" },
  }),
};

// ===========================================
// Stream Event Fixtures
// ===========================================

export const createTextDeltaEvent = (
  text: string,
  isFinal = false,
): TextDeltaEvent => ({
  type: StreamEventType.TEXT_DELTA,
  text,
  isFinal,
  timestamp: new Date(),
});

export const createTextCompleteEvent = (text: string): TextCompleteEvent => ({
  type: StreamEventType.TEXT_COMPLETE,
  text,
  timestamp: new Date(),
});

export const createErrorEvent = (
  message: string,
  code?: string,
): ErrorEvent => ({
  type: StreamEventType.ERROR,
  message,
  code,
  timestamp: new Date(),
});

export const createMetadataEvent = (
  data: Record<string, unknown>,
): MetadataEvent => ({
  type: StreamEventType.METADATA,
  data,
  timestamp: new Date(),
});

// Sample stream events
export const SAMPLE_EVENTS = {
  textDelta: createTextDeltaEvent("Hello "),
  textDeltaFinal: createTextDeltaEvent("World!", true),
  textComplete: createTextCompleteEvent("Hello World!"),
  error: createErrorEvent("Connection lost", "ECONNLOST"),
  metadata: createMetadataEvent({ tokensUsed: 42, model: "gpt-4" }),
};

// ===========================================
// Stream Content Fixtures
// ===========================================

// 模拟 AI 回复流
export const MOCK_AI_RESPONSE_CHUNKS = [
  "哼",
  "，",
  "笨",
  "蛋",
  "，",
  "这种",
  "事",
  "还要",
  "我",
  "教",
  "你",
  "吗",
  "？",
];

// 完整回复文本
export const MOCK_AI_RESPONSE_FULL = "哼，笨蛋，这种事还要我教你吗？";

// 多轮对话
export const MOCK_CONVERSATION_TURNS = [
  { user: "你好", ai: "...哼，有什么事吗？" },
  { user: "在做什么？", ai: "做实验，这与你无关吧。" },
  { user: "我想学量子力学", ai: "你是笨蛋吗？那可不是随便能学会的。" },
];

// ===========================================
// Boundary Test Data
// ===========================================

export const BOUNDARY_TEST_DATA = {
  // 会话 ID 边界
  emptySessionId: "",
  veryLongSessionId: "session-" + "x".repeat(1000),
  specialCharSessionId: "session-<script>alert(1)</script>",
  unicodeSessionId: "session-你好-世界",

  // 用户输入边界
  emptyInput: "",
  whitespaceOnly: "   \n\t  ",
  veryLongInput: "测试".repeat(10000),
  specialCharacters: '<script>alert("xss")</script>',
  unicodeEmojis: "Hello World!",
  mixedLanguages: "Hello 世界 مرحبا こんにちは",
  sqlInjection: "'; DROP TABLE users; --",
  htmlTags: '<div onclick="alert(1)">click me</div>',
  markdownContent: "# Header\n\n**bold** and *italic*",
  jsonContent: '{"key": "value", "nested": {"a": 1}}',
  nullBytes: "test\x00null\x00bytes",

  // 流事件边界
  emptyTextDelta: createTextDeltaEvent(""),
  hugeTextDelta: createTextDeltaEvent("x".repeat(100000)),
  unicodeTextDelta: createTextDeltaEvent("你好世界 🌍 مرحبا"),
};

// ===========================================
// Mock Dependencies
// ===========================================

// 模拟 AgentHandle 依赖 (KURISU-041: 替代 IOrchestrator)
export const createMockAgentHandle = () => ({
  agent: {
    execute: vi.fn(),
  },
  getCognition: vi.fn().mockReturnValue(""),
  personaEngine: null,
});

// 模拟 AsyncGenerator
export async function* createMockTextStream(
  chunks: string[],
): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// 模拟完整事件流
export async function* createMockEventStream(
  events: Array<
    TextDeltaEvent | TextCompleteEvent | ErrorEvent | MetadataEvent
  >,
): AsyncGenerator<(typeof events)[number]> {
  for (const event of events) {
    yield event;
  }
}

// ===========================================
// Timing Test Data
// ===========================================

export const TIMING_THRESHOLDS = {
  // 会话 TTL (毫秒)
  sessionTTL: 30 * 60 * 1000, // 30 minutes
  // 流超时
  streamTimeout: 60 * 1000, // 60 seconds
  // 回调延迟阈值
  callbackLatencyMax: 100, // 100ms
};

// ===========================================
// Error Scenarios
// ===========================================

export const ERROR_SCENARIOS = {
  sessionNotFound: {
    message: "Session not found",
    code: "session_not_found",
  },
  sessionExpired: {
    message: "Session has expired",
    code: "session_expired",
  },
  invalidInput: {
    message: "Invalid input provided",
    code: "invalid_input",
  },
  streamError: {
    message: "Stream processing error",
    code: "stream_error",
  },
  orchestratorError: {
    message: "Agent orchestrator error",
    code: "gateway_error",
  },
  channelError: {
    message: "Channel communication error",
    code: "gateway_error",
  },
};
