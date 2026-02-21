/**
 * L7 Skill System - 类型定义
 *
 * 定义技能配置、触发规则、知识注入等类型
 */

import type { ToolDef } from "../tools/types";

// ============================================
// Skill 类型
// ============================================

/**
 * Skill 类型
 *
 * - knowledge: 纯知识注入（无工具）
 * - tool: 纯工具绑定（无知识）
 * - hybrid: 知识 + 工具
 */
export type SkillType = "knowledge" | "tool" | "hybrid";

// ============================================
// 触发规则
// ============================================

/**
 * 触发规则
 *
 * 定义 Skill 何时被激活
 */
export interface TriggerRule {
  /** 关键词触发 */
  readonly keywords?: readonly string[];
  /** 意图触发 */
  readonly intent?: readonly string[];
  /** 正则匹配 */
  readonly patterns?: readonly string[];
  /** 最小置信度阈值（0-1） */
  readonly minConfidence?: number;
}

// ============================================
// Few-Shot 示例
// ============================================

/**
 * Few-Shot 对话示例
 */
export interface SkillExample {
  /** 用户输入 */
  readonly user: string;
  /** 助手回复（或回复片段） */
  readonly assistant: string;
  /** 工具调用（可选） */
  readonly toolCalls?: readonly {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
  }[];
}

// ============================================
// MCP 配置
// ============================================

/**
 * MCP Server 配置
 */
export interface MCPServerConfig {
  /** 命令 */
  readonly command: string;
  /** 参数 */
  readonly args?: readonly string[];
  /** 环境变量 */
  readonly env?: Record<string, string>;
  /** 工作目录 */
  readonly cwd?: string;
}

/**
 * MCP 配置文件格式
 */
export interface MCPConfig {
  /** MCP Servers */
  readonly mcpServers: Record<string, MCPServerConfig>;
}

// ============================================
// Skill 配置
// ============================================

/**
 * 工具绑定配置
 */
export interface ToolBinding {
  /** MCP 配置文件路径（相对于 skill.yaml） */
  readonly mcpConfig: string;
  /** 可选：指定要使用的工具（不指定则使用全部） */
  readonly include?: readonly string[];
  /** 可选：排除的工具 */
  readonly exclude?: readonly string[];
}

/**
 * Skill 配置（skill.yaml 格式）
 */
export interface SkillConfig {
  /** Skill ID，唯一标识 */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;
  /** 版本号 */
  readonly version: string;
  /** Skill 类型 */
  readonly type: SkillType;

  /** 触发规则 */
  readonly trigger: TriggerRule;

  /** 知识注入（激活时加入 System Prompt） */
  readonly context?: string;

  /** Few-Shot 示例 */
  readonly examples?: readonly SkillExample[];

  /** 工具绑定（tool/hybrid 类型） */
  readonly tools?: ToolBinding;

  /** 元数据 */
  readonly metadata?: {
    readonly author?: string;
    readonly description?: string;
    readonly tags?: readonly string[];
  };
}

// ============================================
// Skill 实例（运行时）
// ============================================

/**
 * Skill 激活状态
 */
export type SkillActivationStatus =
  | "inactive"
  | "activating"
  | "active"
  | "error";

/**
 * Skill 实例（运行时）
 *
 * 包含配置 + 工具定义 + MCP 连接状态
 */
export interface SkillInstance {
  /** Skill 配置 */
  readonly config: SkillConfig;
  /** 可用工具定义（来自 MCP） */
  readonly toolDefs: readonly ToolDef[];
  /** 激活状态 */
  readonly status: SkillActivationStatus;
  /** 错误信息（status=error 时） */
  readonly error?: string;
  /** MCP 配置（如果配置了 tools） */
  readonly mcpConfig?: MCPConfig;
  /** 加载时间 */
  readonly loadedAt: number;
}

// ============================================
// 意图匹配结果
// ============================================

/**
 * 意图匹配结果
 */
export interface IntentMatchResult {
  /** 匹配的 Skill ID */
  readonly skillId: string;
  /** 匹配置信度（0-1） */
  readonly confidence: number;
  /** 匹配原因 */
  readonly reason: "keyword" | "intent" | "pattern" | "fallback";
  /** 匹配的关键词/意图 */
  readonly matched?: string;
}

// ============================================
// Skill 注册表
// ============================================

/**
 * Skill 注册表接口
 */
export interface ISkillRegistry {
  /** 加载 Skill */
  load(skillPath: string): Promise<SkillInstance>;

  /** 卸载 Skill */
  unload(skillId: string): Promise<void>;

  /** 获取 Skill */
  get(skillId: string): SkillInstance | undefined;

  /** 列出所有 Skills */
  list(): readonly SkillInstance[];

  /** 匹配意图 */
  matchIntent(input: string): IntentMatchResult[];

  /** 激活 Skills */
  activate(skillIds: readonly string[]): Promise<void>;
}

// ============================================
// 常量
// ============================================

/**
 * 默认触发规则
 */
export const DEFAULT_TRIGGER_RULE: TriggerRule = {
  minConfidence: 0.5,
};

/**
 * Skill 配置文件名
 */
export const SKILL_CONFIG_FILE = "skill.yaml";

/**
 * MCP 配置文件名
 */
export const MCP_CONFIG_FILE = "mcp.json";
