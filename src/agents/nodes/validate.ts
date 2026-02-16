/**
 * 人设校验节点
 *
 * 验证模型响应是否符合人设约束
 */

import type { AgentState, ValidateNodeDeps, PersonaValidation } from '../types';

/**
 * 创建校验节点
 */
export function createValidateNode(deps: ValidateNodeDeps) {
  const { personaEngine, maxRetries } = deps;

  return async function validateNode(state: AgentState): Promise<Partial<AgentState>> {
    const { currentResponse, retryCount } = state;

    // 如果没有响应，跳过校验
    if (!currentResponse) {
      return {
        personaValidation: {
          isValid: true,
          violations: [],
          shouldRegenerate: false,
        },
      };
    }

    // 执行人设校验
    const result = personaEngine.validate(currentResponse);

    const validation: PersonaValidation = {
      isValid: result.isValid,
      violations: result.violations,
      shouldRegenerate: result.shouldRegenerate && retryCount < maxRetries,
    };

    // 更新重试计数
    const newRetryCount = validation.shouldRegenerate ? retryCount + 1 : retryCount;

    return {
      personaValidation: validation,
      retryCount: newRetryCount,
    };
  };
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function validateNode(
  state: AgentState,
  deps: ValidateNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createValidateNode(deps);
  return node(state);
}
