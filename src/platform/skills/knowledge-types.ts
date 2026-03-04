/**
 * Knowledge 领域类型定义
 *
 * @module platform/skills/knowledge-types
 * @description KnowledgeStore 的核心类型：分类、来源、条目、搜索、统计
 *
 * 设计来源:
 * - knowledge-store.md (KS-1~KS-6)
 * - skill-system.md D15 (manage-skill 知识管理)
 */

// ============================================================================
// 知识分类 (KS-1)
// ============================================================================

/**
 * 知识分类
 *
 * - pattern: 编程模式、API 用法、最佳实践
 * - domain: 领域知识（科学、历史、文化等）
 * - skill-extension: Skill 相关的扩展知识
 * - anti-pattern: 反模式、常见错误、已知陷阱
 */
export type KnowledgeCategory =
  | "pattern"
  | "domain"
  | "skill-extension"
  | "anti-pattern";

/**
 * 知识来源
 *
 * - reflection: LLM 自我反思产生
 * - active-learning: 主动学习获取
 * - manage-skill: 通过 manage-skill 元工具添加
 * - manual: 人工手动添加
 * - user-correction: 用户纠正产生
 */
export type KnowledgeSource =
  | "reflection"
  | "active-learning"
  | "manage-skill"
  | "manual"
  | "user-correction";

/**
 * 三写同步状态 (KS-6)
 *
 * - synced: SQLite + Qdrant + FS 全部同步
 * - pending-vector: Qdrant 待同步
 * - pending-file: FS 待同步
 * - pending-both: Qdrant + FS 都待同步
 */
export type SyncStatus =
  | "synced"
  | "pending-vector"
  | "pending-file"
  | "pending-both";

// ============================================================================
// 效果评分
// ============================================================================

/**
 * 知识条目效果评分
 *
 * 追踪知识的实际使用效果，用于淘汰低效知识
 */
export interface EffectivenessScore {
  /** 效果分数 (0-1) */
  readonly score: number;
  /** 使用次数 */
  readonly usageCount: number;
  /** 最后使用时间 (unix timestamp) */
  readonly lastUsedAt?: number;
  /** 用户反馈 (positive/negative/neutral) */
  readonly feedback?: "positive" | "negative" | "neutral";
}

// ============================================================================
// 知识条目 (KS-2)
// ============================================================================

/**
 * 知识条目
 */
export interface KnowledgeEntry {
  /** 条目 ID (SQLite 自增) */
  readonly id: number;
  /** 知识内容 */
  readonly content: string;
  /** 来源 */
  readonly source: KnowledgeSource;
  /** 分类 */
  readonly category: KnowledgeCategory;
  /** 关联的 Skill ID (可选) */
  readonly skillId?: string;
  /** 标签列表 */
  readonly tags: readonly string[];
  /** 效果评分 */
  readonly effectiveness: EffectivenessScore;
  /** 三写同步状态 */
  readonly syncStatus: SyncStatus;
  /** 创建时间 (unix timestamp) */
  readonly createdAt: number;
  /** 更新时间 (unix timestamp) */
  readonly updatedAt: number;
  /** 是否已归档 */
  readonly archived: boolean;
}

// ============================================================================
// 搜索 (KS-3)
// ============================================================================

/**
 * 知识搜索选项
 */
export interface KnowledgeSearchOptions {
  /** 搜索查询文本 */
  readonly query: string;
  /** 按分类过滤 */
  readonly category?: KnowledgeCategory;
  /** 按 Skill ID 过滤 */
  readonly skillId?: string;
  /** 最小相关性分数 (0-1) */
  readonly minScore?: number;
  /** 返回数量限制 */
  readonly limit?: number;
  /** 是否包含归档条目 */
  readonly includeArchived?: boolean;
}

/**
 * 知识搜索结果
 */
export interface KnowledgeSearchResult {
  /** 知识条目 */
  readonly entry: KnowledgeEntry;
  /** 相关性分数 (0-1) */
  readonly relevanceScore: number;
}

// ============================================================================
// 过滤 (列表用)
// ============================================================================

/**
 * 知识过滤器 (用于 list 方法)
 */
export interface KnowledgeFilter {
  /** 按分类过滤 */
  readonly category?: KnowledgeCategory;
  /** 按来源过滤 */
  readonly source?: KnowledgeSource;
  /** 按 Skill ID 过滤 */
  readonly skillId?: string;
  /** 按同步状态过滤 */
  readonly syncStatus?: SyncStatus;
  /** 是否包含归档条目 (默认 false) */
  readonly includeArchived?: boolean;
  /** 返回数量限制 */
  readonly limit?: number;
  /** 偏移量 (分页) */
  readonly offset?: number;
}

// ============================================================================
// 统计
// ============================================================================

/**
 * KnowledgeStore 统计
 */
export interface KnowledgeStats {
  /** 总条目数 (不含归档) */
  readonly totalEntries: number;
  /** 归档条目数 */
  readonly archivedEntries: number;
  /** 各分类条目数 */
  readonly byCategory: Readonly<Record<KnowledgeCategory, number>>;
  /** 各同步状态条目数 */
  readonly bySyncStatus: Readonly<Record<SyncStatus, number>>;
  /** 容量上限 */
  readonly capacity: number;
  /** 使用率 (0-1) */
  readonly utilizationRate: number;
}

// ============================================================================
// 常量
// ============================================================================

/** 默认知识容量上限 (KS-5) */
export const KNOWLEDGE_CAPACITY_DEFAULT = 500;

/** 默认单条知识最大 Token 数 */
export const KNOWLEDGE_MAX_TOKENS_DEFAULT = 2000;

/** 所有知识分类列表 */
export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  "pattern",
  "domain",
  "skill-extension",
  "anti-pattern",
] as const;

/** 所有知识来源列表 */
export const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
  "reflection",
  "active-learning",
  "manage-skill",
  "manual",
  "user-correction",
] as const;

/** 所有同步状态列表 */
export const SYNC_STATUSES: readonly SyncStatus[] = [
  "synced",
  "pending-vector",
  "pending-file",
  "pending-both",
] as const;

// ============================================================================
// 类型守卫
// ============================================================================

/**
 * 检查值是否为有效的 KnowledgeCategory
 */
export function isKnowledgeCategory(value: unknown): value is KnowledgeCategory {
  return (
    typeof value === "string" &&
    (KNOWLEDGE_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * 检查值是否为有效的 KnowledgeSource
 */
export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    typeof value === "string" &&
    (KNOWLEDGE_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * 检查值是否为有效的 SyncStatus
 */
export function isSyncStatus(value: unknown): value is SyncStatus {
  return (
    typeof value === "string" &&
    (SYNC_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * 检查值是否为有效的 EffectivenessScore
 */
export function isValidEffectivenessScore(
  value: unknown,
): value is EffectivenessScore {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["score"] === "number" &&
    obj["score"] >= 0 &&
    obj["score"] <= 1 &&
    typeof obj["usageCount"] === "number" &&
    obj["usageCount"] >= 0 &&
    Number.isInteger(obj["usageCount"])
  );
}

/**
 * 创建默认的 EffectivenessScore
 */
export function createDefaultEffectiveness(): EffectivenessScore {
  return {
    score: 0.5,
    usageCount: 0,
  };
}
