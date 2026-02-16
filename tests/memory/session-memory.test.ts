/**
 * SessionMemory Unit Tests
 * @vitest-environment node
 *
 * Test Coverage:
 * - Constructor & Initialization
 * - Message Operations (add, query)
 * - Session Management
 * - Immutability
 * - Edge Cases & Error Handling
 * - Performance
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SAMPLE_MESSAGES,
  CONVERSATION_MESSAGES,
  LONG_MESSAGE,
  SPECIAL_CHARS_MESSAGE,
  SAMPLE_SESSION_ID,
  DEFAULT_SESSION_CONFIG,
  CUSTOM_SESSION_CONFIG,
  INVALID_SESSION_IDS,
  BOUNDARY_TEST_DATA,
  generateMessages,
  PERFORMANCE_TEST_DATA,
} from "./fixtures";
import {
  SessionMemory,
  InvalidSessionIdError,
  InvalidMessageError,
} from "@/memory";

describe("SessionMemory", () => {
  describe("Constructor & Initialization", () => {
    it("should initialize with empty message list", () => {
      const session = new SessionMemory(SAMPLE_SESSION_ID);

      expect(session.isEmpty()).toBe(true);
      expect(session.getMessageCount()).toBe(0);
      expect(session.getMessages()).toEqual([]);
    });

    it("should initialize with session ID", () => {
      const session = new SessionMemory(SAMPLE_SESSION_ID);

      expect(session.sessionId).toBe(SAMPLE_SESSION_ID);
    });

    it("should accept optional config", () => {
      const session = new SessionMemory(
        SAMPLE_SESSION_ID,
        CUSTOM_SESSION_CONFIG,
      );

      expect(session.config.maxMessages).toBe(
        CUSTOM_SESSION_CONFIG.maxMessages,
      );
      expect(session.config.ttl).toBe(CUSTOM_SESSION_CONFIG.ttl);
    });

    it("should use default config when not provided", () => {
      const session = new SessionMemory(SAMPLE_SESSION_ID);

      expect(session.config.maxMessages).toBe(
        DEFAULT_SESSION_CONFIG.maxMessages,
      );
      expect(session.config.ttl).toBe(DEFAULT_SESSION_CONFIG.ttl);
    });

    it("should merge partial config with defaults", () => {
      const session = new SessionMemory(SAMPLE_SESSION_ID, { maxMessages: 50 });

      expect(session.config.maxMessages).toBe(50);
      expect(session.config.ttl).toBe(DEFAULT_SESSION_CONFIG.ttl);
    });

    it("should record creation timestamp", () => {
      const before = Date.now();
      const session = new SessionMemory(SAMPLE_SESSION_ID);
      const after = Date.now();

      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
    });

    it("should throw error for invalid session ID", () => {
      INVALID_SESSION_IDS.forEach((invalidId) => {
        if (invalidId === null || invalidId === undefined) {
          // These should be caught by TypeScript, but runtime check too
          expect(() => new SessionMemory(invalidId as any)).toThrow();
        } else if (invalidId === "" || invalidId.trim() === "") {
          expect(() => new SessionMemory(invalidId)).toThrow(
            /Invalid session ID/,
          );
        }
      });
    });
  });

  describe("Message Operations - Add", () => {
    let session: SessionMemory;

    beforeEach(() => {
      session = new SessionMemory(SAMPLE_SESSION_ID);
    });

    it("should add message to session", () => {
      const newSession = session.addMessage(SAMPLE_MESSAGES.user);

      expect(newSession.getMessageCount()).toBe(1);
      expect(newSession.getMessages()[0].content).toBe(
        SAMPLE_MESSAGES.user.content,
      );
    });

    it("should return new SessionMemory instance (immutability)", () => {
      const newSession = session.addMessage(SAMPLE_MESSAGES.user);

      expect(newSession).not.toBe(session);
      expect(session.isEmpty()).toBe(true); // Original unchanged
    });

    it("should not mutate original instance when adding", () => {
      const originalMessages = session.getMessages();
      const newSession = session.addMessage(SAMPLE_MESSAGES.user);

      expect(session.getMessages()).toEqual([]);
      expect(originalMessages).toEqual([]);
    });

    it("should include timestamp automatically", () => {
      const newSession = session.addMessage(SAMPLE_MESSAGES.user);

      const messages = newSession.getMessages();
      expect(messages[0].timestamp).toBeDefined();
      expect(typeof messages[0].timestamp).toBe("number");
      // Allow small time difference
      expect(messages[0].timestamp).toBeGreaterThanOrEqual(Date.now() - 1000);
    });

    it("should support user role", () => {
      const newSession = session.addMessage(SAMPLE_MESSAGES.user);

      expect(newSession.getMessages()[0].role).toBe("user");
    });

    it("should support assistant role", () => {
      const newSession = session.addMessage(SAMPLE_MESSAGES.assistant);

      expect(newSession.getMessages()[0].role).toBe("assistant");
    });

    it("should support system role", () => {
      const newSession = session.addMessage(SAMPLE_MESSAGES.system);

      expect(newSession.getMessages()[0].role).toBe("system");
    });

    it("should maintain message order", () => {
      let currentSession = session;
      CONVERSATION_MESSAGES.forEach((msg) => {
        currentSession = currentSession.addMessage(msg);
      });

      const messages = currentSession.getMessages();
      expect(messages.length).toBe(CONVERSATION_MESSAGES.length);

      messages.forEach((msg, idx) => {
        expect(msg.content).toBe(CONVERSATION_MESSAGES[idx].content);
      });
    });

    it("should enforce message limit (default 100)", () => {
      const messages = generateMessages(150);
      let currentSession = session;

      messages.forEach((msg) => {
        currentSession = currentSession.addMessage(msg);
      });

      expect(currentSession.getMessageCount()).toBe(
        DEFAULT_SESSION_CONFIG.maxMessages,
      );
    });

    it("should discard oldest messages when limit exceeded", () => {
      const messages = generateMessages(150);
      let currentSession = session;

      messages.forEach((msg) => {
        currentSession = currentSession.addMessage(msg);
      });

      const storedMessages = currentSession.getMessages();
      // Should keep the last 100 messages
      expect(storedMessages[0].content).toBe("Message 51");
      expect(storedMessages[99].content).toBe("Message 150");
    });

    it("should respect custom message limit", () => {
      const customSession = new SessionMemory(SAMPLE_SESSION_ID, {
        maxMessages: 10,
        ttl: 3600000,
      });
      const messages = generateMessages(20);
      let currentSession = customSession;

      messages.forEach((msg) => {
        currentSession = currentSession.addMessage(msg);
      });

      expect(currentSession.getMessageCount()).toBe(10);
    });
  });

  describe("Message Operations - Query", () => {
    let session: SessionMemory;

    beforeEach(() => {
      session = new SessionMemory(SAMPLE_SESSION_ID);
      CONVERSATION_MESSAGES.forEach((msg) => {
        session = session.addMessage(msg);
      });
    });

    it("should get all messages", () => {
      const messages = session.getMessages();

      expect(messages.length).toBe(CONVERSATION_MESSAGES.length);
    });

    it("should return copy of messages (immutability)", () => {
      const messages1 = session.getMessages();
      const messages2 = session.getMessages();

      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });

    it("should get messages by role - user", () => {
      const userMessages = session.getMessagesByRole("user");

      expect(userMessages.length).toBe(3);
      userMessages.forEach((msg) => {
        expect(msg.role).toBe("user");
      });
    });

    it("should get messages by role - assistant", () => {
      const assistantMessages = session.getMessagesByRole("assistant");

      expect(assistantMessages.length).toBe(3);
      assistantMessages.forEach((msg) => {
        expect(msg.role).toBe("assistant");
      });
    });

    it("should get messages by role - system (empty)", () => {
      const systemMessages = session.getMessagesByRole("system");

      expect(systemMessages).toEqual([]);
    });

    it("should get messages within time range", () => {
      const now = Date.now();
      const startTime = now - 3500; // 3.5 seconds ago
      const endTime = now - 1500; // 1.5 seconds ago

      const messages = session.getMessagesByTimeRange(startTime, endTime);

      // Should include messages from 3s and 2s ago
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty array for invalid time range", () => {
      const now = Date.now();
      const messages = session.getMessagesByTimeRange(now + 1000, now + 2000);

      expect(messages).toEqual([]);
    });

    it("should get recent N messages", () => {
      const recent = session.getRecentMessages(3);

      expect(recent.length).toBe(3);
      expect(recent[2].content).toBe(CONVERSATION_MESSAGES[5].content);
    });

    it("should return all messages if count exceeds total", () => {
      const recent = session.getRecentMessages(100);

      expect(recent.length).toBe(CONVERSATION_MESSAGES.length);
    });

    it("should return empty array when no messages", () => {
      const emptySession = new SessionMemory(SAMPLE_SESSION_ID);

      expect(emptySession.getMessages()).toEqual([]);
      expect(emptySession.getMessagesByRole("user")).toEqual([]);
      expect(emptySession.getRecentMessages(5)).toEqual([]);
    });
  });

  describe("Session Management", () => {
    let session: SessionMemory;

    beforeEach(() => {
      session = new SessionMemory(SAMPLE_SESSION_ID);
      CONVERSATION_MESSAGES.forEach((msg) => {
        session = session.addMessage(msg);
      });
    });

    it("should clear all messages", () => {
      const clearedSession = session.clear();

      expect(clearedSession.isEmpty()).toBe(true);
      expect(clearedSession.getMessageCount()).toBe(0);
    });

    it("should return new instance when clearing", () => {
      const clearedSession = session.clear();

      expect(clearedSession).not.toBe(session);
      expect(session.getMessageCount()).toBe(CONVERSATION_MESSAGES.length);
    });

    it("should preserve session ID after clearing", () => {
      const clearedSession = session.clear();

      expect(clearedSession.sessionId).toBe(SAMPLE_SESSION_ID);
    });

    it("should get message count", () => {
      expect(session.getMessageCount()).toBe(CONVERSATION_MESSAGES.length);
    });

    it("should check if session is empty", () => {
      const emptySession = new SessionMemory(SAMPLE_SESSION_ID);
      expect(emptySession.isEmpty()).toBe(true);

      const filledSession = emptySession.addMessage(SAMPLE_MESSAGES.user);
      expect(filledSession.isEmpty()).toBe(false);
    });
  });

  describe("Edge Cases & Error Handling", () => {
    let session: SessionMemory;

    beforeEach(() => {
      session = new SessionMemory(SAMPLE_SESSION_ID);
    });

    it("should handle null content gracefully", () => {
      expect(() => {
        session.addMessage({ role: "user", content: null as any });
      }).toThrow();
    });

    it("should handle undefined content gracefully", () => {
      expect(() => {
        session.addMessage({ role: "user", content: undefined as any });
      }).toThrow();
    });

    it("should throw for empty string content", () => {
      expect(() => {
        session.addMessage({ role: "user", content: "" });
      }).toThrow();
    });

    it("should handle very long message content (10k+ chars)", () => {
      const newSession = session.addMessage(LONG_MESSAGE);
      expect(newSession.getMessageCount()).toBe(1);
      expect(newSession.getMessages()[0].content.length).toBe(20000);
    });

    it("should handle special characters and emojis", () => {
      const newSession = session.addMessage(SPECIAL_CHARS_MESSAGE);
      expect(newSession.getMessageCount()).toBe(1);
      expect(newSession.getMessages()[0].content).toBe(
        SPECIAL_CHARS_MESSAGE.content,
      );
    });

    it("should handle unicode characters", () => {
      const newSession = session.addMessage({
        role: "user",
        content: BOUNDARY_TEST_DATA.mixedLanguages,
      });
      expect(newSession.getMessages()[0].content).toBe(
        BOUNDARY_TEST_DATA.mixedLanguages,
      );
    });

    it("should handle SQL injection attempts safely", () => {
      const newSession = session.addMessage({
        role: "user",
        content: BOUNDARY_TEST_DATA.sqlInjection,
      });
      expect(newSession.getMessages()[0].content).toBe(
        BOUNDARY_TEST_DATA.sqlInjection,
      );
    });

    it("should handle XSS attempts safely", () => {
      const newSession = session.addMessage({
        role: "user",
        content: BOUNDARY_TEST_DATA.specialCharacters,
      });
      expect(newSession.getMessages()[0].content).toBe(
        BOUNDARY_TEST_DATA.specialCharacters,
      );
    });

    it("should validate message structure - missing role", () => {
      expect(() => {
        session.addMessage({ content: "test" } as any);
      }).toThrow();
    });

    it("should validate message structure - invalid role", () => {
      expect(() => {
        session.addMessage({ role: "invalid" as any, content: "test" });
      }).toThrow();
    });

    it("should handle concurrent operations safely", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(
          session.addMessage({ role: "user", content: `Message ${i}` }),
        ),
      );

      const sessions = await Promise.all(promises);

      // Each should return a valid session
      sessions.forEach((s) => {
        expect(s.getMessageCount()).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("Performance", () => {
    it("should handle adding 1000+ messages efficiently", () => {
      const startTime = Date.now();
      let session = new SessionMemory(SAMPLE_SESSION_ID);
      const messages = generateMessages(
        PERFORMANCE_TEST_DATA.largeMessageCount,
      );

      messages.forEach((msg) => {
        session = session.addMessage(msg);
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
      expect(session.getMessageCount()).toBe(
        DEFAULT_SESSION_CONFIG.maxMessages,
      );
    });

    it("should handle query operations efficiently with large dataset", () => {
      let session = new SessionMemory(SAMPLE_SESSION_ID);
      const messages = generateMessages(
        PERFORMANCE_TEST_DATA.largeMessageCount,
      );

      messages.forEach((msg) => {
        session = session.addMessage(msg);
      });

      const startTime = Date.now();

      const all = session.getMessages();
      const recent = session.getRecentMessages(50);
      const byRole = session.getMessagesByRole("user");

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Query operations should be fast (< 100ms)
      expect(duration).toBeLessThan(100);
      expect(all.length).toBe(DEFAULT_SESSION_CONFIG.maxMessages);
      expect(recent.length).toBe(50);
      expect(byRole.length).toBe(50); // Half should be user messages
    });

    it("should maintain memory efficiency", () => {
      let session = new SessionMemory(SAMPLE_SESSION_ID);

      // Add many messages
      for (let i = 0; i < 500; i++) {
        session = session.addMessage({
          role: "user",
          content: `Message ${i}`.repeat(100),
        });
      }

      // Session should still enforce limit
      expect(session.getMessageCount()).toBe(
        DEFAULT_SESSION_CONFIG.maxMessages,
      );
    });
  });

  describe("Serialization (Future)", () => {
    it.todo("should serialize to JSON");
    it.todo("should deserialize from JSON");
    it.todo("should preserve immutability during serialization");
  });
});
