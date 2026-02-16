/**
 * 意图路由器
 *
 * 条件路由逻辑，决定状态机流转方向
 */

import type { AgentState } from '../types';
import { AgentRole, IntentType } from '../types';

/**
 * 根据意图选择下一个节点
 */
export function intentRouter(state: AgentState): string {
  const intent = state.routeDecision?.intent ?? IntentType.UNKNOWN;

  switch (intent) {
    case IntentType.TASK:
      return 'task';
    case IntentType.CONVERSATION:
    default:
      return 'conversation';
  }
}

/**
 * 校验后路由：决定是否重试或结束
 */
export function validationRouter(state: AgentState): string {
  // 有响应且校验通过或达到最大重试次数
  if (state.currentResponse !== null) {
    const shouldEnd =
      state.personaValidation?.isValid === true ||
      !state.personaValidation?.shouldRegenerate;

    if (shouldEnd) {
      return 'end';
    }

    // 需要重试：返回对应 Agent
    return state.currentAgent === AgentRole.TASK ? 'task' : 'conversation';
  }

  // 没有响应，结束
  return 'end';
}

/**
 * 检查是否需要重新生成
 */
export function shouldRegenerate(state: AgentState): boolean {
  return state.personaValidation?.shouldRegenerate === true;
}
