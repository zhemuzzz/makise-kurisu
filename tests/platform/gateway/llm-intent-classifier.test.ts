/**
 * LLM 意图分类器测试
 *
 * KURISU-024: LLM 意图分类器（测试先行 - RED 阶段）
 *
 * 测试场景:
 * 1. 短路条件（消息过短、禁用、无注册意图）
 * 2. 置信度阈值
 * 3. 自然语言变体识别
 * 4. 缓存
 * 5. 错误降级
 * 6. 与 Registry 集成
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  IModelProvider,
  IModel,
  ChatResponse,
} from "../../../src/platform/models/types";

// ===========================================
// 类型定义（与实现文件一致）
// ===========================================

/**
 * LLM 意图分类结果
 */
export interface LLMIntentClassificationResult {
  /** 是否识别到意图 */
  readonly isIntent: boolean;
  /** 置信度 (0-1) */
  readonly confidence: number;
  /** 意图类型（如 "delete_confirm", "change_permission"） */
  readonly intentType?: string;
  /** 操作类型（如 "enable", "disable", "upgrade"） */
  readonly action?: string;
  /** 目标值（如目标权限级别） */
  readonly targetValue?: string;
  /** 推理过程（LLM 的解释） */
  readonly reasoning?: string;
}

/**
 * LLM 意图分类器配置
 */
export interface LLMIntentClassifierConfig {
  /** 模型提供者 */
  readonly modelProvider: IModelProvider;
  /** 置信度阈值（默认 0.7） */
  readonly confidenceThreshold?: number;
  /** 最小输入长度（默认 6） */
  readonly minInputLength?: number;
  /** 是否启用（默认 true） */
  readonly enabled?: boolean;
  /** 超时时间（默认 3000ms） */
  readonly timeout?: number;
  /** 缓存 TTL（默认 60000ms） */
  readonly cacheTTL?: number;
}

/**
 * 意图元数据
 */
export interface IntentMetadata {
  /** 意图类型标识 */
  readonly type: string;
  /** 描述 */
  readonly description: string;
  /** 可用操作列表 */
  readonly actions?: readonly string[];
  /** 示例输入 */
  readonly examples: readonly string[];
}

// ===========================================
// Mock 工厂函数
// ===========================================

/**
 * 创建 Mock IModel
 */
function createMockModel(overrides: Partial<IModel> = {}): IModel {
  return {
    name: "test-model",
    type: "cloud",
    provider: "test",
    chat: vi.fn(
      async () =>
        ({
          content: JSON.stringify({
            isIntent: false,
            confidence: 0,
          }),
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          model: "test-model",
          latency: 100,
        }) as ChatResponse,
    ),
    stream: vi.fn(async function* () {
      yield { content: "", done: false };
      yield { content: "", done: true };
    }),
    supportsStreaming: vi.fn(() => true),
    supportsVision: vi.fn(() => false),
    supportsFunctionCalling: vi.fn(() => true),
    estimateCost: vi.fn(() => 0.001),
    getAverageLatency: vi.fn(() => 100),
    ...overrides,
  };
}

/**
 * 创建 Mock IModelProvider
 */
function createMockModelProvider(model?: IModel): IModelProvider {
  const mockModel = model ?? createMockModel();
  return {
    get: vi.fn(() => mockModel),
    getByCapability: vi.fn(() => mockModel),
    getByTask: vi.fn(() => mockModel),
    registerModel: vi.fn(),
    setDefaultModel: vi.fn(),
    listModels: vi.fn(() => [
      { name: "test-model", type: "cloud", provider: "test" },
    ]),
    healthCheck: vi.fn(async () => new Map([["test-model", true]])),
  };
}

/**
 * 创建 Mock LLM 响应
 */
function createMockLLMResponse(
  isIntent: boolean,
  confidence: number,
  overrides: Partial<LLMIntentClassificationResult> = {},
): ChatResponse {
  return {
    content: JSON.stringify({
      isIntent,
      confidence,
      ...overrides,
    }),
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    model: "test-model",
    latency: 100,
  };
}

// ===========================================
// 测试套件
// ===========================================

describe("LLMIntentClassifier", () => {
  // 这些导入会在实现文件创建后生效
  // 目前测试应该 FAIL，因为实现文件不存在
  let LLMIntentClassifier: typeof import("../../../src/platform/gateway/llm-intent-classifier").LLMIntentClassifier;
  let createLLMIntentClassifier: typeof import("../../../src/platform/gateway/llm-intent-classifier").createLLMIntentClassifier;

  beforeAll(async () => {
    // 尝试导入实现模块（预期会失败，因为还未实现）
    try {
      const module = await import("../../../src/platform/gateway/llm-intent-classifier");
      LLMIntentClassifier = module.LLMIntentClassifier;
      createLLMIntentClassifier = module.createLLMIntentClassifier;
    } catch {
      // 模块不存在，测试会 FAIL，这是预期的 RED 阶段行为
    }
  });

  // ===========================================
  // 1. 短路条件测试
  // ===========================================

  describe("Short-circuit conditions", () => {
    it("should skip LLM for input shorter than minInputLength (default 6)", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      // 短输入（< 6 字符）
      const result = await classifier.classify("删");

      expect(result.isIntent).toBe(false);
      expect(result.confidence).toBe(0);
      // LLM 不应该被调用
      expect(mockProvider.get).not.toHaveBeenCalled();
    });

    it("should skip LLM for empty input", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      const result = await classifier.classify("");

      expect(result.isIntent).toBe(false);
      expect(mockProvider.get).not.toHaveBeenCalled();
    });

    it("should skip LLM when classifier is disabled", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        enabled: false,
      });

      // 注册意图
      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        actions: ["enable", "disable"],
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("以后删东西不用问我了");

      expect(result.isIntent).toBe(false);
      expect(mockProvider.get).not.toHaveBeenCalled();
    });

    it("should skip LLM when no intents are registered", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      // 不注册任何意图
      const result = await classifier.classify("关闭删除确认");

      expect(result.isIntent).toBe(false);
      expect(mockProvider.get).not.toHaveBeenCalled();
    });

    it("should use custom minInputLength when provided", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        minInputLength: 3,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["删除确认"],
      });

      // 3 字符输入，满足自定义阈值
      const result = await classifier.classify("删文件");

      // LLM 应该被调用（因为输入长度 >= 3）
      // 注意：这里可能返回 isIntent: false，但关键是 LLM 被调用了
      // 由于是 mock，我们检查模型是否被调用（通过 getByCapability）
      expect(mockProvider.getByCapability).toHaveBeenCalled();
    });
  });

  // ===========================================
  // 2. 置信度阈值测试
  // ===========================================

  describe("Confidence threshold", () => {
    it("should return isIntent: false when confidence below threshold (default 0.7)", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.5, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("可能不想确认");

      expect(result.isIntent).toBe(false);
      expect(result.confidence).toBe(0.5);
    });

    it("should return isIntent: true when confidence equals threshold", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.7, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        confidenceThreshold: 0.7,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("关闭删除确认");

      expect(result.isIntent).toBe(true);
      expect(result.confidence).toBe(0.7);
      expect(result.intentType).toBe("delete_confirm");
      expect(result.action).toBe("disable");
    });

    it("should return isIntent: true when confidence above threshold", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.95, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("以后删除文件不用确认了");

      expect(result.isIntent).toBe(true);
      expect(result.confidence).toBe(0.95);
    });

    it("should use custom confidence threshold", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.6, {
            intentType: "delete_confirm",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        confidenceThreshold: 0.5,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("关闭删除确认");

      expect(result.isIntent).toBe(true);
      expect(result.confidence).toBe(0.6);
    });
  });

  // ===========================================
  // 3. 自然语言变体识别测试
  // ===========================================

  describe("Natural language variant recognition", () => {
    let classifier: InstanceType<typeof LLMIntentClassifier>;
    let mockModel: IModel;

    beforeEach(() => {
      mockModel = createMockModel();
      const mockProvider = createMockModelProvider(mockModel);
      classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "控制删除文件时是否需要用户确认",
        actions: ["enable", "disable"],
        examples: ["关闭删除确认", "删除文件不用问我", "开启删除确认"],
      });
    });

    describe("Disable delete confirmation variants", () => {
      it('should recognize "以后删东西不用问我了" as disable intent', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "disable",
            reasoning: "用户明确表示删除操作不需要询问",
          }),
        );

        const result = await classifier.classify("以后删东西不用问我了");

        expect(result.isIntent).toBe(true);
        expect(result.intentType).toBe("delete_confirm");
        expect(result.action).toBe("disable");
      });

      it('should recognize "删除直接干" as disable intent', async () => {
        // 注意："删除直接干" 是 5 字符，需要自定义 minInputLength
        const localMockModel = createMockModel({
          chat: vi.fn(async () =>
            createMockLLMResponse(true, 0.85, {
              intentType: "delete_confirm",
              action: "disable",
              reasoning: "用户希望删除操作直接执行",
            }),
          ),
        });
        const localMockProvider = createMockModelProvider(localMockModel);
        const localClassifier = createLLMIntentClassifier({
          modelProvider: localMockProvider,
          minInputLength: 3, // 允许更短的输入
        });

        localClassifier.registerIntent({
          type: "delete_confirm",
          description: "控制删除文件时是否需要用户确认",
          actions: ["enable", "disable"],
          examples: ["关闭删除确认", "删除文件不用问我"],
        });

        const result = await localClassifier.classify("删除直接干");

        expect(result.isIntent).toBe(true);
        expect(result.action).toBe("disable");
      });

      it('should recognize "不要在删除文件前确认了" as disable intent', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(true, 0.88, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        );

        const result = await classifier.classify("不要在删除文件前确认了");

        expect(result.isIntent).toBe(true);
        expect(result.action).toBe("disable");
      });

      it('should recognize "删文件别问我" as disable intent', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(true, 0.92, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        );

        const result = await classifier.classify("删文件别问我");

        expect(result.isIntent).toBe(true);
        expect(result.action).toBe("disable");
      });
    });

    describe("Enable delete confirmation variants", () => {
      it('should recognize "开启删除确认" as enable intent', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(true, 0.95, {
            intentType: "delete_confirm",
            action: "enable",
            reasoning: "用户希望恢复删除确认功能",
          }),
        );

        const result = await classifier.classify("开启删除确认");

        expect(result.isIntent).toBe(true);
        expect(result.intentType).toBe("delete_confirm");
        expect(result.action).toBe("enable");
      });

      it('should recognize "删除文件时要问我一下" as enable intent', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(true, 0.87, {
            intentType: "delete_confirm",
            action: "enable",
          }),
        );

        const result = await classifier.classify("删除文件时要问我一下");

        expect(result.isIntent).toBe(true);
        expect(result.action).toBe("enable");
      });

      it('should recognize "恢复删除确认" as enable intent', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(true, 0.93, {
            intentType: "delete_confirm",
            action: "enable",
          }),
        );

        const result = await classifier.classify("恢复删除确认");

        expect(result.isIntent).toBe(true);
        expect(result.action).toBe("enable");
      });
    });

    describe("Ambiguous inputs", () => {
      it('should return low confidence for ambiguous input "删除"', async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(false, 0.3, {
            reasoning: "输入太短，无法确定意图",
          }),
        );

        const result = await classifier.classify("删除");

        // 短于默认 minInputLength(6)，不会调用 LLM
        expect(result.isIntent).toBe(false);
      });

      it("should return low confidence for unrelated input", async () => {
        mockModel.chat = vi.fn(async () =>
          createMockLLMResponse(false, 0.2, {
            reasoning: "与删除确认无关的输入",
          }),
        );

        const result = await classifier.classify("今天天气怎么样");

        expect(result.isIntent).toBe(false);
        expect(result.confidence).toBeLessThan(0.5);
      });
    });
  });

  // ===========================================
  // 4. 缓存测试
  // ===========================================

  describe("Caching", () => {
    it("should cache results for identical inputs", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      // 第一次调用
      const result1 = await classifier.classify("以后删除不用问我了");
      // 第二次相同输入
      const result2 = await classifier.classify("以后删除不用问我了");

      expect(result1).toEqual(result2);
      // LLM 只应该被调用一次（第二次使用缓存）
      expect(mockModel.chat).toHaveBeenCalledTimes(1);
    });

    it("should not use cache for different inputs", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async (messages) => {
          const userMessage = messages.find((m) => m.role === "user");
          if (
            userMessage &&
            "content" in userMessage &&
            userMessage.content.includes("关闭")
          ) {
            return createMockLLMResponse(true, 0.9, {
              intentType: "delete_confirm",
              action: "disable",
            });
          }
          return createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "enable",
          });
        }),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      await classifier.classify("关闭删除确认");
      await classifier.classify("开启删除确认");

      // 两个不同的输入，应该调用两次 LLM
      expect(mockModel.chat).toHaveBeenCalledTimes(2);
    });

    it("should expire cache after cacheTTL", async () => {
      vi.useFakeTimers();

      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        cacheTTL: 1000, // 1 秒
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      // 第一次调用
      await classifier.classify("以后删除不用问我了");
      expect(mockModel.chat).toHaveBeenCalledTimes(1);

      // 时间前进 500ms（未过期）
      vi.advanceTimersByTime(500);
      await classifier.classify("以后删除不用问我了");
      expect(mockModel.chat).toHaveBeenCalledTimes(1); // 仍然使用缓存

      // 时间再前进 600ms（总共 1100ms，已过期）
      vi.advanceTimersByTime(600);
      await classifier.classify("以后删除不用问我了");
      expect(mockModel.chat).toHaveBeenCalledTimes(2); // 缓存过期，重新调用

      vi.useRealTimers();
    });

    it("should normalize input before caching", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      // 两个语义相同但格式不同的输入
      await classifier.classify("关闭删除确认");
      await classifier.classify("  关闭删除确认  "); // 带空格

      // 由于标准化后相同，应该使用缓存
      expect(mockModel.chat).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================
  // 5. 错误降级测试
  // ===========================================

  describe("Error degradation", () => {
    it("should return isIntent: false when LLM call fails", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () => {
          throw new Error("LLM service unavailable");
        }),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("关闭删除确认");

      expect(result.isIntent).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("should return isIntent: false on timeout", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () => {
          // 模拟超时
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
          });
        }),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        timeout: 100, // 100ms 超时
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("关闭删除确认");

      expect(result.isIntent).toBe(false);
    });

    it("should return isIntent: false when LLM returns invalid JSON", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(
          async () =>
            ({
              content: "not a valid json",
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              model: "test-model",
              latency: 100,
            }) as ChatResponse,
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("关闭删除确认");

      expect(result.isIntent).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it("should handle LLM returning missing required fields", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(
          async () =>
            ({
              content: JSON.stringify({ isIntent: true }), // 缺少 confidence
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              model: "test-model",
              latency: 100,
            }) as ChatResponse,
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("关闭删除确认");

      // 应该优雅降级，返回默认值
      expect(result.isIntent).toBe(false);
    });
  });

  // ===========================================
  // 6. 与 Registry 集成测试
  // ===========================================

  describe("Registry integration", () => {
    it("should call LLM when regex intent matching fails", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.85, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        actions: ["enable", "disable"],
        examples: ["关闭删除确认"],
      });

      // 这个输入可能不匹配正则，但 LLM 能理解
      const result = await classifier.classify("删文件的时候不用麻烦我确认了");

      expect(result.isIntent).toBe(true);
      expect(result.intentType).toBe("delete_confirm");
      expect(result.action).toBe("disable");
    });

    it("should support multiple intent types", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async (messages) => {
          const userMessage = messages.find((m) => m.role === "user");
          const content =
            userMessage && "content" in userMessage ? userMessage.content : "";

          if (content.includes("权限")) {
            return createMockLLMResponse(true, 0.9, {
              intentType: "change_permission",
              action: "upgrade",
              targetValue: "full_access",
            });
          }
          return createMockLLMResponse(true, 0.85, {
            intentType: "delete_confirm",
            action: "disable",
          });
        }),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier
        .registerIntent({
          type: "delete_confirm",
          description: "删除确认开关",
          examples: ["关闭删除确认"],
        })
        .registerIntent({
          type: "change_permission",
          description: "切换文件访问权限",
          actions: ["upgrade", "downgrade", "set"],
          examples: ["提升权限"],
        });

      const result1 = await classifier.classify("关闭删除确认");
      expect(result1.intentType).toBe("delete_confirm");

      const result2 = await classifier.classify("给我提升到最高权限");
      expect(result2.intentType).toBe("change_permission");
      expect(result2.action).toBe("upgrade");
      expect(result2.targetValue).toBe("full_access");
    });

    it("should register intent with examples", async () => {
      const mockModel = createMockModel();
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      const metadata: IntentMetadata = {
        type: "delete_confirm",
        description: "删除确认开关",
        actions: ["enable", "disable"],
        examples: ["关闭删除确认", "开启删除确认", "删除不用问我"],
      };

      // 应该支持链式调用
      const result = classifier.registerIntent(metadata);
      expect(result).toBe(classifier);
    });

    it("should include registered intents in LLM prompt", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async (messages) => {
          const systemMessage = messages.find((m) => m.role === "system");
          const content =
            systemMessage && "content" in systemMessage
              ? systemMessage.content
              : "";

          // 验证 prompt 中包含注册的意图信息
          expect(content).toContain("delete_confirm");
          expect(content).toContain("删除确认开关");

          return createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
          });
        }),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      await classifier.classify("关闭删除确认");

      expect(mockModel.chat).toHaveBeenCalled();
    });
  });

  // ===========================================
  // 7. 工厂函数测试
  // ===========================================

  describe("createLLMIntentClassifier factory", () => {
    it("should create classifier with default config", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      expect(classifier).toBeDefined();
      expect(classifier.registerIntent).toBeDefined();
      expect(classifier.classify).toBeDefined();
    });

    it("should create classifier with custom config", async () => {
      const mockProvider = createMockModelProvider();
      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
        confidenceThreshold: 0.8,
        minInputLength: 3,
        enabled: true,
        timeout: 5000,
        cacheTTL: 120000,
      });

      expect(classifier).toBeDefined();
    });

    it("should throw if modelProvider is missing", () => {
      expect(() =>
        createLLMIntentClassifier({} as LLMIntentClassifierConfig),
      ).toThrow();
    });
  });

  // ===========================================
  // 8. 边界情况测试
  // ===========================================

  describe("Edge cases", () => {
    it("should handle very long input", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(false, 0.1, {
            reasoning: "输入过长且与意图无关",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const longInput = "这是一段很长的文本，".repeat(100);
      const result = await classifier.classify(longInput);

      expect(result).toBeDefined();
      expect(typeof result.isIntent).toBe("boolean");
    });

    it("should handle special characters in input", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("删除不用确认！@#￥%……&*（）");

      expect(result.isIntent).toBe(true);
    });

    it("should handle Unicode emoji in input", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.85, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      const result = await classifier.classify("删文件不用问我啦 🗑️😊");

      expect(result.isIntent).toBe(true);
    });

    it("should handle concurrent classifications", async () => {
      const mockModel = createMockModel({
        chat: vi.fn(async () =>
          createMockLLMResponse(true, 0.9, {
            intentType: "delete_confirm",
            action: "disable",
          }),
        ),
      });
      const mockProvider = createMockModelProvider(mockModel);

      const classifier = createLLMIntentClassifier({
        modelProvider: mockProvider,
      });

      classifier.registerIntent({
        type: "delete_confirm",
        description: "删除确认开关",
        examples: ["关闭删除确认"],
      });

      // 并发 5 个分类请求
      const inputs = [
        "关闭删除确认",
        "开启删除确认",
        "删除不用问",
        "删除要确认",
        "不要删除确认",
      ];

      const results = await Promise.all(
        inputs.map((input) => classifier.classify(input)),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result).toBeDefined();
        expect(typeof result.isIntent).toBe("boolean");
      });
    });
  });
});
