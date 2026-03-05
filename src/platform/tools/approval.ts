/**
 * 审批管理器
 *
 * 管理 confirm 级工具的用户审批流程
 *
 * KURISU-019 Phase 4: 扩展风险评估和审批消息功能
 */

import type { ToolCall, ApprovalState } from "./types.js";
import type { FilePermissionLevel } from "../models/executor-types.js";

// ============================================
// 风险评估类型
// ============================================

/**
 * 风险等级
 */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * 操作风险评估
 */
export interface OperationRisk {
  /** 风险等级 */
  readonly level: RiskLevel;
  /** 风险原因 */
  readonly reasons: readonly string[];
  /** 影响的文件路径 */
  readonly affectedPaths?: readonly string[];
  /** 是否可逆 */
  readonly isReversible: boolean;
}

/**
 * 审批请求（扩展版）
 */
export interface ApprovalRequest {
  /** 审批 ID */
  readonly id: string;
  /** 会话 ID */
  readonly sessionId: string;
  /** 待执行的工具调用 */
  readonly toolCall: ToolCall;
  /** 权限级别 */
  readonly permission: FilePermissionLevel;
  /** 风险等级 */
  readonly riskLevel: RiskLevel;
  /** 风险评估详情 */
  readonly risk: OperationRisk;
  /** 审批消息（给人设化之前） */
  readonly message: string;
  /** 创建时间 */
  readonly createdAt: number;
  /** 过期时间 */
  readonly expiresAt: number;
}

/**
 * 审批结果（扩展版）
 */
export interface ApprovalResult {
  /** 是否批准 */
  readonly approved: boolean;
  /** 用户说明的原因（取消时） */
  readonly reason?: string;
  /** 响应时间 */
  readonly respondedAt: number;
}

/**
 * 审批管理器配置
 */
export interface ApprovalManagerConfig {
  /** 审批超时（毫秒） */
  timeout?: number;
  /** 确认关键词 */
  confirmKeywords?: string[];
  /** 取消关键词 */
  cancelKeywords?: string[];
  /** 超时是否自动拒绝 */
  autoRejectOnTimeout?: boolean;
  /** 高风险操作是否需要用户说明原因 */
  criticalRequiresReason?: boolean;
}

/**
 * 审批管理器
 *
 * 负责:
 * 1. 创建审批请求
 * 2. 处理用户回复
 * 3. 管理审批状态
 */
export class ApprovalManager {
  private pendingApprovals: Map<string, ApprovalState> = new Map();
  private timeout: number;
  private confirmKeywords: string[];
  private cancelKeywords: string[];

  constructor(config: ApprovalManagerConfig = {}) {
    this.timeout = config.timeout ?? 30000;
    this.confirmKeywords = config.confirmKeywords ?? [
      "确认",
      "yes",
      "ok",
      "好的",
      "继续",
      "执行",
    ];
    this.cancelKeywords = config.cancelKeywords ?? [
      "取消",
      "放弃",
      "no",
      "不",
      "停止",
      "cancel",
    ];
  }

  /**
   * 创建审批请求
   */
  createApproval(sessionId: string, toolCall: ToolCall): ApprovalState {
    // 检查是否已有等待中的审批
    const existing = this.pendingApprovals.get(sessionId);
    if (existing && existing.status === "pending") {
      return existing;
    }

    const approval: ApprovalState = {
      sessionId,
      toolCall,
      message: this.buildApprovalMessage(toolCall),
      status: "pending",
      createdAt: Date.now(),
      timeout: this.timeout,
    };

    this.pendingApprovals.set(sessionId, approval);
    return approval;
  }

  /**
   * 构建审批消息
   */
  private buildApprovalMessage(toolCall: ToolCall): string {
    return `你让我执行 \`${toolCall.name}\`，这可能会有风险。确定要继续吗？\n回复「确认」继续，回复「取消」放弃。`;
  }

  /**
   * 处理用户回复
   *
   * @returns 审批结果: 'approved' | 'rejected' | 'invalid' | 'timeout'
   */
  handleReply(
    sessionId: string,
    reply: string,
  ): "approved" | "rejected" | "invalid" | "timeout" {
    const approval = this.pendingApprovals.get(sessionId);
    if (!approval) {
      return "invalid";
    }

    // 检查超时
    if (Date.now() - approval.createdAt > this.timeout) {
      this.pendingApprovals.delete(sessionId);
      return "timeout";
    }

    const normalizedReply = reply.toLowerCase().trim();

    // 检查确认
    if (
      this.confirmKeywords.some((kw) =>
        normalizedReply.includes(kw.toLowerCase()),
      )
    ) {
      // 更新状态（由于 ApprovalState 是 immutable 的，需要删除重建）
      this.pendingApprovals.delete(sessionId);
      return "approved";
    }

    // 检查取消
    if (
      this.cancelKeywords.some((kw) =>
        normalizedReply.includes(kw.toLowerCase()),
      )
    ) {
      this.pendingApprovals.delete(sessionId);
      return "rejected";
    }

    // 无法识别的回复
    return "invalid";
  }

  /**
   * 获取审批状态
   */
  getApproval(sessionId: string): ApprovalState | undefined {
    return this.pendingApprovals.get(sessionId);
  }

  /**
   * 检查是否有待审批
   */
  hasPendingApproval(sessionId: string): boolean {
    const approval = this.pendingApprovals.get(sessionId);
    return approval !== undefined && approval.status === "pending";
  }

  /**
   * 取消审批
   */
  cancelApproval(sessionId: string): boolean {
    return this.pendingApprovals.delete(sessionId);
  }

  /**
   * 清理过期审批
   */
  cleanupExpired(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, approval] of this.pendingApprovals) {
      if (now - approval.createdAt > this.timeout) {
        this.pendingApprovals.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 获取所有待审批数量
   */
  getPendingCount(): number {
    return this.pendingApprovals.size;
  }

  // ============================================
  // KURISU-019 Phase 4: 风险评估扩展
  // ============================================

  /**
   * 评估操作风险
   *
   * 根据工具调用和权限级别评估操作的风险等级
   */
  assessRisk(
    toolCall: ToolCall,
    permission: FilePermissionLevel,
  ): OperationRisk {
    const { name, arguments: args } = toolCall;

    // Shell 命令风险评估
    if (name === "shell" || name === "shell_execute") {
      const cmd = (args["command"] as string) ?? "";

      // 危险命令检测
      const dangerousPatterns = [
        { pattern: /\brm\s+-rf\b/, reason: "Recursive force delete" },
        { pattern: /\bdd\s+if=/, reason: "Disk overwrite" },
        { pattern: /\bmkfs\b/, reason: "Format disk" },
        { pattern: />\s*\/dev\//, reason: "Write to device" },
        { pattern: /\bchmod\s+777\b/, reason: "Dangerous permissions" },
        { pattern: /\bsudo\b/, reason: "Privilege escalation" },
      ];

      for (const { pattern, reason } of dangerousPatterns) {
        if (pattern.test(cmd)) {
          return {
            level: "critical",
            reasons: [`Dangerous command detected: ${reason}`],
            affectedPaths: this.extractPathsFromCommand(cmd),
            isReversible: false,
          };
        }
      }

      // 高风险命令
      if (/\brm\b/.test(cmd) || /\bmv\b/.test(cmd)) {
        return {
          level: "high",
          reasons: ["May delete or move files"],
          affectedPaths: this.extractPathsFromCommand(cmd),
          isReversible: false,
        };
      }

      return {
        level: "medium",
        reasons: ["Shell command execution"],
        isReversible: true,
      };
    }

    // 文件删除
    if (name === "file_delete") {
      const filePath = (args["path"] as string) ?? "";
      return {
        level: "high",
        reasons: ["File deletion operation"],
        affectedPaths: [filePath],
        isReversible: false,
      };
    }

    // 文件写入
    if (name === "file_write") {
      const filePath = (args["path"] as string) ?? "";
      return {
        level: "medium",
        reasons: ["File write operation"],
        affectedPaths: [filePath],
        isReversible: true,
      };
    }

    // 浏览器操作
    if (name === "browser" || name === "browser_action") {
      return {
        level: "medium",
        reasons: ["Browser automation"],
        isReversible: true,
      };
    }

    // 完全访问模式下，所有操作都是中等风险
    if (permission === "full_access") {
      return {
        level: "medium",
        reasons: ["Operation with full access permission"],
        isReversible: true,
      };
    }

    // 默认低风险
    return {
      level: "low",
      reasons: [],
      isReversible: true,
    };
  }

  /**
   * 从命令中提取路径
   */
  private extractPathsFromCommand(command: string): string[] {
    const paths: string[] = [];

    // 简单的路径提取（匹配引号内的路径和裸路径）
    const quotedPathRegex = /["']([^"']+)["']/g;
    const barePathRegex = /\s([/~][^\s]+)/g;

    let match: RegExpExecArray | null;

    while ((match = quotedPathRegex.exec(command)) !== null) {
      if (match[1]) {
        paths.push(match[1]);
      }
    }

    while ((match = barePathRegex.exec(command)) !== null) {
      if (match[1]) {
        paths.push(match[1]);
      }
    }

    return paths;
  }

  /**
   * 构建审批消息（扩展版）
   *
   * 根据工具调用和风险评估构建更详细的审批消息
   */
  buildApprovalMessageWithRisk(
    toolCall: ToolCall,
    risk: OperationRisk,
  ): string {
    const { name, arguments: args } = toolCall;

    // 根据工具类型构建消息
    if (name === "shell" || name === "shell_execute") {
      const cmd = (args["command"] as string) ?? "";
      return `你让我执行命令 \`${cmd}\`，这可能会修改文件。确定要继续吗？`;
    }

    if (name === "file_delete") {
      const path = (args["path"] as string) ?? "";
      return `你让我删除文件 \`${path}\`，删除后无法恢复。确定要继续吗？`;
    }

    if (name === "file_write") {
      const path = (args["path"] as string) ?? "";
      return `你让我写入文件 \`${path}\`，这会覆盖现有内容。确定要继续吗？`;
    }

    if (name === "browser" || name === "browser_action") {
      return `你让我控制浏览器执行操作。确定要继续吗？`;
    }

    // 高风险操作的通用消息
    if (risk.level === "critical") {
      return `⚠️ 危险操作！你让我执行 \`${name}\`，这可能会导致数据丢失！确定要继续吗？`;
    }

    if (risk.level === "high") {
      return `你让我执行 \`${name}\`，这个操作有一定风险。确定要继续吗？`;
    }

    return `你让我执行 \`${name}\`。确定要继续吗？`;
  }

  /**
   * 创建审批请求（扩展版）
   *
   * 包含完整的风险评估信息
   */
  createApprovalRequest(
    sessionId: string,
    toolCall: ToolCall,
    permission: FilePermissionLevel,
  ): ApprovalRequest {
    // 检查是否已有等待中的审批
    const existing = this.pendingApprovals.get(sessionId);
    if (existing && existing.status === "pending") {
      // 返回转换后的 ApprovalRequest
      return this.stateToRequest(existing, permission);
    }

    // 评估风险
    const risk = this.assessRisk(toolCall, permission);

    // 创建审批状态
    const approval: ApprovalState = {
      sessionId,
      toolCall,
      message: this.buildApprovalMessageWithRisk(toolCall, risk),
      status: "pending",
      createdAt: Date.now(),
      timeout: this.timeout,
    };

    this.pendingApprovals.set(sessionId, approval);

    // 返回扩展版审批请求
    return {
      id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId,
      toolCall,
      permission,
      riskLevel: risk.level,
      risk,
      message: approval.message,
      createdAt: approval.createdAt,
      expiresAt: approval.createdAt + this.timeout,
    };
  }

  /**
   * 将 ApprovalState 转换为 ApprovalRequest
   */
  private stateToRequest(
    state: ApprovalState,
    permission: FilePermissionLevel,
  ): ApprovalRequest {
    const risk = this.assessRisk(state.toolCall, permission);
    return {
      id: `approval-${state.createdAt}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: state.sessionId,
      toolCall: state.toolCall,
      permission,
      riskLevel: risk.level,
      risk,
      message: state.message,
      createdAt: state.createdAt,
      expiresAt: state.createdAt + (state.timeout ?? this.timeout),
    };
  }

  /**
   * 处理审批结果（扩展版）
   *
   * 返回更详细的审批结果信息
   */
  handleApprovalReply(sessionId: string, reply: string): ApprovalResult {
    const approval = this.pendingApprovals.get(sessionId);

    if (!approval) {
      return {
        approved: false,
        reason: "No pending approval",
        respondedAt: Date.now(),
      };
    }

    // 检查超时
    if (Date.now() - approval.createdAt > this.timeout) {
      this.pendingApprovals.delete(sessionId);
      return {
        approved: false,
        reason: "Approval expired",
        respondedAt: Date.now(),
      };
    }

    const normalizedReply = reply.toLowerCase().trim();

    // 检查确认
    if (
      this.confirmKeywords.some((kw) =>
        normalizedReply.includes(kw.toLowerCase()),
      )
    ) {
      this.pendingApprovals.delete(sessionId);
      return {
        approved: true,
        respondedAt: Date.now(),
      };
    }

    // 检查取消
    if (
      this.cancelKeywords.some((kw) =>
        normalizedReply.includes(kw.toLowerCase()),
      )
    ) {
      this.pendingApprovals.delete(sessionId);
      return {
        approved: false,
        reason: "User cancelled",
        respondedAt: Date.now(),
      };
    }

    // 无法识别的回复
    return {
      approved: false,
      reason: "Unrecognized reply",
      respondedAt: Date.now(),
    };
  }

  /**
   * 获取审批请求（扩展版）
   */
  getApprovalRequest(
    sessionId: string,
    permission: FilePermissionLevel,
  ): ApprovalRequest | null {
    const state = this.pendingApprovals.get(sessionId);
    if (!state) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - state.createdAt > this.timeout) {
      this.pendingApprovals.delete(sessionId);
      return null;
    }

    return this.stateToRequest(state, permission);
  }

  /**
   * 检查操作是否需要审批
   *
   * 根据权限级别和操作类型判断
   */
  needsApproval(permission: FilePermissionLevel, toolName: string): boolean {
    // 完全访问模式：所有操作都需要审批
    if (permission === "full_access") {
      return true;
    }

    // 受限模式：写操作需要审批
    if (permission === "restricted") {
      const confirmTools = [
        "file_write",
        "file_delete",
        "shell",
        "shell_execute",
        "browser",
        "browser_action",
        "computer_use",
      ];
      return confirmTools.includes(toolName);
    }

    // 沙箱模式：默认不需要审批
    return false;
  }
}

/**
 * 创建审批管理器
 */
export function createApprovalManager(
  config?: ApprovalManagerConfig,
): ApprovalManager {
  return new ApprovalManager(config);
}
