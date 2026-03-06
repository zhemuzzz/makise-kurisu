/**
 * Bootstrap Full 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * Phase 4c: Foundation → Domain Services → PlatformServices
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("bootstrapFull", () => {
  let tempDir: string;
  let configDir: string;
  let personasDir: string;

  beforeEach(() => {
    vi.resetModules();
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-bootstrap-full-"));
    configDir = join(tempDir, "config");
    personasDir = join(configDir, "personas");

    // 创建配置文件
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

skills:
  autoLoad: false
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
  - id: test-model
    name: Test Model
    provider: test
    model: test-v1
    endpoint: https://test.example.com/api
    secretRef: zhipuApiKey
    capabilities:
      - chat

defaults:
  conversation: test-model
  embedding: test-model
`,
    );

    // 创建测试角色配置
    const roleDir = join(personasDir, "test-role");
    mkdirSync(roleDir, { recursive: true });

    writeFileSync(
      join(roleDir, "soul.md"),
      `# Test Role

I am a test AI assistant created for integration testing.
My purpose is to verify the bootstrap pipeline works correctly.
`,
    );

    writeFileSync(
      join(roleDir, "persona.yaml"),
      `
speech:
  catchphrases:
    - "Testing in progress"
  patterns:
    greeting:
      - "Hello, test subject."
  tone:
    default: "neutral"
    testing: "precise"
behavior:
  tendencies:
    - analytical
  reactions:
    error: "Hmm, that's unexpected."
formatting:
  useEllipsis: false
  useDash: false
`,
    );

    writeFileSync(
      join(roleDir, "lore.md"),
      `# Test Lore

<!-- core -->
This is the core lore for the test role.
Created in a testing laboratory.
<!-- /core -->

## Extended Lore

This section should not be included in loreCore.
`,
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("BFULL-01: bootstrapFull 返回 BootstrapResult with Foundation + RoleServices", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      // Foundation 存在
      expect(result.foundation).toBeDefined();
      expect(result.foundation.config).toBeDefined();
      expect(result.foundation.tracing).toBeDefined();
      expect(result.foundation.stores).toBeDefined();

      // RoleServices 存在
      expect(result.roles.size).toBe(1);
      expect(result.roles.has("test-role")).toBe(true);
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-02: RoleServices 包含正确的 Identity", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = result.roles.get("test-role")!;

      // Identity 字段验证
      expect(role.identity.roleId).toBe("test-role");
      expect(role.identity.soul).toContain("I am a test AI assistant");
      expect(role.identity.persona.name).toBeDefined();
      expect(role.identity.loreCore).toContain("core lore for the test role");
      // loreCore 不应包含 extended lore
      expect(role.identity.loreCore).not.toContain("Extended Lore");
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-03: PlatformServices 包含所有 9 个 Port", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = result.roles.get("test-role")!;
      const svc = role.services;

      // 全部 9 个 Port 存在
      expect(svc.context).toBeDefined();
      expect(svc.tools).toBeDefined();
      expect(svc.skills).toBeDefined();
      expect(svc.subAgents).toBeDefined();
      expect(svc.permission).toBeDefined();
      expect(svc.approval).toBeDefined();
      expect(svc.tracing).toBeDefined();
      expect(svc.memory).toBeDefined();
      expect(svc.llm).toBeDefined();

      // 核心方法存在
      expect(typeof svc.context.assemblePrompt).toBe("function");
      expect(typeof svc.tools.execute).toBe("function");
      expect(typeof svc.skills.findSkill).toBe("function");
      expect(typeof svc.subAgents.spawn).toBe("function");
      expect(typeof svc.permission.check).toBe("function");
      expect(typeof svc.approval.requestApproval).toBe("function");
      expect(typeof svc.tracing.log).toBe("function");
      expect(typeof svc.memory.recall).toBe("function");
      expect(typeof svc.llm.stream).toBe("function");
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-04: 多角色支持 — 每个角色有独立的 PlatformServices", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    // 创建第二个角色
    const role2Dir = join(personasDir, "role-2");
    mkdirSync(role2Dir, { recursive: true });

    writeFileSync(join(role2Dir, "soul.md"), "# Role 2\nI am the second role.");
    writeFileSync(
      join(role2Dir, "persona.yaml"),
      `
speech:
  catchphrases: ["second"]
  patterns: {}
  tone:
    default: "calm"
behavior:
  tendencies: []
  reactions: {}
formatting:
  useEllipsis: true
  useDash: true
`,
    );
    writeFileSync(join(role2Dir, "lore.md"), "# Role 2 Lore\n<!-- core -->\nRole 2 lore.\n<!-- /core -->");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role", "role-2"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      expect(result.roles.size).toBe(2);
      expect(result.roles.get("test-role")!.identity.roleId).toBe("test-role");
      expect(result.roles.get("role-2")!.identity.roleId).toBe("role-2");

      // 不同角色有不同的 Identity
      expect(result.roles.get("test-role")!.identity.soul).toContain("test AI assistant");
      expect(result.roles.get("role-2")!.identity.soul).toContain("second role");

      // 每个角色有独立的 PlatformServices (不是同一个引用)
      expect(result.roles.get("test-role")!.services).not.toBe(
        result.roles.get("role-2")!.services,
      );
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-05: 角色不存在时抛错", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    await expect(
      bootstrapFull({
        configDir,
        roles: ["nonexistent"],
        personasDir,
        skipQdrant: true,
        skipDotenv: true,
      }),
    ).rejects.toThrow(/nonexistent/);
  });

  it("BFULL-06: shutdown 清理所有资源", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    const store = result.foundation.stores.get("test-role")!;
    result.shutdown();

    // SQLite 应已关闭
    expect(() => store.sqlite.prepare("SELECT 1").get()).toThrow();
  });

  it("BFULL-07: 无角色时返回空 roles Map", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: [],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      expect(result.roles.size).toBe(0);
      expect(result.foundation.tracing).toBeDefined();
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-08: setExecuteTask 注入 SubAgent 回调", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      // setExecuteTask 方法存在
      expect(typeof result.setExecuteTask).toBe("function");

      // 设置回调不抛错
      result.setExecuteTask(async () => ({
        result: "test",
        stats: {
          iterations: 0,
          toolCallCount: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          duration: 0,
          compactCount: 0,
        },
      }));
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-09: TracingPort 正确记录事件", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = result.roles.get("test-role")!;

      // TracingPort log 不抛错
      role.services.tracing.log({
        type: "test_event",
        sessionId: "sess-1",
        data: { foo: "bar" },
      });

      // TracingPort logMetric 不抛错
      role.services.tracing.logMetric("test_metric", 42, { sessionId: "sess-1" });
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-10a: RoleServices 包含 PersonaEngine", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const role = result.roles.get("test-role")!;

      // PersonaEngine 存在且有正确的 API
      expect(role.personaEngine).toBeDefined();
      expect(typeof role.personaEngine.buildContext).toBe("function");
      expect(typeof role.personaEngine.processTurn).toBe("function");
      expect(typeof role.personaEngine.getDebugSnapshot).toBe("function");

      // buildContext 不抛错
      const segments = role.personaEngine.buildContext("u1", {
        type: "private",
        targetUserId: "u1",
      });
      expect(segments.mentalModel).toBeDefined();
      expect(Array.isArray(segments.mentalModel)).toBe(true);

      // getDebugSnapshot 返回有效快照
      const snapshot = role.personaEngine.getDebugSnapshot("u1");
      expect(snapshot.roleId).toBe("test-role");
      expect(snapshot.snapshotAt).toBeGreaterThan(0);
    } finally {
      result.shutdown();
    }
  });

  it("BFULL-10: SkillManagerPort 基本操作不抛错", async () => {
    vi.stubEnv("ZHIPU_API_KEY", "test-key");

    const { bootstrapFull } = await import("@/platform/bootstrap.js");

    const result = await bootstrapFull({
      configDir,
      roles: ["test-role"],
      personasDir,
      skipQdrant: true,
      skipDotenv: true,
    });

    try {
      const skills = result.roles.get("test-role")!.services.skills;

      // findSkill 返回空数组
      const found = await skills.findSkill("test");
      expect(found).toEqual([]);

      // getActiveSkills 返回空数组
      const active = await skills.getActiveSkills("sess-1");
      expect(active).toEqual([]);
    } finally {
      result.shutdown();
    }
  });
});
