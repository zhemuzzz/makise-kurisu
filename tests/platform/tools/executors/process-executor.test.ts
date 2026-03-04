/**
 * 跨平台执行器 - 进程执行器测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  ProcessExecutor,
  createProcessExecutor,
} from "../../../../src/platform/tools/executors/process-executor";
import { DEFAULT_PROCESS_CONFIG } from "../../../../src/platform/tools/executors/types";
import * as platform from "../../../../src/platform/tools/executors/platform";

// Mock platform detection
vi.mock("../../../../src/platform/tools/executors/platform", () => ({
  detectPlatform: vi.fn(),
}));

// Mock child_process at module level
const mockSpawn = vi.hoisted(() => {
  const mockProcess = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
  return vi.fn(() => mockProcess);
});

vi.mock("child_process", () => ({
  spawn: mockSpawn,
}));

// Don't mock fs - use real fs for writing sandbox profiles (temp files)
// This is safe and avoids mock complexity issues

describe("ProcessExecutor", () => {
  let executor: ProcessExecutor;
  let mockProcess: {
    stdout: { on: vi.Mock };
    stderr: { on: vi.Mock };
    on: vi.Mock;
    kill: vi.Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default to Linux (simplest platform, no sandbox-exec)
    vi.mocked(platform.detectPlatform).mockReturnValue({
      platform: "linux",
      osType: "linux",
      isTermux: false,
      homeDir: "/home/test",
      tempDir: "/tmp",
    });

    // Reset mock process
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProcess);

    executor = createProcessExecutor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create executor with default config", () => {
      const exec = createProcessExecutor();
      expect(exec).toBeInstanceOf(ProcessExecutor);
    });

    it("should accept custom config", () => {
      const exec = createProcessExecutor({
        allowedPaths: ["/safe/path"],
        allowFullAccess: true,
        timeout: 60000,
      });

      const config = exec.getConfig();
      expect(config.allowedPaths).toContain("/safe/path");
      expect(config.allowFullAccess).toBe(true);
      expect(config.timeout).toBe(60000);
    });
  });

  describe("getCapabilities", () => {
    it("should return capabilities for macOS", () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "macos",
        osType: "darwin",
        isTermux: false,
        homeDir: "/Users/test",
        tempDir: "/tmp",
      });

      const capabilities = executor.getCapabilities();

      expect(capabilities.isolation).toBe("process");
      expect(capabilities.supportedPermissions).toContain("safe");
      expect(capabilities.supportedPermissions).toContain("confirm");
      expect(capabilities.networkIsolation).toBe(true);
    });

    it("should return capabilities for Linux", () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "linux",
        osType: "linux",
        isTermux: false,
        homeDir: "/home/test",
        tempDir: "/tmp",
      });

      const capabilities = executor.getCapabilities();

      expect(capabilities.platform).toBe("linux");
      expect(capabilities.networkIsolation).toBe(false);
    });

    it("should return capabilities for Windows", () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "windows",
        osType: "win32",
        isTermux: false,
        homeDir: "C:\\Users\\test",
        tempDir: "C:\\Temp",
      });

      const capabilities = executor.getCapabilities();

      expect(capabilities.platform).toBe("windows");
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
    it("should always return true", async () => {
      const result = await executor.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe("execute", () => {
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
      const result = await executor.execute("echo test", {
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
      expect(result.stderr).toContain("Security violation");
    });

    it("should execute safe command on Linux directly", async () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "linux",
        osType: "linux",
        isTermux: false,
        homeDir: "/home/test",
        tempDir: "/tmp",
      });

      // Simulate successful execution
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("hello\n")), 5);
          }
        },
      );
      mockProcess.stderr.on.mockImplementation(() => {});

      const result = await executor.execute("echo hello", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "sh",
        ["-c", "echo hello"],
        expect.any(Object),
      );
      expect(result.success).toBe(true);
    });

    it("should execute command on Windows with cmd.exe", async () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "windows",
        osType: "win32",
        isTermux: false,
        homeDir: "C:\\Users\\test",
        tempDir: "C:\\Temp",
      });

      // Simulate successful execution
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("hello\r\n")), 5);
          }
        },
      );
      mockProcess.stderr.on.mockImplementation(() => {});

      const result = await executor.execute("echo hello", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "C:\\workspace",
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "cmd.exe",
        ["/c", "echo hello"],
        expect.any(Object),
      );
      expect(result.success).toBe(true);
    });

    // Note: Timeout handling is tested via integration tests since it requires
    // real async timing behavior that is difficult to mock reliably

    it("should handle execution error", async () => {
      // Simulate error
      mockProcess.on.mockImplementation(
        (event: string, callback: (error: Error) => void) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("Process failed")), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      const result = await executor.execute("invalid-command", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain("Process failed");
    });

    it("should capture stdout and stderr", async () => {
      // Simulate execution with output
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 20);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("stdout output\n")), 5);
          }
        },
      );
      mockProcess.stderr.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("stderr output\n")), 10);
          }
        },
      );

      const result = await executor.execute("echo test", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.stdout).toContain("stdout output");
      expect(result.stderr).toContain("stderr output");
    });

    it("should return non-zero exit code for failed command", async () => {
      // Simulate failed execution
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(1), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("Command not found")), 5);
          }
        },
      );

      const result = await executor.execute("nonexistent-command", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it("should execute confirm level with approval", async () => {
      // Simulate successful execution
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("file written")), 5);
          }
        },
      );
      mockProcess.stderr.on.mockImplementation(() => {});

      const result = await executor.execute("echo data > file.txt", {
        permission: "confirm",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
        approved: true,
      });

      expect(result.success).toBe(true);
    });

    it("should filter sensitive environment variables", async () => {
      // Simulate successful execution
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(() => {});
      mockProcess.stderr.on.mockImplementation(() => {});

      await executor.execute("echo test", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
        env: {
          PATH: "/usr/bin",
          API_KEY: "secret-key", // Should be filtered
          TOOL_CONFIG: "value", // Should be kept
        },
      });

      // Check spawn was called with filtered env
      const spawnCall = mockSpawn.mock.calls[0];
      const options = spawnCall[2] as { env?: Record<string, string> };

      expect(options.env).toBeDefined();
      expect(options.env?.["TOOL_CONFIG"]).toBe("value");
      // API_KEY should be filtered out
      expect(options.env?.["API_KEY"]).toBeUndefined();
    });

    it("should execute safe command on macOS with sandbox-exec", async () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "macos",
        osType: "darwin",
        isTermux: false,
        homeDir: "/Users/test",
        tempDir: "/tmp",
      });

      // Simulate successful execution
      mockProcess.on.mockImplementation(
        (event: string, callback: (code: number | null) => void) => {
          if (event === "close") {
            setTimeout(() => callback(0), 10);
          }
        },
      );
      mockProcess.stdout.on.mockImplementation(
        (event: string, callback: (data: Buffer) => void) => {
          if (event === "data") {
            setTimeout(() => callback(Buffer.from("hello\n")), 5);
          }
        },
      );
      mockProcess.stderr.on.mockImplementation(() => {});

      const result = await executor.execute("echo hello", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        "sandbox-exec",
        expect.arrayContaining([
          expect.stringContaining(".sb"),
          "sh",
          "-c",
          "echo hello",
        ]),
        expect.any(Object),
      );
      expect(result.success).toBe(true);
      expect(result.executorType).toBe("process");
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const exec = createProcessExecutor({
        timeout: 60000,
      });

      const config = exec.getConfig();
      expect(config.timeout).toBe(60000);
      expect(config.allowFullAccess).toBe(
        DEFAULT_PROCESS_CONFIG.allowFullAccess,
      );
    });
  });
});
