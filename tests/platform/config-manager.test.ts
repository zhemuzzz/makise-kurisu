/**
 * ConfigManager 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * 测试覆盖 CFG-1 ~ CFG-7
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";

// Fixture: minimal valid platform.yaml content
const MINIMAL_PLATFORM_YAML = `
storage:
  dataDir: ./data
scheduler: {}
context: {}
executor:
  type: docker
gateway: {}
`;

// Fixture: models.yaml content with providers
const MINIMAL_MODELS_YAML = `
defaults:
  chat: zhipu-glm5
  embedding: zhipu-embedding
models:
  - id: zhipu-glm5
    provider: zhipu
    model: glm-5-plus
    endpoint: https://open.bigmodel.cn/api/paas/v4
    secretRef: zhipuApiKey
    capabilities: [chat]
  - id: zhipu-embedding
    provider: zhipu
    model: embedding-3
    endpoint: https://open.bigmodel.cn/api/paas/v4
    secretRef: zhipuApiKey
    capabilities: [embedding]
`;

const MINIMAL_PERMISSIONS_YAML = `
version: "1.0"
defaultLevel: confirm
tools:
  safe: []
  confirm: []
  deny: []
paths:
  deny: []
  confirm: []
  allow: []
shell:
  denyPatterns: []
  confirmPatterns: []
`;

describe("ConfigManager", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // CFG-1: load() + get() + getAll()
  describe("CFG-1: Core Interface", () => {
    it("CM-01: load() 从 YAML 文件加载并合并配置", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");

      // 提供必要的 secrets
      process.env["ZHIPU_API_KEY"] = "test-api-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });

      await cm.load();

      const storage = cm.get("storage");
      expect(storage.dataDir).toBe("./data");
    });

    it("CM-02: get<K>() 按分区获取配置，类型安全", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      const context = cm.get("context");
      expect(context.safetyMargin).toBe(0.2);
      expect(context.tokenEstimateDivisor).toBe(3);
      expect(context.maxIterations).toBe(25);
    });

    it("CM-03: load() 未调用时 get() 抛出错误", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });

      expect(() => cm.get("storage")).toThrow("ConfigManager 尚未加载");
    });
  });

  // CFG-3: 分层合并
  describe("CFG-3: Layered Merge", () => {
    it("CM-04: 环境变量覆盖 YAML 值", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";
      process.env["KURISU_STORAGE_DATA_DIR"] = "/custom/data";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      expect(cm.get("storage").dataDir).toBe("/custom/data");
    });

    it("CM-05: 未配置项使用代码默认值", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("minimal-platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      const scheduler = cm.get("scheduler");
      expect(scheduler.evolutionInterval).toBe(86400000);
      expect(scheduler.heartbeatCheckInterval).toBe(3600000);
    });
  });

  // CFG-4: 启动验证
  describe("CFG-4: Startup Validation", () => {
    it("CM-06: 缺少必要配置时抛出包含所有错误的异常", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      // 不设置 ZHIPU_API_KEY

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });

      await expect(cm.load()).rejects.toThrow("配置验证失败");
    });

    it("CM-07: 条件验证 — 配置了 telegram 但缺少 token", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform-with-telegram.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });

      await expect(cm.load()).rejects.toThrow("TELEGRAM_BOT_TOKEN");
    });

    it("CM-08: 条件验证通过 — 配置了 telegram 且有 token", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";
      process.env["TELEGRAM_BOT_TOKEN"] = "test-bot-token";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform-with-telegram.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });

      await expect(cm.load()).resolves.toBeUndefined();
    });
  });

  // CFG-5: Secrets 安全
  describe("CFG-5: Secrets Security", () => {
    it("CM-09: secrets 仅从 process.env 加载", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "real-key-from-env";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      expect(cm.get("secrets").zhipuApiKey).toBe("real-key-from-env");
    });

    it("CM-10: getAll() 返回的 secrets 值为 '***' 掩码", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "super-secret-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      const all = cm.getAll();
      expect(all.secrets.zhipuApiKey).toBe("***");
    });
  });

  // Deep freeze
  describe("Immutability", () => {
    it("CM-11: 返回的配置对象不可修改 (deep frozen)", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      const storage = cm.get("storage");
      expect(() => {
        (storage as Record<string, unknown>)["dataDir"] = "hacked";
      }).toThrow();
    });
  });

  // Models 加载
  describe("Models Loading", () => {
    it("CM-12: models.yaml 中的 providers 正确加载", async () => {
      const { createConfigManager } = await import("@/platform/config-manager");
      process.env["ZHIPU_API_KEY"] = "test-api-key";

      const cm = createConfigManager({
        platformYamlPath: fixtureFile("platform.yaml"),
        modelsYamlPath: fixtureFile("models.yaml"),
        permissionsYamlPath: fixtureFile("permissions.yaml"),
        skipDotenv: true,
      });
      await cm.load();

      const models = cm.get("models");
      expect(models.providers).toHaveLength(2);
      expect(models.defaults.main).toBe("zhipu-glm5");
      expect(models.defaults.embedding).toBe("zhipu-embedding");
    });
  });
});

// ============ Helper ============

import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";

let tempDir: string;

function fixtureFile(name: string): string {
  if (!tempDir) {
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-config-test-"));
    // Write fixture files
    writeFileSync(join(tempDir, "platform.yaml"), MINIMAL_PLATFORM_YAML);
    writeFileSync(join(tempDir, "models.yaml"), MINIMAL_MODELS_YAML);
    writeFileSync(join(tempDir, "permissions.yaml"), MINIMAL_PERMISSIONS_YAML);
    writeFileSync(
      join(tempDir, "minimal-platform.yaml"),
      `
storage:
  dataDir: ./data
gateway: {}
`,
    );
    writeFileSync(
      join(tempDir, "platform-with-telegram.yaml"),
      `
storage:
  dataDir: ./data
gateway:
  telegram:
    webhookUrl: https://example.com/webhook
`,
    );
  }
  return join(tempDir, name);
}
