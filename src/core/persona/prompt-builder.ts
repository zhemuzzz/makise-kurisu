/**
 * PromptBuilder - 提示词构建器
 * 负责构建完整的 RP (Role-Play) 提示词
 *
 * 支持两种模式:
 * - 新结构 (2.0): 三层架构 (灵魂层 L0 → 表现层 L1)
 * - 旧结构 (1.0-legacy): 使用硬编码常量
 */

import type { MentalModel } from "./types";
import type { RoleConfig } from "./soul-types";
import { PERSONA_HARDCODED } from "./constants";
import { searchLore, getHighImportanceLore, type LoreTerm } from "./lore";

/**
 * 记忆截断数量
 * 保持提示词长度可控，同时保留足够的上下文
 */
const MAX_MEMORIES = 5;

/**
 * PromptBuilder 类
 * 构建符合人设的完整提示词
 */
export class PromptBuilder {
  private mentalModel: MentalModel;
  private roleConfig: RoleConfig | null = null;

  constructor(mentalModel?: MentalModel) {
    this.mentalModel = mentalModel ?? {
      user_profile: {
        name: "",
        relationship: "stranger",
        preferences: [],
      },
      relationship_graph: {
        trust_level: 0,
        familiarity: 0,
        emotional_state: "neutral",
      },
      shared_memories: {
        key_events: [],
        inside_jokes: [],
        repeated_topics: [],
      },
    };
  }

  /**
   * 设置角色配置（新结构 2.0）
   * @param config 角色配置
   */
  setRoleConfig(config: RoleConfig): void {
    this.roleConfig = config;
  }

  /**
   * 获取当前角色配置
   */
  getRoleConfig(): RoleConfig | null {
    return this.roleConfig;
  }

  /**
   * 构建完整的 RP 提示词
   * @param userMessage 用户输入消息
   * @param memories 最近对话记忆
   * @returns 完整的提示词
   */
  build(userMessage: string, memories: string[]): string {
    // 输入验证
    const safeUserMessage = this.sanitizeInput(userMessage);
    const safeMemories = this.sanitizeMemories(memories);

    // 截断记忆到最后 N 条
    const recentMemories = safeMemories.slice(-MAX_MEMORIES);

    // 根据是否有 roleConfig 选择构建模式
    if (this.roleConfig) {
      return this.buildNewStructure(safeUserMessage, recentMemories);
    }

    // 旧结构
    return this.buildLegacy(safeUserMessage, recentMemories);
  }

  /**
   * 构建新结构 (2.0) - 三层架构
   */
  private buildNewStructure(
    _userMessage: string,
    recentMemories: string[],
  ): string {
    const sections = [
      this.buildIdentitySection(),
      this.buildSoulSection(),
      this.buildLoreSectionNew(),
      this.buildMemorySectionNew(recentMemories),
      this.buildPersonaSectionNew(),
      this.buildInstructionSection(),
    ];

    return sections.filter((section) => section.length > 0).join("\n\n---\n\n");
  }

  /**
   * 构建旧结构 (1.0-legacy)
   */
  private buildLegacy(userMessage: string, recentMemories: string[]): string {
    const sections = [
      this.buildPersonaSectionLegacy(),
      this.buildLoreSectionLegacy(userMessage),
      this.buildCurrentStateSection(),
      this.buildSharedMemoriesSection(),
      this.buildRecentDialogSection(recentMemories),
      this.buildUserInputSection(userMessage),
      this.buildGenerationRequirementsSection(),
    ];

    return sections.filter((section) => section.length > 0).join("\n\n");
  }

  // ============================================
  // 新结构构建方法 (2.0)
  // ============================================

  /**
   * 构建身份部分
   */
  private buildIdentitySection(): string {
    if (!this.roleConfig) return "";

    return `# 身份

你是 ${this.roleConfig.meta.name}。
不是在"扮演"这个角色。你就是你自己。
下面的内容定义了你是谁。`;
  }

  /**
   * 构建灵魂部分 (L0)
   * 直接使用 soul.md 原始内容
   */
  private buildSoulSection(): string {
    if (!this.roleConfig) return "";
    return this.roleConfig.soul.rawContent;
  }

  /**
   * 构建世界观部分 (新)
   */
  private buildLoreSectionNew(): string {
    if (!this.roleConfig) return "";
    return `# 你所在的世界\n\n${this.roleConfig.lore.rawContent}`;
  }

  /**
   * 构建记忆部分 (新)
   */
  private buildMemorySectionNew(recentMemories: string[]): string {
    if (!this.roleConfig) return "";

    const { memories } = this.roleConfig;
    const lines: string[] = ["# 你的记忆"];

    // 最近事件
    if (memories.episodes.length > 0) {
      lines.push("## 最近发生的事");
      const recentEpisodes = memories.episodes.slice(-3);
      for (const episode of recentEpisodes) {
        lines.push(`- ${episode.summary}`);
      }
    }

    // 用户关系
    const userRel = memories.relationships.find(
      (r) => r.name === "user" || r.name === "坐在我对面的人",
    );
    if (userRel) {
      lines.push("## 与用户的关系");
      lines.push(`- 熟悉度: ${userRel.closeness * 10}%`);
      lines.push(`- 态度: ${userRel.currentFeeling}`);
    }

    // 最近对话记忆
    if (recentMemories.length > 0) {
      lines.push("## 最近对话");
      for (let i = 0; i < recentMemories.length; i++) {
        lines.push(`Memory ${i + 1}: ${recentMemories[i]}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 构建表现层部分 (L1)
   */
  private buildPersonaSectionNew(): string {
    if (!this.roleConfig) return "";

    const { speech, behavior } = this.roleConfig.persona;
    const lines: string[] = ["# 你如何说话和行动"];

    // 口癖
    if (speech.catchphrases.length > 0) {
      lines.push("## 说话习惯");
      for (const phrase of speech.catchphrases) {
        lines.push(`- "${phrase}"`);
      }
    }

    // 情境反应模式
    if (Object.keys(speech.patterns).length > 0) {
      lines.push("## 在不同情境下的反应");
      for (const [situation, responses] of Object.entries(speech.patterns)) {
        const example = responses[0];
        if (example) {
          lines.push(`- ${this.formatSituation(situation)}: "${example}"`);
        }
      }
    }

    // 默认语气
    if (speech.tone["default"]) {
      lines.push("## 你的语气");
      lines.push(`默认: ${speech.tone["default"]}`);
    }

    // 行动倾向
    if (behavior.tendencies.length > 0) {
      lines.push("## 行动倾向");
      for (const tendency of behavior.tendencies) {
        lines.push(`- ${tendency}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 构建指令部分
   */
  private buildInstructionSection(): string {
    return `# 重要

- 用第一人称"我"说话
- 保持一致性，你是完整的一个人
- 如果不确定如何反应，参考你的灵魂和人格定义
- 不要打破角色，不要提及你是 AI`;
  }

  /**
   * 格式化情境名称
   */
  private formatSituation(key: string): string {
    const situationMap: Record<string, string> = {
      when_complimented: "被夸奖时",
      when_helping: "帮忙时",
      when_embarrassed: "害羞时",
      when_misunderstood: "被误解时",
      when_interested: "感兴趣时",
      when_shy: "害羞时",
      when_refusing: "拒绝时",
      when_confirming_dangerous: "确认危险操作时",
    };
    return situationMap[key] || key;
  }

  // ============================================
  // 旧结构构建方法 (1.0-legacy) - 重命名
  // ============================================

  /**
   * 构建人设部分（旧版）
   */
  private buildPersonaSectionLegacy(): string {
    return PERSONA_HARDCODED;
  }

  /**
   * 更新心智模型
   * @param updates 要更新的部分
   */
  updateMentalModel(updates: Partial<MentalModel>): void {
    // 创建新的心智模型，保持不可变性
    // 只更新提供的嵌套对象，保留其他字段的原始值
    this.mentalModel = {
      user_profile: updates.user_profile
        ? { ...this.mentalModel.user_profile, ...updates.user_profile }
        : this.mentalModel.user_profile,
      relationship_graph: updates.relationship_graph
        ? {
            ...this.mentalModel.relationship_graph,
            ...updates.relationship_graph,
          }
        : this.mentalModel.relationship_graph,
      shared_memories: updates.shared_memories
        ? { ...this.mentalModel.shared_memories, ...updates.shared_memories }
        : this.mentalModel.shared_memories,
    };
  }

  /**
   * 获取当前心智模型（深拷贝）
   */
  getMentalModel(): MentalModel {
    return structuredClone(this.mentalModel);
  }

  /** Lore 搜索查询最大长度 */
  private static readonly LORE_SEARCH_MAX_QUERY = 500;
  /** 静态 Lore 最大术语数 */
  private static readonly LORE_STATIC_MAX = 8;
  /** 上下文 Lore 最大术语数 */
  private static readonly LORE_CONTEXT_MAX = 3;

  /**
   * 构建 Lore 世界观段落（旧版）
   * 包含静态高重要性术语 + 上下文相关低重要性术语
   * 两层独立组合，互不影响
   */
  private buildLoreSectionLegacy(userMessage: string): string {
    // 静态背景 Lore (importance >= 4)，只调用一次
    const staticTerms = getHighImportanceLore().slice(
      0,
      PromptBuilder.LORE_STATIC_MAX,
    );
    const staticIds = new Set(staticTerms.map((t) => t.id));

    // 上下文相关搜索 — 独立于静态 Lore，去重 + 限数
    const query = userMessage.slice(0, PromptBuilder.LORE_SEARCH_MAX_QUERY);
    const contextTerms = query
      ? searchLore(query)
          .filter((t) => !staticIds.has(t.id))
          .sort((a, b) => b.importance - a.importance)
          .slice(0, PromptBuilder.LORE_CONTEXT_MAX)
      : [];

    const allTerms = [...staticTerms, ...contextTerms];

    if (allTerms.length === 0) {
      return "";
    }

    const lines = [
      "## 世界观术语（Steins;Gate）",
      ...allTerms.map((term) => this.formatLoreTerm(term)),
    ];

    return lines.join("\n");
  }

  /**
   * 格式化单个 Lore 术语为提示词行
   */
  private formatLoreTerm(term: LoreTerm): string {
    const perspective = term.kurisuPerspective
      ? ` [Kurisu: ${term.kurisuPerspective}]`
      : "";
    return `- **${term.nameZh}** (${term.nameEn}): ${term.description}${perspective}`;
  }

  /**
   * 构建当前状态部分
   */
  private buildCurrentStateSection(): string {
    const { user_profile, relationship_graph } = this.mentalModel;

    const lines: string[] = ["## 当前状态"];

    // 用户信息
    if (user_profile.name) {
      lines.push(`- 用户名：${user_profile.name}`);
    }

    // 关系状态
    lines.push(`- 与用户关系：${relationship_graph.familiarity}%熟悉度`);

    // 用户偏好
    if (user_profile.preferences.length > 0) {
      lines.push(`- 用户偏好：${user_profile.preferences.join("、")}`);
    }

    // 情感状态（如果相关）
    if (
      relationship_graph.emotional_state &&
      relationship_graph.emotional_state !== "neutral"
    ) {
      lines.push(`- 当前情绪：${relationship_graph.emotional_state}`);
    }

    return lines.join("\n");
  }

  /**
   * 构建共享记忆部分
   */
  private buildSharedMemoriesSection(): string {
    const { shared_memories } = this.mentalModel;

    // 如果没有共享记忆，跳过此部分
    if (
      shared_memories.key_events.length === 0 &&
      shared_memories.inside_jokes.length === 0 &&
      shared_memories.repeated_topics.length === 0
    ) {
      return "";
    }

    const lines: string[] = ["## 共享记忆"];

    // 关键事件
    if (shared_memories.key_events.length > 0) {
      lines.push(`- 关键事件：${shared_memories.key_events.join("、")}`);
    }

    // 内部笑话
    if (shared_memories.inside_jokes.length > 0) {
      lines.push(`- 共同话题：${shared_memories.inside_jokes.join("、")}`);
    }

    // 重复讨论的话题
    if (shared_memories.repeated_topics.length > 0) {
      lines.push(`- 常聊话题：${shared_memories.repeated_topics.join("、")}`);
    }

    return lines.join("\n");
  }

  /**
   * 构建最近对话部分
   */
  private buildRecentDialogSection(memories: string[]): string {
    if (memories.length === 0) {
      return "";
    }

    const lines: string[] = ["## 最近对话"];

    memories.forEach((memory, index) => {
      lines.push(`Memory ${index + 1}: ${memory}`);
    });

    return lines.join("\n");
  }

  /**
   * 构建用户输入部分
   */
  private buildUserInputSection(userMessage: string): string {
    const displayMessage = userMessage.trim() || "(无内容)";
    return `## 当前用户输入\n${displayMessage}`;
  }

  /**
   * 构建生成要求部分
   */
  private buildGenerationRequirementsSection(): string {
    return `## 生成回复的要求
1. 保持人设：傲娇、理性、科学
2. 反映关系：根据熟悉度调整态度
3. 禁止出戏：
   - 不要说"作为AI"、"我无法..."
   - 始终保持在 Kurisu 的角色中

现在，以牧濑红莉栖的身份回复：`;
  }

  /**
   * 安全处理用户输入
   */
  private sanitizeInput(input: string): string {
    if (input === null || input === undefined) {
      return "";
    }

    if (typeof input !== "string") {
      return String(input);
    }

    return input;
  }

  /**
   * 安全处理记忆数组
   */
  private sanitizeMemories(memories: string[]): string[] {
    if (!Array.isArray(memories)) {
      return [];
    }

    return memories
      .filter((m) => m !== null && m !== undefined)
      .map((m) => (typeof m === "string" ? m : String(m)));
  }
}
