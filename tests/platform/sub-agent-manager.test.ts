/**
 * SubAgentManager 测试
 *
 * Sub-Agent 生命周期管理: spawn, awaitResult, abort, 并发控制
 *
 * @see sub-agent.md SA-1~SA-11
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubAgentManager } from "../../src/platform/sub-agent-manager.js";
import type {
  SubAgentManagerPort,
  SubAgentConfig,
  SubAgentResult,
  SubAgentStatus,
} from "../../src/agent/ports/platform-services.js";
import type { AgentStats } from "../../src/agent/types.js";

// ============================================================================
// Test Helpers
// ============================================================================

const defaultStats: AgentStats = {
  iterations: 1,
  toolCallCount: 0,
  totalTokens: 100,
  inputTokens: 50,
  outputTokens: 50,
  duration: 1000,
  compactCount: 0,
};

function createConfig(overrides?: Partial<SubAgentConfig>): SubAgentConfig {
  return {
    parentAgentId: "parent-1",
    sessionId: "session-1",
    taskGoal: "Do something",
    contextSlice: [],
    skillIds: [],
    returnFormat: "natural",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("SubAgentManager", () => {
  let manager: SubAgentManagerPort;
  let executeTask: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeTask = vi.fn().mockImplementation(
      async (_config: SubAgentConfig): Promise<{ result: unknown; stats: AgentStats }> => ({
        result: "Task completed",
        stats: defaultStats,
      }),
    );

    manager = new SubAgentManager({
      executeTask,
      maxConcurrentPerSession: 3,
    });
  });

  describe("spawn", () => {
    it("should return a unique sub-agent ID", async () => {
      const id = await manager.spawn(createConfig());

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("should generate unique IDs for multiple spawns", async () => {
      const id1 = await manager.spawn(createConfig());
      const id2 = await manager.spawn(createConfig());

      expect(id1).not.toBe(id2);
    });

    it("should set initial status to running", async () => {
      const id = await manager.spawn(createConfig());

      expect(manager.getStatus(id)).toBe("running");
    });

    it("should reject when max concurrent limit reached", async () => {
      // Create manager with limit of 1
      const limitedManager = new SubAgentManager({
        executeTask: vi.fn().mockImplementation(
          () => new Promise(() => {}), // Never resolves
        ),
        maxConcurrentPerSession: 1,
      });

      await limitedManager.spawn(createConfig());

      await expect(limitedManager.spawn(createConfig())).rejects.toThrow(
        /concurrent/i,
      );
    });

    it("should track sub-agents per session", async () => {
      const id1 = await manager.spawn(createConfig({ sessionId: "s1" }));
      const id2 = await manager.spawn(createConfig({ sessionId: "s2" }));

      expect(manager.getActiveCount("s1")).toBe(1);
      expect(manager.getActiveCount("s2")).toBe(1);

      // Wait for completion
      await manager.awaitResult(id1);
      expect(manager.getActiveCount("s1")).toBe(0);
    });
  });

  describe("awaitResult", () => {
    it("should return result after task completes", async () => {
      const id = await manager.spawn(createConfig());
      const result = await manager.awaitResult(id);

      expect(result.subAgentId).toBe(id);
      expect(result.success).toBe(true);
      expect(result.result).toBe("Task completed");
      expect(result.stats).toEqual(defaultStats);
    });

    it("should handle task failure", async () => {
      executeTask.mockRejectedValue(new Error("Task failed"));

      const id = await manager.spawn(createConfig());
      const result = await manager.awaitResult(id);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.message).toContain("Task failed");
    });

    it("should update status to completed on success", async () => {
      const id = await manager.spawn(createConfig());
      await manager.awaitResult(id);

      expect(manager.getStatus(id)).toBe("completed");
    });

    it("should update status to failed on error", async () => {
      executeTask.mockRejectedValue(new Error("boom"));

      const id = await manager.spawn(createConfig());
      await manager.awaitResult(id);

      expect(manager.getStatus(id)).toBe("failed");
    });

    it("should throw for unknown sub-agent ID", async () => {
      await expect(manager.awaitResult("unknown-id")).rejects.toThrow(
        /not found/i,
      );
    });

    it("should support timeout via AbortSignal", async () => {
      executeTask.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000)),
      );

      const id = await manager.spawn(createConfig());
      const controller = new AbortController();

      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      const result = await manager.awaitResult(id, controller.signal);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe("TIMEOUT");
    });
  });

  describe("abort", () => {
    it("should abort a running sub-agent", async () => {
      executeTask.mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );

      const id = await manager.spawn(createConfig());
      const aborted = await manager.abort(id);

      expect(aborted).toBe(true);
      expect(manager.getStatus(id)).toBe("aborted");
    });

    it("should return false for unknown sub-agent", async () => {
      const result = await manager.abort("unknown-id");
      expect(result).toBe(false);
    });

    it("should return false for already completed sub-agent", async () => {
      const id = await manager.spawn(createConfig());
      await manager.awaitResult(id);

      const aborted = await manager.abort(id);
      expect(aborted).toBe(false);
    });

    it("should decrement active count on abort", async () => {
      executeTask.mockImplementation(
        () => new Promise(() => {}), // Never resolves
      );

      const id = await manager.spawn(createConfig({ sessionId: "s1" }));
      expect(manager.getActiveCount("s1")).toBe(1);

      await manager.abort(id);
      expect(manager.getActiveCount("s1")).toBe(0);
    });
  });

  describe("getActiveCount", () => {
    it("should return 0 for unknown session", () => {
      expect(manager.getActiveCount("unknown")).toBe(0);
    });

    it("should count only running sub-agents", async () => {
      const id = await manager.spawn(createConfig({ sessionId: "s1" }));
      expect(manager.getActiveCount("s1")).toBe(1);

      await manager.awaitResult(id);
      expect(manager.getActiveCount("s1")).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("should return 'pending' for unknown sub-agent", () => {
      // Non-existent defaults to pending
      expect(manager.getStatus("unknown")).toBe("pending");
    });
  });

  describe("executeTask callback", () => {
    it("should be called with the SubAgentConfig", async () => {
      const config = createConfig({ taskGoal: "Custom goal" });
      const id = await manager.spawn(config);
      await manager.awaitResult(id);

      expect(executeTask).toHaveBeenCalledWith(config);
    });
  });
});
