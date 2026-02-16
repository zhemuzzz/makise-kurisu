/**
 * 环境变量注入测试
 * 位置: tests/config/models/env.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Environment Variable Injector', () => {
  beforeEach(() => {
    vi.stubEnv('API_KEY', 'test-key');
    vi.stubEnv('BASE_URL', 'https://api.example.com');
    vi.stubEnv('EMPTY_VAR', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('injectEnvVars', () => {
    it('E-01: should substitute simple ${VAR}', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ apiKey: '${API_KEY}' });
      expect(result.apiKey).toBe('test-key');
    });

    it('E-02: should replace multiple ${VAR}', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ url: '${BASE_URL}/${API_KEY}' });
      expect(result.url).toBe('https://api.example.com/test-key');
    });

    it('E-03: should handle var embedded in string', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ path: 'prefix_${API_KEY}_suffix' });
      expect(result.path).toBe('prefix_test-key_suffix');
    });

    it('E-04: should handle ${VAR:-default} syntax', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ val: '${MISSING:-fallback}' });
      expect(result.val).toBe('fallback');
    });

    it('E-09: should traverse nested objects', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({
        config: {
          nested: {
            key: '${API_KEY}',
          },
        },
      });
      expect(result.config.nested.key).toBe('test-key');
    });

    it('E-10: should traverse arrays', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({
        items: ['${API_KEY}', '${BASE_URL}'],
      });
      expect(result.items).toEqual(['test-key', 'https://api.example.com']);
    });

    it('E-11: should preserve numbers', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ count: 42, price: 3.14 });
      expect(result.count).toBe(42);
      expect(result.price).toBe(3.14);
    });

    it('E-12: should preserve booleans', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ enabled: true, disabled: false });
      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
    });

    it('E-06: should handle empty string value', async () => {
      const { injectEnvVars } = await import('@/config/models/env');
      const result = injectEnvVars({ val: '${EMPTY_VAR}' });
      expect(result.val).toBe('');
    });

    it('E-09: should throw on missing required env var', async () => {
      const { injectEnvVars, EnvVarMissingError } = await import('@/config/models/env');
      expect(() => injectEnvVars({ key: '${UNDEFINED_VAR}' })).toThrow(EnvVarMissingError);
    });
  });
});
