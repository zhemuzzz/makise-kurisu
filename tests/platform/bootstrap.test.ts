/**
 * Bootstrap 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * CFG-7: Bootstrap 序列
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Bootstrap", () => {
  let tempDir: string;
  let configDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-bootstrap-test-"));
    configDir = join(tempDir, "config");

    // 创建最小配置文件
    mkdirSync(join(configDir, "system"), { recursive: true });

    writeFileSync(
      join(configDir, "system", "platform.yaml"),
      `
storage:
  dataDir: ${join(tempDir, "data")}
  qdrant:
    host: localhost
    port: 6333

scheduler:
  evolutionInterval: 86400000
  heartbeatCheckInterval: 3600000
  ileDecayInterval: 1800000
  telemetryCleanupCron: "0 3 * * *"

context:
  safetyMargin: 0.2
  tokenEstimateDivisor: 3
  maxIterations: 25

executor:
  type: docker
  docker:
    image: kurisu-sandbox:latest
    memoryLimit: "512m"
    cpuLimit: "1.0"
    networkMode: none
    timeout: 30000
`,
    );

    writeFileSync(
      join(configDir, "system", "permissions.yaml"),
      `
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
`,
    );

    writeFileSync(
      join(configDir, "models.yaml"),
      `
models:
  - id: zhipu-glm5
    name: GLM-5 Plus
    provider: zhipu
    model: glm-5-plus
    endpoint: https://open.bigmodel.cn/api/paas/v4
    secretRef: zhipuApiKey
    capabilities:
      - chat

defaults:
  conversation: zhipu-glm5
  embedding: zhipu-glm5
`,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("BOOT-01: bootstrap 返回 Foundation 三件套", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key-for-bootstrap");

    const { bootstrap } = await import("@/platform/bootstrap");

    const foundation = await bootstrap({
      configDir,
      roles: ["kurisu"],
      skipQdrant: true,
      skipDotenv: true,
    });

    expect(foundation.config).toBeDefined();
    expect(foundation.tracing).toBeDefined();
    expect(foundation.stores).toBeDefined();
    expect(foundation.stores.get("kurisu")).toBeDefined();

    // ConfigManager 正确加载
    const storage = foundation.config.get("storage");
    expect(storage.dataDir).toBe(join(tempDir, "data"));

    // TracingService 可用 (bufferSize 包含 bootstrap:complete 事件)
    foundation.tracing.log({
      level: "info",
      category: "agent",
      event: "boot:test",
      timestamp: Date.now(),
    });
    expect(foundation.tracing.bufferSize).toBe(2);

    // RoleDataStore 正确创建
    const store = foundation.stores.get("kurisu")!;
    expect(store.roleId).toBe("kurisu");

    foundation.shutdown();
  });

  it("BOOT-02: bootstrap 顺序正确 — Config → Tracing → Store（H1）", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key-for-order");

    const { bootstrap } = await import("@/platform/bootstrap");

    const foundation = await bootstrap({
      configDir,
      roles: ["kurisu"],
      skipQdrant: true,
      skipDotenv: true,
    });

    // Config 已加载（否则 get() 会抛错）
    expect(() => foundation.config.get("storage")).not.toThrow();

    // TracingService 使用独立 platform SQLite（不依赖 RoleDataStore）
    expect(existsSync(join(tempDir, "data", "platform", "tracing.sqlite"))).toBe(true);

    // Store 使用了 config 中的 dataDir
    const store = foundation.stores.get("kurisu")!;
    expect(store.files.identityDir).toContain(join(tempDir, "data"));

    foundation.shutdown();
  });

  it("BOOT-03: shutdown 正确清理所有资源", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key-for-shutdown");

    const { bootstrap } = await import("@/platform/bootstrap");

    const foundation = await bootstrap({
      configDir,
      roles: ["kurisu"],
      skipQdrant: true,
      skipDotenv: true,
    });

    const store = foundation.stores.get("kurisu")!;

    // 写入一条 tracing 事件
    foundation.tracing.log({
      level: "info",
      category: "agent",
      event: "pre-shutdown",
      timestamp: Date.now(),
    });

    foundation.shutdown();

    // RoleDataStore SQLite 已关闭 — 操作应抛错
    expect(() => store.sqlite.prepare("SELECT 1").get()).toThrow();
  });

  it("BOOT-04: 无角色也能启动（TracingService 不依赖 RoleDataStore）", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key-for-no-roles");

    const { bootstrap } = await import("@/platform/bootstrap");

    const foundation = await bootstrap({
      configDir,
      roles: [],
      skipQdrant: true,
      skipDotenv: true,
    });

    // TracingService 仍然可用
    expect(foundation.tracing).toBeDefined();
    foundation.tracing.log({
      level: "info",
      category: "agent",
      event: "no-roles-test",
      timestamp: Date.now(),
    });
    expect(foundation.tracing.bufferSize).toBe(2); // bootstrap:complete + no-roles-test

    expect(foundation.stores.size).toBe(0);

    foundation.shutdown();
  });

  it("BOOT-05: bootstrap 返回包含 permissions 的 Foundation", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key-for-permissions");

    const { bootstrap } = await import("@/platform/bootstrap");

    const foundation = await bootstrap({
      configDir,
      roles: [],
      skipQdrant: true,
      skipDotenv: true,
    });

    expect(foundation.permissions).toBeDefined();
    expect(typeof foundation.permissions.check).toBe("function");
    expect(typeof foundation.permissions.getToolAnnotations).toBe("function");

    foundation.shutdown();
  });

  it("BOOT-06: PermissionService 使用 ConfigManager 的权限配置", async () => {
    // 写入带规则的 permissions.yaml
    writeFileSync(
      join(configDir, "system", "permissions.yaml"),
      `
version: "1.0"
defaultLevel: confirm
tools:
  safe:
    - web_search
  confirm:
    - shell
  deny:
    - file_delete
paths:
  deny: []
  confirm: []
  allow: []
shell:
  denyPatterns: []
  confirmPatterns: []
`,
    );

    vi.stubEnv("ZHIPU_API_KEY", "test-key-for-perm-config");

    const { bootstrap } = await import("@/platform/bootstrap");

    const foundation = await bootstrap({
      configDir,
      roles: [],
      skipQdrant: true,
      skipDotenv: true,
    });

    // 验证 PermissionService 使用了 config 中的规则
    expect(
      foundation.permissions.check({ action: "tool:execute", subject: "web_search" }),
    ).toBe("allow");
    expect(
      foundation.permissions.check({ action: "tool:execute", subject: "shell" }),
    ).toBe("confirm");
    expect(
      foundation.permissions.check({ action: "tool:execute", subject: "file_delete" }),
    ).toBe("deny");

    foundation.shutdown();
  });
});
