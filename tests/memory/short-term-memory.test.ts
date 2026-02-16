/**
 * ShortTermMemory Unit Tests (Mem0 Adapter)
 * @vitest-environment node
 *
 * Test Coverage:
 * - Constructor & Configuration
 * - Memory CRUD Operations
 * - Memory Metadata
 * - Error Handling
 * - Session Isolation
 * - Edge Cases
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SAMPLE_SESSION_ID,
  SAMPLE_MEMORIES,
  MEMORY_SEARCH_RESULTS,
  MOCK_MEM0_CONFIG,
  MEM0_ERROR_RESPONSES,
  VALIDATION_ERRORS,
  BOUNDARY_TEST_DATA,
  createMockMem0Client,
} from "./fixtures";
import { ShortTermMemory, Mem0APIError, ValidationError } from "@/memory";
import type { Mem0Client } from "@/memory";

describe("ShortTermMemory", () => {
  describe("Constructor & Configuration", () => {
    it("should initialize with Mem0 client", () => {
      const mockClient = createMockMem0Client();
      const memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });

      expect(memory).toBeDefined();
    });

    it("should use session ID for isolation", () => {
      const mockClient = createMockMem0Client();
      const memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });

      expect(memory.sessionId).toBe(SAMPLE_SESSION_ID);
    });

    it("should throw error if Mem0 client not configured", () => {
      expect(() => {
        new ShortTermMemory({
          mem0Client: null as any,
          sessionId: SAMPLE_SESSION_ID,
        });
      }).toThrow(/Mem0 client is required/);
    });

    it("should throw error if session ID is invalid", () => {
      const mockClient = createMockMem0Client();

      expect(() => {
        new ShortTermMemory({
          mem0Client: mockClient,
          sessionId: "",
        });
      }).toThrow(/Invalid session ID/);
    });
  });

  describe("Memory Operations - Add", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should add memory with content", async () => {
      const memoryId = await memory.addMemory("User asked about time travel");

      expect(memoryId).toBeDefined();
      expect(typeof memoryId).toBe("string");
      expect(mockClient.add).toHaveBeenCalled();
    });

    it("should add memory with metadata", async () => {
      const metadata = {
        importance: 0.8,
        role: "user" as const,
      };

      await memory.addMemory("Test content", metadata);

      expect(mockClient.add).toHaveBeenCalledWith(
        "Test content",
        expect.objectContaining({
          metadata: expect.objectContaining({
            importance: 0.8,
            role: "user",
            sessionId: SAMPLE_SESSION_ID,
          }),
        }),
      );
    });

    it("should include session context in metadata", async () => {
      await memory.addMemory("Test content");

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[1].metadata.sessionId).toBe(SAMPLE_SESSION_ID);
    });

    it("should include timestamp in metadata", async () => {
      const before = Date.now();
      await memory.addMemory("Test content");
      const after = Date.now();

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[1].metadata.timestamp).toBeGreaterThanOrEqual(before);
      expect(callArgs[1].metadata.timestamp).toBeLessThanOrEqual(after);
    });

    it("should include default importance score if not provided", async () => {
      await memory.addMemory("Test content");

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[1].metadata.importance).toBeDefined();
      expect(callArgs[1].metadata.importance).toBeGreaterThanOrEqual(0);
      expect(callArgs[1].metadata.importance).toBeLessThanOrEqual(1);
    });

    it("should return memory ID on success", async () => {
      mockClient.add.mockResolvedValueOnce({ id: "mem-test-123" });

      const memoryId = await memory.addMemory("Test content");

      expect(memoryId).toBe("mem-test-123");
    });

    it("should use user_id parameter for session isolation", async () => {
      await memory.addMemory("Test content");

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[1].user_id).toBe(SAMPLE_SESSION_ID);
    });

    it("should handle Mem0 API errors gracefully", async () => {
      mockClient.add.mockRejectedValueOnce(MEM0_ERROR_RESPONSES.networkError);

      await expect(memory.addMemory("Test content")).rejects.toThrow(
        /Mem0 API error/,
      );
    });

    it("should validate content before adding", async () => {
      await expect(memory.addMemory("")).rejects.toThrow();
      await expect(memory.addMemory(null as any)).rejects.toThrow();
      await expect(memory.addMemory(undefined as any)).rejects.toThrow();
    });
  });

  describe("Memory Operations - Search", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should search memories by query", async () => {
      mockClient.search.mockResolvedValueOnce(MEMORY_SEARCH_RESULTS);

      const results = await memory.searchMemory("时间旅行");

      expect(results.length).toBe(MEMORY_SEARCH_RESULTS.length);
      expect(mockClient.search).toHaveBeenCalledWith(
        "时间旅行",
        expect.objectContaining({
          user_id: SAMPLE_SESSION_ID,
        }),
      );
    });

    it("should limit search results", async () => {
      mockClient.search.mockResolvedValueOnce(MEMORY_SEARCH_RESULTS);

      await memory.searchMemory("test", 5);

      expect(mockClient.search).toHaveBeenCalledWith(
        "test",
        expect.objectContaining({
          limit: 5,
        }),
      );
    });

    it("should isolate memories by session (user_id)", async () => {
      await memory.searchMemory("test");

      const callArgs = mockClient.search.mock.calls[0][1];
      expect(callArgs.user_id).toBe(SAMPLE_SESSION_ID);
    });

    it("should return empty array when no matches", async () => {
      mockClient.search.mockResolvedValueOnce([]);

      const results = await memory.searchMemory("nonexistent");

      expect(results).toEqual([]);
    });

    it("should handle search API errors", async () => {
      mockClient.search.mockRejectedValueOnce(
        MEM0_ERROR_RESPONSES.networkError,
      );

      await expect(memory.searchMemory("test")).rejects.toThrow(
        /Mem0 API error/,
      );
    });

    it("should handle empty query", async () => {
      // Implementation validates query, so expect throw
      await expect(memory.searchMemory("")).rejects.toThrow();
    });

    it("should handle very long queries", async () => {
      const longQuery = "test ".repeat(1000);
      mockClient.search.mockResolvedValueOnce([]);

      const results = await memory.searchMemory(longQuery);

      expect(mockClient.search).toHaveBeenCalled();
    });

    it("should preserve search score in results", async () => {
      mockClient.search.mockResolvedValueOnce(MEMORY_SEARCH_RESULTS);

      const results = await memory.searchMemory("test");

      expect(results[0]).toHaveProperty("score");
    });
  });

  describe("Memory Operations - Delete", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should delete memory by ID", async () => {
      await memory.deleteMemory("mem-123");

      expect(mockClient.delete).toHaveBeenCalledWith("mem-123");
    });

    it("should handle deletion of non-existent memory", async () => {
      mockClient.delete.mockRejectedValueOnce(MEM0_ERROR_RESPONSES.notFound);

      // Implementation throws on error
      await expect(memory.deleteMemory("nonexistent")).rejects.toThrow();
    });

    it("should handle deletion errors", async () => {
      mockClient.delete.mockRejectedValueOnce(
        MEM0_ERROR_RESPONSES.networkError,
      );

      await expect(memory.deleteMemory("mem-123")).rejects.toThrow(
        /Mem0 API error/,
      );
    });

    it("should validate memory ID", async () => {
      await expect(memory.deleteMemory("")).rejects.toThrow();
      await expect(memory.deleteMemory(null as any)).rejects.toThrow();
    });
  });

  describe("Memory Operations - Get All", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should get all memories for session", async () => {
      mockClient.getAll.mockResolvedValueOnce(SAMPLE_MEMORIES);

      const memories = await memory.getAllMemories();

      expect(memories.length).toBe(SAMPLE_MEMORIES.length);
      expect(mockClient.getAll).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: SAMPLE_SESSION_ID,
        }),
      );
    });

    it("should return empty array when no memories", async () => {
      mockClient.getAll.mockResolvedValueOnce([]);

      const memories = await memory.getAllMemories();

      expect(memories).toEqual([]);
    });

    it("should handle API errors", async () => {
      mockClient.getAll.mockRejectedValueOnce(
        MEM0_ERROR_RESPONSES.networkError,
      );

      await expect(memory.getAllMemories()).rejects.toThrow(/Mem0 API error/);
    });
  });

  describe("Error Handling", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should handle network errors", async () => {
      mockClient.add.mockRejectedValue(MEM0_ERROR_RESPONSES.networkError);

      await expect(memory.addMemory("test")).rejects.toThrow(/Mem0 API error/);
    });

    it("should handle timeout errors", async () => {
      mockClient.add.mockRejectedValue(MEM0_ERROR_RESPONSES.timeout);

      await expect(memory.addMemory("test")).rejects.toThrow(/Mem0 API error/);
    });

    it("should handle unauthorized errors", async () => {
      mockClient.add.mockRejectedValue(MEM0_ERROR_RESPONSES.unauthorized);

      await expect(memory.addMemory("test")).rejects.toThrow(/Mem0 API error/);
    });

    it("should handle rate limit errors", async () => {
      mockClient.add.mockRejectedValue(MEM0_ERROR_RESPONSES.rateLimit);

      await expect(memory.addMemory("test")).rejects.toThrow(/Mem0 API error/);
    });

    it("should provide meaningful error messages", async () => {
      mockClient.add.mockRejectedValue(new Error("Unknown error"));

      try {
        await memory.addMemory("test");
        fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("Mem0 API error");
        expect(error.message).toContain("Unknown error");
      }
    });
  });

  describe("Session Isolation", () => {
    it("should isolate memories between sessions", async () => {
      const mockClient = createMockMem0Client();

      const memory1 = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: "session-1",
      });

      const memory2 = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: "session-2",
      });

      await memory1.addMemory("Memory from session 1");
      await memory2.addMemory("Memory from session 2");

      const call1 = mockClient.add.mock.calls[0];
      const call2 = mockClient.add.mock.calls[1];

      expect(call1[1].user_id).toBe("session-1");
      expect(call2[1].user_id).toBe("session-2");
    });

    it("should only search within session scope", async () => {
      const mockClient = createMockMem0Client();
      const memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: "session-1",
      });

      await memory.searchMemory("test");

      const callArgs = mockClient.search.mock.calls[0][1];
      expect(callArgs.user_id).toBe("session-1");
    });
  });

  describe("Edge Cases", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should handle special characters in content", async () => {
      const specialContent = BOUNDARY_TEST_DATA.specialCharacters;

      await memory.addMemory(specialContent);

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[0]).toBe(specialContent);
    });

    it("should handle unicode and emojis in content", async () => {
      const unicodeContent = BOUNDARY_TEST_DATA.unicodeEmojis;

      await memory.addMemory(unicodeContent);

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[0]).toBe(unicodeContent);
    });

    it("should handle very long content", async () => {
      const longContent = BOUNDARY_TEST_DATA.veryLongText;

      await memory.addMemory(longContent);

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[0]).toBe(longContent);
    });

    it("should handle concurrent add operations", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        memory.addMemory(`Concurrent memory ${i}`),
      );

      const memoryIds = await Promise.all(promises);

      expect(memoryIds.length).toBe(10);
      memoryIds.forEach((id) => expect(typeof id).toBe("string"));
    });

    it("should handle concurrent search operations", async () => {
      mockClient.search.mockResolvedValue(MEMORY_SEARCH_RESULTS);

      const promises = Array.from({ length: 10 }, (_, i) =>
        memory.searchMemory(`Query ${i}`),
      );

      const results = await Promise.all(promises);

      expect(results.length).toBe(10);
      results.forEach((r) => expect(Array.isArray(r)).toBe(true));
    });

    it("should handle SQL injection in content safely", async () => {
      const sqlContent = BOUNDARY_TEST_DATA.sqlInjection;

      await memory.addMemory(sqlContent);

      // Should pass content as-is (Mem0 handles sanitization)
      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[0]).toBe(sqlContent);
    });

    it("should handle XSS attempts safely", async () => {
      const xssContent = BOUNDARY_TEST_DATA.htmlTags;

      await memory.addMemory(xssContent);

      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[0]).toBe(xssContent);
    });
  });

  describe("Metadata Validation", () => {
    let mockClient: ReturnType<typeof createMockMem0Client>;
    let memory: ShortTermMemory;

    beforeEach(() => {
      mockClient = createMockMem0Client();
      memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });
    });

    it("should accept valid metadata", async () => {
      const validMetadata = {
        importance: 0.8,
        role: "user" as const,
      };

      await expect(
        memory.addMemory("test", validMetadata),
      ).resolves.toBeDefined();
    });

    it("should use default values for missing metadata", async () => {
      await memory.addMemory("test");

      // mockClient.add is called with (content, options)
      const callArgs = mockClient.add.mock.calls[0];
      expect(callArgs[1].metadata.importance).toBeDefined();
      expect(callArgs[1].metadata.role).toBeDefined();
    });
  });

  describe("Performance", () => {
    it("should handle batch memory additions efficiently", async () => {
      const mockClient = createMockMem0Client();
      const memory = new ShortTermMemory({
        mem0Client: mockClient,
        sessionId: SAMPLE_SESSION_ID,
      });

      const startTime = Date.now();
      const promises = Array.from({ length: 100 }, (_, i) =>
        memory.addMemory(`Memory ${i}`),
      );

      await Promise.all(promises);
      const duration = Date.now() - startTime;

      // Should complete within 5 seconds
      expect(duration).toBeLessThan(5000);
    });
  });
});
