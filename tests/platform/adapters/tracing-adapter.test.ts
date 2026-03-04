/**
 * TracingAdapter 测试
 *
 * 适配 TracingService → TracingPort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TracingAdapter } from "../../../src/platform/adapters/tracing-adapter.js";
import type { TracingPort, TracingEvent } from "../../../src/agent/ports/platform-services.js";
import type { TracingService, TraceEvent } from "../../../src/platform/tracing-service.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockTracingService(): {
  service: TracingService;
  log: ReturnType<typeof vi.fn>;
} {
  const log = vi.fn();

  const service = {
    log,
    logMetrics: vi.fn(),
    query: vi.fn().mockResolvedValue([]),
    getSessionSummary: vi.fn().mockResolvedValue({}),
    flush: vi.fn(),
    dispose: vi.fn(),
    bufferSize: 0,
  } as unknown as TracingService;

  return { service, log };
}

// ============================================================================
// Tests
// ============================================================================

describe("TracingAdapter", () => {
  let adapter: TracingPort;
  let log: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockTracingService();
    adapter = new TracingAdapter(mock.service);
    log = mock.log;
  });

  describe("log", () => {
    it("should map TracingEvent to TraceEvent", () => {
      const event: TracingEvent = {
        type: "react:iteration",
        sessionId: "s1",
        agentId: "a1",
        level: "info",
        data: { iteration: 1 },
      };

      adapter.log(event);

      expect(log).toHaveBeenCalledTimes(1);
      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.event).toBe("react:iteration");
      expect(logged.level).toBe("info");
      expect(logged.category).toBe("agent");
      expect(logged.sessionId).toBe("s1");
      expect(logged.data).toEqual({ iteration: 1, agentId: "a1" });
      expect(typeof logged.timestamp).toBe("number");
    });

    it("should default level to info", () => {
      adapter.log({ type: "test" });

      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.level).toBe("info");
    });

    it("should infer category from event type prefix", () => {
      adapter.log({ type: "tool:execute" });
      expect((log.mock.calls[0]![0] as TraceEvent).category).toBe("tool");

      adapter.log({ type: "memory:recall" });
      expect((log.mock.calls[1]![0] as TraceEvent).category).toBe("memory");

      adapter.log({ type: "context:assemble" });
      expect((log.mock.calls[2]![0] as TraceEvent).category).toBe("context");

      adapter.log({ type: "ile:emotion" });
      expect((log.mock.calls[3]![0] as TraceEvent).category).toBe("ile");

      adapter.log({ type: "unknown-event" });
      expect((log.mock.calls[4]![0] as TraceEvent).category).toBe("agent");
    });

    it("should not include agentId in data when absent", () => {
      adapter.log({ type: "test", data: { key: "value" } });

      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.data).toEqual({ key: "value" });
    });
  });

  describe("logMetric", () => {
    it("should log metric as a TraceEvent", () => {
      adapter.logMetric("token_count", 1500, { model: "glm-5" });

      expect(log).toHaveBeenCalledTimes(1);
      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.event).toBe("metric:token_count");
      expect(logged.category).toBe("agent");
      expect(logged.level).toBe("info");
      expect(logged.data).toEqual({ value: 1500, model: "glm-5" });
    });

    it("should handle missing tags", () => {
      adapter.logMetric("latency_ms", 200);

      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.data).toEqual({ value: 200 });
    });
  });

  describe("startSpan / endSpan", () => {
    it("should return a unique span ID", () => {
      const spanId = adapter.startSpan("react-loop");
      expect(typeof spanId).toBe("string");
      expect(spanId.length).toBeGreaterThan(0);
    });

    it("should log span start event", () => {
      adapter.startSpan("react-loop");

      expect(log).toHaveBeenCalledTimes(1);
      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.event).toBe("span:start");
      expect(logged.data).toEqual(expect.objectContaining({ name: "react-loop" }));
    });

    it("should log span start with parentId", () => {
      const spanId = adapter.startSpan("react-loop");
      adapter.startSpan("tool-execution", spanId);

      const logged = log.mock.calls[1]![0] as TraceEvent;
      expect(logged.parentId).toBe(spanId);
    });

    it("should log span end event", () => {
      const spanId = adapter.startSpan("react-loop");
      log.mockClear();

      adapter.endSpan(spanId);

      expect(log).toHaveBeenCalledTimes(1);
      const logged = log.mock.calls[0]![0] as TraceEvent;
      expect(logged.event).toBe("span:end");
      expect(logged.spanId).toBe(spanId);
    });

    it("should be no-op for unknown span ID on endSpan", () => {
      adapter.endSpan("unknown-span");
      // Should not throw, may log or no-op
    });
  });
});
