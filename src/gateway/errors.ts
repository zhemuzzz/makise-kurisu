/**
 * L1 交互网关 - 错误类定义
 */

/**
 * Gateway 基础错误类
 */
export class GatewayError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'GATEWAY_ERROR') {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
  }
}

/**
 * 会话错误
 */
export class SessionError extends GatewayError {
  constructor(message: string, code: string = 'SESSION_ERROR') {
    super(message, code);
    this.name = 'SessionError';
  }
}

/**
 * 会话不存在错误
 */
export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

/**
 * 会话已存在错误
 */
export class SessionAlreadyExistsError extends SessionError {
  constructor(sessionId: string) {
    super(`Session already exists: ${sessionId}`, 'SESSION_ALREADY_EXISTS');
    this.name = 'SessionAlreadyExistsError';
  }
}

/**
 * 会话过期错误
 */
export class SessionExpiredError extends SessionError {
  constructor(sessionId: string) {
    super(`Session has expired: ${sessionId}`, 'SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

/**
 * 输入验证错误
 */
export class InputValidationError extends GatewayError {
  constructor(message: string) {
    super(message, 'INVALID_INPUT');
    this.name = 'InputValidationError';
  }
}

/**
 * 流处理错误
 */
export class StreamError extends GatewayError {
  constructor(message: string, code: string = 'STREAM_ERROR') {
    super(message, code);
    this.name = 'StreamError';
  }
}

/**
 * 渠道错误
 */
export class ChannelError extends GatewayError {
  constructor(message: string, code: string = 'CHANNEL_ERROR') {
    super(message, code);
    this.name = 'ChannelError';
  }
}

/**
 * Orchestrator 错误
 */
export class OrchestratorError extends GatewayError {
  constructor(message: string, code: string = 'ORCHESTRATOR_ERROR') {
    super(message, code);
    this.name = 'OrchestratorError';
  }
}
