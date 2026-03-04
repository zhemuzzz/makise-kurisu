/**
 * manage-todo 元工具测试
 *
 * @see meta-tools.md §二
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  manageTodoDefinition,
  manageTodoHandler,
} from "../../../src/agent/meta-tools/manage-todo.js";
import type {
  MetaToolContext,
  SessionState,
} from "../../../src/agent/meta-tools/types.js";
import type { TodoState, TodoItem } from "../../../src/agent/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockSessionState(): SessionState & { current: TodoState | undefined } {
  const state: { current: TodoState | undefined } = { current: undefined };
  return {
    get current() {
      return state.current;
    },
    set current(v: TodoState | undefined) {
      state.current = v;
    },
    getTodoState() {
      return state.current;
    },
    setTodoState(s: TodoState) {
      state.current = s;
    },
  };
}

function createMockContext(
  sessionState?: SessionState,
): MetaToolContext {
  return {
    sessionId: "test-session",
    userId: "test-user",
    agentId: "test-agent",
    sessionState: sessionState ?? createMockSessionState(),
    skills: {} as MetaToolContext["skills"],
    subAgents: {} as MetaToolContext["subAgents"],
  };
}

function makeTodos(items: Array<{ id: string; content: string; status: TodoItem["status"] }>): Array<{ id: string; content: string; status: TodoItem["status"] }> {
  return items;
}

// ============================================================================
// Tests
// ============================================================================

describe("manage-todo", () => {
  describe("toolDefinition", () => {
    it("should have correct name and permission", () => {
      expect(manageTodoDefinition.toolDef.name).toBe("manage-todo");
      expect(manageTodoDefinition.permission).toBe("safe");
    });

    it("should have inputSchema with todos array", () => {
      const schema = manageTodoDefinition.toolDef.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.properties?.todos).toBeDefined();
      expect(schema.properties?.todos.type).toBe("array");
      expect(schema.required).toContain("todos");
    });
  });

  describe("handler", () => {
    let sessionState: ReturnType<typeof createMockSessionState>;
    let context: MetaToolContext;

    beforeEach(() => {
      sessionState = createMockSessionState();
      context = createMockContext(sessionState);
    });

    it("should set todo state from full replacement", async () => {
      const todos = makeTodos([
        { id: "1", content: "分析需求", status: "completed" },
        { id: "2", content: "编写代码", status: "in_progress" },
        { id: "3", content: "运行测试", status: "pending" },
      ]);

      const result = await manageTodoHandler(
        { todos },
        context,
      );

      expect(result.success).toBe(true);
      const state = sessionState.getTodoState();
      expect(state).toBeDefined();
      expect(state!.todos).toHaveLength(3);
      expect(state!.todos[0].status).toBe("completed");
      expect(state!.todos[1].status).toBe("in_progress");
      expect(state!.todos[2].status).toBe("pending");
    });

    it("should overwrite previous state (full replacement model)", async () => {
      // First call
      await manageTodoHandler(
        { todos: makeTodos([{ id: "1", content: "Step A", status: "pending" }]) },
        context,
      );

      // Second call completely replaces
      await manageTodoHandler(
        { todos: makeTodos([{ id: "2", content: "Step B", status: "in_progress" }]) },
        context,
      );

      const state = sessionState.getTodoState();
      expect(state!.todos).toHaveLength(1);
      expect(state!.todos[0].id).toBe("2");
      expect(state!.todos[0].content).toBe("Step B");
    });

    it("should clear todos with empty array", async () => {
      // Set initial state
      await manageTodoHandler(
        { todos: makeTodos([{ id: "1", content: "Task", status: "pending" }]) },
        context,
      );

      // Clear with empty array
      const result = await manageTodoHandler(
        { todos: [] },
        context,
      );

      expect(result.success).toBe(true);
      const state = sessionState.getTodoState();
      expect(state!.todos).toHaveLength(0);
    });

    it("should handle all status transitions", async () => {
      const todos = makeTodos([
        { id: "1", content: "Done", status: "completed" },
        { id: "2", content: "Doing", status: "in_progress" },
        { id: "3", content: "Todo", status: "pending" },
        { id: "4", content: "Dropped", status: "cancelled" },
      ]);

      const result = await manageTodoHandler({ todos }, context);
      expect(result.success).toBe(true);

      const state = sessionState.getTodoState();
      expect(state!.todos).toHaveLength(4);
      expect(state!.todos[0].status).toBe("completed");
      expect(state!.todos[1].status).toBe("in_progress");
      expect(state!.todos[2].status).toBe("pending");
      expect(state!.todos[3].status).toBe("cancelled");
    });

    it("should generate formatted text", async () => {
      const todos = makeTodos([
        { id: "1", content: "分析需求", status: "completed" },
        { id: "2", content: "编写代码", status: "in_progress" },
        { id: "3", content: "运行测试", status: "pending" },
      ]);

      await manageTodoHandler({ todos }, context);

      const state = sessionState.getTodoState();
      expect(state!.formattedText).toContain("分析需求");
      expect(state!.formattedText).toContain("编写代码");
      expect(state!.formattedText).toContain("运行测试");
    });

    it("should fold completed items in formatted text when many", async () => {
      const todos = makeTodos([
        { id: "1", content: "Step 1", status: "completed" },
        { id: "2", content: "Step 2", status: "completed" },
        { id: "3", content: "Step 3", status: "completed" },
        { id: "4", content: "Step 4", status: "in_progress" },
        { id: "5", content: "Step 5", status: "pending" },
      ]);

      await manageTodoHandler({ todos }, context);

      const state = sessionState.getTodoState();
      // Completed items should be folded to count when ≥3
      expect(state!.formattedText).toContain("3");
      // Current and pending items should show full text
      expect(state!.formattedText).toContain("Step 4");
      expect(state!.formattedText).toContain("Step 5");
    });

    it("should truncate long content in formatted text", async () => {
      const longContent = "A".repeat(80);
      const todos = makeTodos([
        { id: "1", content: longContent, status: "pending" },
      ]);

      await manageTodoHandler({ todos }, context);

      const state = sessionState.getTodoState();
      // Raw todos should keep full content
      expect(state!.todos[0].content).toBe(longContent);
      // Formatted text should truncate
      expect(state!.formattedText.length).toBeLessThan(longContent.length + 50);
    });

    it("should return error for invalid params (missing todos)", async () => {
      const result = await manageTodoHandler({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error for invalid todo item (missing id)", async () => {
      const result = await manageTodoHandler(
        { todos: [{ content: "No ID", status: "pending" }] },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error for invalid status", async () => {
      const result = await manageTodoHandler(
        { todos: [{ id: "1", content: "Bad status", status: "unknown" }] },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return callId matching the tool name", async () => {
      const todos = makeTodos([{ id: "1", content: "Task", status: "pending" }]);

      const result = await manageTodoHandler({ todos }, context);

      expect(result.toolName).toBe("manage-todo");
    });

    it("should output success status and summary", async () => {
      const todos = makeTodos([
        { id: "1", content: "Task A", status: "completed" },
        { id: "2", content: "Task B", status: "in_progress" },
      ]);

      const result = await manageTodoHandler({ todos }, context);

      expect(result.success).toBe(true);
      const output = result.output as { success: boolean; summary: string };
      expect(output.success).toBe(true);
      expect(output.summary).toBeDefined();
    });
  });
});
