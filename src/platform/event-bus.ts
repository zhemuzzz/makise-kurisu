/**
 * EventBus 实现
 * 位置: src/platform/event-bus.ts
 *
 * SC-4: 进程内轻量事件总线
 * 封装 Node.js EventEmitter，提供类型安全的事件通信
 *
 * 已知事件:
 * - session:end  — SessionManager 触发
 * - reply:sent   — Agent Core 触发
 * - role:start   — Platform 触发
 * - role:stop    — Platform 触发
 */

import { EventEmitter } from "node:events";

// ============ 接口 ============

export interface EventBus {
  emit(event: string, payload?: unknown): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  dispose(): void;
}

// ============ 实现 ============

class EventBusImpl implements EventBus {
  private readonly emitter = new EventEmitter();

  emit(event: string, payload?: unknown): void {
    this.emitter.emit(event, payload);
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.emitter.off(event, handler);
  }

  dispose(): void {
    this.emitter.removeAllListeners();
  }
}

// ============ 工厂函数 ============

export function createEventBus(): EventBus {
  return new EventBusImpl();
}
