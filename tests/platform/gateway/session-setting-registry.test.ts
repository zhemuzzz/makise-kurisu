/**
 * SessionSettingRegistry 测试
 *
 * KURISU-024: 会话设置流水线重构
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SessionSettingRegistry,
  createSessionSettingRegistry,
  type SessionSettingHandler,
  type SessionSettingIntent,
  type SessionSettingHandleResult,
  type SessionSettingApprovalResult,
} from "../../../src/platform/gateway/session-setting-registry";

// ===========================================
// Mock Handler
// ===========================================

function createMockHandler(
  type: string,
  overrides: Partial<SessionSettingHandler> = {},
): SessionSettingHandler {
  return {
    type,
    detectIntent: vi.fn(() => ({
      isIntent: false,
      confidence: 0,
      originalInput: "",
    })),
    hasPending: vi.fn(() => false),
    handleIntent: vi.fn(async () => ({ handled: false })),
    handleApprovalReply: vi.fn(async () => ({ isApprovalReply: false })),
    ...overrides,
  };
}

// ===========================================
// Tests
// ===========================================

describe("SessionSettingRegistry", () => {
  let registry: SessionSettingRegistry;

  beforeEach(() => {
    registry = createSessionSettingRegistry();
  });

  describe("register", () => {
    it("should register a handler", () => {
      const handler = createMockHandler("test");
      registry.register(handler);

      expect(registry.has("test")).toBe(true);
      expect(registry.get("test")).toBe(handler);
    });

    it("should support chained registration", () => {
      const handler1 = createMockHandler("handler1");
      const handler2 = createMockHandler("handler2");

      registry.register(handler1).register(handler2);

      expect(registry.size).toBe(2);
    });

    it("should throw on duplicate type registration", () => {
      const handler1 = createMockHandler("duplicate");
      const handler2 = createMockHandler("duplicate");

      registry.register(handler1);

      expect(() => registry.register(handler2)).toThrow(
        'SessionSettingHandler type "duplicate" already registered',
      );
    });
  });

  describe("get", () => {
    it("should return handler if exists", () => {
      const handler = createMockHandler("exists");
      registry.register(handler);

      expect(registry.get("exists")).toBe(handler);
    });

    it("should return undefined if not exists", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all handlers in registration order", () => {
      const handler1 = createMockHandler("first");
      const handler2 = createMockHandler("second");
      const handler3 = createMockHandler("third");

      registry.register(handler1).register(handler2).register(handler3);

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all[0]).toBe(handler1);
      expect(all[1]).toBe(handler2);
      expect(all[2]).toBe(handler3);
    });

    it("should return empty array for empty registry", () => {
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("size", () => {
    it("should return correct count", () => {
      expect(registry.size).toBe(0);

      registry.register(createMockHandler("a"));
      expect(registry.size).toBe(1);

      registry.register(createMockHandler("b"));
      expect(registry.size).toBe(2);
    });
  });
});

describe("SessionSettingRegistry.processPipeline", () => {
  let registry: SessionSettingRegistry;

  beforeEach(() => {
    registry = createSessionSettingRegistry();
  });

  describe("pending approval handling", () => {
    it("should check pending approvals in registration order", async () => {
      const handler1 = createMockHandler("first", {
        hasPending: vi.fn(() => true),
        handleApprovalReply: vi.fn(
          async () =>
            ({
              isApprovalReply: true,
              approved: true,
              message: "Handler1 approved",
            }) as SessionSettingApprovalResult,
        ),
      });
      const handler2 = createMockHandler("second", {
        hasPending: vi.fn(() => true),
      });

      registry.register(handler1).register(handler2);

      const result = await registry.processPipeline("session1", "确认");

      expect(result.handled).toBe(true);
      expect(result.handlerType).toBe("first");
      expect(result.message).toBe("Handler1 approved");
      // handler2 should not be called since handler1 handled it
      expect(handler2.handleApprovalReply).not.toHaveBeenCalled();
    });

    it("should continue to next handler if not an approval reply", async () => {
      const handler1 = createMockHandler("first", {
        hasPending: vi.fn(() => true),
        handleApprovalReply: vi.fn(
          async () =>
            ({ isApprovalReply: false }) as SessionSettingApprovalResult,
        ),
      });
      const handler2 = createMockHandler("second", {
        hasPending: vi.fn(() => true),
        handleApprovalReply: vi.fn(
          async () =>
            ({
              isApprovalReply: true,
              approved: true,
              message: "Handler2 approved",
            }) as SessionSettingApprovalResult,
        ),
      });

      registry.register(handler1).register(handler2);

      const result = await registry.processPipeline("session1", "确认");

      expect(result.handled).toBe(true);
      expect(result.handlerType).toBe("second");
    });
  });

  describe("intent detection", () => {
    it("should detect intents in registration order", async () => {
      const handler1 = createMockHandler("first", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.9,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () =>
            ({
              handled: true,
              message: "Handler1 handled",
            }) as SessionSettingHandleResult,
        ),
      });
      const handler2 = createMockHandler("second");

      registry.register(handler1).register(handler2);

      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(true);
      expect(result.handlerType).toBe("first");
      expect(handler2.detectIntent).not.toHaveBeenCalled();
    });

    it("should skip handlers with low confidence", async () => {
      const handler1 = createMockHandler("first", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.3, // below 0.5 threshold
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
      });
      const handler2 = createMockHandler("second", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.8,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () =>
            ({
              handled: true,
              message: "Handler2 handled",
            }) as SessionSettingHandleResult,
        ),
      });

      registry.register(handler1).register(handler2);

      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(true);
      expect(result.handlerType).toBe("second");
      // handler1's handleIntent should not be called due to low confidence
      expect(handler1.handleIntent).not.toHaveBeenCalled();
    });

    it("should continue if handler returns handled: false", async () => {
      const handler1 = createMockHandler("first", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.9,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () => ({ handled: false }) as SessionSettingHandleResult,
        ),
      });
      const handler2 = createMockHandler("second", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.9,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () =>
            ({
              handled: true,
              message: "Handler2 handled",
            }) as SessionSettingHandleResult,
        ),
      });

      registry.register(handler1).register(handler2);

      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(true);
      expect(result.handlerType).toBe("second");
    });
  });

  describe("unhandled messages", () => {
    it("should return handled: false when no handler matches", async () => {
      const handler = createMockHandler("test", {
        detectIntent: vi.fn(() => ({
          isIntent: false,
          confidence: 0,
          originalInput: "",
        })),
        hasPending: vi.fn(() => false),
      });

      registry.register(handler);

      const result = await registry.processPipeline(
        "session1",
        "random message",
      );

      expect(result.handled).toBe(false);
    });

    it("should return handled: false for empty registry", async () => {
      const result = await registry.processPipeline("session1", "any message");

      expect(result.handled).toBe(false);
    });
  });

  describe("priority order", () => {
    it("should check pending approvals before intent detection", async () => {
      const handler = createMockHandler("test", {
        hasPending: vi.fn(() => true),
        handleApprovalReply: vi.fn(
          async () =>
            ({
              isApprovalReply: true,
              approved: true,
              message: "Approved",
            }) as SessionSettingApprovalResult,
        ),
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.9,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
      });

      registry.register(handler);

      const result = await registry.processPipeline("session1", "确认");

      expect(result.handled).toBe(true);
      // handleApprovalReply should be called (pending check)
      expect(handler.handleApprovalReply).toHaveBeenCalled();
      // detectIntent should also be called (it's called during intent phase)
      // but handleIntent should not since approval was handled first
    });
  });

  describe("requiresApproval flag", () => {
    it("should pass through requiresApproval from handler", async () => {
      const handler = createMockHandler("test", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.9,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () =>
            ({
              handled: true,
              requiresApproval: true,
              approvalMessage: "Please confirm",
              message: "Please confirm",
            }) as SessionSettingHandleResult,
        ),
      });

      registry.register(handler);

      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.requiresApproval).toBe(true);
        expect(result.approvalMessage).toBe("Please confirm");
      }
    });
  });

  // ===========================================
  // LLM Fallback Tests
  // ===========================================

  describe("LLM Fallback", () => {
    it("should use LLM classifier when regex fast-path fails", async () => {
      const registry = createSessionSettingRegistry();

      // 正则不匹配的意图
      const handler = createMockHandler("delete_confirm", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: false,
              confidence: 0,
              originalInput: "以后删东西不用问我了",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () =>
            ({
              handled: true,
              message: "已关闭删除确认",
            }) as SessionSettingHandleResult,
        ),
      });

      registry.register(handler);

      // 设置 LLM 分类器
      const mockLLMClassifier = {
        classify: vi.fn(async () => ({
          isIntent: true,
          confidence: 0.9,
          intentType: "delete_confirm",
          action: "disable",
        })),
      };

      registry.setLLMClassifier(mockLLMClassifier);

      const result = await registry.processPipeline(
        "session1",
        "以后删东西不用问我了",
      );

      expect(mockLLMClassifier.classify).toHaveBeenCalledWith(
        "以后删东西不用问我了",
      );
      expect(result.handled).toBe(true);
      if (result.handled) {
        expect(result.handlerType).toBe("delete_confirm");
      }
    });

    it("should not call LLM if regex fast-path succeeds", async () => {
      const registry = createSessionSettingRegistry();

      const handler = createMockHandler("delete_confirm", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: true,
              confidence: 0.9,
              originalInput: "关闭删除确认",
            }) as SessionSettingIntent,
        ),
        handleIntent: vi.fn(
          async () =>
            ({
              handled: true,
              message: "已关闭删除确认",
            }) as SessionSettingHandleResult,
        ),
      });

      registry.register(handler);

      const mockLLMClassifier = {
        classify: vi.fn(),
      };

      registry.setLLMClassifier(mockLLMClassifier);

      await registry.processPipeline("session1", "关闭删除确认");

      // 正则成功，不应调用 LLM
      expect(mockLLMClassifier.classify).not.toHaveBeenCalled();
    });

    it("should not call LLM if no classifier is set", async () => {
      const registry = createSessionSettingRegistry();

      const handler = createMockHandler("delete_confirm", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: false,
              confidence: 0,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
      });

      registry.register(handler);

      // 不设置 LLM 分类器
      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(false);
    });

    it("should ignore LLM result with low confidence", async () => {
      const registry = createSessionSettingRegistry();

      const handler = createMockHandler("delete_confirm", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: false,
              confidence: 0,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
      });

      registry.register(handler);

      const mockLLMClassifier = {
        classify: vi.fn(async () => ({
          isIntent: true,
          confidence: 0.5, // 低于阈值 0.7
          intentType: "delete_confirm",
        })),
      };

      registry.setLLMClassifier(mockLLMClassifier);

      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(false);
    });

    it("should gracefully handle LLM classifier errors", async () => {
      const registry = createSessionSettingRegistry();

      const handler = createMockHandler("delete_confirm", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: false,
              confidence: 0,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
      });

      registry.register(handler);

      const mockLLMClassifier = {
        classify: vi.fn(async () => {
          throw new Error("LLM service unavailable");
        }),
      };

      registry.setLLMClassifier(mockLLMClassifier);

      // LLM 失败应静默降级，不抛出错误
      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(false);
    });

    it("should ignore LLM result for unknown intent type", async () => {
      const registry = createSessionSettingRegistry();

      const handler = createMockHandler("delete_confirm", {
        detectIntent: vi.fn(
          () =>
            ({
              isIntent: false,
              confidence: 0,
              originalInput: "test",
            }) as SessionSettingIntent,
        ),
      });

      registry.register(handler);

      const mockLLMClassifier = {
        classify: vi.fn(async () => ({
          isIntent: true,
          confidence: 0.9,
          intentType: "unknown_intent", // 未注册的意图类型
        })),
      };

      registry.setLLMClassifier(mockLLMClassifier);

      const result = await registry.processPipeline("session1", "test");

      expect(result.handled).toBe(false);
    });

    it("should set and get LLM classifier", () => {
      const registry = createSessionSettingRegistry();

      const mockLLMClassifier = {
        classify: vi.fn(),
      };

      expect(registry.getLLMClassifier()).toBeNull();

      const result = registry.setLLMClassifier(mockLLMClassifier);

      expect(result).toBe(registry); // 链式调用
      expect(registry.getLLMClassifier()).toBe(mockLLMClassifier);
    });

    it("should clear LLM classifier by passing null", () => {
      const registry = createSessionSettingRegistry();

      const mockLLMClassifier = {
        classify: vi.fn(),
      };

      registry.setLLMClassifier(mockLLMClassifier);
      expect(registry.getLLMClassifier()).toBe(mockLLMClassifier);

      registry.setLLMClassifier(null);
      expect(registry.getLLMClassifier()).toBeNull();
    });
  });
});

describe("createSessionSettingRegistry", () => {
  it("should create a new registry instance", () => {
    const registry = createSessionSettingRegistry();
    expect(registry).toBeInstanceOf(SessionSettingRegistry);
    expect(registry.size).toBe(0);
  });
});
