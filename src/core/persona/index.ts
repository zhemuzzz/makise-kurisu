/**
 * 人设一致性引擎
 * 三层管控：硬约束 → 心智模型 → 合规校验
 */

import { MentalModel, PersonaHardcoded, ValidationResult } from './types';
import { PERSONA_HARDCODED } from './constants';

export class PersonaEngine {
  private mentalModel: MentalModel;

  constructor(initialModel?: Partial<MentalModel>) {
    this.mentalModel = {
      user_profile: {
        name: '',
        relationship: 'stranger',
        preferences: [],
        ...initialModel?.user_profile,
      },
      relationship_graph: {
        trust_level: 0,
        familiarity: 0,
        emotional_state: 'neutral',
        ...initialModel?.relationship_graph,
      },
      shared_memories: {
        key_events: [],
        inside_jokes: [],
        repeated_topics: [],
        ...initialModel?.shared_memories,
      },
    };
  }

  /**
   * 获取核心人设硬约束
   */
  getHardcodedPersona(): PersonaHardcoded {
    return {
      content: PERSONA_HARDCODED,
    };
  }

  /**
   * 获取当前心智模型
   */
  getMentalModel(): MentalModel {
    return this.mentalModel;
  }

  /**
   * 更新心智模型
   */
  updateMentalModel(updates: Partial<MentalModel>): void {
    this.mentalModel = {
      ...this.mentalModel,
      ...updates,
    };
  }

  /**
   * 验证人设一致性
   */
  validate(response: string): ValidationResult {
    const violations: string[] = [];

    // 检查是否违反核心人设
    if (this.containsOutOfCharacterPhrases(response)) {
      violations.push('包含不符合人设的表达');
    }

    // 检查是否记住关系状态
    if (!this.reflectsRelationshipLevel(response)) {
      violations.push('未反映正确的关系程度');
    }

    return {
      isValid: violations.length === 0,
      violations,
      shouldRegenerate: violations.length > 0,
    };
  }

  /**
   * 构建 RP Prompt
   */
  buildRPPrompt(userMessage: string, memories: string[]): string {
    const persona = this.getHardcodedPersona();
    const model = this.getMentalModel();

    return `
${persona.content}

## 当前状态
- 与用户关系：${model.relationship_graph.familiarity}%熟悉度
- 用户偏好：${model.user_profile.preferences.join('、')}

## 最近对话
${memories.slice(-5).join('\n')}

## 当前用户输入
${userMessage}

## 生成回复的要求
1. 保持人设：傲娇、理性、科学
2. 反映关系：根据熟悉度调整态度
3. 禁止出戏：
   - 不要说"作为AI"、"我无法..."
   - 始终保持在 Kurisu 的角色中

现在，以牧濑红莉栖的身份回复：
`;
  }

  private containsOutOfCharacterPhrases(text: string): boolean {
    const oocPhrases = ['作为AI', '作为人工智能', '我无法', '我是一个程序'];
    return oocPhrases.some((phrase) => text.includes(phrase));
  }

  private reflectsRelationshipLevel(text: string): boolean {
    // 简化实现：根据熟悉度检查语气
    const familiarity = this.mentalModel.relationship_graph.familiarity;
    if (familiarity < 20) {
      // 陌生阶段：应该更冷淡
      const tooFriendly = ['亲爱的', '宝贝', '最喜欢你了'];
      return !tooFriendly.some((phrase) => text.includes(phrase));
    }
    return true;
  }
}
