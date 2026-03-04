/**
 * 执行器配置 - 配置加载器
 *
 * KURISU-019 Phase 3: 加载 executor.yaml 配置
 */

import { parse as parseYaml } from "yaml";
import { readFile, access, mkdir, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import os from "os";
import type {
  ExecutorSystemConfig,
  FilePermissionLevel,
  ApprovalConfig,
  RestrictedConfig,
  RoleToolConfig,
  PlatformConfig,
} from "./executor-types";
import {
  DEFAULT_APPROVAL_CONFIG,
  DEFAULT_RESTRICTED_CONFIG,
  DEFAULT_ROLE_TOOL_CONFIG,
} from "./executor-types";
import type {
  DockerExecutorConfig,
  CloudExecutorConfig,
} from "../tools/executors/types";

/**
 * 配置文件路径
 */
const EXECUTOR_CONFIG_FILE = "executor.yaml";

/**
 * 执行器配置加载器
 *
 * 负责加载、验证、合并配置
 */
export class ExecutorConfigLoader {
  private readonly configDir: string;
  private cachedConfig: ExecutorSystemConfig | null = null;

  constructor(configDir: string) {
    this.configDir = configDir;
  }

  /**
   * 加载执行器配置
   *
   * 优先级：配置文件 > 环境变量 > 默认值
   */
  async load(): Promise<ExecutorSystemConfig> {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const configPath = join(this.configDir, EXECUTOR_CONFIG_FILE);

    // 尝试读取配置文件
    let rawConfig: Record<string, unknown> = {};

    try {
      await access(configPath);
      const content = await readFile(configPath, "utf-8");
      rawConfig = (parseYaml(content) as Record<string, unknown>) ?? {};
    } catch {
      // 配置文件不存在，使用默认值
      rawConfig = {};
    }

    // 构建完整配置
    const config = this.buildConfig(rawConfig);

    // 缓存配置
    this.cachedConfig = config;

    return config;
  }

  /**
   * 构建完整配置
   */
  private buildConfig(raw: Record<string, unknown>): ExecutorSystemConfig {
    const executorType = this.parseExecutorType(raw["executor"]);
    return {
      autoDetect: this.parseBoolean(raw["auto_detect"], true),
      ...(executorType ? { executor: executorType } : {}),
      platforms: this.parsePlatforms(raw["platforms"]),
      docker: this.parseDockerConfig(raw["docker"]),
      cloud: this.parseCloudConfig(raw["cloud"]),
      defaultPermission: this.parsePermissionLevel(
        raw["default_permission"],
        "sandbox",
      ),
      restricted: this.parseRestrictedConfig(raw["restricted"]),
      approval: this.parseApprovalConfig(raw["approval"]),
    };
  }

  /**
   * 解析布尔值
   */
  private parseBoolean(value: unknown, defaultValue: boolean): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    return defaultValue;
  }

  /**
   * 解析执行器类型
   */
  private parseExecutorType(
    value: unknown,
  ): "docker" | "process" | "cloud" | undefined {
    if (value === "docker" || value === "process" || value === "cloud") {
      return value;
    }
    return undefined;
  }

  /**
   * 解析平台配置
   */
  private parsePlatforms(
    value: unknown,
  ): Partial<Record<string, PlatformConfig>> {
    if (!value || typeof value !== "object") {
      return {};
    }

    const platforms: Partial<Record<string, PlatformConfig>> = {};
    const rawPlatforms = value as Record<string, unknown>;

    for (const [platform, config] of Object.entries(rawPlatforms)) {
      if (config && typeof config === "object") {
        const rawConfig = config as Record<string, unknown>;
        const prefer = this.parseExecutorType(rawConfig["prefer"]);
        const fallback = this.parseFallbackConfig(rawConfig["fallback"]);
        const workspace = this.parseString(rawConfig["workspace"]);
        const endpoint = this.parseString(rawConfig["endpoint"]);

        platforms[platform] = {
          ...(prefer ? { prefer } : {}),
          ...(fallback ? { fallback } : {}),
          ...(workspace ? { workspace } : {}),
          ...(endpoint ? { endpoint } : {}),
        };
      }
    }

    return platforms;
  }

  /**
   * 解析降级配置
   */
  private parseFallbackConfig(value: unknown): PlatformConfig["fallback"] {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const raw = value as Record<string, unknown>;
    const isolation = this.parseIsolationType(raw["isolation"]);

    return {
      type: raw["type"] === "cloud" ? "cloud" : "process",
      allowFullAccess: this.parseBoolean(raw["allow_full_access"], false),
      ...(isolation ? { isolation } : {}),
    };
  }

  /**
   * 解析隔离类型
   */
  private parseIsolationType(
    value: unknown,
  ): "sandbox-exec" | "job-object" | "proot" | "none" | undefined {
    const validTypes = ["sandbox-exec", "job-object", "proot", "none"] as const;
    if (
      typeof value === "string" &&
      validTypes.includes(value as (typeof validTypes)[number])
    ) {
      return value as (typeof validTypes)[number];
    }
    return undefined;
  }

  /**
   * 解析 Docker 配置
   */
  private parseDockerConfig(value: unknown): DockerExecutorConfig {
    const defaultImage = "kurisu-sandbox:latest";
    const defaultSandboxDir = "/tmp/kurisu-workspace";
    const defaultMemoryLimit = 512;
    const defaultCpuLimit = 0.5;
    const defaultTimeout = 30000;

    if (!value || typeof value !== "object") {
      return {
        image: defaultImage,
        sandboxDir: defaultSandboxDir,
        memoryLimit: defaultMemoryLimit,
        cpuLimit: defaultCpuLimit,
        timeout: defaultTimeout,
      };
    }

    const raw = value as Record<string, unknown>;
    const allowedPaths = this.parseStringArray(raw["allowed_paths"]);
    const memoryLimit =
      this.parseNumber(raw["memory_limit"]) ?? defaultMemoryLimit;
    const cpuLimit = this.parseNumber(raw["cpu_limit"]) ?? defaultCpuLimit;
    const timeout = this.parseNumber(raw["timeout"]) ?? defaultTimeout;

    return {
      image: this.parseString(raw["image"]) ?? defaultImage,
      sandboxDir: this.parseString(raw["sandbox_dir"]) ?? defaultSandboxDir,
      memoryLimit,
      cpuLimit,
      timeout,
      ...(allowedPaths ? { allowedPaths } : {}),
    };
  }

  /**
   * 解析云端配置
   */
  private parseCloudConfig(value: unknown): CloudExecutorConfig {
    if (!value || typeof value !== "object") {
      return {
        endpoint: "",
        apiKey: "",
      };
    }

    const raw = value as Record<string, unknown>;
    const timeout = this.parseNumber(raw["timeout"]);

    return {
      endpoint:
        this.parseEnvVar(raw["endpoint"]) ??
        this.parseString(raw["endpoint"]) ??
        "",
      apiKey:
        this.parseEnvVar(raw["api_key"]) ??
        this.parseString(raw["api_key"]) ??
        "",
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }

  /**
   * 解析环境变量引用 ${VAR_NAME}
   */
  private parseEnvVar(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const match = value.match(/^\$\{(\w+)\}$/);
    if (match && match[1]) {
      return process.env[match[1]];
    }

    return undefined;
  }

  /**
   * 解析权限级别
   */
  private parsePermissionLevel(
    value: unknown,
    defaultValue: FilePermissionLevel,
  ): FilePermissionLevel {
    if (
      value === "sandbox" ||
      value === "restricted" ||
      value === "full_access"
    ) {
      return value;
    }
    return defaultValue;
  }

  /**
   * 解析受限模式配置
   */
  private parseRestrictedConfig(value: unknown): RestrictedConfig {
    if (!value || typeof value !== "object") {
      return DEFAULT_RESTRICTED_CONFIG;
    }

    const raw = value as Record<string, unknown>;
    return {
      allowedPaths:
        this.parseStringArray(raw["allowed_paths"]) ??
        DEFAULT_RESTRICTED_CONFIG.allowedPaths,
    };
  }

  /**
   * 解析审批配置
   */
  private parseApprovalConfig(value: unknown): ApprovalConfig {
    if (!value || typeof value !== "object") {
      return DEFAULT_APPROVAL_CONFIG;
    }

    const raw = value as Record<string, unknown>;
    return {
      timeout:
        this.parseNumber(raw["timeout"]) ?? DEFAULT_APPROVAL_CONFIG.timeout,
      autoRejectOnTimeout: this.parseBoolean(
        raw["auto_reject_on_timeout"],
        true,
      ),
      criticalRequiresReason: this.parseBoolean(
        raw["critical_requires_reason"],
        false,
      ),
    };
  }

  /**
   * 解析字符串
   */
  private parseString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  /**
   * 解析字符串数组
   */
  private parseStringArray(value: unknown): readonly string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }
    return value.filter((v): v is string => typeof v === "string");
  }

  /**
   * 解析数字
   */
  private parseNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
  }

  /**
   * 保存配置到文件
   */
  async save(config: ExecutorSystemConfig): Promise<void> {
    const configPath = join(this.configDir, EXECUTOR_CONFIG_FILE);

    // 确保目录存在
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // 转换为 YAML 格式
    const yamlContent = this.toYaml(config);

    // 写入文件
    await writeFile(configPath, yamlContent, "utf-8");

    // 更新缓存
    this.cachedConfig = config;
  }

  /**
   * 将配置转换为 YAML 格式
   */
  private toYaml(config: ExecutorSystemConfig): string {
    const lines: string[] = [
      "# Kurisu 执行器配置",
      "#",
      "# KURISU-019: 跨平台工具执行器配置",
      "",
      "# 是否自动检测最优执行器",
      `auto_detect: ${config.autoDetect}`,
      "",
    ];

    // 手动指定执行器
    if (config.executor) {
      lines.push(`# 手动指定执行器（覆盖自动检测）`);
      lines.push(`executor: ${config.executor}`);
      lines.push("");
    }

    // 平台配置
    if (Object.keys(config.platforms).length > 0) {
      lines.push("# 平台特定配置");
      lines.push("platforms:");
      for (const [platform, platformConfig] of Object.entries(
        config.platforms,
      )) {
        lines.push(`  ${platform}:`);
        if (platformConfig.prefer) {
          lines.push(`    prefer: ${platformConfig.prefer}`);
        }
        if (platformConfig.fallback) {
          lines.push(`    fallback:`);
          lines.push(`      type: ${platformConfig.fallback.type}`);
          if (platformConfig.fallback.allowFullAccess !== undefined) {
            lines.push(
              `      allow_full_access: ${platformConfig.fallback.allowFullAccess}`,
            );
          }
          if (platformConfig.fallback.isolation) {
            lines.push(`      isolation: ${platformConfig.fallback.isolation}`);
          }
        }
        if (platformConfig.workspace) {
          lines.push(`    workspace: ${platformConfig.workspace}`);
        }
        if (platformConfig.endpoint) {
          lines.push(`    endpoint: ${platformConfig.endpoint}`);
        }
      }
      lines.push("");
    }

    // Docker 配置
    lines.push("# Docker 配置");
    lines.push("docker:");
    lines.push(`  image: ${config.docker.image}`);
    lines.push(`  sandbox_dir: ${config.docker.sandboxDir}`);
    if (config.docker.allowedPaths && config.docker.allowedPaths.length > 0) {
      lines.push("  allowed_paths:");
      for (const p of config.docker.allowedPaths) {
        lines.push(`    - ${p}`);
      }
    }
    lines.push(`  memory_limit: ${config.docker.memoryLimit}`);
    lines.push(`  cpu_limit: ${config.docker.cpuLimit}`);
    lines.push(`  timeout: ${config.docker.timeout}`);
    lines.push("");

    // 云端配置
    lines.push("# 云端配置");
    lines.push("cloud:");
    lines.push(`  endpoint: \${KURISU_CLOUD_ENDPOINT}`);
    lines.push(`  api_key: \${KURISU_CLOUD_API_KEY}`);
    lines.push(`  timeout: ${config.cloud.timeout}`);
    lines.push("");

    // 默认权限
    lines.push("# 默认权限");
    lines.push(`default_permission: ${config.defaultPermission}`);
    lines.push("");

    // 受限模式配置
    lines.push("# 用户目录权限配置");
    lines.push("restricted:");
    lines.push("  allowed_paths:");
    for (const p of config.restricted.allowedPaths) {
      lines.push(`    - ${p}`);
    }
    lines.push("");

    // 审批配置
    lines.push("# 审批配置");
    lines.push("approval:");
    lines.push(`  timeout: ${config.approval.timeout}`);
    lines.push(
      `  auto_reject_on_timeout: ${config.approval.autoRejectOnTimeout}`,
    );
    lines.push(
      `  critical_requires_reason: ${config.approval.criticalRequiresReason}`,
    );

    return lines.join("\n") + "\n";
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cachedConfig = null;
  }
}

/**
 * 创建执行器配置加载器
 */
export function createExecutorConfigLoader(
  configDir: string,
): ExecutorConfigLoader {
  return new ExecutorConfigLoader(configDir);
}

/**
 * 获取默认配置
 */
export function getDefaultExecutorConfig(): ExecutorSystemConfig {
  return {
    autoDetect: true,
    platforms: {},
    docker: {
      image: "kurisu-sandbox:latest",
      sandboxDir: "/tmp/kurisu-workspace",
      memoryLimit: 512,
      cpuLimit: 0.5,
      timeout: 30000,
    },
    cloud: {
      endpoint: "",
      apiKey: "",
      timeout: 30000,
    },
    defaultPermission: "sandbox",
    restricted: DEFAULT_RESTRICTED_CONFIG,
    approval: DEFAULT_APPROVAL_CONFIG,
  };
}

/**
 * 获取默认角色工具配置
 */
export function getDefaultRoleToolConfig(): RoleToolConfig {
  return { ...DEFAULT_ROLE_TOOL_CONFIG };
}

/**
 * 展开路径中的 ~ 为用户主目录
 */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(os.homedir(), path.slice(2));
  }
  return path;
}

/**
 * 缩短路径，将用户主目录替换为 ~
 */
export function shortenPath(path: string): string {
  const homeDir = os.homedir();
  if (path.startsWith(homeDir)) {
    return "~" + path.slice(homeDir.length);
  }
  return path;
}
