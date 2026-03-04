/**
 * 跨平台执行器 - Docker 执行器测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DockerExecutor,
  createDockerExecutor,
} from "../../../../src/platform/tools/executors/docker-executor";
import { DEFAULT_DOCKER_CONFIG } from "../../../../src/platform/tools/executors/types";

// Mock dockerode
vi.mock("dockerode", () => {
  const mockContainer = {
    start: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    logs: vi.fn().mockResolvedValue(
      Buffer.from(
        "\x01\x00\x00\x00\x00\x00\x00\x05Hello\x02\x00\x00\x00\x00\x00\x00\x05World",
      ),
    ),
    remove: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
  };

  const mockDocker = vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue("OK"),
    version: vi.fn().mockResolvedValue({ Version: "24.0.0" }),
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({}),
    }),
  }));

  return { default: mockDocker };
});

describe("DockerExecutor", () => {
  let executor: DockerExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = createDockerExecutor();
  });

  describe("constructor", () => {
    it("should create executor with default config", () => {
      const exec = createDockerExecutor();
      expect(exec).toBeInstanceOf(DockerExecutor);
    });

    it("should accept custom config", () => {
      const exec = createDockerExecutor({
        image: "custom-image:latest",
        memoryLimit: 1024,
      });

      const config = exec.getConfig();
      expect(config.image).toBe("custom-image:latest");
      expect(config.memoryLimit).toBe(1024);
    });
  });

  describe("getCapabilities", () => {
    it("should return capabilities", () => {
      const capabilities = executor.getCapabilities();

      expect(capabilities.isolation).toBe("docker");
      expect(capabilities.supportedPermissions).toContain("safe");
      expect(capabilities.supportedPermissions).toContain("confirm");
      expect(capabilities.supportedPermissions).toContain("deny");
      expect(capabilities.networkIsolation).toBe(true);
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

    it("should support deny permission", () => {
      expect(executor.supportsPermission("deny")).toBe(true);
    });
  });

  describe("healthCheck", () => {
    it("should return true when Docker is available", async () => {
      const result = await executor.healthCheck();
      expect(result).toBe(true);
    });
  });

  describe("hasImage", () => {
    it("should return true when image exists", async () => {
      const result = await executor.hasImage();
      expect(result).toBe(true);
    });
  });

  describe("execute", () => {
    it("should execute command successfully", async () => {
      const result = await executor.execute("echo hello", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
      });

      expect(result.success).toBe(true);
      expect(result.executorType).toBe("docker");
      expect(result.exitCode).toBe(0);
    });

    it("should reject confirm level without approval", async () => {
      const result = await executor.execute("rm -rf /", {
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

    it("should execute confirm level with approval", async () => {
      const result = await executor.execute("echo hello", {
        permission: "confirm",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
        approved: true,
      });

      expect(result.success).toBe(true);
    });

    it("should return error for invalid volume path", async () => {
      const result = await executor.execute("cat file.txt", {
        permission: "safe",
        networkAccess: false,
        timeout: 30000,
        workingDir: "/workspace",
        volumes: [
          {
            hostPath: "../etc/passwd", // Invalid: relative path with ..
            containerPath: "/data",
            readOnly: true,
          },
        ],
      });

      expect(result.success).toBe(false);
      expect(result.stderr).toContain("安全错误");
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const config = executor.getConfig();

      expect(config.image).toBe(DEFAULT_DOCKER_CONFIG.image);
      expect(config.sandboxDir).toBe(DEFAULT_DOCKER_CONFIG.sandboxDir);
    });
  });
});
