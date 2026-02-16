/**
 * 测试数据夹具
 * 位置: tests/config/models/fixtures.ts
 */

import type { ModelConfig, Message, ChatResponse } from '@/config/models/types';

export const validModelConfig: ModelConfig = {
  name: 'glm-5',
  type: 'api',
  provider: 'anthropic',
  endpoint: 'https://api.anthropic.com',
  apiKey: 'test-api-key',
  maxTokens: 4096,
  defaultTemperature: 0.7,
  costPerMillionTokens: 0.5,
};

export const validYamlConfig = `
defaults:
  conversation: glm-5
  task: glm-5

models:
  - name: glm-5
    type: api
    provider: anthropic
    endpoint: \${ANTHROPIC_ENDPOINT}
    apiKey: \${ANTHROPIC_API_KEY}
    maxTokens: 4096
    defaultTemperature: 0.7
    costPerMillionTokens: 0.5
`;

export const sampleMessages: Message[] = [
  { role: 'user', content: 'Hello, Kurisu!' },
];

export const mockChatResponse: ChatResponse = {
  content: 'Hello! How can I help you today?',
  usage: {
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
  },
  model: 'glm-5',
  latency: 150,
};

export const mockStreamChunks = [
  { content: 'Hello', done: false, delta: 'Hello' },
  { content: '!', done: false, delta: '!' },
  { content: '', done: true },
];
