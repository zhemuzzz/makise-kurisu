/**
 * Time Tick Handler — ILE 时间感知调度
 *
 * @module platform/time-tick-handler
 * @description 定时触发 PersonaEngine.processTimeTick，驱动 mood/关系衰减 + 主动行为判定
 */

import type { PersonaEngineAPI, TimeTickResult } from "../inner-life/types.js";

// ============================================================================
// Types
// ============================================================================

export interface TimeTickDeps {
  /** 角色 PersonaEngine 映射 (roleId → engine) */
  readonly engines: ReadonlyMap<string, PersonaEngineAPI>;
  /** 事件记录 */
  readonly onAction?: (event: ProactiveActionEvent) => void;
}

export interface ProactiveActionEvent {
  readonly roleId: string;
  readonly userId: string;
  readonly action: string;
  readonly probability: number;
  readonly timeContext: string;
  readonly timestamp: number;
}

export interface TimeTickStats {
  readonly usersProcessed: number;
  readonly actionsTriggered: number;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * 执行时间 tick：遍历所有角色 + 已知用户
 *
 * 流程:
 * 1. 对每个角色的 PersonaEngine 获取 DebugSnapshot（含所有已知用户）
 * 2. 对每个用户计算 elapsed time → processTimeTick
 * 3. 如果 shouldAct=true，触发 onAction 回调
 */
export function handleTimeTick(deps: TimeTickDeps): TimeTickStats {
  const now = Date.now();
  let usersProcessed = 0;
  let actionsTriggered = 0;

  for (const [roleId, engine] of deps.engines) {
    const snapshot = engine.getDebugSnapshot();

    for (const [userId, projection] of Object.entries(snapshot.userProjections)) {
      const elapsed = now - projection.lastInteraction;

      // 跳过刚交互的用户 (< 5min，避免无效计算)
      if (elapsed < 300_000) continue;

      const result: TimeTickResult = engine.processTimeTick(userId, elapsed, now);
      usersProcessed++;

      if (result.shouldAct) {
        actionsTriggered++;
        deps.onAction?.({
          roleId,
          userId,
          action: result.shouldAct ? "proactive" : "none",
          probability: 0, // probability is internal to computeShouldAct
          timeContext: result.timeContext,
          timestamp: now,
        });
      }
    }
  }

  return { usersProcessed, actionsTriggered };
}
