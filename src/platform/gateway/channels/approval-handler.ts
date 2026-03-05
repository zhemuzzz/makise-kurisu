/**
 * L1 交互网关 - 审批处理器
 * @description KURISU-023 统一审批处理 Mixin
 *              将权限切换/目录切换/工具执行审批统一处理，减少 Channel 层代码重复
 */

import type { ToolCall } from "../types.js";

// ===========================================
// 类型定义
// ===========================================

/**
 * 审批类型
 */
export type ApprovalType =
  | "tool"
  | "change_dir"
  | "change_permission"
  | "delete_confirm"; // KURISU-023 方案B

/**
 * 审批处理结果
 */
export interface ApprovalResult {
  /** 是否处理了审批 */
  readonly handled: boolean;
  /** 审批类型 */
  readonly type?: ApprovalType;
  /** 是否批准（handled=true 时有效） */
  readonly approved?: boolean | undefined;
  /** 响应消息 */
  readonly message?: string | undefined;
  /** 待执行的工具调用（工具审批时） */
  readonly toolCall?: ToolCall | undefined;
}

/**
 * 工具审批结果
 */
export interface ToolApprovalResult {
  readonly isApprovalReply: boolean;
  readonly result?: "approved" | "rejected" | "timeout";
  readonly toolCall?: ToolCall;
}

/**
 * 通用审批结果（目录切换/权限切换）
 */
export interface GenericApprovalResult {
  readonly isApprovalReply: boolean;
  readonly approved?: boolean;
  readonly message?: string;
}

/**
 * Gateway 接口（避免循环依赖）
 */
export interface ApprovalGatewayLike {
  /** 检查工具审批回复 */
  checkApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<ToolApprovalResult>;

  /** 执行已批准的工具 */
  executeApprovedTool(sessionId: string, toolCall: ToolCall): Promise<string>;

  /** 检查目录切换审批回复 */
  handleChangeDirApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<GenericApprovalResult>;

  /** 检查权限切换审批回复 */
  handleChangePermissionApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<GenericApprovalResult>;

  /** 检查删除确认关闭审批回复 (KURISU-023 方案B) */
  handleChangeDeleteConfirmApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<GenericApprovalResult>;
}

// ===========================================
// 审批处理器
// ===========================================

/**
 * 审批处理器
 * @description 统一处理所有类型的审批流程
 *
 * @example
 * ```typescript
 * const handler = new ApprovalHandler(gateway);
 * const result = await handler.handleApproval(sessionId, userMessage);
 *
 * if (result.handled) {
 *   if (result.message) {
 *     await channel.sendMessage({ content: result.message });
 *   }
 *   if (result.type === "tool" && result.approved && result.toolCall) {
 *     const response = await gateway.executeApprovedTool(sessionId, result.toolCall);
 *     await channel.sendMessage({ content: response });
 *   }
 *   return; // 处理完成
 * }
 * // 继续正常消息处理流程...
 * ```
 */
export class ApprovalHandler {
  constructor(private readonly gateway: ApprovalGatewayLike) {}

  /**
   * 处理所有审批类型
   * @description 按优先级依次检查：权限切换 → 删除确认关闭 → 目录切换 → 工具执行
   *
   * @param sessionId 会话 ID
   * @param userMessage 用户消息
   * @returns 审批处理结果
   */
  async handleApproval(
    sessionId: string,
    userMessage: string,
  ): Promise<ApprovalResult> {
    // 1. 权限切换审批（最高优先级，影响后续所有操作）
    const permissionResult =
      await this.gateway.handleChangePermissionApprovalReply(
        sessionId,
        userMessage,
      );

    if (permissionResult.isApprovalReply) {
      return {
        handled: true,
        type: "change_permission",
        approved: permissionResult.approved,
        message: permissionResult.message,
      };
    }

    // 2. 删除确认关闭审批 (KURISU-023 方案B)
    const deleteConfirmResult =
      await this.gateway.handleChangeDeleteConfirmApprovalReply(
        sessionId,
        userMessage,
      );

    if (deleteConfirmResult.isApprovalReply) {
      return {
        handled: true,
        type: "delete_confirm",
        approved: deleteConfirmResult.approved,
        message: deleteConfirmResult.message,
      };
    }

    // 3. 目录切换审批
    const dirResult = await this.gateway.handleChangeDirApprovalReply(
      sessionId,
      userMessage,
    );

    if (dirResult.isApprovalReply) {
      return {
        handled: true,
        type: "change_dir",
        approved: dirResult.approved,
        message: dirResult.message,
      };
    }

    // 4. 工具执行审批
    const toolResult = await this.gateway.checkApprovalReply(
      sessionId,
      userMessage,
    );

    if (toolResult.isApprovalReply) {
      return {
        handled: true,
        type: "tool",
        approved: toolResult.result === "approved",
        toolCall: toolResult.toolCall,
        // 工具审批的消息需要执行后才能生成
      };
    }

    return { handled: false };
  }

  /**
   * 执行已批准的工具
   * @description 便捷方法，封装 gateway.executeApprovedTool
   *
   * @param sessionId 会话 ID
   * @param toolCall 工具调用
   * @returns 工具执行结果
   */
  async executeApprovedTool(
    sessionId: string,
    toolCall: ToolCall,
  ): Promise<string> {
    return this.gateway.executeApprovedTool(sessionId, toolCall);
  }

  /**
   * 检查是否有待处理的审批
   * @description 用于判断是否应该提示用户
   */
  hasPendingApproval(_sessionId: string): boolean {
    // 这个方法需要 gateway 提供额外接口
    // 暂时返回 false，后续可以扩展
    return false;
  }
}

// ===========================================
// 工厂函数
// ===========================================

/**
 * 创建审批处理器
 */
export function createApprovalHandler(
  gateway: ApprovalGatewayLike,
): ApprovalHandler {
  return new ApprovalHandler(gateway);
}
