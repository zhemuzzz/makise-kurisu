/**
 * 角色灵魂系统类型定义
 *
 * 三层架构:
 * - L-1 系统安全层: 静默拦截，不产生对话
 * - L0 角色灵魂层: 内在人格，第一人称定义
 * - L1 角色表现层: 外在表达，说话方式
 */

// ============================================
// L0 灵魂层类型
// ============================================

/**
 * 角色灵魂配置
 * 来源: soul.md (Markdown 文件)
 */
export interface SoulConfig {
  /** soul.md 原始内容（第一人称撰写） */
  readonly rawContent: string;
}

// ============================================
// L1 表现层类型
// ============================================

/**
 * 说话模式定义
 */
export interface SpeechPatterns {
  /** 口癖列表 */
  readonly catchphrases: readonly string[];
  /** 情境反应模式 (key: 情境名, value: 可能的回应列表) */
  readonly patterns: Readonly<Record<string, readonly string[]>>;
  /** 语气定义 (key: 情境, value: 语气描述) */
  readonly tone: Readonly<Record<string, string>>;
}

/**
 * 行为反应定义
 */
export interface BehaviorReaction {
  /** 内心想法 */
  readonly thought?: string;
  /** 动作描述 */
  readonly action?: string;
  /** 说话内容 */
  readonly speech?: string;
}

/**
 * 行为模式定义
 */
export interface BehaviorPatterns {
  /** 行动倾向 */
  readonly tendencies: readonly string[];
  /** 情境反应 (key: 情境名, value: 反应定义) */
  readonly reactions: Readonly<Record<string, BehaviorReaction>>;
}

/**
 * 格式化偏好
 */
export interface FormattingConfig {
  /** 使用省略号 */
  readonly useEllipsis: boolean;
  /** 使用破折号表示停顿 */
  readonly useDash: boolean;
  /** 每次回复最多几句话 */
  readonly maxSentences?: number;
  /** 偏好短回复 */
  readonly preferShortReplies?: boolean;
}

/**
 * 角色表现配置
 * 来源: persona.yaml
 */
export interface PersonaConfig {
  readonly speech: SpeechPatterns;
  readonly behavior: BehaviorPatterns;
  readonly formatting: FormattingConfig;
}

// ============================================
// Lore 世界观类型
// ============================================

/**
 * 世界观配置
 * 来源: lore.md (Markdown 文件)
 */
export interface LoreConfig {
  /** lore.md 原始内容 */
  readonly rawContent: string;
}

// ============================================
// 记忆类型
// ============================================

/**
 * 历史事件记录
 */
export interface RelationshipHistory {
  readonly date: string;
  readonly event: string;
  /** 感情变化值 */
  readonly feelingChange: number;
}

/**
 * 关系定义
 */
export interface Relationship {
  /** 角色名称 */
  readonly name: string;
  /** 初次相遇时间 */
  readonly firstMet: string;
  /** 当前感觉 */
  readonly currentFeeling: string;
  /** 亲密度 (1-10) */
  readonly closeness: number;
  /** 备注 */
  readonly notes: readonly string[];
  /** 历史事件 */
  readonly history?: readonly RelationshipHistory[];
}

/**
 * 经历事件
 */
export interface Episode {
  /** 事件 ID */
  readonly id: string;
  /** 日期 */
  readonly date: string;
  /** 摘要 */
  readonly summary: string;
  /** 详情 */
  readonly details: string;
  /** 情感标签 */
  readonly emotions?: readonly string[];
}

/**
 * 记忆配置
 * 来源: memories/episodes.yaml + memories/relationships.yaml
 */
export interface MemoriesConfig {
  readonly episodes: readonly Episode[];
  readonly relationships: readonly Relationship[];
}

// ============================================
// 聚合角色配置
// ============================================

/**
 * 角色元信息
 */
export interface RoleMeta {
  readonly name: string;
  readonly version: string;
  /** 作者 (可选) */
  readonly author?: string;
}

/**
 * 完整角色配置
 */
export interface RoleConfig {
  /** 角色 ID */
  readonly id: string;
  /** 元信息 */
  readonly meta: RoleMeta;
  /** L0 灵魂层 */
  readonly soul: SoulConfig;
  /** L1 表现层 */
  readonly persona: PersonaConfig;
  /** 世界观 */
  readonly lore: LoreConfig;
  /** 记忆 */
  readonly memories: MemoriesConfig;
}

// ============================================
// 加载结果类型
// ============================================

/**
 * 角色加载结果
 */
export interface RoleLoadResult {
  readonly success: boolean;
  readonly config?: RoleConfig;
  readonly error?: {
    readonly code: "NOT_FOUND" | "INVALID_FORMAT" | "MISSING_REQUIRED";
    readonly message: string;
  };
}
