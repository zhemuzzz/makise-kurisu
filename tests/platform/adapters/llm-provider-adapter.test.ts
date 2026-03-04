/**
 * LLMProviderAdapter 测试
 *
 * 适配 IModelProvider + IModel → LLMProviderPort
 * 处理: Message 格式转换, 流包装, ToolDef→OpenAI 转换
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMProviderAdapter } from "../../../src/platform/adapters/llm-provider-adapter.js";
import type { LLMProviderPort, LLMCallConfig, LLMStreamChunk } from "../../../src/agent/ports/platform-services.js";
import type { LLMMessage, LLMResponse } from "../../../src/agent/types.js";
import type { ToolDef } from "../../../src/platform/tools/types.js";
import type { IModel, IModelProvider, ChatResponse, Message } from "../../../src/platform/models/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockModel(): {
  model: IModel;
  chat: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
} {
  const chat = vi.fn().mockResolvedValue({
    content: "Hello!",
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "glm-5",
    latency: 200,
    finishReason: "stop",
  } satisfies ChatResponse);

  const stream = vi.fn();

  const model = {
    name: "glm-5",
    type: "cloud",
    provider: "zhipu",
    chat,
    stream,
    supportsStreaming: () => true,
    supportsVision: () => false,
    supportsFunctionCalling: () => true,
    estimateCost: () => 0.001,
    getAverageLatency: () => 200,
  } as unknown as IModel;

  return { model, chat, stream };
}

function createMockProvider(model: IModel): {
  provider: IModelProvider;
  get: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn().mockReturnValue(model);

  const provider = {
    get,
    getByCapability: vi.fn().mockReturnValue(model),
    getByTask: vi.fn().mockReturnValue(model),
    registerModel: vi.fn(),
    setDefaultModel: vi.fn(),
    listModels: vi.fn().mockReturnValue([
      { name: "glm-5", type: "cloud", provider: "zhipu" },
      { name: "minimax-m2.5", type: "cloud", provider: "minimax" },
    ]),
    healthCheck: vi.fn().mockResolvedValue(new Map([["glm-5", true]])),
  } as unknown as IModelProvider;

  return { provider, get };
}

const sampleToolDef: ToolDef = {
  name: "web_search",
  description: "Search the web",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
  permission: "safe",
  source: { type: "native", nativeId: "web_search" },
};

const sampleConfig: LLMCallConfig = {
  modelId: "glm-5",
  temperature: 0.7,
  maxTokens: 2000,
};

// ============================================================================
// Tests
// ============================================================================

describe("LLMProviderAdapter", () => {
  let adapter: LLMProviderPort;
  let mockModel: ReturnType<typeof createMockModel>;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    mockModel = createMockModel();
    mockProvider = createMockProvider(mockModel.model);
    adapter = new LLMProviderAdapter(mockProvider.provider);
  });

  describe("stream", () => {
    it("should resolve model and call chat()", async () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "You are Kurisu" },
        { role: "user", content: "Hello" },
      ];

      const gen = adapter.stream(messages, [], sampleConfig);
      const chunks: LLMStreamChunk[] = [];

      // Consume the generator
      let result = await gen.next();
      while (!result.done) {
        chunks.push(result.value);
        result = await gen.next();
      }

      // Should have resolved the model
      expect(mockProvider.get).toHaveBeenCalledWith("glm-5");
      // Should have called chat
      expect(mockModel.chat).toHaveBeenCalled();
      // Return value should be LLMResponse
      const response = result.value as LLMResponse;
      expect(response.content).toBe("Hello!");
      expect(response.finishReason).toBe("stop");
    });

    it("should convert LLMMessage[] to Message[]", async () => {
      const messages: LLMMessage[] = [
        { role: "system", content: "System" },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ];

      const gen = adapter.stream(messages, [], sampleConfig);
      // Consume fully
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const callArgs = mockModel.chat.mock.calls[0];
      const convertedMessages = callArgs[0] as Message[];

      expect(convertedMessages).toHaveLength(3);
      expect(convertedMessages[0]).toEqual({ role: "system", content: "System" });
      expect(convertedMessages[1]).toEqual({ role: "user", content: "Hi" });
      expect(convertedMessages[2]).toEqual({ role: "assistant", content: "Hello" });
    });

    it("should convert ToolDef[] to OpenAIToolDefinition[]", async () => {
      const gen = adapter.stream(
        [{ role: "user", content: "Search for cats" }],
        [sampleToolDef],
        sampleConfig,
      );
      // Consume fully
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const callArgs = mockModel.chat.mock.calls[0];
      const options = callArgs[1];

      expect(options.tools).toBeDefined();
      expect(options.tools).toHaveLength(1);
      expect(options.tools[0].type).toBe("function");
      expect(options.tools[0].function.name).toBe("web_search");
    });

    it("should pass config options to ChatOptions", async () => {
      const gen = adapter.stream(
        [{ role: "user", content: "test" }],
        [],
        { modelId: "glm-5", temperature: 0.5, maxTokens: 1000, topP: 0.9 },
      );
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const options = mockModel.chat.mock.calls[0][1];
      expect(options.temperature).toBe(0.5);
      expect(options.maxTokens).toBe(1000);
      expect(options.topP).toBe(0.9);
    });

    it("should yield content as LLMStreamChunk", async () => {
      const gen = adapter.stream(
        [{ role: "user", content: "test" }],
        [],
        sampleConfig,
      );

      const chunks: LLMStreamChunk[] = [];
      let result = await gen.next();
      while (!result.done) {
        chunks.push(result.value);
        result = await gen.next();
      }

      // Should have at least one chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0].delta).toBe("Hello!");
    });

    it("should convert tool calls in response", async () => {
      mockModel.chat.mockResolvedValue({
        content: "",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: "glm-5",
        latency: 150,
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call-1",
            type: "function" as const,
            function: {
              name: "web_search",
              arguments: '{"q":"cats"}',
            },
          },
        ],
      });

      const gen = adapter.stream(
        [{ role: "user", content: "Search for cats" }],
        [sampleToolDef],
        sampleConfig,
      );

      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const response = result.value as LLMResponse;
      expect(response.finishReason).toBe("tool_calls");
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0].name).toBe("web_search");
      expect(response.toolCalls![0].arguments).toEqual({ q: "cats" });
    });

    it("should convert tool message with toolCallId", async () => {
      const messages: LLMMessage[] = [
        { role: "tool", content: "search result", toolCallId: "call-1" },
      ];

      const gen = adapter.stream(messages, [], sampleConfig);
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const callArgs = mockModel.chat.mock.calls[0];
      const convertedMessages = callArgs[0] as Message[];
      const toolMsg = convertedMessages[0] as { role: "tool"; tool_call_id: string; content: string };
      expect(toolMsg.role).toBe("tool");
      expect(toolMsg.tool_call_id).toBe("call-1");
      expect(toolMsg.content).toBe("search result");
    });

    it("should convert assistant message with toolCalls", async () => {
      const messages: LLMMessage[] = [
        {
          role: "assistant",
          content: "Let me search",
          toolCalls: [{ id: "call-1", name: "web_search", arguments: { q: "test" } }],
        },
      ];

      const gen = adapter.stream(messages, [], sampleConfig);
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const callArgs = mockModel.chat.mock.calls[0];
      const convertedMessages = callArgs[0] as Message[];
      const assistantMsg = convertedMessages[0] as { role: "assistant"; content: string; tool_calls?: unknown[] };
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.tool_calls).toBeDefined();
      expect(assistantMsg.tool_calls).toHaveLength(1);
    });

    it("should map usage fields correctly", async () => {
      mockModel.chat.mockResolvedValue({
        content: "response",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: "glm-5",
        latency: 200,
        finishReason: "stop",
      });

      const gen = adapter.stream(
        [{ role: "user", content: "test" }],
        [],
        sampleConfig,
      );
      let result = await gen.next();
      while (!result.done) {
        result = await gen.next();
      }

      const response = result.value as LLMResponse;
      expect(response.usage.promptTokens).toBe(100);
      expect(response.usage.completionTokens).toBe(50);
      expect(response.usage.totalTokens).toBe(150);
    });
  });

  describe("getAvailableModels", () => {
    it("should return model names from provider", () => {
      const models = adapter.getAvailableModels();
      expect(models).toEqual(["glm-5", "minimax-m2.5"]);
    });
  });

  describe("isModelAvailable", () => {
    it("should return true for known models", () => {
      expect(adapter.isModelAvailable("glm-5")).toBe(true);
    });

    it("should return false for unknown models", () => {
      mockProvider.get.mockImplementation(() => {
        throw new Error("Model not found");
      });
      expect(adapter.isModelAvailable("unknown")).toBe(false);
    });
  });
});
