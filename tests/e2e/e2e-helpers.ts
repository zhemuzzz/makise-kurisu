/**
 * E2E 测试共享 Helpers
 *
 * 提供 mock LLM、事件收集器、测试常量和临时配置目录创建等工具函数。
 * 供 e2e-conversation.test.ts 和 smoke.test.ts 共用。
 */

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AgentEvent, AgentConfig, AgentInput } from "@/agent/types.js";
import type { LLMResponse } from "@/agent/types.js";
import type {
  LLMProviderPort,
  LLMStreamChunk,
} from "@/agent/ports/platform-services.js";

// ============================================
// Mock LLM Providers
// ============================================

/**
 * 创建 mock LLM，返回固定文本
 */
export function createMockLLM(responseText: string): LLMProviderPort {
  return {
    async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
      const words = responseText.split(" ");
      for (const word of words) {
        yield { delta: word + " " };
      }

      return {
        content: responseText,
        finishReason: "stop" as const,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };
    },
    getAvailableModels: () => ["mock-model"],
    isModelAvailable: () => true,
  };
}

/**
 * 创建 mock LLM，带工具调用
 */
export function createMockLLMWithToolCall(
  toolName: string,
  toolArgs: Record<string, unknown>,
  followUpResponse: string,
): LLMProviderPort {
  let callCount = 0;

  return {
    async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
      callCount++;

      if (callCount === 1) {
        yield {
          delta: "",
          toolCalls: [
            {
              id: "call-1",
              name: toolName,
              arguments: JSON.stringify(toolArgs),
            },
          ],
        };

        return {
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: toolName,
              arguments: JSON.stringify(toolArgs),
            },
          ],
          finishReason: "tool_calls" as const,
          usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
        };
      }

      yield { delta: followUpResponse };

      return {
        content: followUpResponse,
        finishReason: "stop" as const,
        usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
      };
    },
    getAvailableModels: () => ["mock-model"],
    isModelAvailable: () => true,
  };
}

/**
 * 创建 mock LLM，总是抛出错误
 */
export function createFailingLLM(errorMessage: string): LLMProviderPort {
  return {
    async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
      throw new Error(errorMessage);
    },
    getAvailableModels: () => [],
    isModelAvailable: () => false,
  };
}

/**
 * 创建慢 mock LLM，通过回调控制何时返回
 */
export function createSlowLLM(): {
  llm: LLMProviderPort;
  resolve: () => void;
} {
  let resolveFirst: (() => void) | null = null;

  const llm: LLMProviderPort = {
    async *stream(): AsyncGenerator<LLMStreamChunk, LLMResponse, unknown> {
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      yield { delta: "done" };
      return {
        content: "done",
        finishReason: "stop" as const,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
    getAvailableModels: () => ["mock"],
    isModelAvailable: () => true,
  };

  return {
    llm,
    get resolve() {
      return () => resolveFirst?.();
    },
  };
}

// ============================================
// Event Collector
// ============================================

/**
 * 收集 AsyncGenerator 的所有事件和返回值
 */
export async function collectEvents(
  gen: AsyncGenerator<AgentEvent, unknown, unknown>,
): Promise<{ events: AgentEvent[]; result: unknown }> {
  const events: AgentEvent[] = [];
  let iter = await gen.next();
  while (!iter.done) {
    events.push(iter.value);
    iter = await gen.next();
  }
  return { events, result: iter.value };
}

// ============================================
// Test Constants
// ============================================

export const DEFAULT_INPUT: AgentInput = {
  userMessage: "你好，请问你是谁？",
  activatedSkills: [],
  recalledMemories: [],
  conversationHistory: [],
  mentalModel: {
    mood: { pleasure: 0, arousal: 0, dominance: 0 },
    activeEmotions: [],
    relationshipStage: 1,
    relationshipDescription: "初次见面",
    formattedText: "[mood: neutral]",
  },
};

export const DEFAULT_CONFIG: AgentConfig = {
  mode: "conversation",
  maxIterations: 25,
  timeout: 30000,
  sessionId: "e2e-session-1",
  userId: "e2e-user-1",
  isSubAgent: false,
  debugEnabled: false,
};

// ============================================
// Test Config Directory
// ============================================

/** 创建测试配置目录结构的返回值 */
export interface TestConfigDirs {
  readonly tempDir: string;
  readonly configDir: string;
  readonly personasDir: string;
}

/**
 * 创建完整的测试配置目录（platform.yaml + permissions.yaml + models.yaml）
 */
export function createTestConfigDir(prefix: string): TestConfigDirs {
  const tempDir = mkdtempSync(join(tmpdir(), `kurisu-${prefix}-`));
  const configDir = join(tempDir, "config");
  const personasDir = join(configDir, "personas");

  mkdirSync(join(configDir, "system"), { recursive: true });

  writeFileSync(
    join(configDir, "system", "platform.yaml"),
    `
storage:
  dataDir: ${join(tempDir, "data")}
  qdrant:
    host: localhost
    port: 6333
scheduler:
  evolutionInterval: 86400000
  heartbeatCheckInterval: 3600000
  ileDecayInterval: 1800000
  telemetryCleanupCron: "0 3 * * *"
context:
  safetyMargin: 0.2
  tokenEstimateDivisor: 3
  maxIterations: 25
executor:
  type: docker
  docker:
    image: kurisu-sandbox:latest
    memoryLimit: "512m"
    cpuLimit: "1.0"
    networkMode: none
    timeout: 30000
skills:
  autoLoad: false
`,
  );

  writeFileSync(
    join(configDir, "system", "permissions.yaml"),
    `
version: "1.0"
defaultLevel: confirm
tools:
  safe:
    - test-tool
  confirm: []
  deny: []
paths:
  deny: []
  confirm: []
  allow: []
shell:
  denyPatterns: []
  confirmPatterns: []
`,
  );

  writeFileSync(
    join(configDir, "models.yaml"),
    `
models:
  - id: test-model
    name: Test Model
    provider: test
    model: test-v1
    endpoint: https://test.example.com/api
    secretRef: zhipuApiKey
    capabilities:
      - chat
defaults:
  conversation: test-model
  embedding: test-model
`,
  );

  return { tempDir, configDir, personasDir };
}

/**
 * 创建 kurisu 角色配置
 */
export function createKurisuPersona(personasDir: string): void {
  const roleDir = join(personasDir, "kurisu");
  mkdirSync(roleDir, { recursive: true });

  writeFileSync(
    join(roleDir, "soul.md"),
    `# Kurisu

I am Makise Kurisu, a genius neuroscientist.
I maintain a tsundere personality while being deeply analytical.
`,
  );

  writeFileSync(
    join(roleDir, "persona.yaml"),
    `
speech:
  catchphrases:
    - "哼，这种事情我当然知道"
    - "别、别误会了"
  patterns:
    greeting:
      - "呐...有什么事吗"
  tone:
    default: "tsundere"
behavior:
  tendencies:
    - analytical
    - tsundere
  reactions:
    error: "这...不可能吧"
    success: "哼，理所当然的结果"
formatting:
  useEllipsis: true
  useDash: true
`,
  );

  writeFileSync(
    join(roleDir, "lore.md"),
    `# Kurisu Lore

<!-- core -->
Makise Kurisu is a member of the Future Gadget Lab.
She specializes in neuroscience and time travel theory.
<!-- /core -->

## Extended Background

Additional background information.
`,
  );
}

/**
 * 创建 minimal 角色配置（用于冒烟测试）
 */
export function createMinimalPersona(personasDir: string): void {
  const roleDir = join(personasDir, "minimal");
  mkdirSync(roleDir, { recursive: true });
  writeFileSync(join(roleDir, "soul.md"), "# Minimal\nI am a minimal test agent.");
  writeFileSync(
    join(roleDir, "persona.yaml"),
    `
speech:
  catchphrases: []
  patterns: {}
  tone:
    default: "neutral"
behavior:
  tendencies: []
  reactions: {}
formatting:
  useEllipsis: false
  useDash: false
`,
  );
  writeFileSync(
    join(roleDir, "lore.md"),
    "# Lore\n<!-- core -->\nMinimal lore.\n<!-- /core -->",
  );
}

/**
 * 清理测试目录
 */
export function cleanupTestDir(tempDir: string): void {
  rmSync(tempDir, { recursive: true, force: true });
}
