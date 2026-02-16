/**
 * 上下文构建节点
 *
 * 从记忆系统检索相关上下文，为模型调用准备输入
 */

import type { AgentState, ContextBuildNodeDeps } from "../types";

/**
 * 创建上下文构建节点
 */
export function createContextBuildNode(deps: ContextBuildNodeDeps) {
  const { memoryEngine } = deps;

  return async function contextBuildNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const { sessionId, currentInput } = state;

    // 确保会话存在
    if (!memoryEngine.hasSession(sessionId)) {
      memoryEngine.createSession(sessionId);
    }

    // 构建上下文
    const context = await memoryEngine.buildContext(sessionId, currentInput);

    return {
      context,
    };
  };
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function contextBuildNode(
  state: AgentState,
  deps: ContextBuildNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createContextBuildNode(deps);
  return node(state);
}
