/**
 * Memory System Error Classes
 * 记忆系统错误类定义
 */

/**
 * Base error class for memory system
 */
export class MemoryError extends Error {
  public readonly code: string;
  public readonly timestamp: number;

  constructor(message: string, code: string = 'MEMORY_ERROR') {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    this.timestamp = Date.now();

    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MemoryError);
    }
  }
}

/**
 * Error thrown when session is not found
 */
export class SessionNotFoundError extends MemoryError {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * Error thrown when session ID is invalid
 */
export class InvalidSessionIdError extends MemoryError {
  public readonly sessionId: unknown;

  constructor(sessionId: unknown) {
    super(
      `Invalid session ID: must be a non-empty string, got: ${typeof sessionId}`,
      'INVALID_SESSION_ID'
    );
    this.name = 'InvalidSessionIdError';
    this.sessionId = sessionId;
  }
}

/**
 * Error thrown when message content is invalid
 */
export class InvalidMessageError extends MemoryError {
  public readonly messageData: unknown;

  constructor(reason: string, messageData?: unknown) {
    super(`Invalid message: ${reason}`, 'INVALID_MESSAGE');
    this.name = 'InvalidMessageError';
    this.messageData = messageData;
  }
}

/**
 * Error thrown when Mem0 API call fails
 */
export class Mem0APIError extends MemoryError {
  public readonly operation: string;
  public readonly cause?: Error;

  constructor(operation: string, message: string, cause?: Error) {
    super(`Mem0 API error during ${operation}: ${message}`, 'MEM0_API_ERROR');
    this.name = 'Mem0APIError';
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * Error thrown when Mem0 API key is missing or invalid
 */
export class Mem0AuthError extends MemoryError {
  constructor(message: string = 'Mem0 API key is required') {
    super(message, 'MEM0_AUTH_ERROR');
    this.name = 'Mem0AuthError';
  }
}

/**
 * Error thrown when context building fails
 */
export class ContextBuildError extends MemoryError {
  public readonly sessionId: string;
  public readonly cause?: Error;

  constructor(sessionId: string, message: string, cause?: Error) {
    super(`Failed to build context for session ${sessionId}: ${message}`, 'CONTEXT_BUILD_ERROR');
    this.name = 'ContextBuildError';
    this.sessionId = sessionId;
    this.cause = cause;
  }
}

/**
 * Error thrown when memory limit is exceeded
 */
export class MemoryLimitExceededError extends MemoryError {
  public readonly limit: number;
  public readonly current: number;

  constructor(limit: number, current: number) {
    super(
      `Memory limit exceeded: ${current} messages, limit is ${limit}`,
      'MEMORY_LIMIT_EXCEEDED'
    );
    this.name = 'MemoryLimitExceededError';
    this.limit = limit;
    this.current = current;
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends MemoryError {
  public readonly field: string;
  public readonly value: unknown;

  constructor(field: string, reason: string, value?: unknown) {
    super(`Validation failed for ${field}: ${reason}`, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}
