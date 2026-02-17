/**
 * PromptBuilder - 提示词构建器
 * 负责构建完整的 RP (Role-Play) 提示词
 */

import { MentalModel } from "./types";
import { PERSONA_HARDCODED } from "./constants";

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

    // 构建各部分
    const sections = [
      this.buildPersonaSection(),
      this.buildCurrentStateSection(),
      this.buildSharedMemoriesSection(),
      this.buildRecentDialogSection(recentMemories),
      this.buildUserInputSection(safeUserMessage),
      this.buildGenerationRequirementsSection(),
    ];

    return sections.filter((section) => section.length > 0).join("\n\n");
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

  /**
   * 构建人设部分
   */
  private buildPersonaSection(): string {
    return PERSONA_HARDCODED;
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
