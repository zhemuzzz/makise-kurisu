/**
 * 跨平台执行器 - Termux 执行器测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  TermuxExecutor,
  createTermuxExecutor,
} from "../../../../src/platform/tools/executors/termux-executor";
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

// Mock fs at module level
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));

vi.mock("fs", () => ({
  existsSync: mockExistsSync,
}));

describe("TermuxExecutor", () => {
  let executor: TermuxExecutor;
  let mockProcess: {
    stdout: { on: vi.Mock };
    stderr: { on: vi.Mock };
    on: vi.Mock;
    kill: vi.Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default to Android Termux environment
    vi.mocked(platform.detectPlatform).mockReturnValue({
      platform: "android",
      osType: "linux",
      isTermux: true,
      homeDir: "/data/data/com.termux/files/home",
      tempDir: "/data/data/com.termux/files/usr/tmp",
    });

    // Reset mock process
    mockProcess = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockProcess);
    mockExistsSync.mockReturnValue(true);

    executor = createTermuxExecutor();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create executor with default config", () => {
      const exec = createTermuxExecutor();
      expect(exec).toBeInstanceOf(TermuxExecutor);
    });

    it("should accept custom config", () => {
      const exec = createTermuxExecutor({
        rootfs: "/data/rootfs",
        timeout: 60000,
      });

      const config = exec.getConfig();
      expect(config.rootfs).toBe("/data/rootfs");
      expect(config.timeout).toBe(60000);
    });
  });

  describe("isTermuxEnvironment", () => {
    it("should return true when in Termux", () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "android",
        osType: "linux",
        isTermux: true,
        homeDir: "/data/data/com.termux/files/home",
        tempDir: "/data/data/com.termux/files/usr/tmp",
      });

      expect(TermuxExecutor.isTermuxEnvironment()).toBe(true);
    });

    it("should return false when not in Termux", () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "linux",
        osType: "linux",
        isTermux: false,
        homeDir: "/home/test",
        tempDir: "/tmp",
      });

      expect(TermuxExecutor.isTermuxEnvironment()).toBe(false);
    });
  });

  describe("isProotAvailable", () => {
    it("should return true when proot is available", async () => {
      const mockWhichProcess = {
        on: vi
          .fn()
          .mockImplementation(
            (event: string, callback: (code: number | null) => void) => {
              if (event === "close") {
                callback(0);
              }
            },
          ),
      };
      mockSpawn.mockReturnValueOnce(mockWhichProcess);

      const result = await TermuxExecutor.isProotAvailable();
      expect(result).toBe(true);
    });

    it("should return false when proot is not available", async () => {
      const mockWhichProcess = {
        on: vi
          .fn()
          .mockImplementation(
            (event: string, callback: (code: number | null) => void) => {
              if (event === "close") {
                callback(1);
              }
            },
          ),
      };
      mockSpawn.mockReturnValueOnce(mockWhichProcess);

      const result = await TermuxExecutor.isProotAvailable();
      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      const mockWhichProcess = {
        on: vi
          .fn()
          .mockImplementation(
            (event: string, callback: (error: Error) => void) => {
              if (event === "error") {
                callback(new Error("Command not found"));
              }
            },
          ),
      };
      mockSpawn.mockReturnValueOnce(mockWhichProcess);

      const result = await TermuxExecutor.isProotAvailable();
      expect(result).toBe(false);
    });
  });

  describe("getCapabilities", () => {
    it("should return capabilities for Android", () => {
      const capabilities = executor.getCapabilities();

      expect(capabilities.platform).toBe("android");
      expect(capabilities.isolation).toBe("process");
      expect(capabilities.supportedPermissions).toContain("safe");
      expect(capabilities.supportedPermissions).toContain("confirm");
      expect(capabilities.networkIsolation).toBe(false);
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
    it("should return true when in Termux environment", async () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "android",
        osType: "linux",
        isTermux: true,
        homeDir: "/data/data/com.termux/files/home",
        tempDir: "/data/data/com.termux/files/usr/tmp",
      });

      const result = await executor.healthCheck();
      expect(result).toBe(true);
    });

    it("should return false when not in Termux environment", async () => {
      vi.mocked(platform.detectPlatform).mockReturnValue({
        platform: "linux",
        osType: "linux",
        isTermux: false,
        homeDir: "/home/test",
        tempDir: "/tmp",
      });

      const result = await executor.healthCheck();
      expect(result).toBe(false);
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
      expect(result.stderr).toContain("Dangerous command");
    });

    // Note: proot execution with rootfs is tested via integration tests
    // since it requires fs.existsSync to work correctly with mocking

    it("should execute command directly when no rootfs configured", async () => {
      const execNoRootfs = createTermuxExecutor({
        rootfs: "",
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

      const result = await execNoRootfs.execute("echo hello", {
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

    it("should include Termux environment variables", async () => {
      // Set up process env
      process.env["TERMUX_VERSION"] = "0.118";
      process.env["PREFIX"] = "/data/data/com.termux/files/usr";

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
      });

      // Check spawn was called with Termux env
      const spawnCall = mockSpawn.mock.calls[0];
      const options = spawnCall[2] as { env?: Record<string, string> };

      expect(options.env).toBeDefined();
      expect(options.env?.["TERMUX_VERSION"]).toBe("0.118");

      // Clean up
      delete process.env["TERMUX_VERSION"];
      delete process.env["PREFIX"];
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const exec = createTermuxExecutor({
        rootfs: "/custom/rootfs",
        timeout: 45000,
      });

      const config = exec.getConfig();
      expect(config.rootfs).toBe("/custom/rootfs");
      expect(config.timeout).toBe(45000);
    });
  });
});
