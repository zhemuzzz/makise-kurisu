/**
 * YAML 配置加载器
 * 位置: src/config/models/loader.ts
 */

import { parse } from "yaml";
import { readFile } from "fs/promises";
import {
  type ModelsYamlConfig,
  type ModelConfig,
  type IConfigLoader,
  ConfigLoadError,
  ValidationError,
  FileNotFoundError,
} from "./types";
import { injectEnvVars } from "./env";

/**
 * YAML 配置加载器
 */
export class YamlConfigLoader implements IConfigLoader {
  constructor(private readonly configPath: string) {}

  /**
   * 从文件加载配置
   */
  async load(): Promise<ModelsYamlConfig> {
    try {
      const content = await readFile(this.configPath, "utf-8");
      return this.loadFromString(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new FileNotFoundError(this.configPath);
      }
      throw new ConfigLoadError(
        `Failed to load config from ${this.configPath}`,
        { cause: error as Error },
      );
    }
  }

  /**
   * 从字符串加载配置
   */
  loadFromString(content: string): ModelsYamlConfig {
    let rawConfig: unknown;

    try {
      rawConfig = parse(content);
    } catch (error) {
      throw new ConfigLoadError("Failed to parse YAML", {
        cause: error as Error,
      });
    }

    // 处理空配置
    if (
      !rawConfig ||
      (typeof rawConfig === "object" && Object.keys(rawConfig).length === 0)
    ) {
      return { defaults: {}, models: [] };
    }

    const config = rawConfig as ModelsYamlConfig;

    // 验证配置
    this.validate(config);

    // 解析环境变量
    return this.resolveEnvVars(config);
  }

  /**
   * 解析配置中的环境变量
   */
  resolveEnvVars(config: ModelsYamlConfig): ModelsYamlConfig {
    return injectEnvVars(
      config as unknown as Record<string, unknown>,
    ) as unknown as ModelsYamlConfig;
  }

  /**
   * 验证配置结构
   */
  private validate(config: ModelsYamlConfig): void {
    // 验证 models 数组
    if (config.models && !Array.isArray(config.models)) {
      throw new ValidationError("models must be an array");
    }

    // 验证每个模型配置
    if (config.models) {
      const names = new Set<string>();

      for (const model of config.models) {
        this.validateModel(model);

        // 检查重复名称
        if (names.has(model.name)) {
          console.warn(
            `[ConfigLoader] Warning: Duplicate model name: ${model.name}`,
          );
        }
        names.add(model.name);
      }
    }

    // 验证 defaults
    if (config.defaults && typeof config.defaults !== "object") {
      throw new ValidationError("defaults must be an object");
    }
  }

  /**
   * 验证单个模型配置
   */
  private validateModel(model: ModelConfig): void {
    if (!model.name || typeof model.name !== "string") {
      throw new ValidationError('Model must have a valid "name" field');
    }

    if (!model.type || !["local", "cloud", "api"].includes(model.type)) {
      throw new ValidationError(
        `Model "${model.name}" has invalid type: ${model.type}`,
      );
    }

    if (!model.provider || typeof model.provider !== "string") {
      throw new ValidationError(
        `Model "${model.name}" must have a valid "provider" field`,
      );
    }
  }
}

/**
 * 便捷函数：从文件加载配置
 */
export async function loadConfig(
  configPath: string,
): Promise<ModelsYamlConfig> {
  const loader = new YamlConfigLoader(configPath);
  return loader.load();
}

/**
 * 便捷函数：从字符串加载配置
 */
export function loadConfigFromString(content: string): ModelsYamlConfig {
  const loader = new YamlConfigLoader("");
  return loader.loadFromString(content);
}

// 导出错误类
export { ConfigLoadError, ValidationError, FileNotFoundError } from "./types";
