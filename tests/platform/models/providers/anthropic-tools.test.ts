/**
 * Anthropic Provider Tool Calling 测试
 * 位置: tests/config/models/providers/anthropic-tools.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { validModelConfig, sampleMessages } from "../fixtures";
import type { Message, OpenAIToolDefinition } from "@/platform/models/types";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// 测试用工具定义（OpenAI 格式）
const sampleTools: OpenAIToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search",
      description: "Search the web",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Get git status",
      parameters: {
        type: "object",
        properties: {
          repo_path: { type: "string" },
        },
        required: ["repo_path"],
      },
    },
  },
];

describe("AnthropicCompatibleModel - Tool Calling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("convertToolsToAnthropic", () => {
    it("should convert OpenAI tool format to Anthropic format", async () => {
      const { convertToolsToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const result = convertToolsToAnthropic(sampleTools);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: "search",
        description: "Search the web",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      });
    });
  });

  describe("convertToolChoice", () => {
    it("should convert 'auto' to {type: 'auto'}", async () => {
      const { convertToolChoice } = await import(
        "@/platform/models/providers/anthropic"
      );
      expect(convertToolChoice("auto")).toEqual({ type: "auto" });
    });

    it("should convert 'required' to {type: 'any'}", async () => {
      const { convertToolChoice } = await import(
        "@/platform/models/providers/anthropic"
      );
      expect(convertToolChoice("required")).toEqual({ type: "any" });
    });

    it("should default to {type: 'auto'} for undefined", async () => {
      const { convertToolChoice } = await import(
        "@/platform/models/providers/anthropic"
      );
      expect(convertToolChoice(undefined)).toEqual({ type: "auto" });
    });
  });

  describe("convertMessagesToAnthropic", () => {
    it("should convert basic user/assistant messages", async () => {
      const { convertMessagesToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const messages: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ];

      const result = convertMessagesToAnthropic(messages);

      expect(result).toEqual([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);
    });

    it("should skip system messages", async () => {
      const { convertMessagesToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const messages: Message[] = [
        { role: "system", content: "You are Kurisu" },
        { role: "user", content: "Hello" },
      ];

      const result = convertMessagesToAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ role: "user", content: "Hello" });
    });

    it("should convert assistant with tool_calls to tool_use blocks", async () => {
      const { convertMessagesToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const messages: Message[] = [
        { role: "user", content: "Search TypeScript" },
        {
          role: "assistant",
          content: "Let me search",
          tool_calls: [
            {
              id: "tc_001",
              type: "function",
              function: {
                name: "search",
                arguments: '{"query":"TypeScript 5.0"}',
              },
            },
          ],
        },
      ];

      const result = convertMessagesToAnthropic(messages);

      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({
        role: "assistant",
        content: [
          { type: "text", text: "Let me search" },
          {
            type: "tool_use",
            id: "tc_001",
            name: "search",
            input: { query: "TypeScript 5.0" },
          },
        ],
      });
    });

    it("should convert tool result messages to user tool_result blocks", async () => {
      const { convertMessagesToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const messages: Message[] = [
        { role: "tool", tool_call_id: "tc_001", content: "Search result: ..." },
      ];

      const result = convertMessagesToAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tc_001",
            content: "Search result: ...",
          },
        ],
      });
    });

    it("should merge consecutive tool results into one user message", async () => {
      const { convertMessagesToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const messages: Message[] = [
        {
          role: "tool",
          tool_call_id: "tc_001",
          content: "Result 1",
        },
        {
          role: "tool",
          tool_call_id: "tc_002",
          content: "Result 2",
        },
      ];

      const result = convertMessagesToAnthropic(messages);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tc_001", content: "Result 1" },
          { type: "tool_result", tool_use_id: "tc_002", content: "Result 2" },
        ],
      });
    });

    it("should handle full ReAct conversation", async () => {
      const { convertMessagesToAnthropic } = await import(
        "@/platform/models/providers/anthropic"
      );

      const messages: Message[] = [
        { role: "user", content: "Search TS 5.0" },
        {
          role: "assistant",
          content: "Searching...",
          tool_calls: [
            {
              id: "tc_001",
              type: "function",
              function: {
                name: "search",
                arguments: '{"query":"TS 5.0"}',
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "tc_001", content: "Found: ..." },
        { role: "assistant", content: "Here are the results" },
      ];

      const result = convertMessagesToAnthropic(messages);

      expect(result).toHaveLength(4);
      expect(result[0]).toEqual({ role: "user", content: "Search TS 5.0" });
      // assistant with tool_use
      expect(
        Array.isArray(result[1]!.content) && result[1]!.content.length,
      ).toBe(2);
      // tool_result as user
      expect(result[2]!.role).toBe("user");
      // final assistant
      expect(result[3]).toEqual({
        role: "assistant",
        content: "Here are the results",
      });
    });
  });

  describe("extractToolCalls", () => {
    it("should extract tool_use blocks as LLMToolCall[]", async () => {
      const { extractToolCalls } = await import(
        "@/platform/models/providers/anthropic"
      );

      const content = [
        { type: "text" as const, text: "Let me search" },
        {
          type: "tool_use" as const,
          id: "toolu_123",
          name: "search",
          input: { query: "TypeScript 5.0" },
        },
      ];

      const result = extractToolCalls(content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "toolu_123",
        type: "function",
        function: {
          name: "search",
          arguments: '{"query":"TypeScript 5.0"}',
        },
      });
    });

    it("should return empty array when no tool_use blocks", async () => {
      const { extractToolCalls } = await import(
        "@/platform/models/providers/anthropic"
      );

      const content = [{ type: "text" as const, text: "Hello" }];
      const result = extractToolCalls(content);

      expect(result).toHaveLength(0);
    });

    it("should extract multiple tool_use blocks", async () => {
      const { extractToolCalls } = await import(
        "@/platform/models/providers/anthropic"
      );

      const content = [
        {
          type: "tool_use" as const,
          id: "tc_1",
          name: "search",
          input: { query: "a" },
        },
        {
          type: "tool_use" as const,
          id: "tc_2",
          name: "git_status",
          input: { repo_path: "." },
        },
      ];

      const result = extractToolCalls(content);

      expect(result).toHaveLength(2);
      expect(result[0]!.function.name).toBe("search");
      expect(result[1]!.function.name).toBe("git_status");
    });
  });

  describe("chat() with tools", () => {
    it("should send tools in Anthropic format", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Searching..." }],
          usage: { input_tokens: 50, output_tokens: 20 },
          stop_reason: "end_turn",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      await model.chat(sampleMessages, {
        tools: sampleTools,
        toolChoice: "auto",
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      // 验证 tools 以 Anthropic 格式发送
      expect(body.tools).toHaveLength(2);
      expect(body.tools[0]).toEqual({
        name: "search",
        description: "Search the web",
        input_schema: sampleTools[0]!.function.parameters,
      });

      // 验证 tool_choice
      expect(body.tool_choice).toEqual({ type: "auto" });
    });

    it("should send tool_choice 'any' when toolChoice is 'required'", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "" },
            {
              type: "tool_use",
              id: "toolu_001",
              name: "search",
              input: { query: "TS" },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 30 },
          stop_reason: "tool_use",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      await model.chat(sampleMessages, {
        tools: sampleTools,
        toolChoice: "required",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tool_choice).toEqual({ type: "any" });
    });

    it("should not include tools when none provided", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hello" }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      await model.chat(sampleMessages);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.tools).toBeUndefined();
      expect(body.tool_choice).toBeUndefined();
    });

    it("should parse tool_use response and return toolCalls", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "Let me search" },
            {
              type: "tool_use",
              id: "toolu_abc123",
              name: "search",
              input: { query: "TypeScript 5.0 new features" },
            },
          ],
          usage: { input_tokens: 50, output_tokens: 40 },
          stop_reason: "tool_use",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      const response = await model.chat(sampleMessages, {
        tools: sampleTools,
      });

      expect(response.content).toBe("Let me search");
      expect(response.finishReason).toBe("tool_calls");
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls![0]).toEqual({
        id: "toolu_abc123",
        type: "function",
        function: {
          name: "search",
          arguments: '{"query":"TypeScript 5.0 new features"}',
        },
      });
    });

    it("should not include toolCalls when no tool_use blocks", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Just a regular response" }],
          usage: { input_tokens: 10, output_tokens: 10 },
          stop_reason: "end_turn",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      const response = await model.chat(sampleMessages, {
        tools: sampleTools,
      });

      expect(response.toolCalls).toBeUndefined();
      expect(response.finishReason).toBe("stop");
    });

    it("should handle multiple tool_use blocks in response", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [
            { type: "text", text: "Doing both" },
            {
              type: "tool_use",
              id: "tc_1",
              name: "search",
              input: { query: "a" },
            },
            {
              type: "tool_use",
              id: "tc_2",
              name: "git_status",
              input: { repo_path: "." },
            },
          ],
          usage: { input_tokens: 60, output_tokens: 50 },
          stop_reason: "tool_use",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      const response = await model.chat(sampleMessages, {
        tools: sampleTools,
      });

      expect(response.toolCalls).toHaveLength(2);
      expect(response.toolCalls![0]!.function.name).toBe("search");
      expect(response.toolCalls![1]!.function.name).toBe("git_status");
    });
  });

  describe("chat() with tool result messages", () => {
    it("should convert tool result messages to Anthropic format", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Based on the search results..." }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: "end_turn",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);

      const messages: Message[] = [
        { role: "user", content: "Search TypeScript" },
        {
          role: "assistant",
          content: "Searching...",
          tool_calls: [
            {
              id: "tc_001",
              type: "function",
              function: {
                name: "search",
                arguments: '{"query":"TypeScript"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "tc_001",
          content: "TypeScript is a typed superset of JavaScript.",
        },
      ];

      await model.chat(messages, { tools: sampleTools });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      // 验证 assistant message 包含 tool_use block
      expect(body.messages[1].role).toBe("assistant");
      expect(body.messages[1].content).toEqual([
        { type: "text", text: "Searching..." },
        {
          type: "tool_use",
          id: "tc_001",
          name: "search",
          input: { query: "TypeScript" },
        },
      ]);

      // 验证 tool result 被转为 user message 的 tool_result block
      expect(body.messages[2].role).toBe("user");
      expect(body.messages[2].content).toEqual([
        {
          type: "tool_result",
          tool_use_id: "tc_001",
          content: "TypeScript is a typed superset of JavaScript.",
        },
      ]);
    });
  });

  describe("stop_reason mapping", () => {
    it("should map 'end_turn' to 'stop'", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Done" }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);
      const response = await model.chat(sampleMessages);

      expect(response.finishReason).toBe("stop");
    });

    it("should map 'tool_use' to 'tool_calls'", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [
            {
              type: "tool_use",
              id: "tc_1",
              name: "search",
              input: { query: "x" },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "tool_use",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);
      const response = await model.chat(sampleMessages, {
        tools: sampleTools,
      });

      expect(response.finishReason).toBe("tool_calls");
    });

    it("should map 'max_tokens' to 'length'", async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Truncated" }],
          usage: { input_tokens: 10, output_tokens: 4096 },
          stop_reason: "max_tokens",
        }),
      };
      mockFetch.mockResolvedValueOnce(mockResponse);

      const { AnthropicCompatibleModel } = await import(
        "@/platform/models/providers/anthropic"
      );
      const model = new AnthropicCompatibleModel(validModelConfig);
      const response = await model.chat(sampleMessages);

      expect(response.finishReason).toBe("length");
    });
  });
});
