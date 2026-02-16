/**
 * 配置加载器测试
 * 位置: tests/config/models/loader.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { validYamlConfig, validModelConfig } from './fixtures';

vi.mock('fs/promises');

describe('Config Loader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('ANTHROPIC_ENDPOINT', 'https://api.anthropic.com');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('loadConfig', () => {
    it('L-01: should load valid YAML config', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(validYamlConfig);
      const { loadConfig } = await import('@/config/models/loader');
      const config = await loadConfig('/path/to/models.yaml');

      expect(config.defaults.conversation).toBe('glm-5');
      expect(config.models).toHaveLength(1);
      expect(config.models[0].name).toBe('glm-5');
    });

    it('L-02: should handle empty configuration', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('');
      const { loadConfig } = await import('@/config/models/loader');
      const config = await loadConfig('/path/to/models.yaml');

      expect(config.models).toEqual([]);
    });

    it('L-03: should throw on invalid YAML syntax', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('invalid: yaml: [');
      const { loadConfig, ConfigLoadError } = await import('@/config/models/loader');

      await expect(loadConfig('/path/to/config.yaml')).rejects.toThrow(ConfigLoadError);
    });

    it('L-04: should validate required model fields', async () => {
      const invalidYaml = `
models:
  - type: api
    provider: anthropic
`;
      vi.spyOn(fs, 'readFile').mockResolvedValue(invalidYaml);
      const { loadConfig, ValidationError } = await import('@/config/models/loader');

      await expect(loadConfig('/path/to/config.yaml')).rejects.toThrow(ValidationError);
    });

    it('L-06: should handle missing config file', async () => {
      vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('ENOENT'));
      const { loadConfig, FileNotFoundError } = await import('@/config/models/loader');

      await expect(loadConfig('/nonexistent/config.yaml')).rejects.toThrow(FileNotFoundError);
    });

    it('L-07: should inject env vars into config', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue(validYamlConfig);
      const { loadConfig } = await import('@/config/models/loader');
      const config = await loadConfig('/path/to/models.yaml');

      expect(config.models[0].endpoint).toBe('https://api.anthropic.com');
      expect(config.models[0].apiKey).toBe('test-key');
    });
  });

  describe('loadConfigFromString', () => {
    it('L-11: should parse config from string', async () => {
      const { loadConfigFromString } = await import('@/config/models/loader');
      const config = loadConfigFromString(validYamlConfig);

      expect(config.defaults.conversation).toBe('glm-5');
    });
  });
});
