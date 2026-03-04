/**
 * assemblePlatformServices 工厂函数测试
 *
 * 验证所有 Adapter 正确组装为 PlatformServices
 */

import { describe, it, expect, vi } from "vitest";
import {
  assemblePlatformServices,
  type PlatformDependencies,
} from "../../../src/platform/adapters/index.js";
import type { PlatformServices } from "../../../src/agent/ports/platform-services.js";

// ============================================================================
// Mock createContextManager
// ============================================================================

vi.mock("../../../src/platform/context-manager.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/platform/context-manager.js")>();
  return {
    ...actual,
    createContextManager: vi.fn(() => ({
      assemblePrompt: vi.fn().mockReturnValue({ included: [], skipped: [], tokenUsage: { total: 0, perBlock: new Map() } }),
      processToolResult: vi.fn().mockReturnValue({ content: "", truncated: false, originalLength: 0 }),
      processLLMOutput: vi.fn().mockReturnValue({ content: "" }),
      checkBudget: vi.fn().mockReturnValue({ total: 8000, identityFixed: 500, safetyMargin: 500, available: 7000, used: 0, shouldCompact: false, shouldDegrade: false }),
      compact: vi.fn().mockResolvedValue({ preserved: [], summary: "", removedCount: 0 }),
      estimateTokens: vi.fn().mockReturnValue(0),
      getMetrics: vi.fn().mockReturnValue({ iteration: 0, toolChain: [], tokenUsage: { total: 8000, identityFixed: 500, used: 0, available: 7000 }, compactCount: 0 }),
      recordIteration: vi.fn(),
      recordToolCall: vi.fn(),
      updateTokenUsage: vi.fn(),
    })),
  };
});

// ============================================================================
// Test Helpers
// ============================================================================

function createMockDependencies(): PlatformDependencies {
  return {
    contextManagerOptions: {
      totalContextTokens: 8000,
      identityContent: "test identity",
      safetyMarginTokens: 500,
    },

    toolRegistry: {
      execute: vi.fn(),
      executeAll: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      has: vi.fn().mockReturnValue(false),
    } as unknown as PlatformDependencies["toolRegistry"],

    skillManager: {
      findSkill: vi.fn().mockResolvedValue([]),
      getActiveSkills: vi.fn().mockResolvedValue([]),
      activate: vi.fn(),
      archive: vi.fn(),
      createDraft: vi.fn(),
      confirmDraft: vi.fn(),
    } as unknown as PlatformDependencies["skillManager"],

    subAgentManager: {
      spawn: vi.fn().mockResolvedValue("sub-1"),
      awaitResult: vi.fn().mockResolvedValue({ subAgentId: "sub-1", success: true, result: "done", stats: {} }),
      abort: vi.fn().mockResolvedValue(true),
      getActiveCount: vi.fn().mockReturnValue(0),
      getStatus: vi.fn().mockReturnValue("completed"),
    } as unknown as PlatformDependencies["subAgentManager"],

    permissionService: {
      check: vi.fn().mockReturnValue("allow"),
      getToolAnnotations: vi.fn().mockReturnValue([]),
    },

    approvalService: {
      requestApproval: vi.fn().mockReturnValue({ approvalId: "a1", result: Promise.resolve({ approved: true }) }),
      handleUserResponse: vi.fn(),
      rejectAllPending: vi.fn(),
      pendingCount: 0,
    },

    tracingService: {
      log: vi.fn(),
    },

    memoryEngine: {
      searchMemory: vi.fn().mockResolvedValue([]),
      addMemory: vi.fn().mockResolvedValue("mem-1"),
    } as unknown as PlatformDependencies["memoryEngine"],

    modelProvider: {
      get: vi.fn().mockReturnValue({
        name: "test",
        chat: vi.fn().mockResolvedValue({ content: "", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: "test", latency: 0 }),
      }),
      listModels: vi.fn().mockReturnValue([]),
    } as unknown as PlatformDependencies["modelProvider"],

    summarizeFn: vi.fn().mockResolvedValue("summary"),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("assemblePlatformServices", () => {
  it("should return PlatformServices with all 9 ports", () => {
    const deps = createMockDependencies();
    const services: PlatformServices = assemblePlatformServices(deps);

    expect(services.context).toBeDefined();
    expect(services.tools).toBeDefined();
    expect(services.skills).toBeDefined();
    expect(services.subAgents).toBeDefined();
    expect(services.permission).toBeDefined();
    expect(services.approval).toBeDefined();
    expect(services.tracing).toBeDefined();
    expect(services.memory).toBeDefined();
    expect(services.llm).toBeDefined();
  });

  it("should pass skillManager through directly (no adapter)", () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    // SkillManager is passed through directly
    expect(services.skills).toBe(deps.skillManager);
  });

  it("should pass subAgentManager through directly", () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    expect(services.subAgents).toBe(deps.subAgentManager);
  });

  it("should create functional adapters (context port works)", () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    // Should be able to call methods
    const result = services.context.checkBudget([]);
    expect(result).toBeDefined();
    expect(result.withinBudget).toBeDefined();
  });

  it("should create functional adapters (tools port works)", () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    expect(services.tools.isToolAvailable("test")).toBe(false);
  });

  it("should create functional adapters (permission port works)", async () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    const result = await services.permission.check("test_tool", {}, "s1");
    expect(result.allowed).toBe(true);
  });

  it("should create functional adapters (memory port works)", async () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    const results = await services.memory.recall("test", "user-1");
    expect(results).toEqual([]);
  });

  it("should create functional adapters (tracing port works)", () => {
    const deps = createMockDependencies();
    const services = assemblePlatformServices(deps);

    // Should not throw
    services.tracing.log({ type: "test", sessionId: "s1" });
    expect(deps.tracingService.log).toHaveBeenCalled();
  });
});
