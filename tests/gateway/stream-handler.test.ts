/**
 * L1 交互网关 - 流式处理器测试
 * 测试 AsyncGenerator 转换、回调触发、错误处理
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StreamHandler } from "../../src/gateway/stream-handler";
import {
  StreamEventType,
  type TextDeltaEvent,
  type TextCompleteEvent,
  type ErrorEvent,
  type MetadataEvent,
  type StreamCallbacks,
  type AnyStreamEvent,
} from "../../src/gateway/types";
import {
  createMockTextStream,
  createMockEventStream,
  SAMPLE_EVENTS,
  MOCK_AI_RESPONSE_CHUNKS,
  MOCK_AI_RESPONSE_FULL,
  createTextDeltaEvent,
  createTextCompleteEvent,
  createErrorEvent,
  createMetadataEvent,
  TIMING_THRESHOLDS,
  BOUNDARY_TEST_DATA,
} from "../fixtures/gateway-fixtures";

// Helper to collect generator results
async function collectGenerator<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const item of gen) {
    results.push(item);
  }
  return results;
}

describe("StreamHandler", () => {
  let streamHandler: StreamHandler;

  beforeEach(() => {
    streamHandler = new StreamHandler();
  });

  describe("textStreamFromChunks", () => {
    it("should create text stream from string array", async () => {
      const chunks = ["Hello", " ", "World", "!"];
      const stream = streamHandler.textStreamFromChunks(chunks);

      const results = await collectGenerator(stream);

      expect(results).toEqual(chunks);
    });

    it("should handle empty array", async () => {
      const stream = streamHandler.textStreamFromChunks([]);
      const results = await collectGenerator(stream);

      expect(results).toEqual([]);
    });

    it("should handle single chunk", async () => {
      const stream = streamHandler.textStreamFromChunks(["Single"]);
      const results = await collectGenerator(stream);

      expect(results).toEqual(["Single"]);
    });

    it("should handle large number of chunks", async () => {
      const chunks = MOCK_AI_RESPONSE_CHUNKS;
      const stream = streamHandler.textStreamFromChunks(chunks);
      const results = await collectGenerator(stream);

      expect(results).toEqual(chunks);
      expect(results.join("")).toBe(MOCK_AI_RESPONSE_FULL);
    });
  });

  describe("fullStreamFromTextStream", () => {
    it("should convert text chunks to delta events", async () => {
      async function* textGen() {
        yield "Hello";
        yield " ";
        yield "World";
      }

      const fullStream = streamHandler.fullStreamFromTextStream(textGen());
      const events = await collectGenerator(fullStream);

      expect(events).toHaveLength(3);
      events.forEach((event, index) => {
        expect(event.type).toBe(StreamEventType.TEXT_DELTA);
        expect((event as TextDeltaEvent).isFinal).toBe(index === 2);
      });
    });

    it("should mark last chunk as final", async () => {
      async function* textGen() {
        yield "chunk1";
        yield "chunk2";
        yield "chunk3";
      }

      const fullStream = streamHandler.fullStreamFromTextStream(textGen());
      const events = await collectGenerator(fullStream);

      expect((events[0] as TextDeltaEvent).isFinal).toBe(false);
      expect((events[1] as TextDeltaEvent).isFinal).toBe(false);
      expect((events[2] as TextDeltaEvent).isFinal).toBe(true);
    });

    it("should handle empty generator", async () => {
      async function* textGen() {
        // Empty
      }

      const fullStream = streamHandler.fullStreamFromTextStream(textGen());
      const events = await collectGenerator(fullStream);

      expect(events).toEqual([]);
    });

    it("should include timestamp in events", async () => {
      async function* textGen() {
        yield "test";
      }

      const fullStream = streamHandler.fullStreamFromTextStream(textGen());
      const events = await collectGenerator(fullStream);

      expect((events[0] as TextDeltaEvent).timestamp).toBeInstanceOf(Date);
    });
  });

  describe("withCallbacks", () => {
    it("should call onChunk for each chunk", async () => {
      const onChunk = vi.fn();

      async function* gen() {
        yield "chunk1";
        yield "chunk2";
        yield "chunk3";
      }

      const wrappedStream = streamHandler.withCallbacks(gen(), { onChunk });
      await collectGenerator(wrappedStream);

      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onChunk).toHaveBeenCalledWith("chunk1");
      expect(onChunk).toHaveBeenCalledWith("chunk2");
      expect(onChunk).toHaveBeenCalledWith("chunk3");
    });

    it("should call onComplete when stream completes", async () => {
      const onComplete = vi.fn();

      async function* gen() {
        yield "chunk1";
        yield "chunk2";
      }

      const wrappedStream = streamHandler.withCallbacks(gen(), { onComplete });
      await collectGenerator(wrappedStream);

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith("chunk1chunk2");
    });

    it("should call onError when error occurs", async () => {
      const onError = vi.fn();
      const testError = new Error("Stream error");

      async function* gen() {
        yield "chunk1";
        throw testError;
      }

      const wrappedStream = streamHandler.withCallbacks(gen(), { onError });

      await expect(collectGenerator(wrappedStream)).rejects.toThrow(
        "Stream error",
      );

      expect(onError).toHaveBeenCalledWith(testError);
    });

    it("should call onMetadata for metadata events", async () => {
      const onMetadata = vi.fn();

      async function* gen(): AsyncGenerator<AnyStreamEvent> {
        yield createTextDeltaEvent("test");
        yield createMetadataEvent({ tokens: 42 });
      }

      const wrappedStream = streamHandler.withCallbacks(gen(), { onMetadata });
      await collectGenerator(wrappedStream);

      expect(onMetadata).toHaveBeenCalledWith({ tokens: 42 });
    });

    it("should work with partial callbacks", async () => {
      const onComplete = vi.fn();

      async function* gen() {
        yield "test";
      }

      const wrappedStream = streamHandler.withCallbacks(gen(), { onComplete });
      await collectGenerator(wrappedStream);

      expect(onComplete).toHaveBeenCalled();
    });

    it("should work with no callbacks", async () => {
      async function* gen() {
        yield "test";
      }

      const wrappedStream = streamHandler.withCallbacks(gen(), {});
      const results = await collectGenerator(wrappedStream);

      expect(results).toEqual(["test"]);
    });
  });

  describe("collectFullResponse", () => {
    it("should collect all chunks into full response", async () => {
      async function* gen() {
        yield "Hello";
        yield " ";
        yield "World";
        yield "!";
      }

      const response = await streamHandler.collectFullResponse(gen());

      expect(response).toBe("Hello World!");
    });

    it("should return empty string for empty stream", async () => {
      async function* gen() {
        // Empty
      }

      const response = await streamHandler.collectFullResponse(gen());

      expect(response).toBe("");
    });

    it("should handle unicode content", async () => {
      async function* gen() {
        yield "你好";
        yield "世界";
        yield "🌍";
      }

      const response = await streamHandler.collectFullResponse(gen());

      expect(response).toBe("你好世界🌍");
    });
  });

  describe("createStreamResult", () => {
    it("should create complete stream result", async () => {
      const chunks = ["Hello", " ", "World"];

      const result = streamHandler.createStreamResult(
        streamHandler.textStreamFromChunks(chunks),
      );

      // Test finalResponse first (will consume stream2)
      const final = await result.finalResponse;
      expect(final).toBe("Hello World");

      // Test textStream (will consume stream1)
      const textResults = await collectGenerator(result.textStream);
      expect(textResults).toEqual(chunks);
    });

    it("should create stream result with callbacks", async () => {
      const onChunk = vi.fn();
      const onComplete = vi.fn();
      const chunks = ["a", "b", "c"];

      const result = streamHandler.createStreamResult(
        streamHandler.textStreamFromChunks(chunks),
        { onChunk, onComplete },
      );

      // Consume the textStream to trigger callbacks
      const textResults = await collectGenerator(result.textStream);
      expect(textResults).toEqual(chunks);

      expect(onChunk).toHaveBeenCalledTimes(3);
      expect(onComplete).toHaveBeenCalledWith("abc");
    });

    it("should allow consuming any stream independently", async () => {
      const chunks = ["Hello", " ", "World"];

      const result = streamHandler.createStreamResult(
        streamHandler.textStreamFromChunks(chunks),
      );

      // Consume finalResponse
      const final = await result.finalResponse;
      expect(final).toBe("Hello World");

      // textStream should still be consumable (from cached data)
      const textResults = await collectGenerator(result.textStream);
      expect(textResults).toEqual(chunks);
    });
  });

  describe("error wrapping", () => {
    it("should wrap generator errors in ErrorEvent", async () => {
      async function* gen(): AsyncGenerator<AnyStreamEvent> {
        yield createTextDeltaEvent("partial");
        throw new Error("Generator failed");
      }

      const wrapped = streamHandler.wrapErrors(gen());
      const events = await collectGenerator(wrapped);

      expect(events).toHaveLength(2);
      expect(events[0].type).toBe(StreamEventType.TEXT_DELTA);
      expect(events[1].type).toBe(StreamEventType.ERROR);
      expect((events[1] as ErrorEvent).message).toBe("Generator failed");
    });

    it("should include error code if available", async () => {
      const customError = new Error("Custom error") as Error & { code: string };
      customError.code = "E_CUSTOM";

      async function* gen(): AsyncGenerator<AnyStreamEvent> {
        throw customError;
      }

      const wrapped = streamHandler.wrapErrors(gen());
      const events = await collectGenerator(wrapped);

      expect((events[0] as ErrorEvent).code).toBe("E_CUSTOM");
    });

    it("should not wrap already wrapped errors", async () => {
      async function* gen(): AsyncGenerator<AnyStreamEvent> {
        yield createErrorEvent("Already wrapped", "E001");
      }

      const wrapped = streamHandler.wrapErrors(gen());
      const events = await collectGenerator(wrapped);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe(StreamEventType.ERROR);
    });
  });

  describe("transform stream", () => {
    it("should transform text chunks with mapper", async () => {
      async function* gen() {
        yield "hello";
        yield "world";
      }

      const transformed = streamHandler.transformText(gen(), (text) =>
        text.toUpperCase(),
      );

      const results = await collectGenerator(transformed);

      expect(results).toEqual(["HELLO", "WORLD"]);
    });

    it("should filter chunks with predicate", async () => {
      async function* gen() {
        yield "keep";
        yield "remove";
        yield "keep";
      }

      const filtered = streamHandler.filterText(
        gen(),
        (text) => text === "keep",
      );

      const results = await collectGenerator(filtered);

      expect(results).toEqual(["keep", "keep"]);
    });
  });

  describe("merge streams", () => {
    it("should merge multiple text streams", async () => {
      async function* gen1() {
        yield "a";
        yield "b";
      }

      async function* gen2() {
        yield "1";
        yield "2";
      }

      const merged = streamHandler.mergeTextStreams([gen1(), gen2()]);
      const results = await collectGenerator(merged);

      // Order depends on interleaving, but all items should be present
      expect(results.sort()).toEqual(["1", "2", "a", "b"].sort());
    });

    it("should handle empty streams in merge", async () => {
      async function* gen1() {
        yield "a";
      }

      async function* gen2() {
        // Empty
      }

      const merged = streamHandler.mergeTextStreams([gen1(), gen2()]);
      const results = await collectGenerator(merged);

      expect(results).toEqual(["a"]);
    });
  });

  describe("timeout handling", () => {
    it("should timeout slow generator", async () => {
      async function* slowGen() {
        yield "first";
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield "second"; // Should not reach
      }

      const withTimeout = streamHandler.withTimeout(slowGen(), 100);
      const results = await collectGenerator(withTimeout);

      expect(results).toEqual(["first"]);
    });

    it("should emit error event on timeout", async () => {
      async function* slowGen(): AsyncGenerator<AnyStreamEvent> {
        yield createTextDeltaEvent("first");
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield createTextDeltaEvent("second");
      }

      const withTimeout = streamHandler.withTimeout(slowGen(), 100, true);
      const events = await collectGenerator(withTimeout);

      const hasTimeoutError = events.some(
        (e) =>
          e.type === StreamEventType.ERROR &&
          (e as ErrorEvent).code === "ETIMEOUT",
      );

      expect(hasTimeoutError).toBe(true);
    });

    it("should complete normally if within timeout", async () => {
      async function* fastGen() {
        yield "a";
        yield "b";
      }

      const withTimeout = streamHandler.withTimeout(fastGen(), 1000);
      const results = await collectGenerator(withTimeout);

      expect(results).toEqual(["a", "b"]);
    });
  });

  describe("buffer handling", () => {
    it("should buffer chunks by size", async () => {
      async function* gen() {
        yield "a";
        yield "b";
        yield "c";
        yield "d";
        yield "e";
      }

      const buffered = streamHandler.bufferBySize(gen(), 2);
      const results = await collectGenerator(buffered);

      expect(results).toEqual(["ab", "cd", "e"]);
    });

    it("should buffer chunks by delimiter", async () => {
      async function* gen() {
        yield "line1\n";
        yield "line2\n";
        yield "line3";
      }

      const buffered = streamHandler.bufferByDelimiter(gen(), "\n");
      const results = await collectGenerator(buffered);

      expect(results).toEqual(["line1\n", "line2\n", "line3"]);
    });
  });

  describe("Boundary Cases", () => {
    it("should handle empty text chunks", async () => {
      async function* gen() {
        yield "";
        yield "content";
        yield "";
      }

      const results = await collectGenerator(gen());

      expect(results).toEqual(["", "content", ""]);
    });

    it("should handle very large chunks", async () => {
      const hugeChunk = "x".repeat(100000);

      async function* gen() {
        yield hugeChunk;
      }

      const results = await collectGenerator(gen());

      expect(results[0]).toBe(hugeChunk);
    });

    it("should handle unicode in chunks", async () => {
      async function* gen() {
        yield "你好";
        yield "世界";
        yield "🌍";
      }

      const results = await collectGenerator(gen());

      expect(results.join("")).toBe("你好世界🌍");
    });

    it("should handle special characters", async () => {
      async function* gen() {
        yield "<script>";
        yield "\n\t";
        yield BOUNDARY_TEST_DATA.nullBytes;
      }

      // Should not throw
      const results = await collectGenerator(gen());
      expect(results).toHaveLength(3);
    });
  });

  describe("Performance", () => {
    it("should process 10000 chunks efficiently", async () => {
      const chunks = Array.from({ length: 10000 }, (_, i) => `chunk${i}`);

      const start = performance.now();
      const stream = streamHandler.textStreamFromChunks(chunks);
      const results = await collectGenerator(stream);
      const duration = performance.now() - start;

      expect(results).toHaveLength(10000);
      expect(duration).toBeLessThan(1000); // Should be under 1 second
    });

    it("should handle callbacks without significant overhead", async () => {
      const onChunk = vi.fn();

      async function* gen() {
        for (let i = 0; i < 1000; i++) {
          yield `chunk${i}`;
        }
      }

      const start = performance.now();
      const wrapped = streamHandler.withCallbacks(gen(), { onChunk });
      await collectGenerator(wrapped);
      const duration = performance.now() - start;

      expect(onChunk).toHaveBeenCalledTimes(1000);
      expect(duration).toBeLessThan(100);
    });
  });
});
