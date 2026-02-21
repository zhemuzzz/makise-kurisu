/**
 * 人设一致性引擎 (Facade)
 * 三层管控：硬约束 → 心智模型 → 合规校验
 *
 * 委托给专用子模块：
 * - PersonaValidator: OOC 检测、语气/关系一致性
 * - PersonaEnforcer: 傲娇转换、OOC 移除、情感犹豫
 * - PromptBuilder: RP 提示词构建 + Lore 世界观
 * - RoleLoader: 角色配置加载（soul.md + persona.yaml）
 */

import type { MentalModel, PersonaHardcoded } from "./types";
import type { RoleConfig, RoleLoadResult } from "./soul-types";
import { PersonaValidator, type DetailedValidationResult } from "./validator";
import { PersonaEnforcer } from "./enforcer";
import { PromptBuilder } from "./prompt-builder";
import { RoleLoader } from "./role-loader";

export class PersonaEngine {
  private mentalModel: MentalModel;
  private validator: PersonaValidator;
  private enforcer: PersonaEnforcer;
  private promptBuilder: PromptBuilder;
  private roleLoader: RoleLoader;
  private roleConfig: RoleConfig | null = null;

  constructor(initialModel?: Partial<MentalModel>) {
    this.mentalModel = {
      user_profile: {
        name: "",
        relationship: "stranger",
        preferences: [],
        ...initialModel?.user_profile,
      },
      relationship_graph: {
        trust_level: 0,
        familiarity: 0,
        emotional_state: "neutral",
        ...initialModel?.relationship_graph,
      },
      shared_memories: {
        key_events: [],
        inside_jokes: [],
        repeated_topics: [],
        ...initialModel?.shared_memories,
      },
    };

    this.validator = new PersonaValidator(this.mentalModel);
    this.enforcer = new PersonaEnforcer(this.mentalModel);
    this.promptBuilder = new PromptBuilder(this.mentalModel);
    this.roleLoader = new RoleLoader();
  }

  /**
   * 加载角色配置
   * @param roleId 角色 ID（对应 config/personas/{roleId}/）
   * @returns 加载结果
   */
  async loadRole(roleId: string): Promise<RoleLoadResult> {
    const result = await this.roleLoader.tryLoad(roleId);

    if (result.success && result.config) {
      this.roleConfig = result.config;
      this.promptBuilder.setRoleConfig(result.config);
    }

    return result;
  }

  /**
   * 获取当前角色配置
   */
  getRoleConfig(): RoleConfig | null {
    return this.roleConfig;
  }

  /**
   * 检查是否已加载角色配置
   */
  hasRoleConfig(): boolean {
    return this.roleConfig !== null;
  }

  /**
   * 获取核心人设（从已加载的角色配置）
   * @throws Error 如果未加载角色配置
   */
  getHardcodedPersona(): PersonaHardcoded {
    if (!this.roleConfig) {
      throw new Error("RoleConfig not loaded. Call loadRole() first.");
    }
    return {
      content: this.roleConfig.soul.rawContent,
    };
  }

  /**
   * 获取当前心智模型（深拷贝）
   */
  getMentalModel(): MentalModel {
    return structuredClone(this.mentalModel);
  }

  /**
   * 更新心智模型（防御性深合并）
   */
  updateMentalModel(updates: Partial<MentalModel>): void {
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

    // 重建子模块以反映新状态
    this.validator = new PersonaValidator(this.mentalModel);
    this.enforcer = new PersonaEnforcer(this.mentalModel);
    this.promptBuilder = new PromptBuilder(this.mentalModel);
  }

  /**
   * 验证人设一致性
   * 委托给 PersonaValidator
   */
  validate(response: string): DetailedValidationResult {
    return this.validator.validate(response);
  }

  /**
   * 强化响应的人设特征
   * 委托给 PersonaEnforcer（确定性 seededRandom）
   * @param response AI 生成的响应
   * @param userInput 可选的用户输入（用于触发词检测）
   */
  enforcePersona(response: string, userInput?: string): string {
    return this.enforcer.enforce(response, userInput);
  }

  /**
   * 获取系统提示词
   * 委托给 PromptBuilder（包含 Lore 世界观）
   */
  getSystemPrompt(): string {
    return this.promptBuilder.build("", []);
  }

  /**
   * 构建 RP Prompt
   * @deprecated 使用 getSystemPrompt() 代替
   */
  buildRPPrompt(userMessage: string, memories: string[]): string {
    return this.promptBuilder.build(userMessage, memories);
  }
}
