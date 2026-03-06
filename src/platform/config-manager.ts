/**
 * ConfigManager — 统一配置管理
 * 位置: src/platform/config-manager.ts
 *
 * CFG-1: load() + get() + getAll()
 * CFG-3: 分层合并（env > .env > yaml > defaults）
 * CFG-4: 启动验证
 * CFG-5: Secrets 仅从 env 加载
 * CFG-7: Bootstrap 第一位
 */

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { config as loadDotenv } from "dotenv";

import type { PlatformConfig, ModelProviderConfig } from "./types/config.js";
import {
  PlatformConfigSchema,
  CONFIG_DEFAULTS,
  ENV_VAR_MAPPING,
  SECRETS_ENV_MAPPING,
  CONDITIONAL_VALIDATION_RULES,
} from "./types/config.js";
import { ConfigLoadError } from "./models/types.js";

// ============ Types ============

export interface ConfigManager {
  load(): Promise<void>;
  get<K extends keyof PlatformConfig>(key: K): Readonly<PlatformConfig[K]>;
  getAll(): Readonly<PlatformConfig>;
}

export interface ConfigManagerOptions {
  readonly platformYamlPath?: string;
  readonly modelsYamlPath?: string;
  readonly permissionsYamlPath?: string;
  readonly skipDotenv?: boolean;
}

// ============ Implementation ============

class ConfigManagerImpl implements ConfigManager {
  private config: PlatformConfig | null = null;
  private readonly options: ConfigManagerOptions;

  constructor(options: ConfigManagerOptions) {
    this.options = options;
  }

  async load(): Promise<void> {
    // Step 1: Load .env (unless skipped in tests)
    if (!this.options.skipDotenv) {
      loadDotenv();
    }

    // Step 2: Load YAML files
    const platformYaml = this.loadYamlFile(
      this.options.platformYamlPath ?? "config/system/platform.yaml",
    );
    const modelsYaml = this.loadYamlFile(
      this.options.modelsYamlPath ?? "config/models.yaml",
    );
    const permissionsYaml = this.loadYamlFile(
      this.options.permissionsYamlPath ?? "config/system/permissions.yaml",
    );

    // Step 3: Build raw config with defaults → YAML → env layering
    const rawConfig = this.buildLayeredConfig(platformYaml, modelsYaml, permissionsYaml);

    // Step 4: Validate with Zod
    const parseResult = PlatformConfigSchema.safeParse(rawConfig);
    if (!parseResult.success) {
      const errors = parseResult.error.issues
        .map((issue) => `  ✗ ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");
      throw new ConfigLoadError(
        `[ConfigManager] 配置验证失败:\n${errors}\n启动终止。`,
      );
    }

    const validated = parseResult.data as PlatformConfig;

    // Step 5: Conditional validation (CFG-4)
    const conditionalErrors = this.runConditionalValidation(validated);
    if (conditionalErrors.length > 0) {
      const errorMsg = conditionalErrors.map((e) => `  ✗ ${e}`).join("\n");
      throw new ConfigLoadError(
        `[ConfigManager] 配置验证失败:\n${errorMsg}\n启动终止。`,
      );
    }

    // Step 6: Deep freeze
    this.config = deepFreeze(validated);
  }

  get<K extends keyof PlatformConfig>(key: K): Readonly<PlatformConfig[K]> {
    if (!this.config) {
      throw new Error("ConfigManager 尚未加载，请先调用 load()");
    }
    return this.config[key];
  }

  getAll(): Readonly<PlatformConfig> {
    if (!this.config) {
      throw new Error("ConfigManager 尚未加载，请先调用 load()");
    }
    // Mask secrets (CFG-5)
    return {
      ...this.config,
      secrets: maskSecrets(this.config.secrets),
    };
  }

  // ============ Private ============

  private loadYamlFile(path: string): Record<string, unknown> {
    try {
      const content = readFileSync(path, "utf-8");
      const parsed: unknown = parseYaml(content);
      return (parsed as Record<string, unknown>) ?? {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw new ConfigLoadError(
        `Failed to load config: ${path}`,
        { cause: error instanceof Error ? error : new Error(String(error)) },
      );
    }
  }

  private buildLayeredConfig(
    platformYaml: Record<string, unknown>,
    modelsYaml: Record<string, unknown>,
    permissionsYaml: Record<string, unknown>,
  ): Record<string, unknown> {
    // Layer 1: Code defaults
    const config: Record<string, unknown> = deepClone(CONFIG_DEFAULTS);

    // Layer 2: Platform YAML
    deepMerge(config, platformYaml);

    // Layer 3: Models YAML → models section
    const modelsProviders = modelsYaml["models"];
    const modelsDefaults = modelsYaml["defaults"];
    if (modelsProviders || modelsDefaults) {
      const modelsSection = (config["models"] as Record<string, unknown>) ?? {};
      if (Array.isArray(modelsProviders)) {
        modelsSection["providers"] = transformModelsToProviders(modelsProviders);
      }
      if (modelsDefaults && typeof modelsDefaults === "object") {
        const defaults = modelsDefaults as Record<string, string>;
        modelsSection["defaults"] = {
          chat: defaults["conversation"] ?? defaults["chat"] ?? "",
          embedding: defaults["embedding"] ?? "",
        };
      }
      config["models"] = modelsSection;
    }

    // Layer 4: Permissions YAML
    config["permissions"] = {
      ...CONFIG_DEFAULTS.permissions,
      ...(permissionsYaml),
    };

    // Layer 5: Environment variable overrides (CFG-3)
    this.applyEnvOverrides(config);

    // Layer 6: Secrets — ONLY from process.env (CFG-5)
    config["secrets"] = this.loadSecrets();

    return config;
  }

  private applyEnvOverrides(config: Record<string, unknown>): void {
    for (const [envVar, configPath] of Object.entries(ENV_VAR_MAPPING)) {
      const envValue = process.env[envVar];
      if (envValue !== undefined) {
        setNestedValue(config, configPath, parseEnvValue(envValue));
      }
    }
  }

  private loadSecrets(): Record<string, string | undefined> {
    const secrets: Record<string, string | undefined> = {};
    for (const [envVar, secretKey] of Object.entries(SECRETS_ENV_MAPPING)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        secrets[secretKey] = value;
      }
    }
    return secrets;
  }

  private runConditionalValidation(config: PlatformConfig): string[] {
    const errors: string[] = [];
    for (const rule of CONDITIONAL_VALIDATION_RULES) {
      if (rule.condition && rule.condition(config)) {
        const value = getNestedValue(config, rule.path);
        if (value === undefined || value === null || value === "") {
          errors.push(`${rule.path}: ${rule.message}`);
        }
      }
    }
    return errors;
  }
}

// ============ Utility Functions ============

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  Object.freeze(obj);
  for (const value of Object.values(obj as Record<string, unknown>)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = target[key];
    if (
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue) &&
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue)
    ) {
      deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else {
      target[key] = sourceValue;
    }
  }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] === undefined || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseEnvValue(value: string): unknown {
  // Try to parse as number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") {
    return num;
  }
  // Try booleans
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  return value;
}

function maskSecrets(secrets: PlatformConfig["secrets"]): PlatformConfig["secrets"] {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(secrets)) {
    masked[key] = value ? "***" : "";
  }
  return masked as unknown as PlatformConfig["secrets"];
}

/**
 * 将 models.yaml 格式转换为 ModelProviderConfig 格式
 */
function transformModelsToProviders(
  models: readonly Record<string, unknown>[],
): ModelProviderConfig[] {
  return models.map((model) => ({
    id: String(model["id"] ?? model["name"] ?? ""),
    provider: String(model["provider"] ?? ""),
    model: String(model["model"] ?? ""),
    endpoint: String(model["endpoint"] ?? ""),
    secretRef: String(model["secretRef"] ?? model["apiKey"] ?? ""),
    capabilities: Array.isArray(model["capabilities"])
      ? (model["capabilities"] as string[])
      : ["chat"],
    ...(model["maxTokens"] !== undefined && {
      limits: { maxTokens: Number(model["maxTokens"]) },
    }),
  })) as ModelProviderConfig[];
}

// ============ Factory ============

export function createConfigManager(options: ConfigManagerOptions = {}): ConfigManager {
  return new ConfigManagerImpl(options);
}
