/**
 * PlatformConfig 类型定义 + Zod 校验 Schema
 * 位置: src/platform/types/config.ts
 *
 * CFG-2: PlatformConfig 结构（8 个分区）
 * CFG-4: 启动验证规则
 */

import { z } from "zod";

// ============ Model Provider ============

export interface ModelProviderConfig {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly endpoint: string;
  readonly secretRef: string;
  readonly capabilities: readonly ("chat" | "embedding" | "vision")[];
  readonly limits?: {
    readonly maxTokens?: number;
    readonly rateLimit?: number;
  };
}

const ModelProviderConfigSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  endpoint: z.string().url(),
  secretRef: z.string().min(1),
  capabilities: z.array(z.enum(["chat", "embedding", "vision"])).min(1),
  limits: z
    .object({
      maxTokens: z.number().positive().optional(),
      rateLimit: z.number().positive().optional(),
    })
    .optional(),
});

// ============ Permission (PS-2: 结构化规则配置) ============

export interface PermissionConfig {
  readonly version: string;
  readonly defaultLevel: "safe" | "confirm" | "deny";
  readonly tools: {
    readonly safe: readonly string[];
    readonly confirm: readonly string[];
    readonly deny: readonly string[];
  };
  readonly paths: {
    readonly deny: readonly string[];
    readonly confirm: readonly string[];
    readonly allow: readonly string[];
  };
  readonly shell: {
    readonly denyPatterns: readonly string[];
    readonly confirmPatterns: readonly string[];
  };
}

const PermissionToolsSchema = z.object({
  safe: z.array(z.string()).default([]),
  confirm: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

const PermissionPathsSchema = z.object({
  deny: z.array(z.string()).default([]),
  confirm: z.array(z.string()).default([]),
  allow: z.array(z.string()).default([]),
});

const PermissionShellSchema = z.object({
  denyPatterns: z.array(z.string()).default([]),
  confirmPatterns: z.array(z.string()).default([]),
});

const PermissionConfigSchema = z.object({
  version: z.string().default("1.0"),
  defaultLevel: z.enum(["safe", "confirm", "deny"]).default("confirm"),
  tools: PermissionToolsSchema.default({}),
  paths: PermissionPathsSchema.default({}),
  shell: PermissionShellSchema.default({}),
});

// ============ Routine (Phase 5b: RoutineSystem RT-1~5) ============

export type RoutinePermissionLevel = "low" | "confirm" | "high";
export type RoutineSource = "system" | "persona" | "user" | "self";

export interface RoutineConfig {
  /** 总开关——false 时所有 routine 不运行 */
  readonly enabled: boolean;
  /** 允许运行的来源类型（渐进启用） */
  readonly enabledSources: readonly RoutineSource[];
  /** 每个角色最大 routine 条数 (RT-C) */
  readonly maxRoutinesPerRole: number;
  /** 过期清理检查周期 (ms) */
  readonly cleanupIntervalMs: number;
  /** 新建 routine 的默认权限级别 */
  readonly defaultPermissionLevel: RoutinePermissionLevel;
}

export const RoutineConfigSchema = z.object({
  enabled: z.boolean().default(false),
  enabledSources: z
    .array(z.enum(["system", "persona", "user", "self"]))
    .default(["system"]),
  maxRoutinesPerRole: z.number().int().positive().default(50),
  cleanupIntervalMs: z.number().int().positive().default(3600000),
  defaultPermissionLevel: z.enum(["low", "confirm", "high"]).default("confirm"),
});

export const ROUTINE_CONFIG_DEFAULTS: RoutineConfig = {
  enabled: false,
  enabledSources: ["system"],
  maxRoutinesPerRole: 50,
  cleanupIntervalMs: 3600000,
  defaultPermissionLevel: "confirm",
} as const;

// ============ Skills (Phase 3c: Skill System 2.0) ============

export interface SkillsConfig {
  /** Skills 目录路径 */
  readonly skillsDir: string;
  /** 是否在 bootstrap 时自动加载 Skills（默认 true） */
  readonly autoLoad: boolean;
  /** 分类器 capability (用于 LLM prompt，如 "conversation", "coding") */
  readonly classifierCapability: string;
  /** LLM 分类器超时 (毫秒) */
  readonly classifierTimeout: number;
  /** LLM 分类器最低置信度阈值 (0-1) */
  readonly classifierConfidence: number;
  /** 每个 Session 最大激活 Skill 数 */
  readonly maxActivePerSession: number;
  /** KnowledgeStore 容量上限 */
  readonly knowledgeCapacity: number;
  /** 单条知识最大 Token 数 */
  readonly knowledgeMaxTokensPerEntry: number;
  /** 三写补偿间隔 (毫秒) */
  readonly compensationIntervalMs: number;
}

export const SkillsConfigSchema = z.object({
  skillsDir: z.string().min(1).default("./config/skills"),
  autoLoad: z.boolean().default(true),
  classifierCapability: z.string().min(1).default("conversation"),
  classifierTimeout: z.number().positive().default(3000),
  classifierConfidence: z.number().min(0).max(1).default(0.6),
  maxActivePerSession: z.number().int().positive().default(5),
  knowledgeCapacity: z.number().int().positive().default(500),
  knowledgeMaxTokensPerEntry: z.number().positive().default(2000),
  compensationIntervalMs: z.number().positive().default(1800000),
});

export const SKILLS_CONFIG_DEFAULTS: SkillsConfig = {
  skillsDir: "./config/skills",
  autoLoad: true,
  classifierCapability: "conversation",
  classifierTimeout: 3000,
  classifierConfidence: 0.6,
  maxActivePerSession: 5,
  knowledgeCapacity: 500,
  knowledgeMaxTokensPerEntry: 2000,
  compensationIntervalMs: 1800000,
} as const;

// ============ Evolution (Phase 5c: EV-1~8) ============

export interface EvolutionConfig {
  /** 总开关——false 时 EvolutionService 不运行 */
  readonly enabled: boolean;
  /** session:end 后延迟触发反思 (ms) */
  readonly reflectionDelayMs: number;
  /** 反思/学习单次最大 token 数 */
  readonly reflectionMaxTokens: number;
}

export const EvolutionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  reflectionDelayMs: z.number().int().positive().default(5000),
  reflectionMaxTokens: z.number().int().positive().default(4000),
});

export const EVOLUTION_CONFIG_DEFAULTS: EvolutionConfig = {
  enabled: false,
  reflectionDelayMs: 5000,
  reflectionMaxTokens: 4000,
} as const;

// ============ Mutation (Phase 5d: MP-1~7) ============

export interface MutationConfig {
  /** 单次 submit() 最大 mutation 条数 */
  readonly maxPerSubmit: number;
  /** 验证超时 (ms) */
  readonly validationTimeoutMs: number;
  /** 代码类验证超时 (ms) */
  readonly codeValidationTimeoutMs: number;
  /** mutation_log 日志保留天数 */
  readonly logRetentionDays: number;
  /** 每日处理上限 */
  readonly dailyLimit: number;
  /** 语义去重合并阈值 (0-1) */
  readonly dedupThreshold: number;
  /** 语义去重跳过阈值 (0-1) */
  readonly dedupSkipThreshold: number;
}

export const MutationConfigSchema = z.object({
  maxPerSubmit: z.number().int().positive().default(10),
  validationTimeoutMs: z.number().int().positive().default(30000),
  codeValidationTimeoutMs: z.number().int().positive().default(60000),
  logRetentionDays: z.number().int().positive().default(90),
  dailyLimit: z.number().int().positive().default(100),
  dedupThreshold: z.number().min(0).max(1).default(0.85),
  dedupSkipThreshold: z.number().min(0).max(1).default(0.95),
});

export const MUTATION_CONFIG_DEFAULTS: MutationConfig = {
  maxPerSubmit: 10,
  validationTimeoutMs: 30000,
  codeValidationTimeoutMs: 60000,
  logRetentionDays: 90,
  dailyLimit: 100,
  dedupThreshold: 0.85,
  dedupSkipThreshold: 0.95,
} as const;

// ============ BrowserUse (Phase 6a: WB-1~7) ============

/**
 * Stagehand model 配置: 字符串或对象（Provider 无关）
 */
export type StagehandModelConfigType =
  | string
  | {
      readonly modelName: string;
      readonly apiKey: string;
      readonly baseURL: string;
    };

export interface BrowserUseConfig {
  /** 运行环境 */
  readonly env: "local" | "browserbase";
  /** Stagehand 模型配置 */
  readonly model: StagehandModelConfigType;
  /** Agent 专用模型（可选） */
  readonly agentModel?: StagehandModelConfigType;
  /** Agent 执行模型（可选） */
  readonly agentExecutionModel?: StagehandModelConfigType;
  /** 本地浏览器启动选项 */
  readonly localBrowserLaunchOptions?: {
    readonly headless?: boolean;
  };
  /** action 失败自动修复 */
  readonly selfHeal?: boolean;
  /** DOM 稳定等待时间 (ms) */
  readonly domSettleTimeout?: number;
  /** 日志级别: 0=静默, 1=信息, 2=调试 */
  readonly verbose?: number;
}

const StagehandModelSchema = z.union([
  z.string().min(1),
  z.object({
    modelName: z.string().min(1),
    apiKey: z.string().min(1),
    baseURL: z.string().url(),
  }),
]);

export const BrowserUseConfigSchema = z.object({
  env: z.enum(["local", "browserbase"]).default("local"),
  model: StagehandModelSchema,
  agentModel: StagehandModelSchema.optional(),
  agentExecutionModel: StagehandModelSchema.optional(),
  localBrowserLaunchOptions: z
    .object({
      headless: z.boolean().optional(),
    })
    .optional(),
  selfHeal: z.boolean().default(true),
  domSettleTimeout: z.number().int().positive().optional(),
  verbose: z.number().int().min(0).max(2).default(1),
});

// ============ PlatformConfig ============

export interface PlatformConfig {
  readonly models: {
    readonly providers: readonly ModelProviderConfig[];
    readonly defaults: {
      readonly chat: string;
      readonly embedding: string;
    };
  };

  readonly storage: {
    readonly dataDir: string;
    readonly qdrant?: {
      readonly host: string;
      readonly port: number;
    };
  };

  readonly secrets: {
    readonly zhipuApiKey: string;
    readonly telegramBotToken?: string;
    readonly qqBotToken?: string;
    readonly qdrantApiKey?: string;
  };

  readonly scheduler: {
    readonly evolutionInterval: number;
    readonly heartbeatCheckInterval: number;
    readonly ileDecayInterval: number;
    readonly telemetryCleanupCron: string;
  };

  readonly context: {
    readonly safetyMargin: number;
    readonly tokenEstimateDivisor: number;
    readonly maxIterations: number;
  };

  readonly permissions: PermissionConfig;

  readonly executor: {
    readonly type: "docker" | "process";
    readonly docker?: {
      readonly image: string;
      readonly memoryLimit: string;
      readonly cpuLimit: string;
      readonly networkMode: string;
      readonly timeout: number;
    };
  };

  readonly gateway: {
    readonly telegram?: {
      readonly webhookUrl?: string;
      readonly pollingTimeout?: number;
    };
    readonly qq?: {
      readonly host: string;
      readonly port: number;
      readonly reportUrl?: string;
    };
  };

  readonly skills: SkillsConfig;

  readonly routine: RoutineConfig;

  readonly evolution: EvolutionConfig;

  readonly mutation: MutationConfig;

  readonly browserUse?: BrowserUseConfig;
}

// ============ Zod Schema ============

export const PlatformConfigSchema = z.object({
  models: z.object({
    providers: z.array(ModelProviderConfigSchema).min(1),
    defaults: z.object({
      chat: z.string().min(1),
      embedding: z.string().min(1),
    }),
  }),

  storage: z.object({
    dataDir: z.string().min(1),
    qdrant: z
      .object({
        host: z.string().default("localhost"),
        port: z.number().default(6333),
      })
      .optional(),
  }),

  secrets: z.object({
    zhipuApiKey: z.string().min(1, "缺少智谱 API Key，请设置 ZHIPU_API_KEY 环境变量"),
    telegramBotToken: z.string().optional(),
    qqBotToken: z.string().optional(),
    qdrantApiKey: z.string().optional(),
  }),

  scheduler: z.object({
    evolutionInterval: z.number().default(86400000),
    heartbeatCheckInterval: z.number().default(3600000),
    ileDecayInterval: z.number().default(1800000),
    telemetryCleanupCron: z.string().default("0 3 * * *"),
  }),

  context: z.object({
    safetyMargin: z.number().min(0).max(1).default(0.2),
    tokenEstimateDivisor: z.number().positive().default(3),
    maxIterations: z.number().positive().default(25),
  }),

  permissions: PermissionConfigSchema,

  executor: z.object({
    type: z.enum(["docker", "process"]).default("docker"),
    docker: z
      .object({
        image: z.string().default("kurisu-sandbox:latest"),
        memoryLimit: z.string().default("512m"),
        cpuLimit: z.string().default("1.0"),
        networkMode: z.string().default("none"),
        timeout: z.number().default(30000),
      })
      .optional(),
  }),

  gateway: z.object({
    telegram: z
      .object({
        webhookUrl: z.string().optional(),
        pollingTimeout: z.number().optional(),
      })
      .optional(),
    qq: z
      .object({
        host: z.string(),
        port: z.number(),
        reportUrl: z.string().optional(),
      })
      .optional(),
  }),

  skills: SkillsConfigSchema.default({}),

  routine: RoutineConfigSchema.default({}),

  evolution: EvolutionConfigSchema.default({}),

  mutation: MutationConfigSchema.default({}),

  browserUse: BrowserUseConfigSchema.optional(),
});

// ============ Validation Rules (CFG-4) ============

export interface ValidationRule {
  readonly path: string;
  readonly type: "required" | "conditional";
  readonly condition?: (config: PlatformConfig) => boolean;
  readonly message: string;
}

/**
 * 条件验证规则：配置了某个 gateway 才需要对应 token
 */
export const CONDITIONAL_VALIDATION_RULES: readonly ValidationRule[] = [
  {
    path: "secrets.telegramBotToken",
    type: "conditional",
    condition: (config) => config.gateway.telegram !== undefined,
    message: "已配置 Telegram Gateway 但缺少 Bot Token，请设置 TELEGRAM_BOT_TOKEN 环境变量",
  },
  {
    path: "secrets.qqBotToken",
    type: "conditional",
    condition: (config) => config.gateway.qq !== undefined,
    message: "已配置 QQ Gateway 但缺少 Bot Token，请设置 QQ_BOT_TOKEN 环境变量",
  },
];

// ============ Defaults ============

export const CONFIG_DEFAULTS = {
  storage: {
    dataDir: "./data",
  },
  scheduler: {
    evolutionInterval: 86400000,
    heartbeatCheckInterval: 3600000,
    ileDecayInterval: 1800000,
    telemetryCleanupCron: "0 3 * * *",
  },
  context: {
    safetyMargin: 0.2,
    tokenEstimateDivisor: 3,
    maxIterations: 25,
  },
  executor: {
    type: "docker" as const,
    docker: {
      image: "kurisu-sandbox:latest",
      memoryLimit: "512m",
      cpuLimit: "1.0",
      networkMode: "none",
      timeout: 30000,
    },
  },
  permissions: {
    version: "1.0",
    defaultLevel: "confirm" as const,
    tools: { safe: [], confirm: [], deny: [] },
    paths: { deny: [], confirm: [], allow: [] },
    shell: { denyPatterns: [], confirmPatterns: [] },
  },
  gateway: {},
  skills: SKILLS_CONFIG_DEFAULTS,
  routine: ROUTINE_CONFIG_DEFAULTS,
  evolution: EVOLUTION_CONFIG_DEFAULTS,
  mutation: MUTATION_CONFIG_DEFAULTS,
} as const;

// ============ Env Var Mapping (CFG-3) ============

/**
 * 环境变量到配置路径的映射
 * 规则: KURISU_ + 下划线分隔的大写路径
 */
export const ENV_VAR_MAPPING: Readonly<Record<string, string>> = {
  KURISU_STORAGE_DATA_DIR: "storage.dataDir",
  KURISU_STORAGE_QDRANT_HOST: "storage.qdrant.host",
  KURISU_STORAGE_QDRANT_PORT: "storage.qdrant.port",
  KURISU_EXECUTOR_TYPE: "executor.type",
  KURISU_CONTEXT_SAFETY_MARGIN: "context.safetyMargin",
  KURISU_CONTEXT_MAX_ITERATIONS: "context.maxIterations",
  KURISU_SCHEDULER_EVOLUTION_INTERVAL: "scheduler.evolutionInterval",
  KURISU_GATEWAY_TELEGRAM_WEBHOOK_URL: "gateway.telegram.webhookUrl",
  KURISU_GATEWAY_QQ_HOST: "gateway.qq.host",
  KURISU_GATEWAY_QQ_PORT: "gateway.qq.port",
};

/**
 * Secrets 环境变量映射（CFG-5: 仅从 process.env 加载）
 */
export const SECRETS_ENV_MAPPING: Readonly<Record<string, keyof PlatformConfig["secrets"]>> = {
  ZHIPU_API_KEY: "zhipuApiKey",
  TELEGRAM_BOT_TOKEN: "telegramBotToken",
  QQ_BOT_TOKEN: "qqBotToken",
  QDRANT_API_KEY: "qdrantApiKey",
};
