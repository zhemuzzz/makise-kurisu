/**
 * 执行器审批集成
 *
 * KURISU-019 Phase 4.3: 将审批流程集成到执行器
 *
 * 提供 executeWithApproval 方法，根据权限级别决定是否需要审批
 */

import type { ToolExecutor, ExecuteOptions, ExecuteResult } from "./types";
import type { ApprovalManager, ApprovalRequest, RiskLevel } from "../approval";
import type { FilePermissionLevel } from "../../models/executor-types";

/**
 * 带审批信息的执行结果
 */
export interface ExecuteResultWithApproval extends ExecuteResult {
  /** 是否需要审批 */
  readonly approvalRequired?: boolean;
  /** 审批请求（如果需要审批） */
  readonly approvalRequest?: ApprovalRequest;
}

/**
 * 审批执行器配置
 */
export interface ApprovalExecutorConfig {
  /** 审批管理器 */
  readonly approvalManager: ApprovalManager;
  /** 底层执行器 */
  readonly executor: ToolExecutor;
  /** 默认权限级别 */
  readonly defaultPermission?: FilePermissionLevel;
}

/**
 * 工具调用信息
 */
export interface ToolCallInfo {
  /** 工具名称 */
  readonly name: string;
  /** 工具参数 */
  readonly arguments: Record<string, unknown>;
}

/**
 * 审批执行器包装器
 *
 * 包装任意 ToolExecutor，添加审批流程支持
 */
export class ApprovalExecutorWrapper implements ToolExecutor {
  private readonly approvalManager: ApprovalManager;
  private readonly executor: ToolExecutor;
  private readonly defaultPermission: FilePermissionLevel;

  constructor(config: ApprovalExecutorConfig) {
    this.approvalManager = config.approvalManager;
    this.executor = config.executor;
    this.defaultPermission = config.defaultPermission ?? "sandbox";
  }

  /**
   * 执行命令（带审批流程）
   *
   * @param command 要执行的命令
   * @param options 执行选项
   * @param sessionId 会话 ID（用于审批流程）
   * @param toolCall 工具调用信息（用于风险评估）
   * @returns 执行结果（可能包含审批请求）
   */
  async executeWithApproval(
    command: string,
    options: ExecuteOptions,
    sessionId?: string,
    toolCall?: ToolCallInfo,
  ): Promise<ExecuteResultWithApproval> {
    const permission = this.getPermissionLevel(options);
    const toolName = toolCall?.name ?? "shell";

    // 检查是否需要审批
    if (this.approvalManager.needsApproval(permission, toolName)) {
      // 需要审批但没有提供会话 ID
      if (!sessionId) {
        return {
          success: false,
          stdout: "",
          stderr: "Approval required but no session ID provided",
          exitCode: 126,
          latency: 0,
          executorType: this.executor.getCapabilities().isolation,
          approvalRequired: true,
        };
      }

      // 需要审批但工具已经获得批准
      if (options.approved) {
        // 直接执行
        return this.executeInternal(command, options);
      }

      // 创建审批请求
      const toolCallForApproval = toolCall
        ? { id: `tool-${Date.now()}`, ...toolCall }
        : {
            id: `tool-${Date.now()}`,
            name: toolName,
            arguments: { command },
          };

      const approvalRequest = this.approvalManager.createApprovalRequest(
        sessionId,
        toolCallForApproval,
        permission,
      );

      // 返回需要审批的状态
      return {
        success: false,
        stdout: "",
        stderr: "",
        exitCode: 126,
        latency: 0,
        executorType: this.executor.getCapabilities().isolation,
        approvalRequired: true,
        approvalRequest,
      };
    }

    // 不需要审批，直接执行
    return this.executeInternal(command, options);
  }

  /**
   * 执行已批准的命令
   *
   * 当用户确认审批后调用此方法
   */
  async executeApproved(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    // 标记为已批准
    const approvedOptions: ExecuteOptions = {
      ...options,
      approved: true,
    };

    return this.executeInternal(command, approvedOptions);
  }

  /**
   * 内部执行方法
   */
  private async executeInternal(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResultWithApproval> {
    const result = await this.executor.execute(command, options);

    return {
      ...result,
      approvalRequired: false,
    };
  }

  /**
   * 执行命令（标准接口）
   */
  async execute(
    command: string,
    options: ExecuteOptions,
  ): Promise<ExecuteResult> {
    return this.executor.execute(command, options);
  }

  /**
   * 获取执行器能力
   */
  getCapabilities() {
    return this.executor.getCapabilities();
  }

  /**
   * 检查特定权限是否可用
   */
  supportsPermission(level: string): boolean {
    return this.executor.supportsPermission(level as never);
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    return this.executor.healthCheck();
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (this.executor.cleanup) {
      await this.executor.cleanup();
    }
  }

  /**
   * 从 ExecuteOptions 获取权限级别
   */
  private getPermissionLevel(options: ExecuteOptions): FilePermissionLevel {
    // 将 PermissionLevel (safe/confirm/deny) 映射到 FilePermissionLevel
    switch (options.permission) {
      case "safe":
        return "sandbox";
      case "confirm":
        return "restricted";
      case "deny":
        return "sandbox";
      default:
        return this.defaultPermission;
    }
  }

  /**
   * 获取底层执行器
   */
  getWrappedExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * 获取审批管理器
   */
  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }
}

/**
 * 创建审批执行器包装器
 */
export function createApprovalExecutor(
  config: ApprovalExecutorConfig,
): ApprovalExecutorWrapper {
  return new ApprovalExecutorWrapper(config);
}

/**
 * 检查执行结果是否需要审批
 */
export function isApprovalRequired(
  result: ExecuteResultWithApproval,
): result is ExecuteResultWithApproval & {
  approvalRequired: true;
  approvalRequest: ApprovalRequest;
} {
  return (
    result.approvalRequired === true && result.approvalRequest !== undefined
  );
}

/**
 * 风险等级转文字描述
 */
export function riskLevelToText(level: RiskLevel): string {
  const texts: Record<RiskLevel, string> = {
    low: "低风险",
    medium: "中等风险",
    high: "高风险",
    critical: "极高风险",
  };
  return texts[level] ?? "未知风险";
}

/**
 * 获取风险等级对应的图标
 */
export function riskLevelToIcon(level: RiskLevel): string {
  const icons: Record<RiskLevel, string> = {
    low: "✓",
    medium: "⚠",
    high: "⚠️",
    critical: "🔴",
  };
  return icons[level] ?? "?";
}
