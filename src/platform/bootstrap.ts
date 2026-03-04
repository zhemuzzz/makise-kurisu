/**
 * Bootstrap 序列
 * 位置: src/platform/bootstrap.ts
 *
 * CFG-7: ConfigManager → TracingService → RoleDataStore
 * 所有 Platform Services 的初始化入口
 */

import { mkdirSync } from "fs";
import { join } from "path";
import BetterSqlite3 from "better-sqlite3";
import type { ConfigManager } from "./config-manager.js";
import { createConfigManager } from "./config-manager.js";
import type { TracingService } from "./tracing-service.js";
import { createTracingService, TELEMETRY_SCHEMA, migrateTelemetryOutcomeColumn } from "./tracing-service.js";
import type { RoleDataStore } from "./storage/role-data-store.js";
import { createRoleDataStore } from "./storage/role-data-store-factory.js";
import type { PermissionService } from "./permission-service.js";
import { createPermissionService } from "./permission-service.js";
import { RoleLoader } from "./identity/role-loader.js";
import type { RoleConfig } from "./identity/soul-types.js";
import type {
  Identity,
  PersonaConfig as AgentPersonaConfig,
} from "../agent/types.js";
import type {
  PlatformServices,
  SkillManagerPort,
  ContextManagerPort,
  ToolExecutorPort,
  ApprovalPort,
  MemoryPort,
  LLMProviderPort,
} from "../agent/ports/platform-services.js";
import {
  SubAgentManager,
  type ExecuteTaskFn,
} from "./sub-agent-manager.js";
import { TracingAdapter } from "./adapters/tracing-adapter.js";
import { PermissionAdapter } from "./adapters/permission-adapter.js";
import type { EventBus } from "./event-bus.js";
import { createEventBus } from "./event-bus.js";
import type { Scheduler } from "./scheduler.js";
import { createScheduler } from "./scheduler.js";
import type { RoutineSystem } from "./routine-system.js";
import { createRoutineSystem } from "./routine-system.js";
import { createTestRunner } from "../evolution/validation/test-runner.js";
import { createValidationService } from "../evolution/validation/validation-service.js";
import { createKnowledgeStoreApplicator } from "../evolution/applicators/knowledge-store-applicator.js";
import { createSkillManagerApplicator } from "../evolution/applicators/skill-manager-applicator.js";
import { createRoutineRegistryApplicator } from "../evolution/applicators/routine-registry-applicator.js";
import { createSandboxApplicator } from "../evolution/applicators/sandbox-applicator.js";
import { createConfigApplicator } from "../evolution/applicators/config-applicator.js";
import type { MutationPipeline } from "../evolution/mutation-pipeline.js";
import { createMutationPipeline } from "../evolution/mutation-pipeline.js";
import type { EvolutionService } from "../evolution/evolution-service.js";
import { createEvolutionService } from "../evolution/evolution-service.js";
import type { MutationApplicator } from "../evolution/applicators/types.js";
import type { IBrowserService } from "./browser/types.js";
import { createBrowserService } from "./browser/stagehand-service.js";

// ============ 类型 ============

export interface BootstrapOptions {
  readonly configDir: string;
  readonly roles: readonly string[];
  readonly skipQdrant?: boolean;
  readonly skipDotenv?: boolean;
}

export interface Foundation {
  readonly config: ConfigManager;
  readonly tracing: TracingService;
  readonly stores: ReadonlyMap<string, RoleDataStore>;
  readonly permissions: PermissionService;
  shutdown(): void;
}

// ============ Bootstrap ============

export async function bootstrap(options: BootstrapOptions): Promise<Foundation> {
  const skipQdrant = options.skipQdrant ?? false;
  const skipDotenv = options.skipDotenv ?? false;

  // Step 1: ConfigManager（CFG-7 第一位）
  const config = createConfigManager({
    platformYamlPath: join(options.configDir, "system", "platform.yaml"),
    modelsYamlPath: join(options.configDir, "models.yaml"),
    permissionsYamlPath: join(options.configDir, "system", "permissions.yaml"),
    skipDotenv,
  });
  await config.load();

  const storageConfig = config.get("storage");
  const secrets = config.get("secrets");

  // Step 2: TracingService（独立 platform SQLite，不依赖 RoleDataStore）
  const platformDbDir = join(storageConfig.dataDir, "platform");
  mkdirSync(platformDbDir, { recursive: true });

  const tracingSqlite = new BetterSqlite3(join(platformDbDir, "tracing.sqlite"));
  tracingSqlite.pragma("journal_mode = WAL");
  tracingSqlite.exec(TELEMETRY_SCHEMA);
  migrateTelemetryOutcomeColumn(tracingSqlite);

  // CFG-5: 收集已知 secret 值供 TracingService 脱敏
  const secretValues = Object.values(secrets).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );

  const tracing = createTracingService({
    sqlite: tracingSqlite,
    debugEnabled: typeof process !== "undefined" && !!process.env["DEBUG"]?.includes("kurisu"),
    secretValues,
    silentStderr: false,
  });

  // Step 3: 创建所有角色的 RoleDataStore
  const stores = new Map<string, RoleDataStore>();

  for (const roleId of options.roles) {
    const storeOptions: Parameters<typeof createRoleDataStore>[0] = {
      roleId,
      dataDir: storageConfig.dataDir,
      embeddingDimensions: 1024,
      skipQdrant,
      ...(storageConfig.qdrant?.host ? { qdrantHost: storageConfig.qdrant.host } : {}),
      ...(storageConfig.qdrant?.port ? { qdrantPort: storageConfig.qdrant.port } : {}),
    };
    try {
      const store = await createRoleDataStore(storeOptions);
      stores.set(roleId, store);
    } catch (error) {
      // Clean up already-created stores on failure
      for (const store of stores.values()) {
        store.close();
      }
      tracing.dispose();
      tracingSqlite.close();
      throw error;
    }
  }

  // Step 4: PermissionService (PS-1~4)
  const permissions = createPermissionService({
    config: config.get("permissions"),
  });

  tracing.log({
    level: "info",
    category: "agent",
    event: "bootstrap:complete",
    data: { roles: [...options.roles], skipQdrant },
    timestamp: Date.now(),
  });

  const immutableStores: ReadonlyMap<string, RoleDataStore> = stores;

  return {
    config,
    tracing,
    stores: immutableStores,
    permissions,
    shutdown() {
      tracing.dispose();
      for (const store of stores.values()) {
        store.close();
      }
      tracingSqlite.close();
    },
  };
}

// ============ BootstrapFull Types ============

export { type ExecuteTaskFn } from "./sub-agent-manager.js";

export interface BootstrapFullOptions extends BootstrapOptions {
  readonly personasDir: string;
}

export interface RoleServices {
  readonly identity: Identity;
  readonly services: PlatformServices;
}

export interface BackgroundServices {
  readonly eventBus: EventBus;
  readonly scheduler: Scheduler;
  readonly routineSystem: RoutineSystem;
  readonly pipeline: MutationPipeline;
  readonly evolution: EvolutionService;
}

export interface BootstrapResult {
  readonly foundation: Foundation;
  readonly roles: ReadonlyMap<string, RoleServices>;
  readonly background: BackgroundServices;
  /** 浏览器服务（可选，仅当 browserUse 配置存在时创建） */
  readonly browserService: IBrowserService | null;
  readonly setExecuteTask: (fn: ExecuteTaskFn) => void;
  readonly shutdown: () => void;
}

// ============ BootstrapFull ============

/**
 * 完整启动序列: Foundation → RoleConfig → Identity → PlatformServices
 *
 * Phase 4c: 扩展 bootstrap() 以创建每个角色的 PlatformServices
 */
export async function bootstrapFull(
  options: BootstrapFullOptions,
): Promise<BootstrapResult> {
  const foundation = await bootstrap(options);
  const loader = new RoleLoader(options.personasDir);
  const roles = new Map<string, RoleServices>();

  // SA-1: SubAgentManager with deferred executeTask injection (closure pattern)
  let currentExecuteTask: ExecuteTaskFn = async () => ({
    result: undefined,
    stats: {
      iterations: 0,
      toolCallCount: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      duration: 0,
      compactCount: 0,
    },
  });

  const subAgentManager = new SubAgentManager({
    executeTask: (config) => currentExecuteTask(config),
  });

  const noopSkillManager = createNoopSkillManagerPort();

  for (const roleId of options.roles) {
    try {
      const roleConfig = await loader.load(roleId);
      const identity = roleConfigToIdentity(roleConfig);

      const services: PlatformServices = {
        context: createNoopContextManagerPort(),
        tools: createNoopToolExecutorPort(),
        skills: noopSkillManager,
        subAgents: subAgentManager,
        permission: new PermissionAdapter(foundation.permissions),
        approval: createNoopApprovalPort(),
        tracing: new TracingAdapter(foundation.tracing),
        memory: createNoopMemoryPort(),
        llm: createNoopLLMProviderPort(),
      };

      roles.set(roleId, { identity, services });
    } catch (error) {
      foundation.shutdown();
      throw error;
    }
  }

  // ============ Background Services (Phase 5a/5b/5c/5d/5e) ============

  // Tracing wrapper that auto-adds timestamp for background services
  const bgTracing = {
    log(event: unknown): void {
      const e = event as Record<string, unknown>;
      const withTimestamp = e["timestamp"]
        ? e
        : Object.assign({}, e, { timestamp: Date.now() });
      foundation.tracing.log(withTimestamp as unknown as Parameters<typeof foundation.tracing.log>[0]);
    },
  };

  const eventBus = createEventBus();
  const scheduler = createScheduler({
    eventBus,
    tracing: foundation.tracing,
  });

  // RoutineSystem — 需要 config/system/routines.yaml 路径
  const routineSystem = createRoutineSystem({
    scheduler,
    tracing: foundation.tracing,
    eventBus,
    routineConfig: foundation.config.get("routine"),
    yamlPath: join(options.configDir, "system", "routines.yaml"),
  });

  // Evolution subsystem — 使用第一个角色的 SQLite（单角色 MVP）
  const firstRoleId = options.roles[0];
  const firstStore = firstRoleId ? foundation.stores.get(firstRoleId) : undefined;

  const mutationConfig = foundation.config.get("mutation");
  const evolutionConfig = foundation.config.get("evolution");

  // TestRunner (graceful degradation — null deps)
  const testRunner = createTestRunner({
    toolExecutor: null,
    configManager: null,
    tracing: bgTracing,
  });

  // ValidationService
  const validationService = createValidationService({
    permissionService: foundation.permissions,
    vectorStore: null,
    embeddingProvider: null,
    testRunner,
    mutationConfig,
    tracing: bgTracing,
  });

  // Applicators
  const applicators = new Map<string, MutationApplicator>();
  applicators.set("knowledge-store", createKnowledgeStoreApplicator({
    write: async () => `k-${Date.now()}`,
    archive: async () => {},
    delete: async () => {},
  }));
  applicators.set("skill-manager", createSkillManagerApplicator({
    createDraft: async () => "draft-noop",
    confirmDraft: async () => {},
    archive: async () => {},
  }));
  applicators.set("routine-registry", createRoutineRegistryApplicator({
    add: async (entry) => {
      const opt = entry as { id?: string; name?: string; description?: string; trigger?: string };
      const rt = routineSystem.add({
        name: String(opt["name"] ?? ""),
        description: String(opt["description"] ?? ""),
        enabled: true,
        trigger: String(opt["trigger"] ?? "interval:3600000"),
        source: "self",
      });
      return rt.id;
    },
    update: async (id, updates) => { routineSystem.update(id, updates); },
    remove: async (id) => { routineSystem.remove(id); },
  }));
  applicators.set("sandbox", createSandboxApplicator({
    execute: async () => ({ success: false, output: "Sandbox not configured", exitCode: 1 }),
  }));
  applicators.set("config-manager", createConfigApplicator());

  // MutationPipeline
  const pipelineSqlite = firstStore?.sqlite ?? createInMemorySqlite();
  const pipeline = createMutationPipeline({
    sqlite: pipelineSqlite,
    validationService,
    applicators,
    tracing: bgTracing,
    mutationConfig,
  });

  // EvolutionService
  const evolution = createEvolutionService({
    evolutionConfig,
    pipeline,
    tracing: bgTracing,
    executeBackgroundTask: async () => {
      // Stub — replaced via setExecuteTask in production
    },
  });

  // Wire RoutineSystem task handler → EvolutionService
  routineSystem.setTaskHandler(async (routine) => {
    await evolution.executeRoutine(routine.id, routine.name);
  });

  const background: BackgroundServices = {
    eventBus,
    scheduler,
    routineSystem,
    pipeline,
    evolution,
  };

  // ============ Browser Service (Phase 6a: WB-1~7) ============

  // 可选初始化: 仅当 browserUse 配置存在时创建 (lazy init — 首次工具调用时启动 Chromium)
  const browserUseConfig = foundation.config.get("browserUse");
  const browserService: IBrowserService | null = browserUseConfig
    ? createBrowserService(browserUseConfig)
    : null;

  return {
    foundation,
    roles,
    background,
    browserService,
    setExecuteTask(fn: ExecuteTaskFn) {
      currentExecuteTask = fn;
    },
    shutdown() {
      if (browserService) {
        browserService.close().catch(() => {/* graceful: ignore close errors */});
      }
      evolution.dispose();
      routineSystem.dispose();
      scheduler.dispose();
      eventBus.dispose();
      foundation.shutdown();
    },
  };
}

// ============ Identity Conversion ============

/**
 * RoleConfig → Agent Identity 类型转换
 *
 * soul-types PersonaConfig { speech, behavior, formatting }
 *   → agent PersonaConfig { name, catchphrases, tone, reactions }
 */
export function roleConfigToIdentity(roleConfig: RoleConfig): Identity {
  const reactions = flattenReactions(roleConfig.persona.behavior.reactions);

  const persona: AgentPersonaConfig = {
    name: roleConfig.meta.name,
    catchphrases: [...roleConfig.persona.speech.catchphrases],
    tone: roleConfig.persona.speech.tone["default"] ?? "",
    reactions,
  };

  return {
    roleId: roleConfig.id,
    soul: roleConfig.soul.rawContent,
    persona,
    loreCore: extractLoreCore(roleConfig.lore.rawContent),
  };
}

/**
 * 从 lore.md 提取 <!-- core --> 标记间内容
 */
export function extractLoreCore(rawContent: string): string {
  const match = rawContent.match(/<!-- core -->([\s\S]*?)<!-- \/core -->/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return "";
}

/**
 * BehaviorReaction → string 扁平化
 *
 * 处理两种运行时格式:
 * - YAML 直接写 string: { error: "Hmm" }
 * - BehaviorReaction 对象: { error: { speech: "Hmm", thought: "..." } }
 */
function flattenReactions(
  reactions: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(reactions)) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (value !== null && typeof value === "object") {
      const obj = value as Record<string, string | undefined>;
      result[key] = obj["speech"] ?? obj["action"] ?? obj["thought"] ?? "";
    }
  }
  return result;
}

// ============ Noop Port Factories ============

/**
 * In-memory SQLite for MutationPipeline when no RoleDataStore available
 */
function createInMemorySqlite(): { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } } {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

function createNoopSkillManagerPort(): SkillManagerPort {
  return {
    findSkill: async () => [],
    getActiveSkills: async () => [],
    activate: async (skillId, _sessionId, injectionLevel) => ({
      id: skillId,
      name: skillId,
      injectionLevel,
      activatedAt: Date.now(),
    }),
    archive: async () => true,
    createDraft: async () => "draft-noop",
    confirmDraft: async () => true,
  };
}

function createNoopContextManagerPort(): ContextManagerPort {
  return {
    assemblePrompt: async () => [],
    checkBudget: () => ({
      withinBudget: true,
      currentTokens: 0,
      maxTokens: 128000,
      remainingTokens: 128000,
      shouldCompact: false,
      shouldDegrade: false,
    }),
    processLLMOutput: (raw) => ({ visibleContent: raw, truncated: false }),
    processToolResult: () => "",
    compact: async (messages) => ({
      messages,
      tokensBefore: 0,
      tokensAfter: 0,
      success: true,
    }),
    getStats: () => ({
      totalTokens: 0,
      priorityDistribution: {},
      compactCount: 0,
    }),
  };
}

function createNoopToolExecutorPort(): ToolExecutorPort {
  return {
    execute: async (toolCall) => ({
      callId: toolCall.id,
      toolName: toolCall.name,
      success: true,
      output: "",
      latency: 0,
    }),
    executeBatch: async () => [],
    getToolDefinitions: async () => [],
    isToolAvailable: () => false,
  };
}

function createNoopApprovalPort(): ApprovalPort {
  return {
    requestApproval: async () => "noop",
    awaitResponse: async (approvalId) => ({
      approvalId,
      action: "reject" as const,
    }),
    handleUserResponse: () => {},
    rejectAllPending: () => {},
    getPendingCount: () => 0,
  };
}

function createNoopMemoryPort(): MemoryPort {
  return {
    recall: async () => [],
    store: async () => {},
  };
}

function createNoopLLMProviderPort(): LLMProviderPort {
  return {
    async *stream() {
      return {
        content: "",
        finishReason: "stop" as const,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    },
    getAvailableModels: () => [],
    isModelAvailable: () => false,
  };
}
