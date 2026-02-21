/**
 * 工具调用节点
 *
 * 执行工具调用，处理审批流程
 */

import type { AgentState } from "../types";
import type { ToolCall, ToolResult, ApprovalState } from "../../tools/types";
import type { ToolRegistry } from "../../tools/registry";
import type { PermissionChecker } from "../../tools/permission";
import type { ApprovalManager } from "../../tools/approval";

/**
 * 工具调用节点依赖
 */
export interface ToolCallNodeDeps {
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 权限检查器 */
  permissionChecker: PermissionChecker;
  /** 审批管理器 */
  approvalManager: ApprovalManager;
  /** 最大迭代次数 */
  maxIterations?: number;
}

/**
 * 工具调用路由结果
 */
export type ToolCallRoute = "execute" | "wait_approval" | "skip" | "done";

/**
 * 创建工具调用节点
 */
export function createToolCallNode(deps: ToolCallNodeDeps) {
  const { toolRegistry, permissionChecker, approvalManager, maxIterations = 5 } = deps;

  return async function toolCallNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const { pendingToolCalls, toolCallIteration, approvalState } = state;

    // 1. 检查迭代上限
    if (toolCallIteration >= maxIterations) {
      return {
        pendingToolCalls: [],
      };
    }

    // 2. 如果有审批等待中，不执行新工具
    if (approvalState && approvalState.status === "pending") {
      return {};
    }

    // 3. 没有待执行的工具调用
    if (pendingToolCalls.length === 0) {
      return {};
    }

    // 4. 执行工具调用
    const results: ToolResult[] = [];
    const newPendingCalls: ToolCall[] = [];
    let newApprovalState: ApprovalState | null = null;

    for (const call of pendingToolCalls) {
      // 检查权限
      const permissionResult = permissionChecker.check(call.name);

      if (!permissionResult.allowed) {
        // 权限拒绝
        results.push({
          callId: call.id,
          toolName: call.name,
          success: false,
          output: null,
          error: permissionResult.reason ?? "Permission denied",
          latency: 0,
        });
        continue;
      }

      if (permissionResult.requiresApproval) {
        // 需要审批
        newApprovalState = approvalManager.createApproval(
          state.sessionId,
          call,
        );
        newPendingCalls.push(call);
        continue;
      }

      // 直接执行
      const result = await toolRegistry.execute(call);
      results.push(result);
    }

    return {
      pendingToolCalls: newPendingCalls,
      toolResults: results,
      toolCallIteration: toolCallIteration + 1,
      approvalState: newApprovalState,
    };
  };
}

/**
 * 工具调用路由函数
 *
 * 决定下一步去哪个节点
 */
export function toolCallRouter(state: AgentState): ToolCallRoute {
  const { pendingToolCalls, approvalState, toolCallIteration } = state;
  const maxIterations = 5;

  // 1. 有审批等待中
  if (approvalState && approvalState.status === "pending") {
    return "wait_approval";
  }

  // 2. 达到迭代上限
  if (toolCallIteration >= maxIterations) {
    return "done";
  }

  // 3. 有待执行的工具调用
  if (pendingToolCalls.length > 0) {
    return "execute";
  }

  // 4. 没有工具调用需要处理
  return "done";
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function toolCallNode(
  state: AgentState,
  deps: ToolCallNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createToolCallNode(deps);
  return node(state);
}
