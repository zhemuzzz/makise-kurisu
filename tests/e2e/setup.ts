/**
 * E2E 测试全局 setup
 */

/**
 * 延迟工具
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 收集流的所有 chunks
 */
export async function collectStream(stream: AsyncGenerator<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * 收集流并返回完整文本
 */
export async function collectStreamText(stream: AsyncGenerator<string>): Promise<string> {
  const chunks = await collectStream(stream);
  return chunks.join('');
}
