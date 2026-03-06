/**
 * SessionStateImpl 单元测试
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SessionStateImpl } from "../../../src/agent/meta-tools/session-state-impl.js";
import type { CognitionStore } from "../../../src/platform/storage/cognition-store.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockCognitionStore(): CognitionStore & { writeCalls: string[] } {
  const writeCalls: string[] = [];
  return {
    writeCalls,
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockImplementation(async (content: string) => {
      writeCalls.push(content);
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SessionStateImpl", () => {
  describe("todo state", () => {
    it("should return undefined when no todo state set", () => {
      const state = new SessionStateImpl();
      expect(state.getTodoState()).toBeUndefined();
    });

    it("should get/set todo state", () => {
      const state = new SessionStateImpl();
      const todo = {
        todos: [{ id: "1", content: "test", status: "pending" as const }],
        formattedText: "- [ ] test",
      };

      state.setTodoState(todo);
      expect(state.getTodoState()).toBe(todo);
    });
  });

  describe("cognition state", () => {
    it("should return undefined when no cognition state set", () => {
      const state = new SessionStateImpl();
      expect(state.getCognitionState()).toBeUndefined();
    });

    it("should return initial cognition when provided", () => {
      const initial = { content: "初始认知", formattedText: "## 初始认知" };
      const state = new SessionStateImpl({ initialCognition: initial });
      expect(state.getCognitionState()).toBe(initial);
    });

    it("should get/set cognition state", () => {
      const state = new SessionStateImpl();
      const cognition = { content: "新认知", formattedText: "## 新认知" };

      state.setCognitionState(cognition);
      expect(state.getCognitionState()).toBe(cognition);
    });
  });

  describe("auto-persistence", () => {
    it("should persist cognition to CognitionStore on setCognitionState", async () => {
      const mockStore = createMockCognitionStore();
      const state = new SessionStateImpl({ cognitionStore: mockStore });

      state.setCognitionState({ content: "test content", formattedText: "## test" });

      // Wait for fire-and-forget write
      await new Promise((r) => setTimeout(r, 10));
      expect(mockStore.writeCalls).toContain("test content");
    });

    it("should not throw when CognitionStore write fails", async () => {
      const mockStore = createMockCognitionStore();
      (mockStore.write as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("disk full"),
      );
      const state = new SessionStateImpl({ cognitionStore: mockStore });

      // Should not throw
      state.setCognitionState({ content: "test", formattedText: "## test" });
      await new Promise((r) => setTimeout(r, 10));

      // State is still updated in memory
      expect(state.getCognitionState()?.content).toBe("test");
    });

    it("should not persist when no CognitionStore provided", () => {
      const state = new SessionStateImpl();
      // Should not throw
      state.setCognitionState({ content: "test", formattedText: "## test" });
      expect(state.getCognitionState()?.content).toBe("test");
    });
  });
});
