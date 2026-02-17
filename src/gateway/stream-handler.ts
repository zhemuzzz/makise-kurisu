/**
 * L1 交互网关 - 流式处理器
 * 处理 AsyncGenerator 转换、回调触发、错误处理
 */

import {
  StreamEventType,
  type TextDeltaEvent,
  type MetadataEvent,
  type AnyStreamEvent,
  type StreamCallbacks,
  type GatewayStreamResult,
  isErrorEvent,
} from "./types";

/**
 * 流式处理器
 * 负责流数据的转换和回调处理
 */
export class StreamHandler {
  /**
   * 从字符串数组创建文本流
   */
  async *textStreamFromChunks(chunks: string[]): AsyncGenerator<string> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  /**
   * 将文本流转换为完整事件流
   * 正确标记最后一个 chunk 为 final
   */
  async *fullStreamFromTextStream(
    textStream: AsyncGenerator<string>,
  ): AsyncGenerator<TextDeltaEvent> {
    let current = await textStream.next();

    while (!current.done) {
      const next = await textStream.next();
      const isFinal = next.done === true;

      yield {
        type: StreamEventType.TEXT_DELTA,
        text: current.value,
        isFinal,
        timestamp: new Date(),
      };

      current = next;
    }
  }

  /**
   * 为流添加回调支持
   */
  async *withCallbacks(
    stream: AsyncGenerator<string | AnyStreamEvent>,
    callbacks: StreamCallbacks,
  ): AsyncGenerator<string | AnyStreamEvent> {
    const chunks: string[] = [];

    try {
      for await (const item of stream) {
        if (typeof item === "string") {
          chunks.push(item);
          callbacks.onChunk?.(item);
          yield item;
        } else {
          // Handle event types
          if (isErrorEvent(item)) {
            callbacks.onError?.(new Error(item.message));
          } else if (item.type === StreamEventType.METADATA) {
            callbacks.onMetadata?.((item as MetadataEvent).data);
          }
          yield item;
        }
      }

      // Call onComplete with concatenated chunks
      if (callbacks.onComplete && chunks.length > 0) {
        callbacks.onComplete(chunks.join(""));
      }
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * 收集完整响应
   */
  async collectFullResponse(stream: AsyncGenerator<string>): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return chunks.join("");
  }

  /**
   * 复制流（允许流被多次消费）
   * 使用懒加载模式，只在流被消费时才读取原始流
   */
  private teeStream(textStream: AsyncGenerator<string>): {
    stream1: AsyncGenerator<string>;
    stream2: AsyncGenerator<string>;
  } {
    // 懒加载缓存 - 只有在流被消费时才执行
    let chunksCache: Promise<string[]> | null = null;

    const getChunks = (): Promise<string[]> => {
      if (!chunksCache) {
        chunksCache = (async () => {
          const results: string[] = [];
          for await (const chunk of textStream) {
            results.push(chunk);
          }
          return results;
        })();
      }
      return chunksCache;
    };

    const createStream = async function* (
      getChunksFn: () => Promise<string[]>,
    ): AsyncGenerator<string> {
      const chunks = await getChunksFn();
      for (const chunk of chunks) {
        yield chunk;
      }
    };

    return {
      stream1: createStream(getChunks),
      stream2: createStream(getChunks),
    };
  }

  /**
   * 创建完整的流结果
   */
  createStreamResult(
    textStream: AsyncGenerator<string>,
    callbacks?: StreamCallbacks,
  ): GatewayStreamResult {
    // 复制流以支持多次消费
    const { stream1, stream2 } = this.teeStream(textStream);

    // Wrap with callbacks if provided
    const wrappedStream = callbacks
      ? this.withCallbacks(stream1, callbacks)
      : stream1;

    // Create full stream from text stream
    const fullStream = this.fullStreamFromTextStream(
      wrappedStream as AsyncGenerator<string>,
    );

    // Create final response promise from the second copy
    const finalResponse = this.collectFullResponse(stream2);

    return {
      textStream: wrappedStream as AsyncGenerator<string>,
      fullStream: fullStream as AsyncGenerator<AnyStreamEvent>,
      finalResponse,
    };
  }

  /**
   * 包装错误为 ErrorEvent
   */
  async *wrapErrors(
    stream: AsyncGenerator<AnyStreamEvent>,
  ): AsyncGenerator<AnyStreamEvent> {
    try {
      for await (const event of stream) {
        yield event;
      }
    } catch (error) {
      const err = error as Error & { code?: string };
      yield {
        type: StreamEventType.ERROR,
        message: err.message,
        code: err.code ?? "UNKNOWN_ERROR",
        timestamp: new Date(),
      };
    }
  }

  /**
   * 转换文本流
   */
  async *transformText(
    stream: AsyncGenerator<string>,
    mapper: (text: string) => string,
  ): AsyncGenerator<string> {
    for await (const chunk of stream) {
      yield mapper(chunk);
    }
  }

  /**
   * 过滤文本流
   */
  async *filterText(
    stream: AsyncGenerator<string>,
    predicate: (text: string) => boolean,
  ): AsyncGenerator<string> {
    for await (const chunk of stream) {
      if (predicate(chunk)) {
        yield chunk;
      }
    }
  }

  /**
   * 合并多个文本流
   */
  async *mergeTextStreams(
    streams: AsyncGenerator<string>[],
  ): AsyncGenerator<string> {
    const promises = streams.map(async (stream) => {
      const results: string[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }
      return results;
    });

    const allResults = await Promise.all(promises);
    for (const results of allResults) {
      for (const result of results) {
        yield result;
      }
    }
  }

  /**
   * 为流添加超时
   */
  async *withTimeout<T>(
    stream: AsyncGenerator<T>,
    timeoutMs: number,
    emitErrorEvent = false,
  ): AsyncGenerator<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const error = new Error("Stream timeout") as Error & { code: string };
        error.code = "ETIMEOUT";
        reject(error);
      }, timeoutMs);
    });

    try {
      const iterator = stream[Symbol.asyncIterator]();

      while (true) {
        const result = await Promise.race([iterator.next(), timeoutPromise]);

        if (result.done) {
          break;
        }

        yield result.value;
      }
    } catch (error) {
      if (emitErrorEvent) {
        // Return error as event instead of throwing
        const err = error as Error & { code?: string };
        yield {
          type: StreamEventType.ERROR,
          message: err.message,
          code: err.code || "ETIMEOUT",
          timestamp: new Date(),
        } as T;
      }
      // Otherwise silently stop
    }
  }

  /**
   * 按大小缓冲
   */
  async *bufferBySize(
    stream: AsyncGenerator<string>,
    size: number,
  ): AsyncGenerator<string> {
    let buffer = "";

    for await (const chunk of stream) {
      buffer += chunk;

      while (buffer.length >= size) {
        yield buffer.slice(0, size);
        buffer = buffer.slice(size);
      }
    }

    if (buffer.length > 0) {
      yield buffer;
    }
  }

  /**
   * 按分隔符缓冲
   */
  async *bufferByDelimiter(
    stream: AsyncGenerator<string>,
    delimiter: string,
  ): AsyncGenerator<string> {
    let buffer = "";

    for await (const chunk of stream) {
      buffer += chunk;

      const parts = buffer.split(delimiter);

      // Yield all complete parts
      for (let i = 0; i < parts.length - 1; i++) {
        yield parts[i] + delimiter;
      }

      // Keep the last incomplete part in buffer
      buffer = parts[parts.length - 1] ?? "";
    }

    // Yield remaining buffer
    if (buffer.length > 0) {
      yield buffer;
    }
  }
}
