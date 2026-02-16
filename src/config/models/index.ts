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
} from './types';
import { AnthropicCompatibleModel } from './providers/anthropic';

// 导出类型和错误
export * from './types';
export { injectEnvVars, EnvResolver } from './env';
export { YamlConfigLoader, loadConfig, loadConfigFromString } from './loader';
export { AnthropicCompatibleModel } from './providers/anthropic';

/**
 * Provider 工厂：根据配置创建模型实例
 */
function createModel(config: ModelConfig): IModel {
  switch (config.provider) {
    case 'anthropic':
    case 'anthropic-compatible':
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

  constructor(configs: ModelConfig[] = [], defaults: Record<string, string> = {}) {
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
      conversation: 'conversation',
      code: 'code',
      reasoning: 'reasoning',
      embedding: 'embedding',
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
   * 健康检查
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [name, model] of this.models) {
      try {
        // 简单的可用性检查
        results.set(name, model.supportsStreaming());
      } catch {
        results.set(name, false);
      }
    }

    return results;
  }
}

/**
 * 创建全局默认 ModelProvider
 */
export function createModelProvider(
  configs: ModelConfig[] = [],
  defaults: Record<string, string> = {}
): IModelProvider {
  return new ModelProvider(configs, defaults);
}
