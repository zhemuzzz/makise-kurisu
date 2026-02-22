/**
 * 意图路由器
 *
 * 条件路由逻辑，决定状态机流转方向
 */

import type { AgentState } from "../types";
import { AgentRole, IntentType } from "../types";

/**
 * 根据意图选择下一个节点
 */
export function intentRouter(state: AgentState): string {
  const intent = state.routeDecision?.intent ?? IntentType.UNKNOWN;

  switch (intent) {
    case IntentType.TASK:
      return "task";
    case IntentType.CONVERSATION:
    default:
      return "conversation";
  }
}

/**
 * Generate 后路由：决定是执行工具调用还是进入校验
 */
export function generateRouter(state: AgentState): string {
  // 有待执行的工具调用
  if (state.pendingToolCalls.length > 0) {
    return "tool_call";
  }

  // 有审批等待中
  if (state.approvalState?.status === "pending") {
    return "wait_approval";
  }

  // 没有工具调用，进入校验
  return "validate";
}

/**
 * 工具调用后路由：决定下一步
 */
export function toolCallRouter(state: AgentState): string {
  const maxIterations = 5;

  // 有审批等待中，等待用户回复
  if (state.approvalState?.status === "pending") {
    return "wait_approval";
  }

  // 达到迭代上限，强制结束
  if (state.toolCallIteration >= maxIterations) {
    return "validate";
  }

  // 有工具执行结果，继续生成
  if (state.toolResults.length > 0) {
    return state.currentAgent === AgentRole.TASK ? "task" : "conversation";
  }

  // 还有待执行的工具调用（需要审批的）
  if (state.pendingToolCalls.length > 0) {
    return "tool_call";
  }

  // 其他情况进入校验
  return "validate";
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
      return "end";
    }

    // 需要重试：返回对应 Agent
    return state.currentAgent === AgentRole.TASK ? "task" : "conversation";
  }

  // 没有响应，结束
  return "end";
}

/**
 * 检查是否需要重新生成
 */
export function shouldRegenerate(state: AgentState): boolean {
  return state.personaValidation?.shouldRegenerate === true;
}
