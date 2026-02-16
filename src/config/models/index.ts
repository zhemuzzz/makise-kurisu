/**
 * 模型配置化管理
 * 位置: src/config/models/index.ts
 *
 * 配置驱动，支持运行时切换，不绑定具体模型
 */

import {
  type IModel,
  type IModelProvider,
  type ModelConfig,
  ModelNotFoundError,
  CapabilityNotConfiguredError,
} from "./types";
import { AnthropicCompatibleModel } from "./providers/anthropic";

// 导出类型和错误
export * from "./types";
export { injectEnvVars, EnvResolver } from "./env";
export { YamlConfigLoader, loadConfig, loadConfigFromString } from "./loader";
export { AnthropicCompatibleModel } from "./providers/anthropic";

/**
 * Provider 工厂：根据配置创建模型实例
 */
function createModel(config: ModelConfig): IModel {
  switch (config.provider) {
    case "anthropic":
    case "anthropic-compatible":
      return new AnthropicCompatibleModel(config);

    // 未来扩展其他 provider
    // case 'openai':
    //   return new OpenAIModel(config);
    // case 'ollama':
    //   return new OllamaModel(config);

    default:
      // 默认使用 Anthropic 兼容
      return new AnthropicCompatibleModel(config);
  }
}

/**
 * 模型提供者
 * 管理所有注册的模型实例
 */
export class ModelProvider implements IModelProvider {
  private readonly models: Map<string, IModel> = new Map();
  private defaults: Record<string, string>;

  constructor(
    configs: ModelConfig[] = [],
    defaults: Record<string, string> = {},
  ) {
    this.defaults = { ...defaults };
    configs.forEach((config) => this.registerModel(config));
  }

  /**
   * 获取指定模型
   */
  get(modelName: string): IModel {
    const model = this.models.get(modelName);
    if (!model) {
      throw new ModelNotFoundError(modelName);
    }
    return model;
  }

  /**
   * 根据能力获取默认模型
   */
  getByCapability(capability: string): IModel {
    const defaultModel = this.defaults[capability];
    if (!defaultModel) {
      throw new CapabilityNotConfiguredError(capability);
    }
    return this.get(defaultModel);
  }

  /**
   * 根据任务类型获取模型（路由）
   */
  getByTask(taskType: string): IModel {
    // 任务类型映射到能力
    const taskToCapability: Record<string, string> = {
      conversation: "conversation",
      code: "code",
      reasoning: "reasoning",
      embedding: "embedding",
    };

    const capability = taskToCapability[taskType] ?? taskType;
    return this.getByCapability(capability);
  }

  /**
   * 注册模型
   */
  registerModel(config: ModelConfig): void {
    const model = createModel(config);
    this.models.set(config.name, model);
  }

  /**
   * 设置能力默认模型
   */
  setDefaultModel(capability: string, modelName: string): void {
    this.defaults[capability] = modelName;
  }

  /**
   * 列出所有注册的模型
   */
  listModels(): Array<{ name: string; type: string; provider: string }> {
    return Array.from(this.models.entries()).map(([name, model]) => ({
      name,
      type: model.type,
      provider: model.provider,
    }));
  }

  /**
   * 检查模型能力（不发起 API 调用）
   * 用于快速验证模型配置是否有效
   */
  checkCapabilities(): Map<
    string,
    { streaming: boolean; vision: boolean; functionCalling: boolean }
  > {
    const results = new Map<
      string,
      { streaming: boolean; vision: boolean; functionCalling: boolean }
    >();

    for (const [name, model] of this.models) {
      try {
        results.set(name, {
          streaming: model.supportsStreaming(),
          vision: model.supportsVision(),
          functionCalling: model.supportsFunctionCalling(),
        });
      } catch {
        results.set(name, {
          streaming: false,
          vision: false,
          functionCalling: false,
        });
      }
    }

    return results;
  }

  /**
   * 健康检查（可选发起 API 调用验证连通性）
   * @param options.verifyConnectivity - 是否发起 API 调用验证连通性（默认 false）
   */
  async healthCheck(options?: {
    verifyConnectivity?: boolean;
  }): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    // 如果不验证连通性，只检查模型是否注册
    if (!options?.verifyConnectivity) {
      for (const [name] of this.models) {
        results.set(name, true);
      }
      return results;
    }

    // 验证连通性：对每个模型发起最小化 API 调用
    await Promise.all(
      Array.from(this.models.entries()).map(async ([name, model]) => {
        try {
          // 发起最小化请求验证连通性
          await model.chat([{ role: "user", content: "ping" }], {
            maxTokens: 1,
          });
          results.set(name, true);
        } catch (error) {
          console.debug(
            `[ModelProvider] Health check failed for ${name}:`,
            error,
          );
          results.set(name, false);
        }
      }),
    );

    return results;
  }
}

/**
 * 创建全局默认 ModelProvider
 */
export function createModelProvider(
  configs: ModelConfig[] = [],
  defaults: Record<string, string> = {},
): IModelProvider {
  return new ModelProvider(configs, defaults);
}
