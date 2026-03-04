/**
 * MCP Server Config Loader Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import {
  MCPServerConfigLoader,
  getMCPServerConfigLoader,
  getMCPServerConfig,
  getMCPServerConfigs,
} from "../../../src/platform/skills/mcp-server-config";

describe("MCPServerConfigLoader", () => {
  let testDir: string;
  let testConfigPath: string;
  let loader: MCPServerConfigLoader;

  beforeEach(async () => {
    testDir = join(__dirname, "test-mcp-config");
    testConfigPath = join(testDir, "mcp-servers.yaml");
    await mkdir(testDir, { recursive: true });

    // Reset singleton for each test
    MCPServerConfigLoader.resetInstance();
    loader = MCPServerConfigLoader.getInstance(testConfigPath);
  });

  afterEach(async () => {
    MCPServerConfigLoader.resetInstance();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("应该成功加载有效的配置文件", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "/tmp/workspace"
`,
      );

      const config = await loader.load();

      expect(config.servers).toHaveProperty("filesystem");
      expect(config.servers.filesystem?.command).toBe("npx");
      expect(config.servers.filesystem?.args).toHaveLength(3);
    });

    it("应该返回空配置如果文件不存在", async () => {
      const config = await loader.load();

      expect(config.servers).toEqual({});
    });

    it("应该缓存配置（单例模式）", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  test:
    command: echo
`,
      );

      const config1 = await loader.load();
      const config2 = await loader.load();

      expect(config1).toBe(config2); // 同一个引用
    });

    it("应该处理 env 中的环境变量替换", async () => {
      // 设置测试环境变量
      process.env.TEST_API_KEY = "test-key-123";

      await writeFile(
        testConfigPath,
        `
servers:
  api-server:
    command: npx
    args:
      - "server"
    env:
      API_KEY: "\${TEST_API_KEY}"
`,
      );

      const config = await loader.load();

      expect(config.servers["api-server"]?.env?.API_KEY).toBe("test-key-123");

      // 清理环境变量
      delete process.env.TEST_API_KEY;
    });

    it("应该保留未找到的环境变量占位符", async () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await writeFile(
        testConfigPath,
        `
servers:
  api-server:
    command: npx
    args:
      - "server"
    env:
      API_KEY: "\${NONEXISTENT_KEY}"
`,
      );

      const config = await loader.load();

      expect(config.servers["api-server"]?.env?.API_KEY).toBe(
        "${NONEXISTENT_KEY}",
      );
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("应该替换 args 中的静态环境变量", async () => {
      process.env.TEST_WORKSPACE = "/custom/path";

      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "-y"
      - "\${TEST_WORKSPACE}"
`,
      );

      const config = await loader.load();

      expect(config.servers.filesystem?.args).toContain("/custom/path");

      delete process.env.TEST_WORKSPACE;
    });

    it("应该替换 cwd 中的静态环境变量", async () => {
      process.env.TEST_CWD = "/test/cwd";

      await writeFile(
        testConfigPath,
        `
servers:
  test:
    command: echo
    cwd: "\${TEST_CWD}"
`,
      );

      const config = await loader.load();

      expect(config.servers.test?.cwd).toBe("/test/cwd");

      delete process.env.TEST_CWD;
    });
  });

  describe("两阶段变量替换（KURISU-026 Phase 1）", () => {
    it("Stage 1 应该跳过 WORKING_DIR 运行时变量", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "-y"
      - "\${WORKING_DIR}"
    cwd: "\${WORKING_DIR}"
`,
      );

      const config = await loader.load();

      // Stage 1 应保留 ${WORKING_DIR} 占位符
      expect(config.servers.filesystem?.args).toContain("${WORKING_DIR}");
      expect(config.servers.filesystem?.cwd).toBe("${WORKING_DIR}");
    });

    it("Stage 1 应该跳过 SESSION_ID 运行时变量", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  test:
    command: echo
    env:
      SID: "\${SESSION_ID}"
`,
      );

      const config = await loader.load();

      expect(config.servers.test?.env?.SID).toBe("${SESSION_ID}");
    });

    it("即使 process.env 中有 WORKING_DIR 也应跳过", async () => {
      // 模拟 Docker 环境注入的 WORKING_DIR
      process.env.WORKING_DIR = "/docker/workspace";

      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "\${WORKING_DIR}"
`,
      );

      const config = await loader.load();

      // 应保留占位符，不使用 process.env.WORKING_DIR
      expect(config.servers.filesystem?.args).toContain("${WORKING_DIR}");

      delete process.env.WORKING_DIR;
    });

    it("应该同时替换静态变量和保留运行时变量", async () => {
      process.env.TEST_STATIC = "static-value";

      await writeFile(
        testConfigPath,
        `
servers:
  mixed:
    command: npx
    args:
      - "\${TEST_STATIC}"
      - "\${WORKING_DIR}"
    env:
      KEY: "\${TEST_STATIC}"
`,
      );

      const config = await loader.load();

      expect(config.servers.mixed?.args?.[0]).toBe("static-value");
      expect(config.servers.mixed?.args?.[1]).toBe("${WORKING_DIR}");
      expect(config.servers.mixed?.env?.KEY).toBe("static-value");

      delete process.env.TEST_STATIC;
    });
  });

  describe("getResolvedServerConfig（Stage 2）", () => {
    it("应该用运行时变量替换 WORKING_DIR", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
      - "\${WORKING_DIR}"
    cwd: "\${WORKING_DIR}"
`,
      );

      const resolved = await loader.getResolvedServerConfig("filesystem", {
        runtimeVars: { WORKING_DIR: "/home/user/project" },
      });

      expect(resolved).toBeDefined();
      expect(resolved!.args).toContain("/home/user/project");
      expect(resolved!.cwd).toBe("/home/user/project");
    });

    it("应该替换 args 中多个位置的 WORKING_DIR", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  git:
    command: uvx
    args:
      - "mcp-server-git"
      - "--repository"
      - "\${WORKING_DIR}"
    cwd: "\${WORKING_DIR}"
`,
      );

      const resolved = await loader.getResolvedServerConfig("git", {
        runtimeVars: { WORKING_DIR: "/tmp/myproject" },
      });

      expect(resolved!.args?.[2]).toBe("/tmp/myproject");
      expect(resolved!.cwd).toBe("/tmp/myproject");
    });

    it("不存在的 server 应返回 undefined", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  test:
    command: echo
`,
      );

      const resolved = await loader.getResolvedServerConfig("nonexistent", {
        runtimeVars: { WORKING_DIR: "/tmp" },
      });

      expect(resolved).toBeUndefined();
    });

    it("无运行时变量的 server 配置应原样返回", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  time:
    command: npx
    args:
      - "-y"
      - "mcp-server-time"
`,
      );

      const resolved = await loader.getResolvedServerConfig("time", {
        runtimeVars: { WORKING_DIR: "/tmp" },
      });

      expect(resolved!.args).toEqual(["-y", "mcp-server-time"]);
    });
  });

  describe("getResolvedServerConfigs（Stage 2 批量）", () => {
    it("应该批量解析运行时变量", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "\${WORKING_DIR}"
  git:
    command: uvx
    args:
      - "\${WORKING_DIR}"
  time:
    command: npx
    args:
      - "time"
`,
      );

      const configs = await loader.getResolvedServerConfigs(
        ["filesystem", "git", "time"],
        { runtimeVars: { WORKING_DIR: "/resolved/path" } },
      );

      expect(configs.mcpServers.filesystem?.args?.[0]).toBe("/resolved/path");
      expect(configs.mcpServers.git?.args?.[0]).toBe("/resolved/path");
      expect(configs.mcpServers.time?.args?.[0]).toBe("time");
    });
  });

  describe("getWorkDirDependentServers", () => {
    it("应该返回含 ${WORKING_DIR} 的 server 列表", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  filesystem:
    command: npx
    args:
      - "\${WORKING_DIR}"
  git:
    command: uvx
    args:
      - "--repository"
      - "\${WORKING_DIR}"
  time:
    command: npx
    args:
      - "time"
  search:
    command: npx
    env:
      MODE: stdio
`,
      );

      const dependent = await loader.getWorkDirDependentServers();

      expect(dependent).toContain("filesystem");
      expect(dependent).toContain("git");
      expect(dependent).not.toContain("time");
      expect(dependent).not.toContain("search");
    });

    it("应该检测 cwd 中的 WORKING_DIR", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  custom:
    command: node
    cwd: "\${WORKING_DIR}"
`,
      );

      const dependent = await loader.getWorkDirDependentServers();

      expect(dependent).toContain("custom");
    });

    it("空配置应返回空数组", async () => {
      const dependent = await loader.getWorkDirDependentServers();

      expect(dependent).toEqual([]);
    });
  });

  describe("getServerConfig", () => {
    it("应该返回指定 server 的配置", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  git:
    command: uvx
    args:
      - "mcp-server-git"
`,
      );

      const serverConfig = await loader.getServerConfig("git");

      expect(serverConfig).toBeDefined();
      expect(serverConfig?.command).toBe("uvx");
    });

    it("应该返回 undefined 如果 server 不存在", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  git:
    command: uvx
`,
      );

      const serverConfig = await loader.getServerConfig("nonexistent");

      expect(serverConfig).toBeUndefined();
    });
  });

  describe("getServerConfigs", () => {
    it("应该返回多个 server 的配置", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  git:
    command: uvx
    args:
      - "mcp-server-git"
  filesystem:
    command: npx
    args:
      - "@modelcontextprotocol/server-filesystem"
`,
      );

      const configs = await loader.getServerConfigs(["git", "filesystem"]);

      expect(configs.mcpServers).toHaveProperty("git");
      expect(configs.mcpServers).toHaveProperty("filesystem");
    });

    it("应该忽略不存在的 server", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  git:
    command: uvx
`,
      );

      const configs = await loader.getServerConfigs([
        "git",
        "nonexistent",
        "also-nonexistent",
      ]);

      expect(Object.keys(configs.mcpServers)).toHaveLength(1);
      expect(configs.mcpServers).toHaveProperty("git");
    });
  });

  describe("listServerNames", () => {
    it("应该返回所有 server 名称", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  git:
    command: uvx
  filesystem:
    command: npx
  time:
    command: npx
`,
      );

      const names = await loader.listServerNames();

      expect(names).toHaveLength(3);
      expect(names).toContain("git");
      expect(names).toContain("filesystem");
      expect(names).toContain("time");
    });

    it("应该返回空数组如果无配置", async () => {
      const names = await loader.listServerNames();

      expect(names).toEqual([]);
    });
  });

  describe("reload", () => {
    it("应该重新加载配置", async () => {
      await writeFile(
        testConfigPath,
        `
servers:
  initial:
    command: echo
`,
      );

      const config1 = await loader.load();
      expect(config1.servers).toHaveProperty("initial");

      // 修改配置文件
      await writeFile(
        testConfigPath,
        `
servers:
  updated:
    command: echo
`,
      );

      const config2 = await loader.reload();

      expect(config2.servers).not.toHaveProperty("initial");
      expect(config2.servers).toHaveProperty("updated");
    });
  });
});

describe("便捷函数", () => {
  let testDir: string;
  let testConfigPath: string;

  beforeEach(async () => {
    testDir = join(__dirname, "test-mcp-config-helper");
    testConfigPath = join(testDir, "mcp-servers.yaml");
    await mkdir(testDir, { recursive: true });
    MCPServerConfigLoader.resetInstance();
  });

  afterEach(async () => {
    MCPServerConfigLoader.resetInstance();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("getMCPServerConfig", () => {
    it("应该返回指定 server 的配置", async () => {
      // 首先获取 loader 并加载配置
      const loader = getMCPServerConfigLoader(testConfigPath);

      await writeFile(
        testConfigPath,
        `
servers:
  test:
    command: npx
`,
      );

      // 先加载配置
      await loader.load();

      const config = await getMCPServerConfig("test");
      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
    });
  });

  describe("getMCPServerConfigs", () => {
    it("应该返回多个 server 的配置", async () => {
      const loader = getMCPServerConfigLoader(testConfigPath);

      await writeFile(
        testConfigPath,
        `
servers:
  test1:
    command: echo
  test2:
    command: ls
`,
      );

      // 先加载配置
      await loader.load();

      const configs = await getMCPServerConfigs(["test1", "test2"]);

      expect(configs.mcpServers).toHaveProperty("test1");
      expect(configs.mcpServers).toHaveProperty("test2");
    });
  });
});

describe("getInstance", () => {
  beforeEach(() => {
    MCPServerConfigLoader.resetInstance();
  });

  afterEach(() => {
    MCPServerConfigLoader.resetInstance();
  });

  it("应该返回单例实例", () => {
    const instance1 = getMCPServerConfigLoader();
    const instance2 = getMCPServerConfigLoader();

    expect(instance1).toBe(instance2);
  });

  it("应该在路径变化时创建新实例", () => {
    const instance1 = getMCPServerConfigLoader("path1");
    const instance2 = getMCPServerConfigLoader("path2");

    expect(instance1).not.toBe(instance2);
  });
});
