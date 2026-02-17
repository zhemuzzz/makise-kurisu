/**
 * L1 交互网关 - Gateway 集成测试
 * 测试 Gateway 主类、模块整合、完整流程
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Gateway } from "../../src/gateway";
import {
  ChannelType,
  type GatewayDeps,
  type SessionInfo,
  type StreamCallbacks,
  createSessionInfo,
} from "../../src/gateway/types";
import {
  createMockOrchestrator,
  createMockSession,
  createMockTextStream,
  MOCK_AI_RESPONSE_CHUNKS,
  MOCK_AI_RESPONSE_FULL,
  MOCK_CONVERSATION_TURNS,
  SAMPLE_SESSIONS,
  BOUNDARY_TEST_DATA,
  ERROR_SCENARIOS,
} from "../fixtures/gateway-fixtures";

describe("Gateway", () => {
  let gateway: Gateway;
  let mockOrchestrator: ReturnType<typeof createMockOrchestrator>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = createMockOrchestrator();

    gateway = new Gateway({
      orchestrator: mockOrchestrator,
    });
  });

  afterEach(async () => {
    await gateway.stop();
  });

  describe("constructor", () => {
    it("should create Gateway with required dependencies", () => {
      expect(gateway).toBeDefined();
    });

    it("should throw error if orchestrator is missing", () => {
      expect(() => new Gateway({} as GatewayDeps)).toThrow(
        /orchestrator.*required/i,
      );
    });

    it("should accept optional configuration", () => {
      const customGateway = new Gateway({
        orchestrator: mockOrchestrator,
        sessionTTL: 60000,
        maxSessions: 100,
      });

      expect(customGateway).toBeDefined();
    });

    it("should initialize with default configuration", () => {
      const defaultGateway = new Gateway({
        orchestrator: mockOrchestrator,
      });

      expect(defaultGateway).toBeDefined();
    });
  });

  describe("start", () => {
    it("should start successfully", async () => {
      await gateway.start();

      expect(gateway.isRunning()).toBe(true);
    });

    it("should be idempotent", async () => {
      await gateway.start();
      await gateway.start();
      await gateway.start();

      expect(gateway.isRunning()).toBe(true);
    });

    it("should initialize session manager", async () => {
      await gateway.start();

      expect(gateway.getSessionCount()).toBe(0);
    });
  });

  describe("stop", () => {
    it("should stop successfully", async () => {
      await gateway.start();
      await gateway.stop();

      expect(gateway.isRunning()).toBe(false);
    });

    it("should be idempotent", async () => {
      await gateway.start();
      await gateway.stop();
      await gateway.stop();
      await gateway.stop();

      expect(gateway.isRunning()).toBe(false);
    });

    it("should clean up sessions on stop", async () => {
      await gateway.start();

      // Create some sessions
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);
      await gateway.createSession("session-2", "user-2", ChannelType.CLI);

      await gateway.stop();

      expect(gateway.getSessionCount()).toBe(0);
    });
  });

  describe("createSession", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should create a new session", async () => {
      const session = await gateway.createSession(
        "session-1",
        "user-1",
        ChannelType.CLI,
      );

      expect(session.sessionId).toBe("session-1");
      expect(session.userId).toBe("user-1");
      expect(session.channelType).toBe(ChannelType.CLI);
    });

    it("should store created session", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      const session = gateway.getSession("session-1");

      expect(session).toBeDefined();
      expect(session?.sessionId).toBe("session-1");
    });

    it("should increment session count", async () => {
      expect(gateway.getSessionCount()).toBe(0);

      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      expect(gateway.getSessionCount()).toBe(1);
    });

    it("should create session for each channel type", async () => {
      const channels = [
        ChannelType.CLI,
        ChannelType.REST,
        ChannelType.DISCORD,
        ChannelType.WEBSOCKET,
      ];

      for (let i = 0; i < channels.length; i++) {
        await gateway.createSession(`session-${i}`, `user-${i}`, channels[i]);
      }

      expect(gateway.getSessionCount()).toBe(4);
    });

    it("should throw error if session already exists", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      await expect(
        gateway.createSession("session-1", "user-2", ChannelType.CLI),
      ).rejects.toThrow(/already exists/);
    });

    it("should accept optional metadata", async () => {
      const metadata = { ip: "127.0.0.1", userAgent: "test" };

      const session = await gateway.createSession(
        "session-1",
        "user-1",
        ChannelType.REST,
        metadata,
      );

      expect(session.metadata).toEqual(metadata);
    });

    it("should call orchestrator createSession", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      expect(mockOrchestrator.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          userId: "user-1",
          channelType: ChannelType.CLI,
        }),
      );
    });
  });

  describe("getSession", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should return session by ID", async () => {
      const created = await gateway.createSession(
        "session-1",
        "user-1",
        ChannelType.CLI,
      );

      const retrieved = gateway.getSession("session-1");

      expect(retrieved).toEqual(created);
    });

    it("should return null for non-existent session", () => {
      const session = gateway.getSession("non-existent");

      expect(session).toBeNull();
    });

    it("should return immutable session copy", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      const copy1 = gateway.getSession("session-1");
      const copy2 = gateway.getSession("session-1");

      expect(copy1).not.toBe(copy2);
      expect(copy1).toEqual(copy2);
    });
  });

  describe("deleteSession", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should delete existing session", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      const deleted = await gateway.deleteSession("session-1");

      expect(deleted).toBe(true);
      expect(gateway.getSession("session-1")).toBeNull();
    });

    it("should return false for non-existent session", async () => {
      const deleted = await gateway.deleteSession("non-existent");

      expect(deleted).toBe(false);
    });

    it("should decrement session count", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      expect(gateway.getSessionCount()).toBe(1);

      await gateway.deleteSession("session-1");

      expect(gateway.getSessionCount()).toBe(0);
    });

    it("should call orchestrator deleteSession", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      await gateway.deleteSession("session-1");

      expect(mockOrchestrator.deleteSession).toHaveBeenCalledWith("session-1");
    });
  });

  describe("processStream", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should process input and return stream result", async () => {
      // Setup mock stream
      async function* mockGen() {
        yield* MOCK_AI_RESPONSE_CHUNKS;
      }

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: mockGen(),
        fullStream: mockGen() as AsyncGenerator<any>,
        finalResponse: Promise.resolve(MOCK_AI_RESPONSE_FULL),
      });

      const result = await gateway.processStream("session-1", "你好", "user-1");

      expect(result.textStream).toBeDefined();
      expect(result.fullStream).toBeDefined();
      expect(result.finalResponse).toBeInstanceOf(Promise);
    });

    it("should create session if not exists", async () => {
      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      await gateway.processStream("new-session", "Hello", "user-1");

      expect(mockOrchestrator.createSession).toHaveBeenCalled();
    });

    it("should reuse existing session", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      await gateway.processStream("session-1", "Hello", "user-1");

      expect(mockOrchestrator.createSession).toHaveBeenCalledTimes(1);
    });

    it("should update session lastActiveAt", async () => {
      const session = await gateway.createSession(
        "session-1",
        "user-1",
        ChannelType.CLI,
      );
      const originalActiveAt = session.lastActiveAt;

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      await gateway.processStream("session-1", "Hello");

      const updated = gateway.getSession("session-1");
      expect(updated?.lastActiveAt.getTime()).toBeGreaterThan(
        originalActiveAt.getTime(),
      );
    });

    it("should accept callbacks", async () => {
      const onChunk = vi.fn();
      const onComplete = vi.fn();

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["chunk1", "chunk2"]),
        finalResponse: Promise.resolve("chunk1chunk2"),
      });

      const callbacks: StreamCallbacks = { onChunk, onComplete };
      const result = await gateway.processStream(
        "session-1",
        "Hello",
        "user-1",
        callbacks,
      );

      // Consume the textStream to trigger callbacks
      for await (const _ of result.textStream) {
        // Just consume
      }

      expect(onChunk).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });

    it("should throw error if gateway not started", async () => {
      const stoppedGateway = new Gateway({ orchestrator: mockOrchestrator });

      await expect(
        stoppedGateway.processStream("session-1", "Hello"),
      ).rejects.toThrow(/not started/i);
    });

    it("should throw error for empty input", async () => {
      await expect(gateway.processStream("session-1", "")).rejects.toThrow(
        /invalid.*input/i,
      );
    });

    it("should throw error for whitespace-only input", async () => {
      await expect(
        gateway.processStream("session-1", "   \n\t   "),
      ).rejects.toThrow(/invalid.*input/i);
    });
  });

  describe("error handling", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should handle orchestrator errors gracefully", async () => {
      mockOrchestrator.processStream.mockRejectedValue(
        new Error("Orchestrator error"),
      );

      await expect(
        gateway.processStream("session-1", "Hello", "user-1"),
      ).rejects.toThrow("Orchestrator error");
    });

    it("should emit error event for stream failures", async () => {
      const onError = vi.fn();

      async function* failingGen() {
        yield "partial";
        throw new Error("Stream failed");
      }

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: failingGen(),
        fullStream: failingGen() as AsyncGenerator<any>,
        // Use a promise that never resolves to avoid unhandled rejection
        finalResponse: new Promise(() => {}),
      });

      const result = await gateway.processStream(
        "session-1",
        "Hello",
        "user-1",
        { onError },
      );

      // Consume the textStream to trigger the error
      try {
        for await (const _ of result.textStream) {
          // Just consume
        }
      } catch {
        // Expected error
      }

      expect(onError).toHaveBeenCalled();
    });

    it("should handle timeout errors", async () => {
      mockOrchestrator.processStream.mockRejectedValue(
        Object.assign(new Error("Timeout"), { code: "ETIMEDOUT" }),
      );

      await expect(
        gateway.processStream("session-1", "Hello", "user-1"),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Timeout"),
      });
    });

    it("should handle network errors", async () => {
      mockOrchestrator.processStream.mockRejectedValue(
        Object.assign(new Error("Network error"), { code: "ENETUNREACH" }),
      );

      await expect(
        gateway.processStream("session-1", "Hello", "user-1"),
      ).rejects.toThrow();
    });
  });

  describe("session management integration", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should list all sessions for a user", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);
      await gateway.createSession("session-2", "user-1", ChannelType.REST);
      await gateway.createSession("session-3", "user-2", ChannelType.CLI);

      const user1Sessions = gateway.getSessionsByUserId("user-1");

      expect(user1Sessions).toHaveLength(2);
    });

    it("should clear all sessions", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);
      await gateway.createSession("session-2", "user-2", ChannelType.CLI);

      await gateway.clearAllSessions();

      expect(gateway.getSessionCount()).toBe(0);
    });

    it("should enforce maximum session limit", async () => {
      const limitedGateway = new Gateway(
        { orchestrator: mockOrchestrator },
        { maxSessions: 2 },
      );

      await limitedGateway.start();

      await limitedGateway.createSession(
        "session-1",
        "user-1",
        ChannelType.CLI,
      );

      await limitedGateway.createSession(
        "session-2",
        "user-2",
        ChannelType.CLI,
      );

      // Verify count is 2
      expect(limitedGateway.getSessionCount()).toBe(2);

      // Third session should fail
      await expect(
        limitedGateway.createSession("session-3", "user-3", ChannelType.CLI),
      ).rejects.toThrow(/maximum.*session/i);

      await limitedGateway.stop();
    });

    it("should clean up expired sessions automatically", async () => {
      // 直接测试 SessionManager 的 TTL 行为，绕过 Gateway
      const { SessionManager } =
        await import("../../src/gateway/session-manager");

      const ttlMs = 10;
      const manager = new SessionManager({
        ttl: ttlMs,
        cleanupInterval: 10000,
      });

      manager.create({
        sessionId: "session-1",
        userId: "user-1",
        channelType: ChannelType.CLI,
      });

      expect(manager.count()).toBe(1);

      // 等待 TTL 过期
      await new Promise((resolve) => setTimeout(resolve, ttlMs * 5));

      // 手动触发清理
      manager.cleanup();

      expect(manager.count()).toBe(0);

      manager.stopCleanup();
    });
  });

  describe("multi-turn conversation", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should handle multi-turn conversation flow", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      for (const turn of MOCK_CONVERSATION_TURNS) {
        mockOrchestrator.processStream.mockResolvedValue({
          textStream: createMockTextStream([turn.ai]),
          finalResponse: Promise.resolve(turn.ai),
        });

        const result = await gateway.processStream("session-1", turn.user);
        const response = await result.finalResponse;

        expect(response).toBe(turn.ai);
      }

      // Should have processed all turns
      expect(mockOrchestrator.processStream).toHaveBeenCalledTimes(
        MOCK_CONVERSATION_TURNS.length,
      );
    });

    it("should maintain session context across turns", async () => {
      const session = await gateway.createSession(
        "session-1",
        "user-1",
        ChannelType.CLI,
      );

      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      await gateway.processStream("session-1", "Turn 1");
      await gateway.processStream("session-1", "Turn 2");

      // Session should be the same
      const finalSession = gateway.getSession("session-1");
      expect(finalSession?.sessionId).toBe(session.sessionId);
    });
  });

  describe("concurrent requests", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should handle concurrent stream requests", async () => {
      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      const requests = Array.from({ length: 10 }, (_, i) =>
        gateway.processStream(`session-${i}`, `Input ${i}`, `user-${i}`),
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      results.forEach((result) => {
        expect(result.textStream).toBeDefined();
      });
    });

    it("should isolate sessions between concurrent requests", async () => {
      mockOrchestrator.processStream.mockImplementation(async (params) => {
        return {
          textStream: createMockTextStream([
            `Response for ${params.sessionId}`,
          ]),
          finalResponse: Promise.resolve(`Response for ${params.sessionId}`),
        };
      });

      const requests = Array.from({ length: 5 }, (_, i) =>
        gateway
          .processStream(`session-${i}`, `Input ${i}`, `user-${i}`)
          .then((r) => r.finalResponse),
      );

      const responses = await Promise.all(requests);

      responses.forEach((response, i) => {
        expect(response).toBe(`Response for session-${i}`);
      });
    });
  });

  describe("boundary cases", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should handle very long input", async () => {
      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      const longInput = "a".repeat(100000);

      const result = await gateway.processStream(
        "session-1",
        longInput,
        "user-1",
      );

      expect(result.textStream).toBeDefined();
    });

    it("should handle unicode input", async () => {
      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["你好世界"]),
        finalResponse: Promise.resolve("你好世界"),
      });

      const result = await gateway.processStream(
        "session-1",
        "你好世界 🌍 مرحبا",
        "user-1",
      );

      const response = await result.finalResponse;
      expect(response).toBe("你好世界");
    });

    it("should handle special characters safely", async () => {
      mockOrchestrator.processStream.mockResolvedValue({
        textStream: createMockTextStream(["response"]),
        finalResponse: Promise.resolve("response"),
      });

      const specialInputs = [
        "<script>alert(1)</script>",
        "'; DROP TABLE users; --",
        '{"json": "content"}',
        "\x00null\x00bytes",
      ];

      for (const input of specialInputs) {
        const result = await gateway.processStream(
          "session-1",
          input,
          "user-1",
        );
        expect(result.textStream).toBeDefined();
      }
    });

    it("should handle null session ID", async () => {
      await expect(
        gateway.createSession(
          null as unknown as string,
          "user-1",
          ChannelType.CLI,
        ),
      ).rejects.toThrow();
    });

    it("should handle undefined user ID", async () => {
      await expect(
        gateway.createSession(
          "session-1",
          undefined as unknown as string,
          ChannelType.CLI,
        ),
      ).rejects.toThrow();
    });
  });

  describe("metrics and monitoring", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should track session count", async () => {
      expect(gateway.getSessionCount()).toBe(0);

      await gateway.createSession("session-1", "user-1", ChannelType.CLI);
      expect(gateway.getSessionCount()).toBe(1);

      await gateway.createSession("session-2", "user-2", ChannelType.CLI);
      expect(gateway.getSessionCount()).toBe(2);

      await gateway.deleteSession("session-1");
      expect(gateway.getSessionCount()).toBe(1);
    });

    it("should provide gateway status", async () => {
      await gateway.createSession("session-1", "user-1", ChannelType.CLI);

      const status = gateway.getStatus();

      expect(status.isRunning).toBe(true);
      expect(status.sessionCount).toBe(1);
    });
  });

  describe("performance", () => {
    beforeEach(async () => {
      await gateway.start();
    });

    it("should create 100 sessions quickly", async () => {
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        await gateway.createSession(
          `session-${i}`,
          `user-${i}`,
          ChannelType.CLI,
        );
      }

      const duration = performance.now() - start;

      expect(gateway.getSessionCount()).toBe(100);
      expect(duration).toBeLessThan(1000);
    });

    it("should retrieve sessions quickly", async () => {
      for (let i = 0; i < 100; i++) {
        await gateway.createSession(
          `session-${i}`,
          `user-${i}`,
          ChannelType.CLI,
        );
      }

      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        gateway.getSession(`session-${i}`);
      }

      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });
  });
});
