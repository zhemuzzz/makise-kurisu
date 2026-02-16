/**
 * 模型配置化管理
 * 配置驱动，支持运行时切换，不绑定具体模型
 */

import { IModel, IModelProvider, ModelConfig, ChatOptions, ChatResponse } from './types';

export class ModelProvider implements IModelProvider {
  private models: Map<string, IModel> = new Map();
  private defaults: Record<string, string> = {};

  constructor(configs: ModelConfig[] = [], defaults: Record<string, string> = {}) {
    this.defaults = defaults;
    configs.forEach((config) => this.registerModel(config));
  }

  /**
   * 获取模型
   */
  get(modelName: string): IModel {
    const model = this.models.get(modelName);
    if (!model) {
      throw new Error(`Model not found: ${modelName}`);
    }
    return model;
  }

  /**
   * 根据能力获取模型
   */
  getByCapability(capability: string): IModel {
    const defaultModel = this.defaults[capability];
    if (defaultModel) {
      return this.get(defaultModel);
    }
    throw new Error(`No model configured for capability: ${capability}`);
  }

  /**
   * 注册模型
   */
  registerModel(config: ModelConfig): void {
    const model = this.createModel(config);
    this.models.set(config.name, model);
  }

  /**
   * 设置默认模型
   */
  setDefaultModel(type: string, modelName: string): void {
    this.defaults[type] = modelName;
  }

  /**
   * 列出所有模型
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
    for (const [name] of this.models) {
      try {
        // 简单的 ping 测试
        results.set(name, true);
      } catch {
        results.set(name, false);
      }
    }
    return results;
  }

  private createModel(config: ModelConfig): IModel {
    return new BaseModel(config);
  }
}

/**
 * 基础模型实现
 */
class BaseModel implements IModel {
  readonly name: string;
  readonly type: string;
  readonly provider: string;

  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.name = config.name;
    this.type = config.type;
    this.provider = config.provider;
    this.config = config;
  }

  async chat(messages: Array<{ role: string; content: string }>, options?: ChatOptions): Promise<ChatResponse> {
    // TODO: 实现实际的模型调用
    const startTime = Date.now();

    // 占位实现
    const response = `[${this.name}] Response to: ${messages[messages.length - 1]?.content ?? ''}`;

    return {
      content: response,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      model: this.name,
      latency: Date.now() - startTime,
    };
  }

  async *stream(messages: Array<{ role: string; content: string }>, options?: ChatOptions): AsyncIterator<string> {
    // TODO: 实现流式输出
    const response = await this.chat(messages, options);
    yield response.content;
  }

  supportsStreaming(): boolean {
    return true;
  }

  supportsVision(): boolean {
    return false;
  }

  supportsFunctionCalling(): boolean {
    return false;
  }

  estimateCost(tokens: number): number {
    const costPerMillion = this.config.costPerMillionTokens ?? 0;
    return (tokens / 1_000_000) * costPerMillion;
  }

  getAverageLatency(): number {
    return 500; // ms
  }
}
