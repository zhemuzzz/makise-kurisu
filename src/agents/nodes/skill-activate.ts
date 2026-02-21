/**
 * Skill 激活节点
 *
 * 根据用户输入匹配 Skills，激活后获取可用工具列表
 */

import type { AgentState } from "../types";
import type { ToolDef } from "../../tools/types";
import type { IntentMatchResult, SkillInstance } from "../../skills/types";

/**
 * Skill 激活节点依赖
 */
export interface SkillActivateNodeDeps {
  /** 匹配意图 */
  matchIntent: (input: string) => IntentMatchResult[];
  /** 获取 Skill 实例 */
  getSkill: (skillId: string) => SkillInstance | undefined;
  /** 最大激活 Skills 数量 */
  maxActiveSkills?: number;
  /** 最小匹配置信度 */
  minConfidence?: number;
}

/**
 * 创建 Skill 激活节点
 */
export function createSkillActivateNode(deps: SkillActivateNodeDeps) {
  const { matchIntent, getSkill, maxActiveSkills = 3, minConfidence = 0.5 } = deps;

  return async function skillActivateNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const { currentInput, activeSkills: prevActiveSkills } = state;

    // 1. 匹配意图
    const matches = matchIntent(currentInput);

    // 2. 过滤低置信度匹配
    const validMatches = matches.filter((m) => m.confidence >= minConfidence);

    // 3. 限制最大激活数量
    const topMatches = validMatches.slice(0, maxActiveSkills);

    // 4. 获取 Skill IDs
    const newActiveSkillIds = topMatches.map((m) => m.skillId);

    // 5. 合并之前激活的 Skills（保持连续性）
    const mergedSkillIds = [...new Set([...prevActiveSkills, ...newActiveSkillIds])];

    // 6. 获取所有工具定义
    const allToolDefs: ToolDef[] = [];
    for (const skillId of mergedSkillIds) {
      const skill = getSkill(skillId);
      if (skill && skill.toolDefs.length > 0) {
        allToolDefs.push(...skill.toolDefs);
      }
    }

    // 7. 去重工具（按名称）
    const uniqueTools = Array.from(
      new Map(allToolDefs.map((t) => [t.name, t])).values(),
    );

    return {
      activeSkills: mergedSkillIds,
      availableTools: uniqueTools,
    };
  };
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function skillActivateNode(
  state: AgentState,
  deps: SkillActivateNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createSkillActivateNode(deps);
  return node(state);
}
