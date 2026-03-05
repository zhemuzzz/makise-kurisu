/**
 * 通用错误处理工具
 *
 * 统一 try-catch + console.error 模式
 */

export interface ErrorHandlingOptions<T> {
  /** 错误发生时的回退值 */
  fallback?: T;
  /** 是否重新抛出错误 */
  rethrow?: boolean;
  /** 是否记录到 console.error (默认 true) */
  log?: boolean;
}

/**
 * 包装函数，统一错误处理
 *
 * @param context 错误上下文描述 (e.g., "TelegramChannel sendMessage")
 * @param fn 要执行的函数
 * @param options 错误处理选项
 * @returns 函数执行结果或 fallback 值
 *
 * @example
 * ```typescript
 * const result = await withErrorHandling(
 *   "loadConfig",
 *   () => fs.readFileSync("config.json", "utf-8"),
 *   { fallback: "{}" }
 * );
 * ```
 */
export async function withErrorHandling<T>(
  context: string,
  fn: () => Promise<T>,
  options: ErrorHandlingOptions<T> = {},
): Promise<T | undefined> {
  const { fallback, rethrow = false, log = true } = options;

  try {
    return await fn();
  } catch (error) {
    if (log) {
      console.error(`${context}:`, error);
    }

    if (rethrow) {
      throw error;
    }

    return fallback;
  }
}

/**
 * 同步版本的 withErrorHandling
 */
export function withErrorHandlingSync<T>(
  context: string,
  fn: () => T,
  options: ErrorHandlingOptions<T> = {},
): T | undefined {
  const { fallback, rethrow = false, log = true } = options;

  try {
    return fn();
  } catch (error) {
    if (log) {
      console.error(`${context}:`, error);
    }

    if (rethrow) {
      throw error;
    }

    return fallback;
  }
}

/**
 * 简化版：仅记录错误，不返回值
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logError("riskyOperation", error);
 * }
 * ```
 */
export function logError(context: string, error: unknown): void {
  console.error(`${context}:`, error);
}
