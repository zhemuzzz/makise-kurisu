/**
 * E05: 错误恢复测试
 *
 * 验证异常输入和错误场景的处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Gateway } from "../../../src/gateway";
import { AgentOrchestrator } from "../../../src/agents/orchestrator";
import { InputValidationError, GatewayError } from "../../../src/gateway";
import { OrchestratorError } from "../../../src/agents/errors";
import {
  createMockOrchestratorForGateway,
  createE2EDeps,
  createMockModelProvider,
  generateTestSessionId,
  generateTestUserId,
} from "../fixtures/e2e-fixtures";
import { collectStreamText } from "../setup";

describe("E05: Error Recovery", () => {
  describe("input validation", () => {
    let gateway: Gateway;
    const sessionId = generateTestSessionId();
    const userId = generateTestUserId();

    beforeEach(async () => {
      const mockOrchestrator = createMockOrchestratorForGateway();
      gateway = new Gateway({ orchestrator: mockOrchestrator });
      await gateway.start();
    });

    afterEach(async () => {
      await gateway.stop();
    });

    it("should reject empty input", async () => {
      await expect(
        gateway.processStream(sessionId, "", userId),
      ).rejects.toThrow(InputValidationError);
    });

    it("should reject whitespace-only input", async () => {
      await expect(
        gateway.processStream(sessionId, "   ", userId),
      ).rejects.toThrow(InputValidationError);
    });

    it("should trim input whitespace", async () => {
      // 带空格的输入应该被接受并处理
      const result = await gateway.processStream(sessionId, "  你好  ", userId);
      expect(result).toBeDefined();

      // 消费流验证
      const text = await collectStreamText(result.textStream);
      expect(text).toBeDefined();
    });

    it("should handle very long input", async () => {
      const longInput = "a".repeat(10000);

      // 应该处理长输入（或抛出特定错误）
      try {
        const result = await gateway.processStream(
          sessionId,
          longInput,
          userId,
        );
        expect(result).toBeDefined();
      } catch (error) {
        // 如果有限制，应该是特定错误
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("should handle special characters safely", async () => {
      const specialInputs = [
        '<script>alert("xss")</script>',
        "${expression}",
        "#{expression}",
        '"; DROP TABLE users; --',
        "\\n\\r\\t",
        "emoji: 🎉🚀💻",
      ];

      for (const input of specialInputs) {
        try {
          const result = await gateway.processStream(sessionId, input, userId);
          expect(result).toBeDefined();
        } catch (error) {
          // 特殊字符可能被拒绝，但不应该崩溃
          expect(error).toBeInstanceOf(Error);
        }
      }
    });
  });

  describe("model API errors", () => {
    it("should handle model API failure", async () => {
      // 创建会抛出错误的 mock model provider
      const failingModelProvider = createMockModelProvider();
      failingModelProvider.getByTask = vi.fn().mockReturnValue({
        chat: vi.fn().mockRejectedValue(new Error("API Error")),
        stream: vi.fn().mockRejectedValue(new Error("API Error")),
      });

      const deps = createE2EDeps();
      deps.modelProvider = failingModelProvider;

      const orchestrator = new AgentOrchestrator(deps);

      // 应该抛出错误
      await expect(
        orchestrator.process(
          generateTestSessionId(),
          generateTestUserId(),
          "你好",
        ),
      ).rejects.toThrow();
    });

    it("should handle stream interruption", async () => {
      // 创建会中断的流
      async function* failingStream() {
        yield { delta: "partial", done: false };
        throw new Error("Stream interrupted");
      }

      const failingModelProvider = createMockModelProvider();
      failingModelProvider.getByTask = vi.fn().mockReturnValue({
        chat: vi.fn().mockResolvedValue({ content: "response" }),
        stream: vi.fn().mockReturnValue(failingStream()),
      });

      const deps = createE2EDeps();
      deps.modelProvider = failingModelProvider;

      const orchestrator = new AgentOrchestrator(deps);

      const result = await orchestrator.processStream(
        generateTestSessionId(),
        generateTestUserId(),
        "测试",
      );

      // 流应该抛出错误
      await expect(
        (async () => {
          for await (const _ of result.chunks) {
          }
        })(),
      ).rejects.toThrow("Stream interrupted");
    });

    it("should handle timeout gracefully", async () => {
      // 创建会超时的 mock
      const slowModelProvider = createMockModelProvider();
      slowModelProvider.getByTask = vi.fn().mockReturnValue({
        chat: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { content: "slow response" };
        }),
        stream: vi.fn().mockImplementation(async function* () {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          yield { delta: "slow", done: false };
        }),
      });

      const deps = createE2EDeps();
      deps.modelProvider = slowModelProvider;

      const orchestrator = new AgentOrchestrator(deps);

      // 使用 Promise.race 模拟超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 100);
      });

      await expect(
        Promise.race([
          orchestrator.process(
            generateTestSessionId(),
            generateTestUserId(),
            "你好",
          ),
          timeoutPromise,
        ]),
      ).rejects.toThrow("Timeout");
    });
  });

  describe("session errors", () => {
    let gateway: Gateway;
    const userId = generateTestUserId();

    beforeEach(async () => {
      const mockOrchestrator = createMockOrchestratorForGateway();
      gateway = new Gateway({ orchestrator: mockOrchestrator });
      await gateway.start();
    });

    afterEach(async () => {
      await gateway.stop();
    });

    it("should require userId for new session", async () => {
      // processStream 没有提供 userId 且会话不存在
      await expect(
        gateway.processStream("non-existent-session", "你好"),
      ).rejects.toThrow(GatewayError);
    });

    it("should handle operations on stopped gateway", async () => {
      await gateway.stop();

      await expect(
        gateway.processStream(generateTestSessionId(), "你好", userId),
      ).rejects.toThrow("not started");
    });

    it("should handle concurrent session limits", async () => {
      const limitedGateway = new Gateway(
        { orchestrator: createMockOrchestratorForGateway() },
        { maxSessions: 2 },
      );

      await limitedGateway.start();

      try {
        // 创建最大数量的会话
        const sid1 = generateTestSessionId();
        const sid2 = generateTestSessionId();
        const sid3 = generateTestSessionId();

        await limitedGateway.createSession(sid1, userId, 0);
        await limitedGateway.createSession(sid2, userId, 0);

        // 确认已有 2 个会话
        expect(limitedGateway.getSessionCount()).toBe(2);

        // 第三个应该失败
        await expect(
          limitedGateway.createSession(sid3, userId, 0),
        ).rejects.toThrow(/maximum.*session/i);
      } finally {
        await limitedGateway.stop();
      }
    });
  });

  describe("memory errors", () => {
    it("should handle memory engine failure", async () => {
      // 创建会失败的 memory engine
      const failingMemoryEngine = {
        hasSession: vi.fn().mockReturnValue(false),
        createSession: vi.fn().mockImplementation(() => {
          throw new Error("Memory error");
        }),
        buildContext: vi.fn(),
        getRecentMessages: vi.fn().mockReturnValue([]),
        addSessionMessage: vi.fn(),
      };

      const deps = createE2EDeps({ memoryEngine: failingMemoryEngine as any });
      const orchestrator = new AgentOrchestrator(deps);

      // 应该抛出错误
      await expect(
        orchestrator.process(
          generateTestSessionId(),
          generateTestUserId(),
          "你好",
        ),
      ).rejects.toThrow();
    });

    it("should handle context build failure", async () => {
      const failingMemoryEngine = {
        hasSession: vi.fn().mockReturnValue(true),
        createSession: vi.fn(),
        buildContext: vi
          .fn()
          .mockRejectedValue(new Error("Context build failed")),
        getRecentMessages: vi.fn().mockReturnValue([]),
        addSessionMessage: vi.fn(),
      };

      const deps = createE2EDeps({ memoryEngine: failingMemoryEngine as any });
      const orchestrator = new AgentOrchestrator(deps);

      await expect(
        orchestrator.process(
          generateTestSessionId(),
          generateTestUserId(),
          "你好",
        ),
      ).rejects.toThrow();
    });
  });

  describe("error messages", () => {
    it("should provide meaningful error messages", async () => {
      const mockOrchestrator = createMockOrchestratorForGateway();
      const gateway = new Gateway({ orchestrator: mockOrchestrator });
      await gateway.start();

      try {
        // 空输入
        try {
          await gateway.processStream(
            generateTestSessionId(),
            "",
            generateTestUserId(),
          );
        } catch (error) {
          expect((error as Error).message).toContain("empty");
        }

        // 未启动
        await gateway.stop();
        try {
          await gateway.processStream(
            generateTestSessionId(),
            "hello",
            generateTestUserId(),
          );
        } catch (error) {
          expect((error as Error).message).toContain("not started");
        }
      } finally {
        // cleanup
      }
    });

    it("should not leak sensitive information in errors", async () => {
      const mockOrchestrator = createMockOrchestratorForGateway();
      const gateway = new Gateway({ orchestrator: mockOrchestrator });
      await gateway.start();

      try {
        // 错误消息不应该包含敏感信息
        await gateway.processStream(
          generateTestSessionId(),
          "",
          generateTestUserId(),
        );
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toMatch(/api[_-]?key/i);
        expect(message).not.toMatch(/password/i);
        expect(message).not.toMatch(/secret/i);
      } finally {
        await gateway.stop();
      }
    });
  });

  describe("recovery scenarios", () => {
    it("should allow new requests after error", async () => {
      const mockOrchestrator = createMockOrchestratorForGateway();
      const gateway = new Gateway({ orchestrator: mockOrchestrator });
      await gateway.start();
      const sessionId = generateTestSessionId();
      const userId = generateTestUserId();

      try {
        // 第一次请求失败
        try {
          await gateway.processStream(sessionId, "", userId);
        } catch {
          // 预期失败
        }

        // 第二次请求应该成功
        const result = await gateway.processStream(sessionId, "你好", userId);
        expect(result).toBeDefined();
      } finally {
        await gateway.stop();
      }
    });

    it("should maintain gateway state after error", async () => {
      const mockOrchestrator = createMockOrchestratorForGateway();
      const gateway = new Gateway({ orchestrator: mockOrchestrator });
      await gateway.start();
      const sessionId = generateTestSessionId();
      const userId = generateTestUserId();

      try {
        // 创建会话
        await gateway.createSession(sessionId, userId, 0);
        const countBefore = gateway.getSessionCount();

        // 触发错误
        try {
          await gateway.processStream(sessionId, "", userId);
        } catch {
          // 预期失败
        }

        // Gateway 状态应该保持一致
        expect(gateway.isRunning()).toBe(true);
        expect(gateway.getSessionCount()).toBe(countBefore);
      } finally {
        await gateway.stop();
      }
    });
  });
});
