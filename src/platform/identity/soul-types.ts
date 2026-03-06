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
// 认知类型
// ============================================

/**
 * 认知配置
 * 来源: cognition.md (Markdown 文件)
 * 角色的"活跃认知笔记本"
 */
export interface CognitionConfig {
  /** cognition.md 原始内容 */
  readonly rawContent: string;
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
  /** 认知 (活跃认知笔记本) */
  readonly cognition: CognitionConfig;
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
