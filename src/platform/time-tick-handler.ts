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
// Constants
// ============================================================================

/** 跳过刚交互的用户 (< 5min) */
const MIN_ELAPSED_MS = 300_000;

/** 沉默超过 24h 视为长期沉默 */
const LONG_SILENCE_THRESHOLD_MS = 86_400_000;

/** 长期沉默时每 N 次 tick 才执行 1 次 */
const LONG_SILENCE_SKIP_INTERVAL = 12;

// ============================================================================
// Tick Frequency PreCheck
// ============================================================================

/**
 * 创建 tick 频率分层 preCheck 函数
 *
 * 分层策略:
 * - Tier 1: 活跃对话中 → RoutineSystem inSession 机制跳过
 * - Tier 2: 沉默 < 1h → computeShouldAct 下游拦截 (probability=0)
 * - Tier 3: 沉默 1h~24h → 每次 tick 执行
 * - Tier 4: 全部用户沉默 > 24h → 每 12 次 tick 执行 1 次 (≈6h)
 */
export function createTickPreCheck(
  engines: ReadonlyMap<string, PersonaEngineAPI>,
): () => Promise<boolean> {
  let tickCounter = 0;

  return async () => {
    const now = Date.now();
    let hasAnyUser = false;
    let allLongSilence = true;

    for (const engine of engines.values()) {
      const snapshot = engine.getDebugSnapshot();
      for (const projection of Object.values(snapshot.userProjections)) {
        hasAnyUser = true;
        if (now - projection.lastInteraction < LONG_SILENCE_THRESHOLD_MS) {
          allLongSilence = false;
          break;
        }
      }
      if (!allLongSilence) break;
    }

    // 没有已知用户 → 跳过
    if (!hasAnyUser) return false;

    tickCounter++;

    // Tier 4: 所有用户沉默 > 24h → 降频
    if (allLongSilence && tickCounter % LONG_SILENCE_SKIP_INTERVAL !== 1) {
      return false;
    }

    return true;
  };
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
      if (elapsed < MIN_ELAPSED_MS) continue;

      const result: TimeTickResult = engine.processTimeTick(userId, elapsed, now);
      usersProcessed++;

      if (result.shouldAct) {
        actionsTriggered++;
        deps.onAction?.({
          roleId,
          userId,
          action: "proactive",
          probability: 0, // probability is internal to computeShouldAct
          timeContext: result.timeContext,
          timestamp: now,
        });
      }
    }
  }

  return { usersProcessed, actionsTriggered };
}
