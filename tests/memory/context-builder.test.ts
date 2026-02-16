/**
 * ContextBuilder Unit Tests
 * @vitest-environment node
 *
 * Test Coverage:
 * - Constructor & Initialization
 * - Context Building
 * - Memory Integration
 * - Context Truncation
 * - Edge Cases
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SAMPLE_SESSION_ID,
  SAMPLE_MEMORIES,
  CONVERSATION_MESSAGES,
  BOUNDARY_TEST_DATA,
  createMockSessionMemory,
  createMockPersonaEngine,
  createMockShortTermMemory,
} from "./fixtures";
import {
  ContextBuilder,
  SessionMemory,
  ValidationError,
} from "@/memory";

describe("ContextBuilder", () => {
  describe("Constructor & Initialization", () => {
    it("should initialize with PersonaEngine", () => {
      const mockPersona = createMockPersonaEngine();
      const builder = new ContextBuilder(mockPersona);

      expect(builder).toBeDefined();
    });

    it("should initialize without PersonaEngine (optional)", () => {
      const builder = new ContextBuilder();

      expect(builder).toBeDefined();
    });

    it("should accept custom options", () => {
      const mockPersona = createMockPersonaEngine();
      const builder = new ContextBuilder(mockPersona, {
        maxTokens: 8192,
        maxMessages: 50,
      });

      expect(builder).toBeDefined();
    });

    it("should accept null PersonaEngine", () => {
      const builder = new ContextBuilder(null as any);

      expect(builder).toBeDefined();
    });
  });

  describe("Context Building", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let mockShortTermMemory: ReturnType<typeof createMockShortTermMemory>;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      mockShortTermMemory = createMockShortTermMemory();
      builder = new ContextBuilder(mockPersona);
    });

    it("should build context from persona prompt", async () => {
      const result = await builder.build(
        mockSessionMemory,
        null,
        "Hello"
      );

      expect(result.systemPrompt).toContain("牧濑红莉栖");
    });

    it("should include session memories", async () => {
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "user",
        content: "你好",
      });
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "assistant",
        content: "有什么事",
      });

      const result = await builder.build(
        mockSessionMemory,
        null,
        "Test message"
      );

      expect(result.fullContext).toContain("你好");
      expect(result.fullContext).toContain("有什么事");
    });

    it("should include short-term memories", async () => {
      mockShortTermMemory.searchMemory.mockResolvedValueOnce(SAMPLE_MEMORIES);

      const result = await builder.build(
        mockSessionMemory,
        mockShortTermMemory as any,
        "time travel"
      );

      expect(mockShortTermMemory.searchMemory).toHaveBeenCalledWith(
        "time travel",
        expect.any(Number)
      );
    });

    it("should include current message", async () => {
      const currentMessage = "What is time travel?";

      const result = await builder.build(
        mockSessionMemory,
        null,
        currentMessage
      );

      expect(result.fullContext).toContain(currentMessage);
    });

    it("should return token count", async () => {
      const result = await builder.build(
        mockSessionMemory,
        null,
        "Hello"
      );

      expect(typeof result.tokenCount).toBe("number");
      expect(result.tokenCount).toBeGreaterThan(0);
    });

    it("should return recent messages", async () => {
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "user",
        content: "Hello",
      });

      const result = await builder.build(
        mockSessionMemory,
        null,
        "Test"
      );

      expect(result.recentMessages).toHaveLength(1);
      expect(result.recentMessages[0].content).toBe("Hello");
    });
  });

  describe("Memory Integration", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let mockShortTermMemory: ReturnType<typeof createMockShortTermMemory>;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      mockShortTermMemory = createMockShortTermMemory();
      builder = new ContextBuilder(mockPersona);
    });

    it("should integrate with SessionMemory", async () => {
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "user",
        content: "Hello",
      });

      const result = await builder.build(
        mockSessionMemory,
        null,
        "Test"
      );

      expect(result.recentMessages).toHaveLength(1);
    });

    it("should integrate with ShortTermMemory", async () => {
      mockShortTermMemory.searchMemory.mockResolvedValueOnce(SAMPLE_MEMORIES);

      await builder.build(
        mockSessionMemory,
        mockShortTermMemory as any,
        "time travel"
      );

      expect(mockShortTermMemory.searchMemory).toHaveBeenCalled();
    });

    it("should handle empty session memory gracefully", async () => {
      const result = await builder.build(
        mockSessionMemory,
        null,
        "Hello"
      );

      expect(result.fullContext).toBeDefined();
      expect(result.recentMessages).toHaveLength(0);
    });

    it("should handle empty short-term memory gracefully", async () => {
      mockShortTermMemory.searchMemory.mockResolvedValueOnce([]);

      const result = await builder.build(
        mockSessionMemory,
        mockShortTermMemory as any,
        "Hello"
      );

      expect(result.fullContext).toBeDefined();
      expect(result.relevantMemories).toHaveLength(0);
    });

    it("should order messages chronologically", async () => {
      mockSessionMemory = mockSessionMemory
        .addMessage({ role: "user", content: "Old message" })
        .addMessage({ role: "assistant", content: "New message" });

      const result = await builder.build(
        mockSessionMemory,
        null,
        "Test"
      );

      const oldIndex = result.fullContext.indexOf("Old message");
      const newIndex = result.fullContext.indexOf("New message");
      expect(oldIndex).toBeLessThan(newIndex);
    });
  });

  describe("Context Truncation", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
    });

    it("should truncate to fit context window", async () => {
      // Create very long conversation
      let session = mockSessionMemory;
      for (let i = 0; i < 100; i++) {
        session = session.addMessage({
          role: "user",
          content: `This is message number ${i} with some padding text to make it longer.`,
        });
      }

      builder = new ContextBuilder(mockPersona, { maxTokens: 500 });
      const result = await builder.build(session, null, "Hello");

      // Rough token estimation (4 chars per token)
      expect(result.fullContext.length / 4).toBeLessThan(600);
    });

    it("should preserve persona prompt (highest priority)", async () => {
      let session = mockSessionMemory;
      for (let i = 0; i < 100; i++) {
        session = session.addMessage({
          role: "user",
          content: "A".repeat(100),
        });
      }

      builder = new ContextBuilder(mockPersona, { maxTokens: 500 });
      const result = await builder.build(session, null, "Hello");

      expect(result.systemPrompt).toContain("牧濑红莉栖");
    });

    it("should preserve current message", async () => {
      let session = mockSessionMemory;
      for (let i = 0; i < 100; i++) {
        session = session.addMessage({
          role: "user",
          content: "A".repeat(100),
        });
      }

      builder = new ContextBuilder(mockPersona, { maxTokens: 500 });
      const result = await builder.build(session, null, "IMPORTANT CURRENT MESSAGE");

      expect(result.fullContext).toContain("IMPORTANT CURRENT MESSAGE");
    });
  });

  describe("buildSync", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      builder = new ContextBuilder(mockPersona);
    });

    it("should build context synchronously", () => {
      const result = builder.buildSync(mockSessionMemory, "Hello");

      expect(result).toBeDefined();
      expect(result.fullContext).toContain("Hello");
    });

    it("should not include short-term memories in sync mode", () => {
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "user",
        content: "Test",
      });

      const result = builder.buildSync(mockSessionMemory, "Hello");

      expect(result.relevantMemories).toHaveLength(0);
    });
  });

  describe("Edge Cases", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      builder = new ContextBuilder(mockPersona);
    });

    it("should handle empty current message", async () => {
      await expect(
        builder.build(mockSessionMemory, null, "")
      ).rejects.toThrow(ValidationError);
    });

    it("should handle null current message", async () => {
      await expect(
        builder.build(mockSessionMemory, null, null as any)
      ).rejects.toThrow(ValidationError);
    });

    it("should handle special characters in context", async () => {
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "user",
        content: BOUNDARY_TEST_DATA.specialCharacters,
      });

      const result = await builder.build(
        mockSessionMemory,
        null,
        BOUNDARY_TEST_DATA.mixedLanguages
      );

      expect(result.fullContext).toContain("<script>");
      expect(result.fullContext).toContain("世界");
    });

    it("should handle missing PersonaEngine gracefully", async () => {
      builder = new ContextBuilder();
      const result = await builder.build(mockSessionMemory, null, "Hello");

      expect(result.systemPrompt).toBe("");
      expect(result.fullContext).toContain("Hello");
    });

    it("should handle very long persona prompt", async () => {
      const longPersona = "牧濑红莉栖\n" + "特质描述\n".repeat(1000);
      mockPersona.getSystemPrompt.mockReturnValue(longPersona);

      builder = new ContextBuilder(mockPersona, { maxTokens: 500 });
      const result = await builder.build(mockSessionMemory, null, "Hello");

      expect(result.fullContext.length).toBeGreaterThan(0);
    });
  });

  describe("Output Validation", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      builder = new ContextBuilder(mockPersona);
    });

    it("should return fullContext as string", async () => {
      const result = await builder.build(mockSessionMemory, null, "Hello");

      expect(typeof result.fullContext).toBe("string");
      expect(result.fullContext.length).toBeGreaterThan(0);
    });

    it("should return all required properties", async () => {
      const result = await builder.build(mockSessionMemory, null, "Hello");

      expect(result).toHaveProperty("systemPrompt");
      expect(result).toHaveProperty("relevantMemories");
      expect(result).toHaveProperty("recentMessages");
      expect(result).toHaveProperty("fullContext");
      expect(result).toHaveProperty("tokenCount");
    });

    it("should calculate approximate token count", async () => {
      mockSessionMemory = mockSessionMemory.addMessage({
        role: "user",
        content: "This is a test message",
      });

      const result = await builder.build(mockSessionMemory, null, "Hello");

      // Rough check: token count should be proportional to string length
      const estimatedTokens = result.fullContext.length / 4;
      expect(result.tokenCount).toBeGreaterThan(estimatedTokens * 0.25);
      expect(result.tokenCount).toBeLessThan(estimatedTokens * 3);
    });
  });

  describe("Integration Scenarios", () => {
    let mockPersona: ReturnType<typeof createMockPersonaEngine>;
    let mockSessionMemory: SessionMemory;
    let mockShortTermMemory: ReturnType<typeof createMockShortTermMemory>;
    let builder: ContextBuilder;

    beforeEach(() => {
      mockPersona = createMockPersonaEngine();
      mockSessionMemory = new SessionMemory(SAMPLE_SESSION_ID);
      mockShortTermMemory = createMockShortTermMemory();
      builder = new ContextBuilder(mockPersona);
    });

    it("should build complete context with all components", async () => {
      let session = mockSessionMemory;
      for (const msg of CONVERSATION_MESSAGES) {
        session = session.addMessage(msg);
      }
      mockShortTermMemory.searchMemory.mockResolvedValueOnce(SAMPLE_MEMORIES);

      const result = await builder.build(
        session,
        mockShortTermMemory as any,
        "Tell me about time travel"
      );

      expect(result.systemPrompt).toContain("牧濑红莉栖"); // Persona
      expect(result.fullContext).toContain("你好"); // Session memory
      expect(result.fullContext).toContain("Tell me about time travel"); // Current message
      expect(result.relevantMemories.length).toBeGreaterThan(0); // Short-term memories
    });

    it("should maintain context consistency across multiple calls", async () => {
      let session = mockSessionMemory;
      for (const msg of CONVERSATION_MESSAGES) {
        session = session.addMessage(msg);
      }

      const result1 = await builder.build(session, null, "Message 1");
      const result2 = await builder.build(session, null, "Message 2");

      // Both should have similar structure
      expect(result1.recentMessages.length).toBe(result2.recentMessages.length);
      expect(result1.systemPrompt).toBe(result2.systemPrompt);
    });
  });

  describe("Performance", () => {
    it("should build context efficiently", async () => {
      const mockPersona = createMockPersonaEngine();
      let session = new SessionMemory(SAMPLE_SESSION_ID);
      for (let i = 0; i < 100; i++) {
        session = session.addMessage({
          role: "user",
          content: `Message ${i}`,
        });
      }

      const builder = new ContextBuilder(mockPersona);

      const startTime = Date.now();
      await builder.build(session, null, "Hello");
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
    });
  });
});
