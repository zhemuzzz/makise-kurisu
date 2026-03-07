/**
 * L1 交互网关 - 错误类定义
 */

import type { KurisuErrorType } from "../errors.js";

/**
 * Gateway 基础错误类
 */
export class GatewayError extends Error {
  public readonly code: KurisuErrorType;

  constructor(message: string, code: KurisuErrorType = "gateway_error") {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

/**
 * 会话错误
 */
export class SessionError extends GatewayError {
  constructor(message: string, code: KurisuErrorType = "gateway_error") {
    super(message, code);
    this.name = "SessionError";
  }
}

/**
 * 会话不存在错误
 */
export class SessionNotFoundError extends SessionError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, "session_not_found");
    this.name = "SessionNotFoundError";
  }
}

/**
 * 会话已存在错误
 */
export class SessionAlreadyExistsError extends SessionError {
  constructor(sessionId: string) {
    super(`Session already exists: ${sessionId}`, "gateway_error");
    this.name = "SessionAlreadyExistsError";
  }
}

/**
 * 会话过期错误
 */
export class SessionExpiredError extends SessionError {
  constructor(sessionId: string) {
    super(`Session has expired: ${sessionId}`, "session_expired");
    this.name = "SessionExpiredError";
  }
}

/**
 * 输入验证错误
 */
export class InputValidationError extends GatewayError {
  constructor(message: string) {
    super(message, "invalid_input");
    this.name = "InputValidationError";
  }
}

/**
 * 流处理错误
 */
export class StreamError extends GatewayError {
  constructor(message: string, code: KurisuErrorType = "stream_error") {
    super(message, code);
    this.name = "StreamError";
  }
}

/**
 * 渠道错误
 */
export class ChannelError extends GatewayError {
  constructor(message: string, code: KurisuErrorType = "gateway_error") {
    super(message, code);
    this.name = "ChannelError";
  }
}
