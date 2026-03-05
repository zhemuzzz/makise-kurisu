/**
 * 人设一致性引擎 (Facade)
 * 三层管控：硬约束 → 心智模型 → 合规校验
 *
 * 委托给专用子模块：
 * - RoleLoader: 角色配置加载（soul.md + persona.yaml）
 */

import type { MentalModel, PersonaHardcoded } from "./types.js";
import type { RoleConfig, RoleLoadResult } from "./soul-types.js";
import { RoleLoader } from "./role-loader.js";
import type { ToolResult } from "../tools/types.js";
import {
  PersonaWrapper,
  createPersonaWrapper,
  type PersonaWrapperConfig,
} from "../tools/persona-wrapper.js";

export class PersonaEngine {
  private mentalModel: MentalModel;
  private roleLoader: RoleLoader;
  private toolWrapper: PersonaWrapper;
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

    this.roleLoader = new RoleLoader();
    this.toolWrapper = createPersonaWrapper();
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
  }

  /**
   * 获取系统提示词
   */
  getSystemPrompt(): string {
    if (this.roleConfig) {
      return this.roleConfig.soul.rawContent;
    }
    return "";
  }

  /**
   * 包装工具输出
   *
   * 将工具执行结果用角色语气包装，使其符合人设
   * 委托给 PersonaWrapper
   *
   * @param result 工具执行结果
   * @returns 人设化后的输出文本
   */
  wrapToolOutput(result: ToolResult): string {
    return this.toolWrapper.wrap(result);
  }

  /**
   * 构建审批请求消息
   *
   * @param toolName 工具名称
   * @param args 工具参数（可选）
   * @returns 审批请求消息
   */
  buildApprovalMessage(
    toolName: string,
    args?: Record<string, unknown>,
  ): string {
    return this.toolWrapper.buildApprovalMessage(toolName, args);
  }

  /**
   * 配置工具包装器
   *
   * @param config 包装器配置
   */
  configureToolWrapper(config: PersonaWrapperConfig): void {
    this.toolWrapper = createPersonaWrapper(config);
  }
}
