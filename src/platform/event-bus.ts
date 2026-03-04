/**
 * EventBus 实现
 * 位置: src/platform/event-bus.ts
 *
 * SC-4: 进程内轻量事件总线
 * 封装 Node.js EventEmitter，提供类型安全的事件通信
 *
 * BusEventMap 定义已知事件的 payload 类型。
 * 未列入 map 的事件名退化为 `unknown` payload（Scheduler 动态事件兼容）。
 */

import { EventEmitter } from "node:events";

// ============ Event Map ============

/**
 * 已知事件 → payload 类型映射
 *
 * 新增事件时在此处添加一行即可获得全链路类型推导。
 */
export interface BusEventMap {
  "session:end": { readonly sessionId: string; readonly reason: string };
  "reply:sent": { readonly sessionId: string; readonly content: string };
  "role:start": { readonly roleId: string };
  "role:stop": { readonly roleId: string };
}

/** 解析 payload 类型：已知事件取 map，未知事件退化 unknown */
type EventPayload<E extends string> = E extends keyof BusEventMap
  ? BusEventMap[E]
  : unknown;

// ============ 接口 ============

export interface EventBus {
  emit<E extends string>(event: E, payload?: EventPayload<E>): void;
  on<E extends string>(event: E, handler: (payload: EventPayload<E>) => void): void;
  off<E extends string>(event: E, handler: (payload: EventPayload<E>) => void): void;
  dispose(): void;
}

// ============ 实现 ============

class EventBusImpl implements EventBus {
  private readonly emitter = new EventEmitter();

  emit<E extends string>(event: E, payload?: EventPayload<E>): void {
    this.emitter.emit(event, payload);
  }

  on<E extends string>(event: E, handler: (payload: EventPayload<E>) => void): void {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  off<E extends string>(event: E, handler: (payload: EventPayload<E>) => void): void {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
  }

  dispose(): void {
    this.emitter.removeAllListeners();
  }
}

// ============ 工厂函数 ============

export function createEventBus(): EventBus {
  return new EventBusImpl();
}
