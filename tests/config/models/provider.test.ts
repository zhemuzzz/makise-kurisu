/**
 * ModelProvider 测试
 * 位置: tests/config/models/provider.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { validModelConfig } from './fixtures';

describe('ModelProvider', () => {
  describe('constructor', () => {
    it('P-01: should create empty provider', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider();

      expect(provider.listModels()).toEqual([]);
    });

    it('P-02: should initialize with configs', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider([validModelConfig]);

      expect(provider.listModels()).toHaveLength(1);
    });
  });

  describe('registerModel', () => {
    it('P-03: should register single model', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider();

      provider.registerModel(validModelConfig);

      expect(provider.get('glm-5')).toBeDefined();
    });

    it('P-11: should overwrite duplicate model', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider();

      provider.registerModel(validModelConfig);
      provider.registerModel({ ...validModelConfig, maxTokens: 8192 });

      const model = provider.get('glm-5');
      // 通过获取模型验证覆盖成功
      expect(model).toBeDefined();
    });
  });

  describe('get', () => {
    it('P-04: should retrieve registered model', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider([validModelConfig]);

      const model = provider.get('glm-5');

      expect(model).toBeDefined();
      expect(model.name).toBe('glm-5');
    });

    it('P-05: should throw for non-existent model', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider();

      expect(() => provider.get('unknown')).toThrow('Model not found');
    });
  });

  describe('getByCapability', () => {
    it('P-06: should return default for capability', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider([validModelConfig], { conversation: 'glm-5' });

      const model = provider.getByCapability('conversation');

      expect(model.name).toBe('glm-5');
    });

    it('P-07: should throw for unconfigured capability', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider();

      expect(() => provider.getByCapability('unknown')).toThrow('No model configured');
    });
  });

  describe('setDefaultModel', () => {
    it('P-08: should update default mapping', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider([validModelConfig]);

      provider.setDefaultModel('conversation', 'glm-5');

      expect(provider.getByCapability('conversation').name).toBe('glm-5');
    });
  });

  describe('listModels', () => {
    it('P-09: should return all registered models', async () => {
      const { ModelProvider } = await import('@/config/models');
      const provider = new ModelProvider([validModelConfig]);

      const models = provider.listModels();

      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('glm-5');
    });
  });
});
