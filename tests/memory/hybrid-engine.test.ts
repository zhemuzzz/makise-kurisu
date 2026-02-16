/**
 * HybridMemoryEngine Integration Tests
 * @vitest-environment node
 *
 * Test Coverage:
 * - Constructor & Initialization
 * - Session Management
 * - Message Flow (Happy Path)
 * - Memory Search
 * - Context Building Integration
 * - Error Handling
 * - Immutability
 * - Performance
 * - Edge Cases
 * - Integration Scenarios
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SAMPLE_SESSION_ID,
  SAMPLE_SESSIONS,
  SAMPLE_MESSAGES,
  CONVERSATION_MESSAGES,
  SAMPLE_MEMORIES,
  SAMPLE_PERSONA_PROMPT,
  DEFAULT_SESSION_CONFIG,
  MOCK_MEM0_CONFIG,
  BOUNDARY_TEST_DATA,
  PERFORMANCE_TEST_DATA,
  INVALID_SESSION_IDS,
  MEM0_ERROR_RESPONSES,
  createMockMem0Client,
  createMockPersonaEngine,
  generateMessages,
  generateSessionId,
  wait,
} from "./fixtures";
import {
  HybridMemoryEngine,
  SessionMemory,
  ShortTermMemory,
  ContextBuilder,
  SessionNotFoundError,
  InvalidSessionIdError,
} from "@/memory";
import type { PersonaEngineLike, Mem0Client, BuildContext } from "@/memory";

describe("HybridMemoryEngine", () => {
  describe("Constructor & Initialization", () => {
    it("should initialize without config", () => {
      const engine = new HybridMemoryEngine();

      expect(engine).toBeDefined();
      expect(engine.listSessions()).toEqual([]);
    });

    it("should accept custom configuration", () => {
      const engine = new HybridMemoryEngine({
        sessionConfig: { maxMessages: 50, ttl: 7200000 },
        maxSessions: 10,
      });

      expect(engine).toBeDefined();
    });

    it("should initialize with empty sessions map", () => {
      const engine = new HybridMemoryEngine();

      expect(engine.listSessions()).toEqual([]);
    });

    it("should create SessionMemory instances on demand", () => {
      const engine = new HybridMemoryEngine();
      const sessionId = engine.createSession();

      expect(engine.hasSession(sessionId)).toBe(true);
      expect(engine.getSession(sessionId)).toBeDefined();
    });

    it("should reuse existing SessionMemory instances", () => {
      const engine = new HybridMemoryEngine();
      const sessionId = engine.createSession();

      const session1 = engine.getSession(sessionId);
      const session2 = engine.getSession(sessionId);

      // Should be the same instance or equivalent
      expect(session1?.getMessages()).toEqual(session2?.getMessages());
    });
  });

  describe("Session Management", () => {
    let engine: HybridMemoryEngine;

    beforeEach(() => {
      engine = new HybridMemoryEngine();
    });

    it("should create new session with auto-generated ID", () => {
      const sessionId = engine.createSession();

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("should create new session with custom ID", () => {
      const customId = "custom-session-123";
      const sessionId = engine.createSession(customId);

      expect(sessionId).toBe(customId);
    });

    it("should get existing session", () => {
      const sessionId = engine.createSession();
      const session = engine.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session?.isEmpty()).toBe(true);
    });

    it("should return undefined for non-existent session", () => {
      const session = engine.getSession("non-existent");

      expect(session).toBeUndefined();
    });

    it("should check if session exists", () => {
      const sessionId = engine.createSession();

      expect(engine.hasSession(sessionId)).toBe(true);
      expect(engine.hasSession("non-existent")).toBe(false);
    });

    it("should clear session", () => {
      const sessionId = engine.createSession();
      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);

      engine.clearSession(sessionId);

      const session = engine.getSession(sessionId);
      expect(session?.isEmpty()).toBe(true);
    });

    it("should list active sessions", () => {
      const id1 = engine.createSession();
      const id2 = engine.createSession();
      const id3 = engine.createSession();

      const sessions = engine.listSessions();

      expect(sessions).toContain(id1);
      expect(sessions).toContain(id2);
      expect(sessions).toContain(id3);
      expect(sessions.length).toBe(3);
    });

    it("should handle duplicate session ID", () => {
      const sessionId = engine.createSession("duplicate-id");

      expect(() => {
        engine.createSession("duplicate-id");
      }).toThrow(/Session already exists/);
    });

    it("should validate session ID format", () => {
      INVALID_SESSION_IDS.forEach((invalidId) => {
        if (
          invalidId === "" ||
          (typeof invalidId === "string" && invalidId.trim() === "")
        ) {
          expect(() => {
            engine.createSession(invalidId);
          }).toThrow(/Invalid session ID/);
        }
      });
    });
  });

  describe("Message Flow (Happy Path)", () => {
    let engine: HybridMemoryEngine;
    let sessionId: string;

    beforeEach(() => {
      engine = new HybridMemoryEngine();
      sessionId = engine.createSession();
    });

    it("should add user message to session", () => {
      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);

      const messages = engine.getMessages(sessionId);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe(SAMPLE_MESSAGES.user.content);
    });

    it("should add assistant message to session", () => {
      engine.addMessage(sessionId, SAMPLE_MESSAGES.assistant);

      const messages = engine.getMessages(sessionId);
      expect(messages.length).toBe(1);
      expect(messages[0].role).toBe("assistant");
    });

    it("should add multiple messages to session", () => {
      CONVERSATION_MESSAGES.forEach((msg) => {
        engine.addMessage(sessionId, msg);
      });

      const messages = engine.getMessages(sessionId);
      expect(messages.length).toBe(CONVERSATION_MESSAGES.length);
    });

    it("should retrieve session messages", () => {
      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);
      engine.addMessage(sessionId, SAMPLE_MESSAGES.assistant);

      const messages = engine.getMessages(sessionId);

      expect(messages.length).toBe(2);
    });

    it("should get recent messages", () => {
      CONVERSATION_MESSAGES.forEach((msg) => {
        engine.addMessage(sessionId, msg);
      });

      const recent = engine.getRecentMessages(sessionId, 3);

      expect(recent.length).toBe(3);
    });

    it("should build complete context", async () => {
      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);

      const context = await engine.buildContext(sessionId, "Hello");

      expect(context).toBeDefined();
      expect(typeof context).toBe("string");
      expect(context.length).toBeGreaterThan(0);
    });
  });

  describe("Memory Operations", () => {
    let engine: HybridMemoryEngine;
    let sessionId: string;
    let mockMem0Client: ReturnType<typeof createMockMem0Client>;

    beforeEach(() => {
      mockMem0Client = createMockMem0Client();
      engine = HybridMemoryEngine.withMem0(mockMem0Client as any);
      sessionId = engine.createSession();
    });

    it("should store message in short-term memory", async () => {
      mockMem0Client.add.mockResolvedValueOnce({ id: "mem-new-1" });

      const memoryId = await engine.addMemory(
        sessionId,
        "User asked about time travel",
        { importance: 0.8, role: "user" },
      );

      expect(memoryId).toBeDefined();
      expect(typeof memoryId).toBe("string");
    });

    it("should search memories", async () => {
      mockMem0Client.add.mockResolvedValueOnce({ id: "mem-1" });
      mockMem0Client.search.mockResolvedValueOnce([
        { id: "mem-1", content: "Time travel discussion", score: 0.9 },
      ]);

      await engine.addMemory(sessionId, "Time travel discussion");
      const results = await engine.searchMemory(sessionId, "time travel");

      expect(Array.isArray(results)).toBe(true);
    });

    it("should limit search results", async () => {
      mockMem0Client.search.mockResolvedValueOnce([
        { id: "mem-1", content: "Memory 1", score: 0.9 },
        { id: "mem-2", content: "Memory 2", score: 0.8 },
      ]);

      const results = await engine.searchMemory(sessionId, "Memory", 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it("should return empty array when no memories found", async () => {
      mockMem0Client.search.mockResolvedValueOnce([]);

      const results = await engine.searchMemory(sessionId, "nonexistent");

      expect(results).toEqual([]);
    });

    it("should isolate memories by session", async () => {
      mockMem0Client.search.mockResolvedValue([]);
      mockMem0Client.add.mockResolvedValue({ id: "mem-new" });

      const session1 = engine.createSession("session-1");
      const session2 = engine.createSession("session-2");

      await engine.addMemory(session1, "Memory from session 1");
      await engine.addMemory(session2, "Memory from session 2");

      const results1 = await engine.searchMemory(session1, "Memory");
      const results2 = await engine.searchMemory(session2, "Memory");

      expect(results1).toBeDefined();
      expect(results2).toBeDefined();
    });
  });

  describe("Context Building Integration", () => {
    let engine: HybridMemoryEngine;
    let sessionId: string;
    let mockMem0Client: ReturnType<typeof createMockMem0Client>;

    beforeEach(() => {
      mockMem0Client = createMockMem0Client();
      engine = HybridMemoryEngine.withMem0(mockMem0Client as any);
      sessionId = engine.createSession();
    });

    it("should build context with all components", async () => {
      mockMem0Client.add.mockResolvedValueOnce({ id: "mem-1" });
      mockMem0Client.search.mockResolvedValueOnce([
        { id: "mem-1", content: "Test memory", score: 0.9 },
      ]);

      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);
      await engine.addMemory(sessionId, "Test memory");

      const context = await engine.buildContext(sessionId, "Hello");

      expect(context).toBeDefined();
      expect(context.length).toBeGreaterThan(0);
    });

    it("should handle missing components gracefully", async () => {
      // No messages added, no memories added
      const context = await engine.buildContext(sessionId, "Hello");

      expect(context).toBeDefined();
    });

    it("should include current message in context", async () => {
      const currentMessage = "What is time travel?";

      const context = await engine.buildContext(sessionId, currentMessage);

      expect(context).toContain(currentMessage);
    });
  });

  describe("Error Handling", () => {
    let engine: HybridMemoryEngine;

    beforeEach(() => {
      engine = new HybridMemoryEngine();
    });

    it("should handle SessionMemory errors", () => {
      const sessionId = engine.createSession();

      expect(() => {
        engine.addMessage(sessionId, {
          role: "invalid" as any,
          content: "test",
        });
      }).toThrow();
    });

    it("should handle non-existent session errors", () => {
      expect(() => {
        engine.getMessages("non-existent");
      }).toThrow(/Session not found/);
    });

    it("should provide meaningful error messages", () => {
      try {
        engine.getMessages("non-existent");
        fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("Session not found");
      }
    });

    it("should handle invalid session ID in operations", () => {
      expect(() => {
        engine.addMessage("", SAMPLE_MESSAGES.user);
      }).toThrow(/Invalid session ID/);
    });

    it("should handle memory operation failures gracefully", async () => {
      const sessionId = engine.createSession();

      // Should not throw even if Mem0 fails
      try {
        await engine.addMemory(sessionId, null as any);
        fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toBeDefined();
      }
    });
  });

  describe("Immutability", () => {
    let engine: HybridMemoryEngine;
    let sessionId: string;

    beforeEach(() => {
      engine = new HybridMemoryEngine();
      sessionId = engine.createSession();
    });

    it("should not mutate session state when getting messages", () => {
      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);

      const messages1 = engine.getMessages(sessionId);
      const messages2 = engine.getMessages(sessionId);

      expect(messages1).not.toBe(messages2);
      expect(messages1).toEqual(messages2);
    });

    it("should preserve message history", () => {
      engine.addMessage(sessionId, { role: "user", content: "Message 1" });
      engine.addMessage(sessionId, {
        role: "assistant",
        content: "Response 1",
      });
      engine.addMessage(sessionId, { role: "user", content: "Message 2" });

      const messages = engine.getMessages(sessionId);

      expect(messages.length).toBe(3);
      expect(messages[0].content).toBe("Message 1");
      expect(messages[2].content).toBe("Message 2");
    });
  });

  describe("Performance", () => {
    it("should handle concurrent sessions", async () => {
      const engine = new HybridMemoryEngine();
      const sessionIds = SAMPLE_SESSIONS.map(() => engine.createSession());

      // Add messages to all sessions concurrently
      const promises = sessionIds.map((sessionId, idx) =>
        Promise.resolve(
          engine.addMessage(sessionId, {
            role: "user",
            content: `Message for session ${idx}`,
          }),
        ),
      );

      await Promise.all(promises);

      // Each session should have exactly 1 message
      sessionIds.forEach((sessionId, idx) => {
        const messages = engine.getMessages(sessionId);
        expect(messages.length).toBe(1);
        expect(messages[0].content).toBe(`Message for session ${idx}`);
      });
    });

    it("should handle rapid message additions", () => {
      const engine = new HybridMemoryEngine();
      const sessionId = engine.createSession();

      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        engine.addMessage(sessionId, {
          role: "user",
          content: `Message ${i}`,
        });
      }
      const duration = Date.now() - startTime;

      // Should complete within 1 second
      expect(duration).toBeLessThan(1000);
      expect(engine.getMessages(sessionId).length).toBe(100);
    });

    it("should handle large context building", async () => {
      const engine = new HybridMemoryEngine();
      const sessionId = engine.createSession();

      // Add many messages
      for (let i = 0; i < 50; i++) {
        engine.addMessage(sessionId, {
          role: "user",
          content: `Long message content ${i} `.repeat(20),
        });
      }

      const startTime = Date.now();
      const context = await engine.buildContext(sessionId, "Hello");
      const duration = Date.now() - startTime;

      // Should complete within 2 seconds
      expect(duration).toBeLessThan(2000);
      expect(context.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    let engine: HybridMemoryEngine;

    beforeEach(() => {
      engine = new HybridMemoryEngine();
    });

    it("should handle empty session ID", () => {
      expect(() => {
        engine.createSession("");
      }).toThrow(/Invalid session ID/);
    });

    it("should handle special characters in session ID", () => {
      const specialId = "session-测试-🌍-123";
      const sessionId = engine.createSession(specialId);

      expect(sessionId).toBe(specialId);
      expect(engine.hasSession(specialId)).toBe(true);
    });

    it("should handle very long sessions", () => {
      const sessionId = engine.createSession();
      const messages = generateMessages(500);

      messages.forEach((msg) => {
        engine.addMessage(sessionId, msg);
      });

      // Should enforce message limit
      const storedMessages = engine.getMessages(sessionId);
      expect(storedMessages.length).toBeLessThanOrEqual(
        DEFAULT_SESSION_CONFIG.maxMessages,
      );
    });

    it("should handle concurrent operations on same session", async () => {
      const sessionId = engine.createSession();

      const promises = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(
          engine.addMessage(sessionId, {
            role: "user",
            content: `Concurrent message ${i}`,
          }),
        ),
      );

      await Promise.all(promises);

      // Should have all messages
      const messages = engine.getMessages(sessionId);
      expect(messages.length).toBe(10);
    });

    it("should handle memory overflow", () => {
      const limitedEngine = new HybridMemoryEngine({
        sessionConfig: { maxMessages: 10, ttl: 3600000 },
      });
      const sessionId = limitedEngine.createSession();

      const messages = generateMessages(20);
      messages.forEach((msg) => {
        limitedEngine.addMessage(sessionId, msg);
      });

      // Should enforce limit
      expect(limitedEngine.getMessages(sessionId).length).toBe(10);
    });

    it("should handle very long message content", () => {
      const sessionId = engine.createSession();
      const longContent = "A".repeat(100000);

      engine.addMessage(sessionId, { role: "user", content: longContent });

      const messages = engine.getMessages(sessionId);
      expect(messages[0].content).toBe(longContent);
    });

    it("should handle special characters in messages", () => {
      const sessionId = engine.createSession();

      engine.addMessage(sessionId, {
        role: "user",
        content: BOUNDARY_TEST_DATA.specialCharacters,
      });

      const messages = engine.getMessages(sessionId);
      expect(messages[0].content).toBe(BOUNDARY_TEST_DATA.specialCharacters);
    });

    it("should handle unicode and emojis in messages", () => {
      const sessionId = engine.createSession();

      engine.addMessage(sessionId, {
        role: "user",
        content: BOUNDARY_TEST_DATA.mixedLanguages,
      });

      const messages = engine.getMessages(sessionId);
      expect(messages[0].content).toBe(BOUNDARY_TEST_DATA.mixedLanguages);
    });
  });

  describe("Integration Scenarios", () => {
    let engine: HybridMemoryEngine;
    let mockMem0Client: ReturnType<typeof createMockMem0Client>;

    beforeEach(() => {
      mockMem0Client = createMockMem0Client();
      engine = HybridMemoryEngine.withMem0(mockMem0Client as any);
    });

    it("should complete full conversation cycle", async () => {
      mockMem0Client.add.mockResolvedValueOnce({ id: "mem-1" });
      mockMem0Client.search.mockResolvedValueOnce([]);

      const sessionId = engine.createSession();

      // User sends message
      engine.addMessage(sessionId, { role: "user", content: "Hello" });

      // Assistant responds
      engine.addMessage(sessionId, { role: "assistant", content: "Hi there!" });

      // Store in memory
      await engine.addMemory(sessionId, "User greeted assistant");

      // Build context for next turn
      const context = await engine.buildContext(sessionId, "How are you?");

      expect(context).toContain("Hello");
      expect(context).toContain("How are you?");
    });

    it("should maintain context across multiple turns", async () => {
      const sessionId = engine.createSession();

      // Turn 1
      engine.addMessage(sessionId, {
        role: "user",
        content: "My name is Okabe",
      });
      engine.addMessage(sessionId, {
        role: "assistant",
        content: "Nice to meet you, Okabe",
      });

      // Turn 2
      engine.addMessage(sessionId, {
        role: "user",
        content: "What is time travel?",
      });
      engine.addMessage(sessionId, {
        role: "assistant",
        content: "Time travel is...",
      });

      // Turn 3
      const context = await engine.buildContext(sessionId, "Tell me more");

      expect(context).toContain("Okabe");
      expect(context).toContain("time travel");
      expect(context).toContain("Tell me more");
    });

    it("should handle multi-user scenarios", async () => {
      const user1Session = engine.createSession("user-1-session");
      const user2Session = engine.createSession("user-2-session");

      // User 1 conversation
      engine.addMessage(user1Session, {
        role: "user",
        content: "User 1 message",
      });
      engine.addMessage(user1Session, {
        role: "assistant",
        content: "Response to user 1",
      });

      // User 2 conversation
      engine.addMessage(user2Session, {
        role: "user",
        content: "User 2 message",
      });
      engine.addMessage(user2Session, {
        role: "assistant",
        content: "Response to user 2",
      });

      // Each user should only see their messages
      const user1Messages = engine.getMessages(user1Session);
      const user2Messages = engine.getMessages(user2Session);

      expect(user1Messages.length).toBe(2);
      expect(user2Messages.length).toBe(2);
      expect(user1Messages[0].content).toBe("User 1 message");
      expect(user2Messages[0].content).toBe("User 2 message");
    });

    it("should handle session cleanup", () => {
      const sessionId = engine.createSession();
      engine.addMessage(sessionId, SAMPLE_MESSAGES.user);

      engine.clearSession(sessionId);

      const session = engine.getSession(sessionId);
      expect(session?.isEmpty()).toBe(true);
    });

    it("should handle engine destruction", () => {
      const sessionId1 = engine.createSession();
      const sessionId2 = engine.createSession();

      engine.destroy();

      // All sessions should be cleared
      expect(engine.listSessions()).toEqual([]);
    });
  });

  describe("Validation", () => {
    let engine: HybridMemoryEngine;
    let sessionId: string;
    let mockMem0Client: ReturnType<typeof createMockMem0Client>;

    beforeEach(() => {
      mockMem0Client = createMockMem0Client();
      engine = HybridMemoryEngine.withMem0(mockMem0Client as any);
      sessionId = engine.createSession();
    });

    it("should validate message structure", () => {
      expect(() => {
        engine.addMessage(sessionId, { role: "user" } as any);
      }).toThrow();

      expect(() => {
        engine.addMessage(sessionId, { content: "test" } as any);
      }).toThrow();
    });

    it("should validate message role", () => {
      expect(() => {
        engine.addMessage(sessionId, {
          role: "invalid" as any,
          content: "test",
        });
      }).toThrow();
    });

    it("should validate message content type", () => {
      expect(() => {
        engine.addMessage(sessionId, { role: "user", content: null as any });
      }).toThrow();

      expect(() => {
        engine.addMessage(sessionId, {
          role: "user",
          content: undefined as any,
        });
      }).toThrow();
    });

    it("should validate memory content", async () => {
      await expect(engine.addMemory(sessionId, null as any)).rejects.toThrow();

      await expect(
        engine.addMemory(sessionId, undefined as any),
      ).rejects.toThrow();
    });

    it("should return empty array for search without mem0Client", async () => {
      const engineWithoutMem0 = new HybridMemoryEngine();
      const sid = engineWithoutMem0.createSession();

      const results = await engineWithoutMem0.searchMemory(sid, "test");

      expect(results).toEqual([]);
    });
  });

  describe("Cleanup & Resource Management", () => {
    let engine: HybridMemoryEngine;

    beforeEach(() => {
      engine = new HybridMemoryEngine();
    });

    it("should clean up resources on destroy", () => {
      engine.createSession("session-1");
      engine.createSession("session-2");

      engine.destroy();

      expect(engine.listSessions()).toEqual([]);
    });

    it("should handle multiple destroy calls", () => {
      engine.createSession("session-1");

      engine.destroy();
      engine.destroy();
      engine.destroy();

      expect(engine.listSessions()).toEqual([]);
    });

    it("should handle operations after destroy", () => {
      const sessionId = engine.createSession();
      engine.destroy();

      expect(() => {
        engine.getMessages(sessionId);
      }).toThrow();
    });
  });

  describe("Configuration", () => {
    it("should use default config when not provided", () => {
      const engine = new HybridMemoryEngine();
      expect(engine).toBeDefined();
    });

    it("should merge custom config with defaults", () => {
      const engine = new HybridMemoryEngine({
        sessionConfig: { maxMessages: 50 },
      });

      const sessionId = engine.createSession();
      const messages = generateMessages(100);

      messages.forEach((msg) => {
        engine.addMessage(sessionId, msg);
      });

      // Should use custom limit
      expect(engine.getMessages(sessionId).length).toBe(50);
    });
  });
});
