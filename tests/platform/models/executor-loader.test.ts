/**
 * Executor Config Loader Tests
 *
 * KURISU-019 Phase 3.1: 测试执行器配置加载器
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import os from "os";
import {
  ExecutorConfigLoader,
  createExecutorConfigLoader,
  getDefaultExecutorConfig,
  getDefaultRoleToolConfig,
  expandPath,
  shortenPath,
} from "../../../src/platform/models/executor-loader";
import type { ExecutorSystemConfig } from "../../../src/platform/models/executor-types";

describe("ExecutorConfigLoader", () => {
  let tempDir: string;
  let loader: ExecutorConfigLoader;

  beforeEach(async () => {
    tempDir = join(os.tmpdir(), `kurisu-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    loader = new ExecutorConfigLoader(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("应该返回默认配置当配置文件不存在时", async () => {
      const config = await loader.load();

      expect(config.autoDetect).toBe(true);
      expect(config.defaultPermission).toBe("sandbox");
      expect(config.docker.image).toBe("kurisu-sandbox:latest");
    });

    it("应该加载并解析配置文件", async () => {
      const yamlContent = `
auto_detect: false
default_permission: restricted
docker:
  image: custom-image:latest
  sandbox_dir: /custom/workspace
  memory_limit: 1024
`;
      await writeFile(join(tempDir, "executor.yaml"), yamlContent);
      loader.clearCache();

      const config = await loader.load();

      expect(config.autoDetect).toBe(false);
      expect(config.defaultPermission).toBe("restricted");
      expect(config.docker.image).toBe("custom-image:latest");
      expect(config.docker.sandboxDir).toBe("/custom/workspace");
      expect(config.docker.memoryLimit).toBe(1024);
    });

    it("应该解析平台特定配置", async () => {
      const yamlContent = `
platforms:
  linux:
    prefer: docker
    fallback:
      type: process
      allow_full_access: false
  macos:
    prefer: docker
    fallback:
      type: process
      isolation: sandbox-exec
`;
      await writeFile(join(tempDir, "executor.yaml"), yamlContent);
      loader.clearCache();

      const config = await loader.load();

      expect(config.platforms["linux"]?.prefer).toBe("docker");
      expect(config.platforms["linux"]?.fallback?.type).toBe("process");
      expect(config.platforms["linux"]?.fallback?.allowFullAccess).toBe(false);
      expect(config.platforms["macos"]?.fallback?.isolation).toBe("sandbox-exec");
    });

    it("应该解析审批配置", async () => {
      const yamlContent = `
approval:
  timeout: 60000
  auto_reject_on_timeout: false
  critical_requires_reason: true
`;
      await writeFile(join(tempDir, "executor.yaml"), yamlContent);
      loader.clearCache();

      const config = await loader.load();

      expect(config.approval.timeout).toBe(60000);
      expect(config.approval.autoRejectOnTimeout).toBe(false);
      expect(config.approval.criticalRequiresReason).toBe(true);
    });

    it("应该解析受限模式配置", async () => {
      const yamlContent = `
restricted:
  allowed_paths:
    - ~/Documents
    - ~/Projects
    - ~/Downloads
`;
      await writeFile(join(tempDir, "executor.yaml"), yamlContent);
      loader.clearCache();

      const config = await loader.load();

      expect(config.restricted.allowedPaths).toContain("~/Documents");
      expect(config.restricted.allowedPaths).toContain("~/Projects");
      expect(config.restricted.allowedPaths).toContain("~/Downloads");
    });

    it("应该缓存加载的配置", async () => {
      const config1 = await loader.load();
      const config2 = await loader.load();

      expect(config1).toBe(config2);
    });
  });

  describe("save", () => {
    it("应该保存配置到文件", async () => {
      const config: ExecutorSystemConfig = {
        autoDetect: false,
        platforms: {},
        docker: {
          image: "test-image:latest",
          sandboxDir: "/test/workspace",
          memoryLimit: 256,
          cpuLimit: 0.25,
          timeout: 15000,
        },
        cloud: {
          endpoint: "https://test.example.com",
          apiKey: "test-key",
          timeout: 30000,
        },
        defaultPermission: "restricted",
        restricted: {
          allowedPaths: ["~/Documents"],
        },
        approval: {
          timeout: 45000,
          autoRejectOnTimeout: true,
          criticalRequiresReason: false,
        },
      };

      await loader.save(config);

      // 重新加载验证
      loader.clearCache();
      const loaded = await loader.load();

      expect(loaded.autoDetect).toBe(false);
      expect(loaded.defaultPermission).toBe("restricted");
      expect(loaded.docker.image).toBe("test-image:latest");
    });
  });

  describe("clearCache", () => {
    it("应该清除缓存的配置", async () => {
      const config1 = await loader.load();
      loader.clearCache();
      const config2 = await loader.load();

      // 不同的对象引用
      expect(config1).not.toBe(config2);
    });
  });
});

describe("getDefaultExecutorConfig", () => {
  it("应该返回有效的默认配置", () => {
    const config = getDefaultExecutorConfig();

    expect(config.autoDetect).toBe(true);
    expect(config.defaultPermission).toBe("sandbox");
    expect(config.docker.image).toBe("kurisu-sandbox:latest");
    expect(config.approval.timeout).toBe(30000);
  });
});

describe("getDefaultRoleToolConfig", () => {
  it("应该返回有效的默认角色工具配置", () => {
    const config = getDefaultRoleToolConfig();

    expect(config.filePermission).toBe("sandbox");
    expect(config.networkAccess).toBe(false);
  });
});

describe("expandPath", () => {
  it("应该展开 ~ 为用户主目录", () => {
    const homeDir = os.homedir();

    expect(expandPath("~/Documents")).toBe(join(homeDir, "Documents"));
    expect(expandPath("~/.config")).toBe(join(homeDir, ".config"));
  });

  it("应该保持绝对路径不变", () => {
    expect(expandPath("/usr/local/bin")).toBe("/usr/local/bin");
  });

  it("应该保持相对路径不变", () => {
    expect(expandPath("./test")).toBe("./test");
  });
});

describe("shortenPath", () => {
  it("应该将用户主目录替换为 ~", () => {
    const homeDir = os.homedir();

    expect(shortenPath(join(homeDir, "Documents"))).toBe("~/Documents");
    expect(shortenPath(join(homeDir, "Projects"))).toBe("~/Projects");
  });

  it("应该保持非主目录路径不变", () => {
    expect(shortenPath("/usr/local/bin")).toBe("/usr/local/bin");
  });
});
