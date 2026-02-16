/**
 * 人设强化节点
 *
 * 强化响应的人设特征，并存储到记忆系统
 */

import type { AgentState, EnforceNodeDeps } from "../types";

/**
 * 创建强化节点
 */
export function createEnforceNode(deps: EnforceNodeDeps) {
  const { personaEngine, memoryEngine } = deps;

  return async function enforceNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const { sessionId, currentResponse, messages } = state;

    // 如果没有响应，直接返回
    if (!currentResponse) {
      return {};
    }

    // 强化人设
    const enforcedResponse = personaEngine.enforcePersona(currentResponse);

    // 存储到记忆系统
    memoryEngine.addSessionMessage(sessionId, state.currentInput, "user");
    memoryEngine.addSessionMessage(sessionId, enforcedResponse, "assistant");

    // 更新消息列表中的响应
    const updatedMessages = messages.map((msg) => {
      if (msg.role === "assistant" && msg.content === currentResponse) {
        return { ...msg, content: enforcedResponse };
      }
      return msg;
    });

    return {
      currentResponse: enforcedResponse,
      messages: updatedMessages,
    };
  };
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function enforceNode(
  state: AgentState,
  deps: EnforceNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createEnforceNode(deps);
  return node(state);
}
