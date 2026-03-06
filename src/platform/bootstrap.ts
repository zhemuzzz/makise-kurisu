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
import { ContextManagerAdapter } from "./adapters/context-manager-adapter.js";
import { LLMProviderAdapter } from "./adapters/llm-provider-adapter.js";
import { ToolExecutorAdapter } from "./adapters/tool-executor-adapter.js";
import { ApprovalAdapter } from "./adapters/approval-adapter.js";
import { MemoryAdapter } from "./adapters/memory-adapter.js";
// createContextManager is now used internally by ContextManagerAdapter
import { createApprovalService } from "./approval-service.js";
import type { ApprovalService } from "./approval-service.js";
import { ToolRegistry } from "./tools/registry.js";
import { createMCPBridge } from "./tools/mcp-bridge.js";
import type { MCPBridge } from "./tools/mcp-bridge.js";
import { HybridMemoryEngine } from "./memory/hybrid-engine.js";
import { createModelProvider } from "./models/index.js";
import type { ModelConfig } from "./models/types.js";
import type { IModelProvider } from "./models/types.js";
import type { ModelProviderConfig as PlatformModelProviderConfig } from "./types/config.js";
import { createSkillRegistry } from "./skills/registry.js";
import type { SkillRegistry } from "./skills/registry.js";
import { createSkillIntentClassifier } from "./skills/intent-classifier.js";
import type { ISkillIntentClassifier } from "./skills/intent-classifier.js";
import { createSkillManager } from "./skills/skill-manager.js";
import type { ISkillManager } from "./skills/skill-manager.js";
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
import { createCognitionStore } from "./storage/cognition-store.js";
import type { CognitionStore } from "./storage/cognition-store.js";
import { SessionStateImpl } from "../agent/meta-tools/session-state-impl.js";
import type { SessionState } from "../agent/meta-tools/types.js";
import type { MetaToolDeps } from "./adapters/tool-executor-adapter.js";
import type { PersonaEngineAPI } from "../inner-life/types.js";
import { createPersonaEngine, KURISU_ENGINE_CONFIG, formatILESummary } from "../inner-life/index.js";
import { createSQLiteStateStore } from "../inner-life/orchestrator/sqlite-state-store.js";
import { handleTimeTick, createTickPreCheck } from "./time-tick-handler.js";

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
  /** 认知持久化 (stateDir/cognition.md) */
  readonly cognitionStore: CognitionStore;
  /**
   * 获取最新认知内容（内存优先，始终是最新值）
   * GatewayOrchestrator 用此 getter 注入 prompt
   */
  readonly getCognition: () => string;
  /** ILE PersonaEngine（mood/关系/时间感知） */
  readonly personaEngine: PersonaEngineAPI;
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

// ============ Config Conversion Helpers ============

/**
 * PlatformConfig 的 secrets 结构中按 secretRef 键查找实际密钥值
 */
function resolveSecretRef(
  ref: string,
  secrets: { readonly zhipuApiKey: string; readonly telegramBotToken?: string; readonly qqBotToken?: string; readonly qdrantApiKey?: string },
): string {
  const map: Record<string, string | undefined> = {
    zhipuApiKey: secrets.zhipuApiKey,
    telegramBotToken: secrets.telegramBotToken,
    qqBotToken: secrets.qqBotToken,
    qdrantApiKey: secrets.qdrantApiKey,
  };
  return map[ref] ?? "";
}

/**
 * ModelProviderConfig[] → ModelConfig[] 转换
 * PlatformConfig 存储的模型配置 → ModelProvider 需要的格式
 */
function convertToModelConfigs(
  providers: readonly PlatformModelProviderConfig[],
  secrets: { readonly zhipuApiKey: string; readonly telegramBotToken?: string; readonly qqBotToken?: string; readonly qdrantApiKey?: string },
): ModelConfig[] {
  return providers.map((p) => {
    const base = {
      name: p.id,
      type: "cloud" as const,
      provider: p.provider,
      endpoint: p.endpoint,
      apiKey: resolveSecretRef(p.secretRef, secrets),
      model: p.model,
    };
    if (p.limits?.maxTokens !== undefined) {
      return { ...base, maxTokens: p.limits.maxTokens };
    }
    return base;
  });
}

// ============ Phase: Shared Infrastructure ============

interface SharedInfra {
  readonly subAgentManager: SubAgentManager;
  readonly skillManager: ISkillManager;
  readonly approvalService: ApprovalService;
  readonly toolRegistry: ToolRegistry;
  readonly memoryEngine: HybridMemoryEngine;
  readonly modelProvider: IModelProvider | null;
  readonly mcpBridge: MCPBridge;
  readonly skillRegistry: SkillRegistry;
  readonly intentClassifier: ISkillIntentClassifier;
  readonly summarizeFn: (text: string) => Promise<string>;
  readonly setExecuteTask: (fn: ExecuteTaskFn) => void;
}

function initSharedInfra(foundation: Foundation): SharedInfra {
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

  const approvalService: ApprovalService = createApprovalService();
  const memoryEngine = new HybridMemoryEngine();

  // ModelProvider: convert PlatformConfig → ModelConfig[] with secret resolution
  const modelsConfig = foundation.config.get("models");
  const secrets = foundation.config.get("secrets");
  let modelProvider: IModelProvider | null = null;
  try {
    const modelConfigs = convertToModelConfigs(modelsConfig.providers, secrets);
    modelProvider = createModelProvider(
      modelConfigs,
      modelsConfig.defaults as unknown as Record<string, string>,
    );
  } catch (error) {
    foundation.tracing.log({
      level: "warn",
      category: "agent",
      event: "bootstrap:model-provider-failed",
      data: { error: String(error) },
      timestamp: Date.now(),
    });
  }

  // MCPBridge: MCP Server 连接管理
  const mcpBridge = createMCPBridge({
    connectionTimeout: 10000,
    toolCallTimeout: 30000,
    autoReconnect: true,
  });

  // ToolRegistry: 工具注册表（注入 MCPBridge）
  const toolRegistry = new ToolRegistry({ mcpBridge });

  // SkillRegistry: Skill 注册表（注入 MCPBridge）
  const skillsConfig = foundation.config.get("skills");
  const skillRegistry = createSkillRegistry({
    mcpBridge,
    skillsDir: skillsConfig.skillsDir,
  });

  // IntentClassifier: 意图分类器（注入 SkillRegistry + ModelProvider）
  const intentClassifierConfig = {
    skillRegistry,
    capability: skillsConfig.classifierCapability,
    confidenceThreshold: skillsConfig.classifierConfidence,
    timeout: skillsConfig.classifierTimeout,
    ...(modelProvider !== null && { modelProvider }),
  };
  const intentClassifier = createSkillIntentClassifier(intentClassifierConfig);

  // SkillManager: Skill 管理器（注入 SkillRegistry + IntentClassifier）
  const skillManager = createSkillManager({
    skillRegistry,
    intentClassifier,
    maxActivePerSession: skillsConfig.maxActivePerSession,
  });

  // summarizeFn: uses chat model for compact summaries (fallback: truncate)
  const capturedModelProvider = modelProvider;
  const summarizeFn = async (text: string): Promise<string> => {
    if (capturedModelProvider === null) {
      return text.length > 200 ? text.slice(0, 200) + "..." : text;
    }
    try {
      const chatModel = capturedModelProvider.getByCapability("chat");
      const response = await chatModel.chat(
        [{ role: "user", content: `请用中文简洁总结以下对话内容:\n${text}` }],
        { maxTokens: 500 },
      );
      return response.content;
    } catch {
      return text.length > 200 ? text.slice(0, 200) + "..." : text;
    }
  };

  return {
    subAgentManager,
    skillManager,
    approvalService,
    toolRegistry,
    memoryEngine,
    modelProvider,
    mcpBridge,
    skillRegistry,
    intentClassifier,
    summarizeFn,
    setExecuteTask(fn: ExecuteTaskFn) {
      currentExecuteTask = fn;
    },
  };
}

// ============ Phase: Per-Role Services ============

async function initRoleServices(
  options: BootstrapFullOptions,
  foundation: Foundation,
  shared: SharedInfra,
): Promise<Map<string, RoleServices>> {
  const loader = new RoleLoader(options.personasDir);
  const roles = new Map<string, RoleServices>();
  const contextConfig = foundation.config.get("context");

  for (const roleId of options.roles) {
    try {
      const roleConfig = await loader.load(roleId);
      const identity = roleConfigToIdentity(roleConfig);

      // Per-role ContextManagerOptions (different identityContent per role)
      const identityContent = [
        identity.soul,
        JSON.stringify(identity.persona),
        identity.loreCore,
      ].join("\n");

      const contextManagerOptions = {
        totalContextTokens: 128000,
        identityContent,
        safetyMarginTokens: Math.floor(128000 * contextConfig.safetyMargin),
        tokenEstimateDivisor: contextConfig.tokenEstimateDivisor,
      };

      // PersonaEngine (ILE): mood/关系/时间感知
      const roleStore = foundation.stores.get(roleId);
      const ileStateStore = roleStore?.sqlite
        ? createSQLiteStateStore(roleStore.sqlite)
        : undefined;
      // TODO: per-role engine config — 当前单角色 MVP 只用 Kurisu 配置
      const engineConfig = { ...KURISU_ENGINE_CONFIG, roleId };
      const personaEngine = createPersonaEngine(engineConfig, ileStateStore);

      // CognitionStore: 持久化到 stateDir，启动时加载已保存内容
      const cognitionStore = createCognitionStore({
        stateDir: roleStore?.files.stateDir ?? "",
        initialContent: roleConfig.cognition.rawContent,
      });
      const persistedCognition = await cognitionStore.read();

      // 共享认知引用: SessionStateImpl 写入时更新，GatewayOrchestrator 每轮读取
      let latestCognition = persistedCognition;
      const onCognitionUpdate = (content: string): void => {
        latestCognition = content;
      };

      // Per-role SessionState 管理 (MetaToolContext 需要)
      const sessionStates = new Map<string, SessionState>();

      const metaToolDeps: MetaToolDeps = {
        getSessionState(sessionId: string): SessionState {
          const existing = sessionStates.get(sessionId);
          if (existing) return existing;
          const newState = persistedCognition.length > 0
            ? new SessionStateImpl({
                cognitionStore,
                initialCognition: { content: persistedCognition, formattedText: persistedCognition },
                onCognitionUpdate,
              })
            : new SessionStateImpl({ cognitionStore, onCognitionUpdate });
          sessionStates.set(sessionId, newState);
          return newState;
        },
        skills: shared.skillManager,
        subAgents: shared.subAgentManager,
        agentId: roleId,
      };

      const services: PlatformServices = {
        context: new ContextManagerAdapter(contextManagerOptions, shared.summarizeFn),
        tools: new ToolExecutorAdapter(shared.toolRegistry, metaToolDeps),
        skills: shared.skillManager,
        subAgents: shared.subAgentManager,
        permission: new PermissionAdapter(foundation.permissions),
        approval: new ApprovalAdapter(shared.approvalService),
        tracing: new TracingAdapter(foundation.tracing),
        memory: new MemoryAdapter(shared.memoryEngine),
        llm: shared.modelProvider !== null
          ? new LLMProviderAdapter(shared.modelProvider)
          : createNoopLLMProviderPort(),
      };

      roles.set(roleId, {
        identity,
        services,
        cognitionStore,
        getCognition: () => latestCognition,
        personaEngine,
      });
    } catch (error) {
      foundation.shutdown();
      throw error;
    }
  }

  return roles;
}

// ============ Phase: Background Services ============

function initBackgroundServices(
  options: BootstrapFullOptions,
  foundation: Foundation,
  roles: ReadonlyMap<string, RoleServices>,
): BackgroundServices {
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
  const getILESummary = (): string => {
    const summaries: string[] = [];
    for (const [, role] of roles) {
      summaries.push(formatILESummary(role.personaEngine.getDebugSnapshot()));
    }
    return summaries.join("\n");
  };

  const evolution = createEvolutionService({
    evolutionConfig,
    pipeline,
    tracing: bgTracing,
    executeBackgroundTask: async () => {
      // Stub — replaced via setExecuteTask in production
    },
    getILESummary,
  });

  // Wire RoutineSystem task handler → route by routine name
  const engines = new Map<string, PersonaEngineAPI>();
  for (const [roleId, role] of roles) {
    engines.set(roleId, role.personaEngine);
  }

  routineSystem.setTaskHandler(async (routine) => {
    if (routine.name === "时间感知") {
      handleTimeTick({
        engines,
        onAction: (event) => {
          foundation.tracing.log({
            level: "info",
            category: "ile",
            event: "proactive:action",
            data: { ...event },
            timestamp: event.timestamp,
          });
        },
      });
    } else {
      await evolution.executeRoutine(routine.id, routine.name);
    }
  });

  // Register preCheck: ile:shouldTick — frequency tiering by silence duration
  routineSystem.registerPreCheck("ile:shouldTick", createTickPreCheck(engines));

  return { eventBus, scheduler, routineSystem, pipeline, evolution };
}

// ============ BootstrapFull ============

/**
 * 完整启动序列: Foundation → SharedInfra → RoleServices → Background → Browser
 *
 * Phase 4c: 扩展 bootstrap() 以创建每个角色的 PlatformServices
 * C3: 拆分为 4 个 phase 函数，bootstrapFull 仅做编排
 */
export async function bootstrapFull(
  options: BootstrapFullOptions,
): Promise<BootstrapResult> {
  // Phase 1: Foundation (ConfigManager → TracingService → RoleDataStore → PermissionService)
  const foundation = await bootstrap(options);

  // Phase 2: Shared infrastructure (SubAgentManager, ModelProvider, adapters)
  const shared = initSharedInfra(foundation);

  // Phase 2.5: Load Skills from directory (if autoLoad enabled)
  const skillsConfig = foundation.config.get("skills");
  if (skillsConfig.autoLoad) {
    try {
      await shared.skillRegistry.loadFromDirectory(skillsConfig.skillsDir);
      foundation.tracing.log({
        level: "info",
        category: "agent",
        event: "bootstrap:skills-loaded",
        data: {
          skillsDir: skillsConfig.skillsDir,
          count: shared.skillRegistry.list().length,
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      foundation.tracing.log({
        level: "warn",
        category: "agent",
        event: "bootstrap:skills-load-failed",
        data: { error: String(error) },
        timestamp: Date.now(),
      });
    }
  }

  // Phase 3: Per-role Identity + PlatformServices
  const roles = await initRoleServices(options, foundation, shared);

  // Phase 4: Background services (EventBus, Scheduler, RoutineSystem, Evolution)
  const background = initBackgroundServices(options, foundation, roles);

  // Phase 5: Browser service (optional, lazy init)
  const browserUseConfig = foundation.config.get("browserUse");
  const browserService: IBrowserService | null = browserUseConfig
    ? createBrowserService(browserUseConfig)
    : null;

  return {
    foundation,
    roles,
    background,
    browserService,
    setExecuteTask: shared.setExecuteTask,
    shutdown() {
      if (browserService) {
        browserService.close().catch(() => {/* graceful: ignore close errors */});
      }
      background.evolution.dispose();
      background.routineSystem.dispose();
      background.scheduler.dispose();
      background.eventBus.dispose();
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

// ============ Noop Port Factories (exported for tests + graceful degradation) ============

/**
 * In-memory SQLite for MutationPipeline when no RoleDataStore available
 */
function createInMemorySqlite(): { exec(sql: string): void; prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[] } } {
  const db = new BetterSqlite3(":memory:");
  db.pragma("journal_mode = WAL");
  return db;
}

export function createNoopContextManagerPort(): ContextManagerPort {
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

export function createNoopToolExecutorPort(): ToolExecutorPort {
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

export function createNoopApprovalPort(): ApprovalPort {
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

export function createNoopMemoryPort(): MemoryPort {
  return {
    recall: async () => [],
    store: async () => {},
  };
}

function createNoopLLMProviderPort(): LLMProviderPort {
  return {
    async *stream() {
      yield { delta: "" };
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
