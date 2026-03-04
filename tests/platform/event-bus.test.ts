/**
 * EventBus 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * SC-4: 进程内轻量事件总线
 * B3: BusEventMap 类型安全
 */

import { describe, it, expect, vi } from "vitest";
import type { BusEventMap } from "@/platform/event-bus";

describe("EventBus", () => {
  it("EB-01: emit/on — handler 收到正确 typed payload", async () => {
    const { createEventBus } = await import("@/platform/event-bus");
    const bus = createEventBus();

    const handler = vi.fn<[BusEventMap["session:end"]]>();
    bus.on("session:end", handler);
    bus.emit("session:end", { sessionId: "sess-1", reason: "timeout" });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ sessionId: "sess-1", reason: "timeout" });

    bus.dispose();
  });

  it("EB-02: 同一事件多个 handler 都被调用", async () => {
    const { createEventBus } = await import("@/platform/event-bus");
    const bus = createEventBus();

    const handler1 = vi.fn<[BusEventMap["reply:sent"]]>();
    const handler2 = vi.fn<[BusEventMap["reply:sent"]]>();
    bus.on("reply:sent", handler1);
    bus.on("reply:sent", handler2);
    bus.emit("reply:sent", { sessionId: "s1", content: "hello" });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();

    bus.dispose();
  });

  it("EB-03: off 移除特定 handler，其余不受影响", async () => {
    const { createEventBus } = await import("@/platform/event-bus");
    const bus = createEventBus();

    const handler1 = vi.fn<[BusEventMap["role:start"]]>();
    const handler2 = vi.fn<[BusEventMap["role:start"]]>();
    bus.on("role:start", handler1);
    bus.on("role:start", handler2);
    bus.off("role:start", handler1);
    bus.emit("role:start", { roleId: "kurisu" });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();

    bus.dispose();
  });

  it("EB-04: emit 无监听者不抛异常（未知事件 → unknown payload）", async () => {
    const { createEventBus } = await import("@/platform/event-bus");
    const bus = createEventBus();

    // String literal outside BusEventMap → payload is unknown
    expect(() => bus.emit("nonexistent:event", { data: 42 })).not.toThrow();

    bus.dispose();
  });

  it("EB-05: dispose() 移除所有监听器", async () => {
    const { createEventBus } = await import("@/platform/event-bus");
    const bus = createEventBus();

    const handler = vi.fn();
    bus.on("session:end", handler);
    bus.on("role:stop", handler);
    bus.dispose();

    bus.emit("session:end", { sessionId: "s1", reason: "test" });
    bus.emit("role:stop", { roleId: "kurisu" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("EB-06: emit 无 payload — handler 收到 undefined", async () => {
    const { createEventBus } = await import("@/platform/event-bus");
    const bus = createEventBus();

    const handler = vi.fn();
    bus.on("role:start", handler);
    bus.emit("role:start");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(undefined);

    bus.dispose();
  });
});
