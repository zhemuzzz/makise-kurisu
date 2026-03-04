/**
 * ApprovalExecutorWrapper Tests
 *
 * KURISU-019 Phase 4.3: 测试审批执行器包装器
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ApprovalExecutorWrapper,
  createApprovalExecutor,
  isApprovalRequired,
  riskLevelToText,
  riskLevelToIcon,
  type ToolCallInfo,
} from "@/platform/tools/executors/approval-wrapper";
import type {
  ToolExecutor,
  ExecuteOptions,
  ExecuteResult,
  ExecutorCapabilities,
} from "@/platform/tools/executors/types";
import { ApprovalManager, createApprovalManager } from "@/platform/tools/approval";

// Mock 执行器
class MockExecutor implements ToolExecutor {
  async execute(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    return {
      success: true,
      stdout: `Executed: ${command}`,
      stderr: "",
      exitCode: 0,
      latency: 100,
      executorType: "mock",
    };
  }

  getCapabilities(): ExecutorCapabilities {
    return {
      platform: "linux",
      isolation: "process",
      supportedPermissions: ["safe", "confirm"],
      networkIsolation: false,
      maxMemory: 0,
      supportsApproval: true,
    };
  }

  supportsPermission(level: string): boolean {
    return level === "safe" || level === "confirm";
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

describe("ApprovalExecutorWrapper", () => {
  let wrapper: ApprovalExecutorWrapper;
  let mockExecutor: MockExecutor;
  let approvalManager: ApprovalManager;

  beforeEach(() => {
    mockExecutor = new MockExecutor();
    approvalManager = createApprovalManager({ timeout: 30000 });
    wrapper = createApprovalExecutor({
      approvalManager,
      executor: mockExecutor,
      defaultPermission: "sandbox",
    });
  });

  const createToolCall = (
    name: string,
    args: Record<string, unknown> = {},
  ): ToolCallInfo => ({
    name,
    arguments: args,
  });

  describe("executeWithApproval", () => {
    describe("sandbox 权限", () => {
      it("应该直接执行不需要审批的操作", async () => {
        const options: ExecuteOptions = {
          permission: "safe",
          networkAccess: false,
          timeout: 30000,
          workingDir: "/tmp",
        };

        const result = await wrapper.executeWithApproval(
          "ls -la",
          options,
          "session-1",
          createToolCall("file_read"),
        );

        expect(result.success).toBe(true);
        expect(result.approvalRequired).toBeFalsy();
        expect(result.stdout).toContain("Executed: ls -la");
      });
    });

    describe("restricted 权限", () => {
      it("应该对需要审批的操作返回审批请求", async () => {
        const options: ExecuteOptions = {
          permission: "confirm",
          networkAccess: false,
          timeout: 30000,
          workingDir: "/tmp",
        };

        const result = await wrapper.executeWithApproval(
          "rm test.txt",
          options,
          "session-1",
          createToolCall("shell", { command: "rm test.txt" }),
        );

        expect(result.success).toBe(false);
        expect(result.approvalRequired).toBe(true);
        expect(result.approvalRequest).toBeDefined();
        expect(result.approvalRequest?.sessionId).toBe("session-1");
      });

      it("应该在没有 session ID 时返回错误", async () => {
        const options: ExecuteOptions = {
          permission: "confirm",
          networkAccess: false,
          timeout: 30000,
          workingDir: "/tmp",
        };

        const result = await wrapper.executeWithApproval(
          "rm test.txt",
          options,
          undefined, // 没有 session ID
          createToolCall("shell"),
        );

        expect(result.success).toBe(false);
        expect(result.approvalRequired).toBe(true);
        expect(result.stderr).toContain("no session ID");
      });

      it("应该在已批准时直接执行", async () => {
        const options: ExecuteOptions = {
          permission: "confirm",
          networkAccess: false,
          timeout: 30000,
          workingDir: "/tmp",
          approved: true,
        };

        const result = await wrapper.executeWithApproval(
          "rm test.txt",
          options,
          "session-1",
          createToolCall("shell"),
        );

        expect(result.success).toBe(true);
        expect(result.approvalRequired).toBe(false);
      });
    });
  });

  describe("executeApproved", () => {
    it("应该将 approved 标志设置为 true 后执行", async () => {
      const options: ExecuteOptions = {
        permission: "confirm",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/tmp",
      };

      const result = await wrapper.executeApproved("rm test.txt", options);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("Executed: rm test.txt");
    });
  });

  describe("execute (标准接口)", () => {
    it("应该直接调用底层执行器", async () => {
      const options: ExecuteOptions = {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/tmp",
      };

      const result = await wrapper.execute("ls", options);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain("Executed: ls");
    });
  });

  describe("getCapabilities", () => {
    it("应该返回底层执行器的能力", () => {
      const capabilities = wrapper.getCapabilities();

      expect(capabilities.platform).toBe("linux");
      expect(capabilities.isolation).toBe("process");
      expect(capabilities.supportsApproval).toBe(true);
    });
  });

  describe("healthCheck", () => {
    it("应该返回底层执行器的健康状态", async () => {
      const healthy = await wrapper.healthCheck();

      expect(healthy).toBe(true);
    });
  });

  describe("getWrappedExecutor", () => {
    it("应该返回底层执行器", () => {
      const executor = wrapper.getWrappedExecutor();

      expect(executor).toBe(mockExecutor);
    });
  });

  describe("getApprovalManager", () => {
    it("应该返回审批管理器", () => {
      const manager = wrapper.getApprovalManager();

      expect(manager).toBe(approvalManager);
    });
  });
});

describe("isApprovalRequired", () => {
  it("应该正确识别需要审批的结果", () => {
    const result = {
      success: false,
      stdout: "",
      stderr: "",
      exitCode: 126,
      latency: 0,
      executorType: "process" as const,
      approvalRequired: true,
      approvalRequest: {
        id: "approval-123",
        sessionId: "session-1",
        toolCall: { id: "call-1", name: "shell", arguments: {} },
        permission: "restricted" as const,
        riskLevel: "medium" as const,
        risk: { level: "medium" as const, reasons: [], isReversible: true },
        message: "test",
        createdAt: Date.now(),
        expiresAt: Date.now() + 30000,
      },
    };

    expect(isApprovalRequired(result)).toBe(true);
  });

  it("应该正确识别不需要审批的结果", () => {
    const result = {
      success: true,
      stdout: "output",
      stderr: "",
      exitCode: 0,
      latency: 100,
      executorType: "process" as const,
      approvalRequired: false,
    };

    expect(isApprovalRequired(result)).toBe(false);
  });
});

describe("riskLevelToText", () => {
  it("应该返回正确的中文描述", () => {
    expect(riskLevelToText("low")).toBe("低风险");
    expect(riskLevelToText("medium")).toBe("中等风险");
    expect(riskLevelToText("high")).toBe("高风险");
    expect(riskLevelToText("critical")).toBe("极高风险");
  });
});

describe("riskLevelToIcon", () => {
  it("应该返回正确的图标", () => {
    expect(riskLevelToIcon("low")).toBe("✓");
    expect(riskLevelToIcon("medium")).toBe("⚠");
    expect(riskLevelToIcon("high")).toBe("⚠️");
    expect(riskLevelToIcon("critical")).toBe("🔴");
  });
});
