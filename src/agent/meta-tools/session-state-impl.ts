/**
 * SessionStateImpl — SessionState 具体实现
 *
 * 管理 manage-todo 和 manage-cognition 的跨轮次状态
 * cognition 更新时自动持久化到 CognitionStore
 *
 * @module agent/meta-tools/session-state-impl
 */

import type { TodoState, CognitionState } from "../types.js";
import type { SessionState } from "./types.js";
import type { CognitionStore } from "../../platform/storage/cognition-store.js";

// ============================================================================
// Implementation
// ============================================================================

export class SessionStateImpl implements SessionState {
  private todoState: TodoState | undefined;
  private cognitionState: CognitionState | undefined;
  private readonly cognitionStore: CognitionStore | undefined;

  constructor(options?: {
    readonly cognitionStore?: CognitionStore;
    readonly initialCognition?: CognitionState;
  }) {
    this.cognitionStore = options?.cognitionStore;
    this.cognitionState = options?.initialCognition;
  }

  getTodoState(): TodoState | undefined {
    return this.todoState;
  }

  setTodoState(state: TodoState): void {
    this.todoState = state;
  }

  getCognitionState(): CognitionState | undefined {
    return this.cognitionState;
  }

  setCognitionState(state: CognitionState): void {
    this.cognitionState = state;

    // 异步持久化（fire-and-forget，不阻塞元工具执行）
    if (this.cognitionStore) {
      void this.cognitionStore.write(state.content).catch(() => {
        // 持久化失败静默处理——内存中的状态仍然有效
      });
    }
  }
}
