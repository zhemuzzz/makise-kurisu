/**
 * PersonaOrchestrator — 主编排器
 *
 * @module inner-life/orchestrator/orchestrator
 * @description 有状态，组装 Core 纯函数 + StateStore
 *
 * @see persona-inner-life.md IL-3, 第八节
 */

import type {
  PersonaEngineAPI,
  PersonaEngineConfig,
  PromptSegments,
  SceneInfo,
  InteractionType,
  PersonaEvent,
  DebugSnapshot,
  CharacterState,
  UserMoodProjection,
  RelationshipState,
  TimeTickResult,
} from "../types.js";

import { mapEmotionTags } from "../core/emotion-mapping.js";
import {
  computeMoodDecay,
  applyEmotionPull,
  computeProjection,
  padToMood,
  clampPAD,
} from "../core/mood-math.js";
import {
  computeRelationshipDecay,
  updateRelationshipFromInteraction,
  checkMilestone,
  createInitialRelationship,
  adjustedThreshold,
} from "../core/relationship-rules.js";
import { syncBaseMood } from "../core/growth-rules.js";
import { buildPromptSegments } from "./context-builder.js";
import { formatTimeContext } from "../core/time-context.js";
import {
  computeShouldAct,
  DEFAULT_PROACTIVE_CONFIG,
} from "../core/proactive-behavior.js";
import type { StateStore } from "./state-store.js";
import { createInMemoryStateStore } from "./state-store.js";

// ============================================================================
// 常量
// ============================================================================

/** 一天的毫秒数 */
const MS_PER_DAY = 86_400_000;

// ============================================================================
// PersonaOrchestrator
// ============================================================================

class PersonaOrchestrator implements PersonaEngineAPI {
  private readonly config: PersonaEngineConfig;
  private readonly store: StateStore;
  /** 每日行动计数 (per-userId) — 非持久化，重启从 0 开始 */
  private readonly dailyActionCounts = new Map<string, { date: string; count: number }>();

  constructor(config: PersonaEngineConfig, store: StateStore) {
    this.config = config;
    this.store = store;

    // 初始化角色状态
    this.ensureCharacterState();
  }

  // --------------------------------------------------------------------------
  // PersonaEngineAPI 实现
  // --------------------------------------------------------------------------

  /**
   * 构建 prompt 注入段（读）
   *
   * 流程:
   * 1. 获取/创建 UserMoodProjection
   * 2. 时间衰减 (mood + relationship)
   * 3. 构建 PromptSegments via context-builder
   */
  buildContext(userId: string, scene: SceneInfo): PromptSegments {
    const charState = this.getOrCreateCharacterState();
    const relationship = this.getOrCreateRelationship(userId);
    const projection = this.getOrCreateProjection(userId, charState);

    // 时间衰减: mood
    const now = Date.now();
    const moodElapsed = now - projection.projectedMood.updatedAt;
    const decayedMood = computeMoodDecay(
      projection.projectedMood,
      this.config.personality,
      moodElapsed,
    );

    // 时间衰减: relationship
    const relElapsed = now - relationship.lastInteraction;
    const relDays = relElapsed / MS_PER_DAY;
    const decayedRelationship = computeRelationshipDecay(
      relationship,
      relDays,
    );

    // 过滤低于表达阈值的情绪
    const threshold = adjustedThreshold(
      this.config.personality.expressionThreshold,
      decayedRelationship,
    );
    const expressedEmotions = projection.recentEmotions.filter(
      (e) => e.weight >= threshold,
    );

    // 更新衰减后的状态
    const updatedProjection: UserMoodProjection = {
      projectedMood: decayedMood,
      recentEmotions: expressedEmotions,
      lastInteraction: projection.lastInteraction,
    };
    this.store.saveUserProjection(
      this.config.roleId,
      userId,
      updatedProjection,
    );
    this.store.saveRelationship(
      this.config.roleId,
      userId,
      decayedRelationship,
    );

    return buildPromptSegments(
      charState,
      userId,
      scene,
      updatedProjection,
      decayedRelationship,
    );
  }

  /**
   * 处理一轮对话结果（写）
   *
   * 流程:
   * 1. parseEmotionTags → ActiveEmotion[]
   * 2. applyEmotionPull → 更新 userProjection.projectedMood
   * 3. baseMood 同步 (1-5% 变化量)
   * 4. updateRelationshipFromInteraction
   * 5. checkMilestone
   * 6. 保存状态
   */
  processTurn(
    userId: string,
    emotionTags: readonly string[],
    interactionType: InteractionType,
  ): void {
    const charState = this.getOrCreateCharacterState();
    const relationship = this.getOrCreateRelationship(userId);
    const projection = this.getOrCreateProjection(userId, charState);

    // 1. 解析情绪标签
    const emotions = mapEmotionTags(emotionTags);

    // 2. 情绪拉扯心境
    const pulledMood = applyEmotionPull(
      projection.projectedMood,
      emotions,
      this.config.personality.emotionBias,
    );

    // 3. baseMood 温水煮青蛙同步
    const moodDelta = {
      p: pulledMood.pleasure - charState.baseMood.pleasure,
      a: pulledMood.arousal - charState.baseMood.arousal,
      d: pulledMood.dominance - charState.baseMood.dominance,
    };
    const newBaseMood = syncBaseMood(
      charState.baseMood,
      moodDelta,
      this.config.baseMoodSyncRatio,
    );

    // 4. 更新关系
    const updatedRelationship = updateRelationshipFromInteraction(
      relationship,
      emotions,
      interactionType,
    );

    // 5. 检查里程碑
    let finalRelationship = updatedRelationship;
    const milestone = checkMilestone(updatedRelationship);
    if (milestone) {
      finalRelationship = {
        ...updatedRelationship,
        milestoneHistory: [...updatedRelationship.milestoneHistory, milestone],
      };
    }

    // 6. 重新计算投影
    const newProjection: UserMoodProjection = {
      projectedMood: computeProjection(
        newBaseMood,
        finalRelationship,
        pulledMood,
      ),
      recentEmotions: emotions,
      lastInteraction: Date.now(),
    };

    // 7. 保存所有状态
    const newCharState: CharacterState = {
      ...charState,
      baseMood: newBaseMood,
      userProjections: new Map([
        ...charState.userProjections,
        [userId, newProjection],
      ]),
      relationships: new Map([
        ...charState.relationships,
        [userId, finalRelationship],
      ]),
    };

    this.store.saveCharacterState(this.config.roleId, newCharState);
    this.store.saveUserProjection(
      this.config.roleId,
      userId,
      newProjection,
    );
    this.store.saveRelationship(
      this.config.roleId,
      userId,
      finalRelationship,
    );
  }

  /**
   * 注入特殊事件
   */
  injectEvent(event: PersonaEvent): void {
    const charState = this.getOrCreateCharacterState();

    if (event.moodImpact) {
      if (event.scope === "global") {
        // 全局事件: 直接影响 baseMood
        const newBaseMood = padToMood(
          clampPAD({
            p: charState.baseMood.pleasure + event.moodImpact.p,
            a: charState.baseMood.arousal + event.moodImpact.a,
            d: charState.baseMood.dominance + event.moodImpact.d,
          }),
          Date.now(),
        );

        this.store.saveCharacterState(this.config.roleId, {
          ...charState,
          baseMood: newBaseMood,
        });
      } else if (event.scope === "user" && event.userId) {
        // 用户事件: 影响该用户的投影
        const projection = this.getOrCreateProjection(
          event.userId,
          charState,
        );
        const newMood = padToMood(
          clampPAD({
            p: projection.projectedMood.pleasure + event.moodImpact.p,
            a: projection.projectedMood.arousal + event.moodImpact.a,
            d: projection.projectedMood.dominance + event.moodImpact.d,
          }),
          Date.now(),
        );

        this.store.saveUserProjection(this.config.roleId, event.userId, {
          ...projection,
          projectedMood: newMood,
        });
      }
    }
  }

  /**
   * 调试：获取完整状态快照
   */
  getDebugSnapshot(userId?: string): DebugSnapshot {
    const charState = this.getOrCreateCharacterState();

    const userProjections: Record<string, UserMoodProjection> = {};
    const relationships: Record<string, RelationshipState> = {};

    if (userId) {
      // 只返回指定用户
      const proj = this.store.getUserProjection(
        this.config.roleId,
        userId,
      );
      if (proj) userProjections[userId] = proj;

      const rel = this.store.getRelationship(this.config.roleId, userId);
      if (rel) relationships[userId] = rel;
    } else {
      // 返回所有用户
      for (const [uid, proj] of charState.userProjections) {
        userProjections[uid] = proj;
      }
      for (const [uid, rel] of charState.relationships) {
        relationships[uid] = rel;
      }
    }

    return {
      roleId: this.config.roleId,
      baseMood: charState.baseMood,
      personality: charState.personality,
      userProjections,
      relationships,
      snapshotAt: Date.now(),
    };
  }

  /**
   * 时间 tick — 纯数学，不调 LLM
   *
   * 1. mood 衰减 + 性格方向回归 (computeMoodDecay)
   * 2. 关系衰减 (computeRelationshipDecay)
   * 3. 持久化衰减后状态
   * 4. shouldAct 判定 (B2 补全，当前 stranger 一律 false)
   * 5. 生成时间上下文
   */
  processTimeTick(
    userId: string,
    elapsedMs: number,
    currentTime: number,
  ): TimeTickResult {
    const charState = this.getOrCreateCharacterState();
    const relationship = this.getOrCreateRelationship(userId);
    const projection = this.getOrCreateProjection(userId, charState);

    // 1. Mood 衰减 (向 personality.defaultMood 回归)
    const decayedMood = computeMoodDecay(
      projection.projectedMood,
      this.config.personality,
      elapsedMs,
    );

    // 2. 关系衰减
    const relDays = elapsedMs / MS_PER_DAY;
    const decayedRelationship = computeRelationshipDecay(
      relationship,
      relDays,
    );

    // 3. 持久化衰减后状态
    const updatedProjection: UserMoodProjection = {
      projectedMood: decayedMood,
      recentEmotions: projection.recentEmotions,
      lastInteraction: projection.lastInteraction,
    };
    this.store.saveUserProjection(
      this.config.roleId,
      userId,
      updatedProjection,
    );
    this.store.saveRelationship(
      this.config.roleId,
      userId,
      decayedRelationship,
    );

    // 4. shouldAct 判定
    const actionsToday = this.getActionsToday(userId);
    const shouldActResult = computeShouldAct({
      relationship: decayedRelationship,
      elapsedMs,
      mood: decayedMood,
      actionsToday,
      config: DEFAULT_PROACTIVE_CONFIG,
    });

    const shouldAct = shouldActResult.shouldAct;

    // 递增每日计数
    if (shouldAct) {
      this.incrementActionsToday(userId);
    }

    // 5. 时间上下文
    const timeContext = formatTimeContext(elapsedMs, currentTime);

    return {
      userId,
      mood: decayedMood,
      relationship: decayedRelationship,
      shouldAct,
      timeContext,
    };
  }

  // --------------------------------------------------------------------------
  // 内部方法
  // --------------------------------------------------------------------------

  private ensureCharacterState(): void {
    const existing = this.store.getCharacterState(this.config.roleId);
    if (!existing) {
      const initial: CharacterState = {
        roleId: this.config.roleId,
        personality: this.config.personality,
        baseMood: { ...this.config.personality.defaultMood, updatedAt: Date.now() },
        userProjections: new Map(),
        relationships: new Map(),
      };
      this.store.saveCharacterState(this.config.roleId, initial);
    }
  }

  private getOrCreateCharacterState(): CharacterState {
    const state = this.store.getCharacterState(this.config.roleId);
    if (state) return state;

    // 不应该走到这里 (ensureCharacterState 在构造函数中调用)
    this.ensureCharacterState();
    return this.store.getCharacterState(this.config.roleId)!;
  }

  private getOrCreateRelationship(userId: string): RelationshipState {
    const existing = this.store.getRelationship(
      this.config.roleId,
      userId,
    );
    if (existing) return existing;

    const initial = createInitialRelationship();
    this.store.saveRelationship(this.config.roleId, userId, initial);
    return initial;
  }

  private getOrCreateProjection(
    userId: string,
    charState: CharacterState,
  ): UserMoodProjection {
    const existing = this.store.getUserProjection(
      this.config.roleId,
      userId,
    );
    if (existing) return existing;

    const initial: UserMoodProjection = {
      projectedMood: charState.baseMood,
      recentEmotions: [],
      lastInteraction: Date.now(),
    };
    this.store.saveUserProjection(this.config.roleId, userId, initial);
    return initial;
  }

  private getActionsToday(userId: string): number {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const entry = this.dailyActionCounts.get(userId);
    if (!entry || entry.date !== today) return 0;
    return entry.count;
  }

  private incrementActionsToday(userId: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.dailyActionCounts.get(userId);
    if (!entry || entry.date !== today) {
      this.dailyActionCounts.set(userId, { date: today, count: 1 });
    } else {
      this.dailyActionCounts.set(userId, { date: today, count: entry.count + 1 });
    }
  }
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建 PersonaEngine 实例
 *
 * @param config - PersonaEngine 配置
 * @param store - 可选状态存储 (默认 In-Memory)
 * @returns PersonaEngineAPI 实例
 */
export function createPersonaEngine(
  config: PersonaEngineConfig,
  store?: StateStore,
): PersonaEngineAPI {
  return new PersonaOrchestrator(
    config,
    store ?? createInMemoryStateStore(),
  );
}
