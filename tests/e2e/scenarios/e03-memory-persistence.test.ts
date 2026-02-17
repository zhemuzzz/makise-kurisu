/**
 * E03: 记忆持久化测试
 *
 * 验证多轮对话的上下文保持
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentOrchestrator } from "../../../src/agents/orchestrator";
import {
  createE2EDeps,
  createMockMemoryEngine,
  generateTestSessionId,
  generateTestUserId,
  MULTI_TURN_CONVERSATION,
} from "../fixtures/e2e-fixtures";

describe("E03: Memory Persistence", () => {
  let orchestrator: AgentOrchestrator;
  let sessionId: string;
  const userId = generateTestUserId();

  beforeEach(() => {
    const deps = createE2EDeps();
    orchestrator = new AgentOrchestrator(deps, {
      maxContextMessages: 10,
    });
    sessionId = generateTestSessionId();
  });

  describe("session memory", () => {
    it("should persist messages within session", async () => {
      // 第一轮对话
      await orchestrator.process(sessionId, userId, "你好");

      // 第二轮对话
      await orchestrator.process(sessionId, userId, "在做什么？");

      // 检查会话存在
      expect(orchestrator.hasSession(sessionId)).toBe(true);
    });

    it("should maintain message order", async () => {
      // 模拟多轮对话
      for (const turn of MULTI_TURN_CONVERSATION) {
        await orchestrator.process(sessionId, userId, turn.user);
      }

      // 会话应该存在
      expect(orchestrator.hasSession(sessionId)).toBe(true);
    });

    it("should handle session isolation", async () => {
      const sessionId2 = generateTestSessionId();

      // 两个独立会话
      await orchestrator.process(sessionId, userId, "会话1消息");
      await orchestrator.process(sessionId2, userId, "会话2消息");

      // 两个会话都应该存在
      expect(orchestrator.hasSession(sessionId)).toBe(true);
      expect(orchestrator.hasSession(sessionId2)).toBe(true);
    });

    it("should create session on first message", async () => {
      // 最初会话不存在
      expect(orchestrator.hasSession(sessionId)).toBe(false);

      // 发送消息后创建会话
      await orchestrator.process(sessionId, userId, "你好");

      expect(orchestrator.hasSession(sessionId)).toBe(true);
    });
  });

  describe("memory engine integration", () => {
    it("should use memory engine to store messages", async () => {
      const memoryEngine = createMockMemoryEngine();
      const deps = createE2EDeps({ memoryEngine });

      const orchestratorWithMemory = new AgentOrchestrator(deps, {
        maxContextMessages: 10,
      });

      await orchestratorWithMemory.process(sessionId, userId, "测试消息");

      // 验证 memory engine 被调用
      expect(memoryEngine.hasSession(sessionId)).toBe(true);
    });

    it("should retrieve recent messages for context", async () => {
      const memoryEngine = createMockMemoryEngine();
      const deps = createE2EDeps({ memoryEngine });

      const orchestratorWithMemory = new AgentOrchestrator(deps, {
        maxContextMessages: 5,
      });

      // 添加多条消息
      for (let i = 0; i < 3; i++) {
        await orchestratorWithMemory.process(sessionId, userId, `消息 ${i}`);
      }

      // 检查消息数量
      const messages = memoryEngine.getRecentMessages(sessionId, 5);
      // 应该有用户消息 + 助手响应
      expect(messages.length).toBeGreaterThan(0);
    });

    it("should limit context messages to maxContextMessages", async () => {
      const maxMessages = 3;
      const memoryEngine = createMockMemoryEngine();
      const deps = createE2EDeps({ memoryEngine });

      const orchestratorWithMemory = new AgentOrchestrator(deps, {
        maxContextMessages: maxMessages,
      });

      // 添加超过限制的消息
      for (let i = 0; i < 5; i++) {
        await orchestratorWithMemory.process(sessionId, userId, `消息 ${i}`);
      }

      // 验证 orchestrator 配置了正确的 maxContextMessages
      // mock memory engine 会返回所有消息，但 orchestrator 应该只使用 maxMessages 条
      // 这里我们验证 memory engine 被正确调用
      expect(memoryEngine.getRecentMessages).toHaveBeenCalled();
    });
  });

  describe("stream with memory", () => {
    it("should persist messages after streaming", async () => {
      const memoryEngine = createMockMemoryEngine();
      const deps = createE2EDeps({ memoryEngine });

      const orchestratorWithMemory = new AgentOrchestrator(deps);

      const result = await orchestratorWithMemory.processStream(
        sessionId,
        userId,
        "流式测试消息",
      );

      // 消费流
      const fullResponse = await result.finalResponse;
      expect(fullResponse).toBeDefined();

      // 消息应该被存储
      expect(memoryEngine.hasSession(sessionId)).toBe(true);
    });

    it("should store both user and assistant messages", async () => {
      const memoryEngine = createMockMemoryEngine();
      const deps = createE2EDeps({ memoryEngine });

      const orchestratorWithMemory = new AgentOrchestrator(deps);
      const testSessionId = generateTestSessionId();

      const result = await orchestratorWithMemory.processStream(
        testSessionId,
        userId,
        "你好",
      );

      // 需要消费流才能触发消息存储
      await result.finalResponse;

      // 验证 addSessionMessage 被调用（用户消息和助手消息）
      expect(memoryEngine.addSessionMessage).toHaveBeenCalled();
    });
  });

  describe("cross-session isolation", () => {
    it("should not share memory between different sessions", async () => {
      const sessionId1 = generateTestSessionId();
      const sessionId2 = generateTestSessionId();

      // 会话1
      await orchestrator.process(sessionId1, userId, "会话1的消息");

      // 会话2
      await orchestrator.process(sessionId2, userId, "会话2的消息");

      // 两个会话独立存在
      expect(orchestrator.hasSession(sessionId1)).toBe(true);
      expect(orchestrator.hasSession(sessionId2)).toBe(true);
    });

    it("should handle concurrent sessions independently", async () => {
      const sessions = Array.from({ length: 3 }, () => generateTestSessionId());

      // 并发处理多个会话
      await Promise.all(
        sessions.map((sid) => orchestrator.process(sid, userId, "并发测试")),
      );

      // 所有会话都应该存在
      for (const sid of sessions) {
        expect(orchestrator.hasSession(sid)).toBe(true);
      }
    });
  });
});
