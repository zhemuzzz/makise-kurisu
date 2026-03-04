/**
 * 带超时的 Promise 包装（共享工具函数）
 *
 * KURISU-029: 从 mcp-bridge.ts 和 mcp-health-checker.ts 提取的公共实现
 */

/**
 * 为 Promise 添加超时保护
 *
 * @param promise 原始 Promise
 * @param timeoutMs 超时时间（毫秒）
 * @param operation 操作描述（用于错误消息）
 * @returns 包装后的 Promise（超时则 reject）
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation = "Operation",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
