/**
 * E02: 会话管理测试
 *
 * 验证会话 CRUD 操作和生命周期管理
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Gateway } from "../../../src/gateway";
import { ChannelType, SessionAlreadyExistsError } from "../../../src/gateway";
import {
  createMockOrchestratorForGateway,
  generateTestSessionId,
  generateTestUserId,
} from "../fixtures/e2e-fixtures";

describe("E02: Session Management", () => {
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

  describe("createSession", () => {
    it("should create session with valid parameters", async () => {
      const sessionId = generateTestSessionId();

      const session = await gateway.createSession(
        sessionId,
        userId,
        ChannelType.CLI,
      );

      expect(session).toBeDefined();
      expect(session.sessionId).toBe(sessionId);
      expect(session.userId).toBe(userId);
      expect(session.channelType).toBe(ChannelType.CLI);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.lastActiveAt).toBeInstanceOf(Date);
    });

    it("should create session with metadata", async () => {
      const sessionId = generateTestSessionId();
      const metadata = { source: "test", version: "1.0" };

      const session = await gateway.createSession(
        sessionId,
        userId,
        ChannelType.CLI,
        metadata,
      );

      expect(session.metadata).toEqual(metadata);
    });

    it("should reject duplicate session creation", async () => {
      const sessionId = generateTestSessionId();

      // 第一次创建成功
      await gateway.createSession(sessionId, userId, ChannelType.CLI);

      // 第二次应该失败
      await expect(
        gateway.createSession(sessionId, userId, ChannelType.CLI),
      ).rejects.toThrow(SessionAlreadyExistsError);
    });

    it("should reject session ID longer than 256 characters", async () => {
      const longSessionId = "a".repeat(257);

      await expect(
        gateway.createSession(longSessionId, userId, ChannelType.CLI),
      ).rejects.toThrow("exceeds maximum length");
    });

    it("should accept session ID exactly 256 characters", async () => {
      const sessionId = "a".repeat(256);

      const session = await gateway.createSession(
        sessionId,
        userId,
        ChannelType.CLI,
      );

      expect(session.sessionId).toBe(sessionId);
    });
  });

  describe("getSession", () => {
    it("should retrieve existing session", async () => {
      const sessionId = generateTestSessionId();
      await gateway.createSession(sessionId, userId, ChannelType.CLI);

      const session = gateway.getSession(sessionId);

      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe(sessionId);
    });

    it("should return null for non-existent session", () => {
      const session = gateway.getSession("non-existent");

      expect(session).toBeNull();
    });

    it("should return session copy (immutability)", async () => {
      const sessionId = generateTestSessionId();
      await gateway.createSession(sessionId, userId, ChannelType.CLI);

      const session1 = gateway.getSession(sessionId);
      const session2 = gateway.getSession(sessionId);

      // 应该是不同的对象引用
      expect(session1).not.toBe(session2);
      // 但内容相同
      expect(session1).toEqual(session2);
    });
  });

  describe("deleteSession", () => {
    it("should delete existing session", async () => {
      const sessionId = generateTestSessionId();
      await gateway.createSession(sessionId, userId, ChannelType.CLI);

      const deleted = await gateway.deleteSession(sessionId);

      expect(deleted).toBe(true);
      expect(gateway.getSession(sessionId)).toBeNull();
    });

    it("should return false for non-existent session", async () => {
      const deleted = await gateway.deleteSession("non-existent");

      expect(deleted).toBe(false);
    });

    it("should decrement session count after deletion", async () => {
      const sessionId = generateTestSessionId();
      await gateway.createSession(sessionId, userId, ChannelType.CLI);

      const countBefore = gateway.getSessionCount();
      await gateway.deleteSession(sessionId);
      const countAfter = gateway.getSessionCount();

      expect(countAfter).toBe(countBefore - 1);
    });
  });

  describe("session cleanup", () => {
    it("should cleanup expired sessions automatically", async () => {
      // 创建一个 TTL 很短的 gateway
      const mockOrchestrator = createMockOrchestratorForGateway();
      const shortTtlGateway = new Gateway(
        { orchestrator: mockOrchestrator },
        { sessionTTL: 50, cleanupInterval: 30 },
      );

      await shortTtlGateway.start();

      try {
        const sessionId = generateTestSessionId();
        await shortTtlGateway.createSession(sessionId, userId, ChannelType.CLI);

        // 确认会话存在
        expect(shortTtlGateway.getSession(sessionId)).not.toBeNull();

        // 等待 TTL 过期 + 清理
        await new Promise((resolve) => setTimeout(resolve, 100));

        // 手动触发清理（测试用）
        shortTtlGateway.cleanupExpiredSessions();

        // 会话应该被清理
        expect(shortTtlGateway.getSession(sessionId)).toBeNull();
      } finally {
        await shortTtlGateway.stop();
      }
    });

    it("should manually cleanup expired sessions", async () => {
      const sessionId = generateTestSessionId();
      await gateway.createSession(sessionId, userId, ChannelType.CLI);

      // 确保会话存在
      expect(gateway.getSession(sessionId)).not.toBeNull();

      // 手动清理（不会立即清理活跃会话）
      gateway.cleanupExpiredSessions();

      // 会话仍然存在（因为未过期）
      expect(gateway.getSession(sessionId)).not.toBeNull();
    });
  });

  describe("session limits", () => {
    it("should enforce maximum session limit", async () => {
      // 创建一个 maxSessions=2 的 gateway
      const mockOrchestrator = createMockOrchestratorForGateway();
      const limitedGateway = new Gateway(
        { orchestrator: mockOrchestrator },
        { maxSessions: 2 },
      );

      await limitedGateway.start();

      try {
        // 创建 2 个会话
        const sid1 = generateTestSessionId();
        const sid2 = generateTestSessionId();
        const sid3 = generateTestSessionId();

        await limitedGateway.createSession(sid1, userId, ChannelType.CLI);
        await limitedGateway.createSession(sid2, userId, ChannelType.CLI);

        // 确认已有 2 个会话
        expect(limitedGateway.getSessionCount()).toBe(2);

        // 第 3 个应该失败
        await expect(
          limitedGateway.createSession(sid3, userId, ChannelType.CLI),
        ).rejects.toThrow(/maximum.*session/i);
      } finally {
        await limitedGateway.stop();
      }
    });
  });

  describe("session count", () => {
    it("should return correct session count", async () => {
      expect(gateway.getSessionCount()).toBe(0);

      await gateway.createSession(
        generateTestSessionId(),
        userId,
        ChannelType.CLI,
      );
      expect(gateway.getSessionCount()).toBe(1);

      await gateway.createSession(
        generateTestSessionId(),
        userId,
        ChannelType.CLI,
      );
      expect(gateway.getSessionCount()).toBe(2);
    });

    it("should return 0 when no sessions", async () => {
      expect(gateway.getSessionCount()).toBe(0);
    });
  });

  describe("getSessionsByUserId", () => {
    it("should return all sessions for a user", async () => {
      const user1 = generateTestUserId();
      const user2 = generateTestUserId();

      await gateway.createSession(
        generateTestSessionId(),
        user1,
        ChannelType.CLI,
      );
      await gateway.createSession(
        generateTestSessionId(),
        user1,
        ChannelType.CLI,
      );
      await gateway.createSession(
        generateTestSessionId(),
        user2,
        ChannelType.CLI,
      );

      const user1Sessions = gateway.getSessionsByUserId(user1);
      const user2Sessions = gateway.getSessionsByUserId(user2);

      expect(user1Sessions.length).toBe(2);
      expect(user2Sessions.length).toBe(1);
    });

    it("should return empty array for unknown user", () => {
      const sessions = gateway.getSessionsByUserId("unknown-user");
      expect(sessions).toEqual([]);
    });
  });
});
