/**
 * Inner Life Engine 类型定义
 *
 * @module inner-life/types
 * @description 情绪/心境/关系/成长 完整类型定义
 *
 * 设计结论来源:
 * - persona-inner-life.md: IL-1~IL-7
 *
 * 三个时间尺度:
 * - Emotion（秒级）: 快速触发/衰减
 * - Mood（小时级）: 缓慢变化
 * - Personality（周月级）: 几乎不变
 */

// ============================================================================
// PAD 向量 — 心境空间基础
// ============================================================================

/**
 * PAD 三维向量
 *
 * Pleasure-Arousal-Dominance 模型 (Mehrabian & Russell)
 * 每个维度范围: [-1.0, 1.0]
 */
export interface PADVector {
  /** 愉悦/不悦 */
  readonly p: number;
  /** 激活/平静 */
  readonly a: number;
  /** 掌控/失控 */
  readonly d: number;
}

/**
 * 心境状态 (PAD + 时间戳)
 */
export interface MoodState {
  readonly pleasure: number;
  readonly arousal: number;
  readonly dominance: number;
  readonly updatedAt: number;
}

// ============================================================================
// 情绪标签 — 封闭集 (IL-4)
// ============================================================================

/**
 * 情绪标签封闭集
 *
 * 14 个标签分 3 类:
 * - positive: joy, contentment, pride, curiosity, relief
 * - negative: irritation, frustration, shame, sadness, anxiety
 * - social: affection, trust, embarrassment, defensiveness
 *
 * @see persona-inner-life.md IL-4
 */
export type EmotionTag =
  // Positive
  | "joy"
  | "contentment"
  | "pride"
  | "curiosity"
  | "relief"
  // Negative
  | "irritation"
  | "frustration"
  | "shame"
  | "sadness"
  | "anxiety"
  // Social
  | "affection"
  | "trust"
  | "embarrassment"
  | "defensiveness";

/**
 * 情绪标签集合 (运行时校验用)
 */
export const EMOTION_TAGS: readonly EmotionTag[] = [
  "joy",
  "contentment",
  "pride",
  "curiosity",
  "relief",
  "irritation",
  "frustration",
  "shame",
  "sadness",
  "anxiety",
  "affection",
  "trust",
  "embarrassment",
  "defensiveness",
] as const;

/**
 * 强度修饰符
 *
 * @see persona-inner-life.md IL-4 intensity_modifiers
 */
export type IntensityModifier = "mild_" | "" | "strong_" | "extreme_";

/**
 * 活跃情绪 (标签 + 权重)
 */
export interface ActiveEmotion {
  readonly tag: EmotionTag;
  /** 权重 = PAD 向量模长 × intensity × emotionBias */
  readonly weight: number;
  /** 原始强度系数 */
  readonly intensity: number;
  /** PAD 向量 */
  readonly pad: PADVector;
}

// ============================================================================
// 人格默认值
// ============================================================================

/**
 * 角色人格默认值
 *
 * PAD 基线 + 情绪偏置 + 行为参数
 */
export interface PersonalityDefaults {
  /** PAD 默认心境 (回归目标) */
  readonly defaultMood: MoodState;
  /** 情绪偏置: 增幅/衰减系数 (>1 增幅, <1 衰减) */
  readonly emotionBias: Readonly<Partial<Record<EmotionTag, number>>>;
  /** 心境回归基线速度 (每小时衰减百分比, 0-1) */
  readonly moodDecayRate: number;
  /** 最小表达阈值 (低于此值的情绪不表达) */
  readonly expressionThreshold: number;
}

// ============================================================================
// Per-User 心境投影 (IL-2)
// ============================================================================

/**
 * Per-User 心境投影
 *
 * 每个用户看到独立的角色心境，避免跨用户污染。
 *
 * projectedMood = baseMood + relationshipModifier + recentResidual
 *
 * @see persona-inner-life.md IL-2
 */
export interface UserMoodProjection {
  /** 投影后的心境 */
  readonly projectedMood: MoodState;
  /** 近期活跃情绪 */
  readonly recentEmotions: readonly ActiveEmotion[];
  /** 最后交互时间 */
  readonly lastInteraction: number;
}

// ============================================================================
// 关系系统
// ============================================================================

/**
 * 关系阶段 (Persona 5 式)
 *
 * @see persona-inner-life.md 第四节
 */
export type RelationshipStage =
  | "stranger" // 0-20 familiarity
  | "acquaintance" // 20-40
  | "familiar" // 40-60
  | "friend" // 60-80
  | "close_friend"; // 80-100

/**
 * 关系状态 (Per-User)
 */
export interface RelationshipState {
  /** 关系阶段 */
  readonly stage: RelationshipStage;
  /** 信任度 0-100 (不自然衰减，只有负面事件才降低) */
  readonly trust: number;
  /** 亲密度 0-100 (每日衰减 -1，不低于阶段下限) */
  readonly familiarity: number;
  /** 温暖度 0-100 (每日衰减 -2，无下限可降为 0) */
  readonly warmth: number;
  /** 交互次数 */
  readonly interactionCount: number;
  /** 最后交互时间 */
  readonly lastInteraction: number;
  /** 里程碑历史 */
  readonly milestoneHistory: readonly Milestone[];
}

/**
 * 里程碑记录
 */
export interface Milestone {
  /** 里程碑类型 */
  readonly type: string;
  /** 达成时间 */
  readonly achievedAt: number;
  /** 描述 */
  readonly description: string;
}

// ============================================================================
// 成长系统
// ============================================================================

/**
 * 成长经历
 */
export interface GrowthExperience {
  /** PAD 变化方向 */
  readonly padDelta: PADVector;
  /** 权重 */
  readonly weight: number;
  /** 时间戳 */
  readonly timestamp: number;
}

/**
 * 成长边界 (防止人格崩坏)
 */
export interface GrowthBounds {
  /** 每个 PAD 维度的最大漂移量 */
  readonly maxDrift: PADVector;
}

// ============================================================================
// 角色完整状态
// ============================================================================

/**
 * 角色完整状态
 *
 * @see persona-inner-life.md 第三节
 */
export interface CharacterState {
  /** 角色 ID */
  readonly roleId: string;
  /** 人格默认值 */
  readonly personality: PersonalityDefaults;
  /** 全局基线心境 (极慢变化) */
  readonly baseMood: MoodState;
  /** Per-User 心境投影 */
  readonly userProjections: ReadonlyMap<string, UserMoodProjection>;
  /** Per-User 关系状态 */
  readonly relationships: ReadonlyMap<string, RelationshipState>;
}

// ============================================================================
// 交互类型
// ============================================================================

/**
 * 交互类型
 */
export type InteractionType =
  | "text_chat" // 文字对话
  | "voice_chat" // 语音对话
  | "tool_use" // 工具使用
  | "group_chat" // 群聊
  | "background"; // 后台任务

// ============================================================================
// 事件系统
// ============================================================================

/**
 * 特殊事件 (剧情杀、节日等)
 *
 * 由 Orchestrator.injectEvent() 处理
 */
export interface PersonaEvent {
  /** 事件类型 */
  readonly type: string;
  /** 影响范围: 全局或指定用户 */
  readonly scope: "global" | "user";
  /** 目标用户 (scope=user 时) */
  readonly userId?: string;
  /** 心境影响 (直接叠加) */
  readonly moodImpact?: PADVector;
  /** 描述 */
  readonly description: string;
  /** 时间戳 */
  readonly timestamp: number;
}

// ============================================================================
// 场景信息
// ============================================================================

/**
 * 场景信息 (群聊/私聊)
 *
 * @see persona-inner-life.md 第六节
 */
export interface SceneInfo {
  /** 场景类型 */
  readonly type: "private" | "group";
  /** 当前对话对象 userId */
  readonly targetUserId: string;
  /** 在场用户信息 (群聊时) */
  readonly participants?: readonly ParticipantInfo[];
}

/**
 * 在场用户信息
 */
export interface ParticipantInfo {
  readonly userId: string;
  readonly displayName: string;
  readonly relationshipStage: RelationshipStage;
}

// ============================================================================
// buildContext 输出
// ============================================================================

/**
 * Prompt 片段
 *
 * PersonaEngine 输出按语义分组，
 * 最终排列顺序由 ContextManager (CM-3) 的 Priority Queue 统一决定。
 *
 * @see persona-inner-life.md IL-6
 */
export interface PromptSegments {
  /** Soul + Persona → CM-3 Priority 1 */
  readonly identity: readonly string[];
  /** 内心状态快照 → CM-3 Priority 2 */
  readonly mentalModel: readonly string[];
  /** Lore 核心摘要 → CM-3 Priority 3 */
  readonly lore: readonly string[];
}

// ============================================================================
// 时间 Tick 结果
// ============================================================================

/**
 * processTimeTick 输出
 *
 * 纯数学计算结果：mood 衰减/性格回归 + 关系衰减 + 是否建议主动行动
 */
export interface TimeTickResult {
  /** 用户 ID */
  readonly userId: string;
  /** tick 后的 mood (衰减 + 性格方向回归) */
  readonly mood: MoodState;
  /** tick 后的关系状态 (衰减后) */
  readonly relationship: RelationshipState;
  /** 是否建议主动行动 */
  readonly shouldAct: boolean;
  /** 时间上下文描述 (注入 prompt 用) */
  readonly timeContext: string;
}

// ============================================================================
// 调试快照
// ============================================================================

/**
 * 完整调试快照
 */
export interface DebugSnapshot {
  /** 角色 ID */
  readonly roleId: string;
  /** 全局基线心境 */
  readonly baseMood: MoodState;
  /** 人格默认值 */
  readonly personality: PersonalityDefaults;
  /** Per-User 投影 */
  readonly userProjections: Record<string, UserMoodProjection>;
  /** Per-User 关系 */
  readonly relationships: Record<string, RelationshipState>;
  /** 快照时间 */
  readonly snapshotAt: number;
}

// ============================================================================
// PersonaEngine 对外接口 (IL-3)
// ============================================================================

/**
 * PersonaEngine 对外接口
 *
 * Agent Core 和 Platform 通过此接口消费 ILE。
 *
 * @see persona-inner-life.md IL-3, 第八节
 */
export interface PersonaEngineAPI {
  /**
   * 构建 prompt 注入段（读）
   *
   * @param userId - 用户 ID
   * @param scene - 场景信息
   * @returns Prompt 片段
   */
  buildContext(userId: string, scene: SceneInfo): PromptSegments;

  /**
   * 处理一轮对话结果（写）
   *
   * @param userId - 用户 ID
   * @param emotionTags - LLM 输出的情绪标签 (可含 intensity modifier)
   * @param interactionType - 交互类型
   */
  processTurn(
    userId: string,
    emotionTags: readonly string[],
    interactionType: InteractionType,
  ): void;

  /**
   * 注入特殊事件（剧情杀、节日等）
   *
   * @param event - 特殊事件
   */
  injectEvent(event: PersonaEvent): void;

  /**
   * 调试：获取完整状态快照
   *
   * @param userId - 可选，指定用户则只返回该用户相关
   * @returns 调试快照
   */
  getDebugSnapshot(userId?: string): DebugSnapshot;

  /**
   * 时间 tick — 纯数学，不调 LLM
   *
   * 沉默期间由 Scheduler 周期调用：
   * - mood 衰减 + 性格方向回归
   * - 关系衰减 (familiarity/warmth)
   * - shouldAct 概率判定
   * - 时间上下文生成
   *
   * @param userId - 用户 ID
   * @param elapsedMs - 距上次交互的毫秒数
   * @param currentTime - 当前时间戳
   * @returns TimeTickResult
   */
  processTimeTick(
    userId: string,
    elapsedMs: number,
    currentTime: number,
  ): TimeTickResult;
}

// ============================================================================
// PersonaEngine 配置
// ============================================================================

/**
 * PersonaEngine 配置
 */
export interface PersonaEngineConfig {
  /** 角色 ID */
  readonly roleId: string;
  /** 人格默认值 */
  readonly personality: PersonalityDefaults;
  /** baseMood 同步比例 (0-1, 默认 0.03 即 3%) */
  readonly baseMoodSyncRatio: number;
  /** 自然遗忘天数 (默认 30) */
  readonly forgettingDays: number;
}
