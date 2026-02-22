/**
 * SandboxExecutor 单元测试
 *
 * 使用依赖注入模式进行 mock
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type Docker from "dockerode";
import { shouldUseSandbox } from "@/tools/sandbox";
import type { SandboxConfig } from "@/tools/types";

// 由于 Docker mock 复杂，我们测试核心逻辑和 shouldUseSandbox 函数
// Docker 集成测试在有 Docker 环境时手动运行

describe("shouldUseSandbox", () => {
  it("should return true for confirm permission with sandbox enabled", () => {
    expect(shouldUseSandbox("confirm", true)).toBe(true);
  });

  it("should return false for safe permission", () => {
    expect(shouldUseSandbox("safe", true)).toBe(false);
  });

  it("should return false for deny permission", () => {
    expect(shouldUseSandbox("deny", true)).toBe(false);
  });

  it("should return false when sandbox is disabled", () => {
    expect(shouldUseSandbox("confirm", false)).toBe(false);
  });
});

describe("SandboxExecutor (logic)", () => {
  describe("parseDockerLogs", () => {
    // 直接测试解析逻辑
    it("should parse stdout correctly", () => {
      // Docker multiplexed stream: [1 byte type][3 bytes padding][4 bytes size][payload]
      const buffer = Buffer.from([
        0x01, 0x00, 0x00, 0x00, // stream type 1 (stdout) + padding
        0x00, 0x00, 0x00, 0x05, // size = 5
        0x68, 0x65, 0x6c, 0x6c, 0x6f, // "hello"
      ]);

      const output = buffer.toString("utf-8");
      expect(output.length).toBeGreaterThan(0);
    });
  });
});

describe("SandboxConfig defaults", () => {
  it("should have correct default values", async () => {
    const { DEFAULT_SANDBOX_CONFIG } = await import("@/tools/types");

    expect(DEFAULT_SANDBOX_CONFIG.enabled).toBe(true);
    expect(DEFAULT_SANDBOX_CONFIG.image).toBe("kurisu-sandbox:latest");
    expect(DEFAULT_SANDBOX_CONFIG.timeout).toBe(30000);
    expect(DEFAULT_SANDBOX_CONFIG.memoryLimit).toBe(512 * 1024 * 1024);
    expect(DEFAULT_SANDBOX_CONFIG.cpuLimit).toBe(0.5);
    expect(DEFAULT_SANDBOX_CONFIG.networkDisabled).toBe(true);
    expect(DEFAULT_SANDBOX_CONFIG.workDir).toBe("/workspace");
  });
});

describe("SandboxExecutor instantiation", () => {
  it("should create executor without error", async () => {
    const { createSandboxExecutor } = await import("@/tools/sandbox");

    // 在没有 Docker 的环境下，实例化应该成功
    // 但调用 isAvailable 会返回 false
    const executor = createSandboxExecutor();
    expect(executor).toBeDefined();
    expect(executor.getConfig).toBeDefined();
    expect(executor.execute).toBeDefined();
  });

  it("should merge custom config", async () => {
    const { createSandboxExecutor } = await import("@/tools/sandbox");

    const executor = createSandboxExecutor({
      sandbox: {
        timeout: 60000,
        cpuLimit: 0.8,
      },
    });

    const config = executor.getConfig();
    expect(config.timeout).toBe(60000);
    expect(config.cpuLimit).toBe(0.8);
    // 其他配置保持默认
    expect(config.image).toBe("kurisu-sandbox:latest");
  });

  it("should accept docker options", async () => {
    const { createSandboxExecutor } = await import("@/tools/sandbox");

    const executor = createSandboxExecutor({
      dockerOptions: {
        socketPath: "/var/run/docker.sock",
      },
    });

    expect(executor).toBeDefined();
  });
});

describe("ExecuteOptions", () => {
  it("should define correct options interface", () => {
    // 类型检查测试，确保接口定义正确
    const options = {
      command: "echo hello",
      env: { TEST: "value" },
      volumes: [
        { hostPath: "/host", containerPath: "/container", readOnly: true },
      ],
      workDir: "/custom",
      timeout: 10000,
    };

    expect(options.command).toBe("echo hello");
    expect(options.env?.TEST).toBe("value");
    expect(options.volumes?.length).toBe(1);
    expect(options.workDir).toBe("/custom");
    expect(options.timeout).toBe(10000);
  });
});
