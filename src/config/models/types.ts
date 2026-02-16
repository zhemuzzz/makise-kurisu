/**
 * 模型配置类型定义
 */

export interface ModelConfig {
  name: string;
  type: 'local' | 'cloud' | 'api';
  provider: string;
  endpoint?: string;
  apiKey?: string;
  modelPath?: string;
  maxTokens?: number;
  defaultTemperature?: number;
  capabilities?: Partial<ModelCapabilities>;
  costPerMillionTokens?: number;
}

export interface ModelCapabilities {
  maxTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  quality: 'basic' | 'good' | 'excellent';
  speed: 'slow' | 'medium' | 'fast';
  cost: 'low' | 'medium' | 'high';
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  metadata?: Record<string, unknown>;
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
}

export interface IModel {
  readonly name: string;
  readonly type: string;
  readonly provider: string;
  chat(messages: Array<{ role: string; content: string }>, options?: ChatOptions): Promise<ChatResponse>;
  stream(messages: Array<{ role: string; content: string }>, options?: ChatOptions): AsyncIterator<string>;
  supportsStreaming(): boolean;
  supportsVision(): boolean;
  supportsFunctionCalling(): boolean;
  estimateCost(tokens: number): number;
  getAverageLatency(): number;
}

export interface IModelProvider {
  get(modelName: string): IModel;
  getByCapability(capability: string): IModel;
  registerModel(config: ModelConfig): void;
  setDefaultModel(type: string, modelName: string): void;
  listModels(): Array<{ name: string; type: string; provider: string }>;
  healthCheck(): Promise<Map<string, boolean>>;
}
