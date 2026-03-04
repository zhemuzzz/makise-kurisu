/**
 * spawn-sub-agent 元工具测试
 *
 * @see meta-tools.md §三, sub-agent.md SA-10
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  spawnSubAgentDefinition,
  spawnSubAgentHandler,
} from "../../../src/agent/meta-tools/spawn-sub-agent.js";
import type {
  MetaToolContext,
  SessionState,
} from "../../../src/agent/meta-tools/types.js";
import type {
  SubAgentManagerPort,
  SubAgentResult,
} from "../../../src/agent/ports/platform-services.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockSessionState(): SessionState {
  return {
    getTodoState: () => undefined,
    setTodoState: () => {},
  };
}

function createMockSubAgentManager(
  result?: Partial<SubAgentResult>,
): SubAgentManagerPort {
  const defaultResult: SubAgentResult = {
    subAgentId: "sub-agent-001",
    success: true,
    result: "Task completed successfully",
    stats: {
      iterations: 3,
      toolCallCount: 2,
      totalTokens: 1500,
      inputTokens: 1000,
      outputTokens: 500,
      duration: 5000,
      compactCount: 0,
    },
  };

  return {
    spawn: vi.fn().mockResolvedValue("sub-agent-001"),
    awaitResult: vi.fn().mockResolvedValue({ ...defaultResult, ...result }),
    abort: vi.fn().mockResolvedValue(true),
    getActiveCount: vi.fn().mockReturnValue(0),
    getStatus: vi.fn().mockReturnValue("completed"),
  } as unknown as SubAgentManagerPort;
}

function createMockContext(
  subAgentManager?: SubAgentManagerPort,
): MetaToolContext {
  return {
    sessionId: "test-session",
    userId: "test-user",
    agentId: "test-agent",
    sessionState: createMockSessionState(),
    skills: {} as MetaToolContext["skills"],
    subAgents: subAgentManager ?? createMockSubAgentManager(),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("spawn-sub-agent", () => {
  describe("toolDefinition", () => {
    it("should have correct name and permission", () => {
      expect(spawnSubAgentDefinition.toolDef.name).toBe("spawn-sub-agent");
      expect(spawnSubAgentDefinition.permission).toBe("safe");
    });

    it("should have inputSchema with task_goal", () => {
      const schema = spawnSubAgentDefinition.toolDef.inputSchema;
      expect(schema.type).toBe("object");
      expect(schema.properties?.task_goal).toBeDefined();
      expect(schema.required).toContain("task_goal");
    });
  });

  describe("handler", () => {
    it("should spawn and await result", async () => {
      const subAgentManager = createMockSubAgentManager();
      const context = createMockContext(subAgentManager);

      const result = await spawnSubAgentHandler(
        { task_goal: "搜索天气信息" },
        context,
      );

      expect(result.success).toBe(true);
      expect(subAgentManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskGoal: "搜索天气信息",
          parentAgentId: "test-agent",
          sessionId: "test-session",
        }),
      );
      expect(subAgentManager.awaitResult).toHaveBeenCalledWith(
        "sub-agent-001",
        undefined,
      );
    });

    it("should pass optional parameters", async () => {
      const subAgentManager = createMockSubAgentManager();
      const context = createMockContext(subAgentManager);

      await spawnSubAgentHandler(
        {
          task_goal: "分析代码",
          skill_ids: ["coding-assistant"],
          max_iterations: 10,
          timeout: 30000,
          return_format: "structured",
        },
        context,
      );

      expect(subAgentManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          taskGoal: "分析代码",
          skillIds: ["coding-assistant"],
          maxIterations: 10,
          timeout: 30000,
          returnFormat: "structured",
        }),
      );
    });

    it("should return sub-agent result on success", async () => {
      const subAgentManager = createMockSubAgentManager({
        result: { analysis: "Code looks good" },
      });
      const context = createMockContext(subAgentManager);

      const result = await spawnSubAgentHandler(
        { task_goal: "分析代码" },
        context,
      );

      expect(result.success).toBe(true);
      const output = result.output as {
        success: boolean;
        subAgentId: string;
        result: unknown;
      };
      expect(output.subAgentId).toBe("sub-agent-001");
      expect(output.result).toEqual({ analysis: "Code looks good" });
    });

    it("should handle sub-agent failure", async () => {
      const subAgentManager = createMockSubAgentManager({
        success: false,
        error: { code: "TIMEOUT", message: "Task timed out" },
      });
      const context = createMockContext(subAgentManager);

      const result = await spawnSubAgentHandler(
        { task_goal: "长时间任务" },
        context,
      );

      expect(result.success).toBe(false);
    });

    it("should fail for missing task_goal", async () => {
      const context = createMockContext();

      const result = await spawnSubAgentHandler({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should fail for non-string task_goal", async () => {
      const context = createMockContext();

      const result = await spawnSubAgentHandler(
        { task_goal: 123 },
        context,
      );

      expect(result.success).toBe(false);
    });

    it("should handle spawn errors gracefully", async () => {
      const subAgentManager = createMockSubAgentManager();
      (subAgentManager.spawn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Concurrency limit reached"),
      );
      const context = createMockContext(subAgentManager);

      const result = await spawnSubAgentHandler(
        { task_goal: "task" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Concurrency limit");
    });

    it("should handle awaitResult errors gracefully", async () => {
      const subAgentManager = createMockSubAgentManager();
      (subAgentManager.awaitResult as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Connection lost"),
      );
      const context = createMockContext(subAgentManager);

      const result = await spawnSubAgentHandler(
        { task_goal: "task" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Connection lost");
    });

    it("should use defaults for optional parameters", async () => {
      const subAgentManager = createMockSubAgentManager();
      const context = createMockContext(subAgentManager);

      await spawnSubAgentHandler(
        { task_goal: "simple task" },
        context,
      );

      expect(subAgentManager.spawn).toHaveBeenCalledWith(
        expect.objectContaining({
          skillIds: [],
          contextSlice: [],
          returnFormat: "natural",
        }),
      );
    });
  });
});
