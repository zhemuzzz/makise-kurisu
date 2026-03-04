/**
 * 跨平台执行器 - 云端执行器测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  CloudExecutor,
  createCloudExecutor,
} from "../../../../src/platform/tools/executors/cloud-executor";
import * as platform from "../../../../src/platform/tools/executors/platform";

// Mock platform detection
vi.mock("../../../../src/platform/tools/executors/platform", () => ({
  detectPlatform: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("CloudExecutor", () => {
  let executor: CloudExecutor;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default to iOS
    vi.mocked(platform.detectPlatform).mockReturnValue({
      platform: "ios",
      osType: "darwin",
      isTermux: false,
      homeDir: "/var/mobile",
      tempDir: "/tmp",
    });

    // Default fetch behavior - successful response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        stdout: "hello\n",
        stderr: "",
        exitCode: 0,
        latency: 100,
        timedOut: false,
      }),
    });

    executor = createCloudExecutor({
      endpoint: "https://api.kurisu.ai/v1/execute",
      apiKey: "test-api-key",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create executor with config", () => {
      const exec = createCloudExecutor({
        endpoint: "https://api.example.com/execute",
        apiKey: "secret-key",
        timeout: 120000,
      });

      expect(exec).toBeInstanceOf(CloudExecutor);
      const config = exec.getConfig();
      expect(config.endpoint).toBe("https://api.example.com/execute");
      expect(config.apiKey).toBe("secret-key");
      expect(config.timeout).toBe(120000);
    });
  });

  describe("isAvailable", () => {
    it("should return true when config is complete", () => {
      expect(
        CloudExecutor.isAvailable({
          endpoint: "https://api.kurisu.ai/v1/execute",
          apiKey: "test-key",
        })
      ).toBe(true);
    });

    it("should return false when apiKey is missing", () => {
      expect(
        CloudExecutor.isAvailable({
          endpoint: "https://api.kurisu.ai/v1/execute",
          apiKey: "",
        })
      ).toBe(false);
    });

    it("should return false when endpoint is missing", () => {
      expect(
        CloudExecutor.isAvailable({
          endpoint: "",
          apiKey: "test-key",
        })
      ).toBe(false);
    });
  });

  describe("getCapabilities", () => {
    it("should return capabilities", () => {
      const capabilities = executor.getCapabilities();

      expect(capabilities.isolation).toBe("cloud");
      expect(capabilities.supportedPermissions).toContain("safe");
      expect(capabilities.supportedPermissions).toContain("confirm");
      expect(capabilities.networkIsolation).toBe(true);
      expect(capabilities.maxMemory).toBe(1024);
      expect(capabilities.supportsApproval).toBe(true);
    });
  });

  describe("supportsPermission", () => {
    it("should support safe permission", () => {
      expect(executor.supportsPermission("safe")).toBe(true);
    });

    it("should support confirm permission", () => {
      expect(executor.supportsPermission("confirm")).toBe(true);
    });

    it("should not support deny permission", () => {
      expect(executor.supportsPermission("deny")).toBe(false);
    });
  });

  describe("healthCheck", () => {
    it("should return true when cloud service is healthy", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
      });

      const result = await executor.healthCheck();
      expect(result).toBe(true);
    });

    it("should return false when cloud service is unhealthy", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
      });

      const result = await executor.healthCheck();
      expect(result).toBe(false);
    });

    it("should return false when fetch fails", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await executor.healthCheck();
      expect(result).toBe(false);
    });

    it("should return false when config is missing", async () => {
      const execNoConfig = createCloudExecutor({
        endpoint: "",
        apiKey: "",
      });

      const result = await execNoConfig.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe("execute", () => {
    it("should return error when API key is missing", async () => {
      const execNoKey = createCloudExecutor({
        endpoint: "https://api.kurisu.ai/v1/execute",
        apiKey: "",
      });

      const result = await execNoKey.execute("echo hello", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("requires API key");
    });

    it("should return error when endpoint is missing", async () => {
      const execNoEndpoint = createCloudExecutor({
        endpoint: "",
        apiKey: "test-key",
      });

      const result = await execNoEndpoint.execute("echo hello", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("requires endpoint");
    });

    it("should reject deny level", async () => {
      const result = await executor.execute("echo hello", {
        permission: "deny",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("Permission denied");
    });

    it("should reject confirm level without approval", async () => {
      const result = await executor.execute("rm file.txt", {
        permission: "confirm",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
        approved: false,
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("requires approval");
    });

    it("should reject dangerous command", async () => {
      const result = await executor.execute("rm -rf /", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("Dangerous command");
    });

    it("should execute command successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
          latency: 150,
          timedOut: false,
        }),
      });

      const result = await executor.execute("echo hello world", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
      expect(result.executorType).toBe("cloud");
    });

    it("should send correct request body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stdout: "",
          stderr: "",
          exitCode: 0,
          latency: 50,
        }),
      });

      await executor.execute("echo test", {
        permission: "safe",
        networkAccess: true,
        timeout: 60000,
        workingDir: "/custom/workspace",
        env: { FOO: "bar" },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.kurisu.ai/v1/execute",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer test-api-key",
          }),
        })
      );

      // Check request body
      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.command).toBe("echo test");
      expect(body.permission).toBe("safe");
      expect(body.networkAccess).toBe(true);
      expect(body.timeout).toBe(60000);
      expect(body.workingDir).toBe("/custom/workspace");
      expect(body.env).toEqual({ FOO: "bar" });
    });

    it("should handle HTTP error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const result = await executor.execute("echo test", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain("HTTP 500");
      expect(result.stderr).toContain("Internal Server Error");
    });

    it("should handle network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const result = await executor.execute("echo test", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Cloud execution failed");
      expect(result.stderr).toContain("Network timeout");
    });

    it("should handle request timeout with AbortController", async () => {
      // Simulate abort
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      const result = await executor.execute("sleep 100", {
        permission: "safe",
        networkAccess: false,
        timeout: 100,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Cloud execution failed");
    });

    it("should handle cloud execution failure", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          stdout: "",
          stderr: "Command failed: permission denied",
          exitCode: 1,
          latency: 100,
          timedOut: false,
        }),
      });

      const result = await executor.execute("cat /etc/shadow", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Command failed");
    });

    it("should handle cloud timeout", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          stdout: "",
          stderr: "Execution timeout",
          exitCode: 137,
          latency: 30000,
          timedOut: true,
        }),
      });

      const result = await executor.execute("sleep 1000", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(137);
    });

    it("should execute confirm level with approval", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          stdout: "file created",
          stderr: "",
          exitCode: 0,
          latency: 200,
        }),
      });

      const result = await executor.execute("touch /workspace/file.txt", {
        permission: "confirm",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
        approved: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const config = executor.getConfig();
      expect(config.endpoint).toBe("https://api.kurisu.ai/v1/execute");
      expect(config.apiKey).toBe("test-api-key");
    });
  });
});
