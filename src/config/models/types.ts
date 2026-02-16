/**
 * 模型配置类型定义
 * 位置: src/config/models/types.ts
 */

// ============ 消息类型 ============

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// ============ 配置类型 ============

export interface ModelCapabilities {
  maxTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  quality: "basic" | "good" | "excellent";
  speed: "slow" | "medium" | "fast";
  cost: "low" | "medium" | "high";
}

export interface ModelConfig {
  name: string;
  type: "local" | "cloud" | "api";
  provider: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  modelPath?: string;
  maxTokens?: number;
  defaultTemperature?: number;
  capabilities?: Partial<ModelCapabilities>;
  costPerMillionTokens?: number;
  timeout?: number;
  retries?: number;
}

export interface ModelsYamlConfig {
  defaults: Record<string, string>;
  models: ModelConfig[];
  routing?: {
    rules: Record<string, string>;
  };
}

// ============ 运行时选项 ============

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  content: string;
  done: boolean;
  delta?: string;
}

export interface ChatResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  latency: number;
  finishReason?: "stop" | "length" | "error";
}

// ============ 核心接口 ============

export interface IModel {
  readonly name: string;
  readonly type: string;
  readonly provider: string;

  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  stream(
    messages: Message[],
    options?: ChatOptions,
  ): AsyncGenerator<StreamChunk>;

  supportsStreaming(): boolean;
  supportsVision(): boolean;
  supportsFunctionCalling(): boolean;

  estimateCost(tokens: number): number;
  getAverageLatency(): number;
}

export interface IModelProvider {
  get(modelName: string): IModel;
  getByCapability(capability: string): IModel;
  getByTask(taskType: string): IModel;

  registerModel(config: ModelConfig): void;
  setDefaultModel(capability: string, modelName: string): void;
  listModels(): Array<{ name: string; type: string; provider: string }>;

  healthCheck(): Promise<Map<string, boolean>>;
}

// ============ 加载器接口 ============

export interface IConfigLoader {
  load(): Promise<ModelsYamlConfig>;
  loadFromString(content: string): ModelsYamlConfig;
  resolveEnvVars(config: ModelsYamlConfig): ModelsYamlConfig;
}

// ============ 错误类型 ============

/**
 * 基础错误类，提供统一的错误处理
 */
export abstract class KurisuError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class ConfigLoadError extends KurisuError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
  }
}

export class ValidationError extends KurisuError {
  constructor(message: string) {
    super(message);
  }
}

export class FileNotFoundError extends KurisuError {
  constructor(public readonly path: string) {
    super(`Config file not found: ${path}`);
  }
}

export class EnvVarMissingError extends KurisuError {
  constructor(public readonly varName: string) {
    super(`Missing required environment variable: ${varName}`);
  }
}

export class ModelNotFoundError extends KurisuError {
  constructor(public readonly modelName: string) {
    super(`Model not found: ${modelName}`);
  }
}

export class CapabilityNotConfiguredError extends KurisuError {
  constructor(public readonly capability: string) {
    super(`No model configured for capability: ${capability}`);
  }
}
