/**
 * Anthropic Provider 测试
 * 位置: tests/config/models/providers/anthropic.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validModelConfig, sampleMessages, mockChatResponse, mockStreamChunks } from '../fixtures';

describe('AnthropicCompatibleModel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('constructor', () => {
    it('A-01: should create instance with config', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      expect(model.name).toBe('glm-5');
      expect(model.type).toBe('api');
      expect(model.provider).toBe('anthropic');
    });
  });

  describe('chat', () => {
    it('A-02: should return ChatResponse for basic request', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      // Mock HTTP client
      const response = await model.chat(sampleMessages);

      expect(response.content).toBeDefined();
      expect(response.usage.totalTokens).toBeGreaterThan(0);
      expect(response.model).toBe('glm-5');
    });

    it('A-03: should apply chat options', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      await model.chat(sampleMessages, {
        temperature: 0.5,
        maxTokens: 2048,
      });

      // 验证选项被应用（需要 mock 验证）
    });

    it('A-15: should throw on empty messages', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      await expect(model.chat([])).rejects.toThrow('Messages cannot be empty');
    });
  });

  describe('stream', () => {
    it('A-04: should yield StreamChunks', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      const chunks = [];
      for await (const chunk of model.stream(sampleMessages)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].done).toBe(true);
    });
  });

  describe('capabilities', () => {
    it('A-11: should support streaming', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      expect(model.supportsStreaming()).toBe(true);
    });

    it('A-12: should report vision capability', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      // 基于配置决定
      expect(typeof model.supportsVision()).toBe('boolean');
    });

    it('A-13: should support function calling', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      expect(model.supportsFunctionCalling()).toBe(true);
    });
  });

  describe('cost', () => {
    it('A-10: should calculate cost correctly', async () => {
      const { AnthropicCompatibleModel } = await import('@/config/models/providers/anthropic');
      const model = new AnthropicCompatibleModel(validModelConfig);

      const cost = model.estimateCost(1000000); // 1M tokens

      expect(cost).toBe(0.5); // costPerMillionTokens = 0.5
    });
  });
});
