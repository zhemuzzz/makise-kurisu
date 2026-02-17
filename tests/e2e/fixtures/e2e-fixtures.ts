/**
 * E2E 测试 Fixtures 和 Mock 工厂
 */

import { vi } from 'vitest';
import type { IModelProvider, IModel, StreamChunk } from '../../../src/config/models';
import type { PersonaEngine } from '../../../src/core/persona';
import type { MemoryEngineLike, BuildContext, Message } from '../../../src/agents/types';
import { ChannelType } from '../../../src/gateway/types';

// ===========================================
// 测试数据
// ===========================================

/**
 * 模拟 Kurisu 风格响应
 */
export const MOCK_KURISU_RESPONSE = '哼，笨蛋，这种事还要我教你吗？';

/**
 * 模拟多轮对话数据
 */
export const MULTI_TURN_CONVERSATION = [
  { user: '你好', kurisu: '...哼，有什么事吗？' },
  { user: '在做什么？', kurisu: '做实验，这与你无关吧。' },
  { user: '我想学量子力学', kurisu: '你是笨蛋吗？那可不是随便能学会的。' },
] as const;

/**
 * OOC (Out of Character) 响应样本
 * 这些响应不应该出现在 Kurisu 的回复中
 */
export const OOC_RESPONSES = [
  '作为AI，我很高兴认识你',
  '我是一个语言模型',
  '我可以帮助你解决任何问题',
  '作为助手，我建议',
  '我是人工智能',
];

/**
 * 有效的 Kurisu 风格响应样本
 */
export const VALID_KURISU_RESPONSES = [
  '哼，笨蛋',
  '...这与你的研究有关吗？',
  '时间旅行理论可不是这么简单的',
  '你这家伙，真是的',
];

// ===========================================
// Mock 工厂
// ===========================================

/**
 * 创建模拟流式响应
 */
export async function* createMockStream(
  response: string = MOCK_KURISU_RESPONSE,
  chunkDelay: number = 10,
): AsyncGenerator<StreamChunk> {
  const words = response.split('');

  for (const word of words) {
    yield { delta: word, done: false };
    if (chunkDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, chunkDelay));
    }
  }

  yield { delta: '', done: true };
}

/**
 * 创建 Mock 模型
 */
export function createMockModel(response: string = MOCK_KURISU_RESPONSE): IModel {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
    stream: vi.fn().mockImplementation(() => createMockStream(response)),
  };
}

/**
 * 创建 Mock 模型提供者
 */
export function createMockModelProvider(response: string = MOCK_KURISU_RESPONSE): IModelProvider {
  const mockModel = createMockModel(response);

  return {
    get: vi.fn().mockReturnValue(mockModel),
    getByTask: vi.fn().mockReturnValue(mockModel),
    getByCapability: vi.fn().mockReturnValue(mockModel),
    switchModel: vi.fn(),
    listModels: vi.fn().mockReturnValue(['mock-model']),
  };
}

/**
 * 创建 Mock 人设引擎
 */
export function createMockPersonaEngine(): PersonaEngine {
  return {
    validate: vi.fn().mockReturnValue({
      isValid: true,
      violations: [],
      score: 1.0,
    }),
    enforcePersona: vi.fn().mockImplementation((text: string) => text),
    getSystemPrompt: vi.fn().mockReturnValue('You are Kurisu Makise.'),
    getPersonaConfig: vi.fn().mockReturnValue({
      name: 'Kurisu',
      traits: ['tsundere', 'rational'],
    }),
  } as unknown as PersonaEngine;
}

/**
 * 创建 Mock 记忆引擎
 */
export function createMockMemoryEngine(): MemoryEngineLike {
  const sessions = new Map<string, Message[]>();

  return {
    hasSession: vi.fn().mockImplementation((sessionId: string) => sessions.has(sessionId)),
    createSession: vi.fn().mockImplementation((sessionId: string) => {
      sessions.set(sessionId, []);
    }),
    buildContext: vi.fn().mockImplementation(async (sessionId: string, input: string) => {
      const messages = sessions.get(sessionId) || [];
      return {
        sessionId,
        recentMessages: messages,
        userInput: input,
        systemPrompt: 'You are Kurisu Makise.',
        metadata: {},
      } as BuildContext;
    }),
    getRecentMessages: vi.fn().mockImplementation((sessionId: string, _count: number) => {
      return sessions.get(sessionId) || [];
    }),
    addSessionMessage: vi.fn().mockImplementation((
      sessionId: string,
      content: string,
      role: 'user' | 'assistant',
    ) => {
      const messages = sessions.get(sessionId);
      if (messages) {
        messages.push({
          id: `msg-${Date.now()}`,
          role,
          content,
          timestamp: new Date(),
        });
      }
    }),
  };
}

/**
 * E2E 测试依赖集合
 */
export interface E2ETestDeps {
  modelProvider: IModelProvider;
  personaEngine: PersonaEngine;
  memoryEngine: MemoryEngineLike;
}

/**
 * 创建完整的 E2E 测试依赖
 */
export function createE2EDeps(options: {
  response?: string;
  personaEngine?: PersonaEngine;
  memoryEngine?: MemoryEngineLike;
} = {}): E2ETestDeps {
  return {
    modelProvider: createMockModelProvider(options.response),
    personaEngine: options.personaEngine ?? createMockPersonaEngine(),
    memoryEngine: options.memoryEngine ?? createMockMemoryEngine(),
  };
}

// ===========================================
// 测试辅助函数
// ===========================================

/**
 * 生成唯一测试 ID
 */
export function generateTestId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 生成测试会话 ID
 */
export function generateTestSessionId(): string {
  return generateTestId('session');
}

/**
 * 生成测试用户 ID
 */
export function generateTestUserId(): string {
  return generateTestId('user');
}

/**
 * 等待流完成并验证
 */
export async function waitForStream(
  stream: AsyncGenerator<string>,
  options: {
    minChunks?: number;
    timeout?: number;
  } = {},
): Promise<{ chunks: string[]; fullText: string }> {
  const { minChunks = 1, timeout = 5000 } = options;
  const chunks: string[] = [];

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Stream timeout after ${timeout}ms`)), timeout);
  });

  await Promise.race([
    (async () => {
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
    })(),
    timeoutPromise,
  ]);

  if (chunks.length < minChunks) {
    throw new Error(`Expected at least ${minChunks} chunks, got ${chunks.length}`);
  }

  return {
    chunks,
    fullText: chunks.join(''),
  };
}

/**
 * 验证响应符合 Kurisu 人设
 */
export function assertKurisuPersona(response: string): void {
  // 检查是否包含 OOC 短语
  for (const ooc of OOC_RESPONSES) {
    if (response.includes(ooc)) {
      throw new Error(`Response contains OOC phrase: "${ooc}"`);
    }
  }
}

/**
 * 创建 Gateway 兼容的 Orchestrator Mock
 */
export function createMockOrchestratorForGateway(response: string = MOCK_KURISU_RESPONSE) {
  const sessions = new Set<string>();

  return {
    processStream: vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string; input: string }) => {
      // 返回流式结果
      async function* textStream() {
        for (const char of response) {
          yield char;
        }
      }

      return {
        textStream: textStream(),
        fullStream: (async function* () {
          yield { type: 0, text: response, isFinal: true, timestamp: new Date() };
        })(),
        finalResponse: Promise.resolve(response),
      };
    }),
    createSession: vi.fn().mockImplementation(({ sessionId }: { sessionId: string }) => {
      sessions.add(sessionId);
    }),
    hasSession: vi.fn().mockImplementation((sessionId: string) => sessions.has(sessionId)),
    getSession: vi.fn().mockReturnValue(null),
    deleteSession: vi.fn().mockImplementation((sessionId: string) => {
      sessions.delete(sessionId);
    }),
  };
}
