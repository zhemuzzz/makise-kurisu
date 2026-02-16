/**
 * L3 Agent 编排层 - 错误定义
 */

/**
 * Agent 编排层基础错误
 */
export abstract class AgentError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * Orchestrator 错误
 */
export class OrchestratorError extends AgentError {
  constructor(
    public readonly stage: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Orchestrator error at ${stage}: ${message}`, options);
  }
}

/**
 * 路由错误
 */
export class RouteError extends AgentError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
  }
}

/**
 * Agent 执行错误
 */
export class AgentExecutionError extends AgentError {
  constructor(
    public readonly agentRole: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Agent ${agentRole} execution failed: ${message}`, options);
  }
}

/**
 * 最大重试次数超限
 */
export class MaxRetriesExceededError extends AgentError {
  constructor(
    public readonly retryCount: number,
    public readonly maxRetries: number,
  ) {
    super(`Max retries exceeded: ${retryCount}/${maxRetries}`);
  }
}

/**
 * 人设校验失败
 */
export class PersonaValidationError extends AgentError {
  constructor(
    public readonly violations: readonly string[],
  ) {
    super(`Persona validation failed: ${violations.join(', ')}`);
  }
}

/**
 * 上下文构建错误
 */
export class ContextBuildError extends AgentError {
  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);
  }
}

/**
 * 模型调用错误
 */
export class ModelInvocationError extends AgentError {
  constructor(
    public readonly modelName: string,
    message: string,
    options?: { cause?: Error },
  ) {
    super(`Model ${modelName} invocation failed: ${message}`, options);
  }
}
