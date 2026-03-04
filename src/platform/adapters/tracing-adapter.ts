/**
 * TracingAdapter - TracingService → TracingPort
 *
 * 适配 Platform 的 TracingService 到 Agent 的 TracingPort 接口。
 * - TracingEvent.type 映射为 TraceEvent.event
 * - 从 type 前缀推断 TraceCategory
 * - Span 生命周期通过 start/end 事件模拟
 *
 * @module platform/adapters/tracing-adapter
 */

import { randomUUID } from "crypto";
import type {
  TracingPort,
  TracingEvent,
} from "../../agent/ports/platform-services.js";
import type {
  TracingService,
  TraceCategory,
  TraceLevel,
} from "../tracing-service.js";

// ============================================================================
// Category Inference
// ============================================================================

const CATEGORY_PREFIXES: ReadonlyMap<string, TraceCategory> = new Map([
  ["tool", "tool"],
  ["memory", "memory"],
  ["context", "context"],
  ["ile", "ile"],
  ["knowledge", "knowledge"],
  ["gateway", "gateway"],
  ["scheduler", "scheduler"],
]);

function inferCategory(eventType: string): TraceCategory {
  const prefix = eventType.split(":")[0];
  if (prefix !== undefined) {
    const category = CATEGORY_PREFIXES.get(prefix);
    if (category !== undefined) {
      return category;
    }
  }
  return "agent";
}

// ============================================================================
// Adapter
// ============================================================================

export class TracingAdapter implements TracingPort {
  private readonly service: TracingService;
  /** Active spans: spanId → { name, parentId } */
  private readonly activeSpans = new Map<string, { name: string; parentId?: string }>();

  constructor(service: TracingService) {
    this.service = service;
  }

  log(event: TracingEvent): void {
    const level: TraceLevel = event.level ?? "info";
    const category = inferCategory(event.type);

    // Build data: merge event.data + agentId if present
    const data: Record<string, unknown> | undefined =
      event.agentId !== undefined
        ? { ...event.data, agentId: event.agentId }
        : event.data;

    this.service.log({
      level,
      category,
      event: event.type,
      ...(event.sessionId !== undefined ? { sessionId: event.sessionId } : {}),
      ...(data !== undefined ? { data } : {}),
      timestamp: Date.now(),
    });
  }

  logMetric(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): void {
    this.service.log({
      level: "info",
      category: "agent",
      event: `metric:${name}`,
      data: { value, ...tags },
      timestamp: Date.now(),
    });
  }

  startSpan(name: string, parentId?: string): string {
    const spanId = randomUUID();
    const spanEntry = parentId !== undefined
      ? { name, parentId }
      : { name };
    this.activeSpans.set(spanId, spanEntry);

    this.service.log({
      level: "info",
      category: "agent",
      event: "span:start",
      spanId,
      ...(parentId !== undefined ? { parentId } : {}),
      data: { name },
      timestamp: Date.now(),
    });

    return spanId;
  }

  endSpan(spanId: string): void {
    const span = this.activeSpans.get(spanId);
    if (span === undefined) {
      // Unknown span — no-op
      return;
    }

    this.activeSpans.delete(spanId);

    this.service.log({
      level: "info",
      category: "agent",
      event: "span:end",
      spanId,
      ...(span.parentId !== undefined ? { parentId: span.parentId } : {}),
      data: { name: span.name },
      timestamp: Date.now(),
    });
  }
}
