/**
 * Anthropic Provider 测试
 * 位置: tests/config/models/providers/anthropic.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  validModelConfig,
  sampleMessages,
  mockChatResponse,
  mockStreamChunks,
} from "../fixtures";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("AnthropicCompatibleModel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("A-01: should create instance with config", async () => {
      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      expect(model.name).toBe("glm-5");
      expect(model.type).toBe("api");
      expect(model.provider).toBe("anthropic");
    });
  });

  describe("chat", () => {
    it("A-02: should return ChatResponse for basic request", async () => {
      // Setup mock response
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hello! How can I help you today?" }],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: "glm-5",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      const response = await model.chat(sampleMessages);

      expect(response.content).toBeDefined();
      expect(response.usage.totalTokens).toBe(30);
      expect(response.model).toBe("glm-5");
    });

    it("A-03: should apply chat options", async () => {
      // Setup mock response
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Response with options" }],
          usage: { input_tokens: 10, output_tokens: 15 },
          model: "glm-5",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      await model.chat(sampleMessages, {
        temperature: 0.5,
        maxTokens: 2048,
      });

      // Verify fetch was called with correct options
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.temperature).toBe(0.5);
      expect(body.max_tokens).toBe(2048);
    });

    it("A-15: should throw on empty messages", async () => {
      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      await expect(model.chat([])).rejects.toThrow("Messages cannot be empty");
    });
  });

  describe("stream", () => {
    it("A-04: should yield StreamChunks", async () => {
      // Create mock ReadableStream for SSE response
      // Format: "data: <json>\n\n" (parser expects lines starting with "data: ")
      const encoder = new TextEncoder();
      const streamChunks = [
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"!"}}\n\n',
        'data: {"type":"message_stop"}\n\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex < streamChunks.length) {
            const chunk = streamChunks[chunkIndex++];
            return { done: false, value: encoder.encode(chunk) };
          }
          return { done: true, value: undefined };
        }),
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      const chunks = [];
      for await (const chunk of model.stream(sampleMessages)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].done).toBe(true);
    });
  });

  describe("capabilities", () => {
    it("A-11: should support streaming", async () => {
      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      expect(model.supportsStreaming()).toBe(true);
    });

    it("A-12: should report vision capability", async () => {
      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      // 基于配置决定
      expect(typeof model.supportsVision()).toBe("boolean");
    });

    it("A-13: should support function calling", async () => {
      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      expect(model.supportsFunctionCalling()).toBe(true);
    });
  });

  describe("cost", () => {
    it("A-10: should calculate cost correctly", async () => {
      const { AnthropicCompatibleModel } =
        await import("@/config/models/providers/anthropic");
      const model = new AnthropicCompatibleModel(validModelConfig);

      const cost = model.estimateCost(1000000); // 1M tokens

      expect(cost).toBe(0.5); // costPerMillionTokens = 0.5
    });
  });
});
