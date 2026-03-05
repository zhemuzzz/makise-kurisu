/**
 * PersonaWrapper - 工具输出人设化包装器
 *
 * 将工具执行结果用角色语气包装，让工具输出符合 Kurisu 人设
 *
 * 设计思路：
 * - 成功时："哼，帮你查到了..." 或 "等一下..."
 * - 失败时："真是的，执行失败了..." 或 "这个我做不到..."
 * - 需要审批时："你让我执行 xxx，确定要继续吗？"
 * - 拒绝时："这个我做不了。别问我为什么。"
 *
 * KURISU-019 Phase 4: 扩展审批相关方法
 */

import type { ToolResult } from "./types.js";
import type { ApprovalRequest, RiskLevel } from "./approval.js";

/**
 * 工具输出类型
 */
export type ToolOutputType =
  | "success"
  | "failure"
  | "approval_needed"
  | "denied"
  | "timeout";

/**
 * PersonaWrapper 配置
 */
export interface PersonaWrapperConfig {
  /** 是否启用人设包装 */
  readonly enabled?: boolean;
  /** 是否在输出前添加工具名 */
  readonly showToolName?: boolean;
  /** 最大输出长度（超出截断） */
  readonly maxOutputLength?: number;
  /** 自定义模板（覆盖默认 Kurisu 模板） */
  readonly templates?: Partial<ResponseTemplates>;
}

/**
 * 人设化响应模板
 */
interface ResponseTemplates {
  readonly successPrefixes: readonly string[];
  readonly failurePrefixes: readonly string[];
  readonly approvalMessages: readonly string[];
  readonly deniedMessages: readonly string[];
  readonly timeoutMessages: readonly string[];
}

/**
 * 默认 Kurisu 人设模板
 */
const KURISU_TEMPLATES: ResponseTemplates = {
  successPrefixes: [
    "哼，帮你查到了。",
    "...找到了。是这样的——",
    "搜了一下，",
    "查到了。等一下，我整理一下...",
    "好了，这是结果。",
  ],
  failurePrefixes: [
    "真是的，执行失败了。",
    "...不行，出错了。",
    "抱歉，这个我做不到。",
    "出问题了。你再试试？",
    "失败了...不是我的错。",
  ],
  approvalMessages: [
    "等一下，你让我执行 {tool}，这可能会修改数据。确定要继续吗？\n回复「确认」继续，回复「取消」放弃。",
    "你确定要执行 {tool} 吗？这个操作不可撤销。\n回复「确认」继续，回复「取消」放弃。",
    "{tool}...真的要做吗？做了就回不来了。\n回复「确认」继续，回复「取消」放弃。",
  ],
  deniedMessages: [
    "这个我做不了。别问我为什么。",
    "...你是认真的吗？这种事我不会做的。",
    "那个...这个不在我的权限范围内。",
    "不行。这个操作太危险了。",
  ],
  timeoutMessages: [
    "等太久了，超时了。",
    "...慢死了，不等了。",
    "超时了。你再试一次？",
    "响应太慢，算了。",
  ],
};

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<Omit<PersonaWrapperConfig, "templates">> = {
  enabled: true,
  showToolName: false,
  maxOutputLength: 2000,
};

/**
 * PersonaWrapper 类
 *
 * 包装工具输出，添加人设化前缀和语气
 */
export class PersonaWrapper {
  private readonly config: Required<Omit<PersonaWrapperConfig, "templates">>;
  private readonly templates: ResponseTemplates;
  private seed: number;

  constructor(config?: PersonaWrapperConfig) {
    const { templates: customTemplates, ...restConfig } = config ?? {};
    this.config = { ...DEFAULT_CONFIG, ...restConfig };
    // 合并自定义模板，允许覆盖默认 Kurisu 模板
    this.templates = {
      successPrefixes:
        customTemplates?.successPrefixes ?? KURISU_TEMPLATES.successPrefixes,
      failurePrefixes:
        customTemplates?.failurePrefixes ?? KURISU_TEMPLATES.failurePrefixes,
      approvalMessages:
        customTemplates?.approvalMessages ?? KURISU_TEMPLATES.approvalMessages,
      deniedMessages:
        customTemplates?.deniedMessages ?? KURISU_TEMPLATES.deniedMessages,
      timeoutMessages:
        customTemplates?.timeoutMessages ?? KURISU_TEMPLATES.timeoutMessages,
    };
    this.seed = 12345;
  }

  /**
   * 包装工具结果
   *
   * @param result 工具执行结果
   * @returns 人设化后的输出文本
   */
  wrap(result: ToolResult): string {
    if (!this.config.enabled) {
      return this.formatRawOutput(result);
    }

    const outputType = this.determineOutputType(result);

    switch (outputType) {
      case "approval_needed":
        return this.wrapApprovalNeeded(result);
      case "denied":
        return this.wrapDenied(result);
      case "timeout":
        return this.wrapTimeout(result);
      case "failure":
        return this.wrapFailure(result);
      case "success":
      default:
        return this.wrapSuccess(result);
    }
  }

  /**
   * 确定输出类型
   */
  private determineOutputType(result: ToolResult): ToolOutputType {
    // 需要审批
    if (result.approvalRequired && result.approvalStatus === "pending") {
      return "approval_needed";
    }

    // 被拒绝
    if (result.approvalStatus === "rejected") {
      return "denied";
    }

    // 超时
    if (result.approvalStatus === "timeout") {
      return "timeout";
    }

    // 失败
    if (!result.success) {
      return "failure";
    }

    // 成功
    return "success";
  }

  /**
   * 包装成功结果
   */
  private wrapSuccess(result: ToolResult): string {
    const prefix = this.selectTemplate(this.templates.successPrefixes);
    const output = this.formatOutput(result.output);

    if (this.config.showToolName) {
      return `${prefix}\n[${result.toolName}] ${output}`;
    }

    return `${prefix}\n${output}`;
  }

  /**
   * 包装失败结果
   */
  private wrapFailure(result: ToolResult): string {
    const prefix = this.selectTemplate(this.templates.failurePrefixes);
    const error = result.error ?? "未知错误";

    if (this.config.showToolName) {
      return `${prefix}\n[${result.toolName}] 错误: ${error}`;
    }

    return `${prefix}\n错误: ${error}`;
  }

  /**
   * 包装需要审批的结果
   */
  private wrapApprovalNeeded(result: ToolResult): string {
    const template = this.selectTemplate(this.templates.approvalMessages);
    return template.replace("{tool}", result.toolName);
  }

  /**
   * 包装被拒绝的结果
   */
  private wrapDenied(_result: ToolResult): string {
    return this.selectTemplate(this.templates.deniedMessages);
  }

  /**
   * 包装超时结果
   */
  private wrapTimeout(_result: ToolResult): string {
    return this.selectTemplate(this.templates.timeoutMessages);
  }

  /**
   * 格式化原始输出（无人设包装）
   */
  private formatRawOutput(result: ToolResult): string {
    if (result.success) {
      return this.formatOutput(result.output);
    }
    return `错误: ${result.error ?? "未知错误"}`;
  }

  /**
   * 格式化输出内容
   */
  private formatOutput(output: unknown): string {
    let formatted: string;

    if (output === null || output === undefined) {
      formatted = "(无结果)";
    } else if (typeof output === "string") {
      formatted = output;
    } else if (typeof output === "object") {
      try {
        formatted = JSON.stringify(output, null, 2);
      } catch {
        formatted = String(output);
      }
    } else {
      formatted = String(output);
    }

    // 截断过长输出
    if (formatted.length > this.config.maxOutputLength) {
      formatted =
        formatted.slice(0, this.config.maxOutputLength) + "\n... (输出已截断)";
    }

    return formatted;
  }

  /**
   * 选择模板（确定性随机）
   */
  private selectTemplate(templates: readonly string[]): string {
    const index = Math.floor(this.seededRandom() * templates.length);
    return templates[index] ?? templates[0]!;
  }

  /**
   * 伪随机数生成器（确定性）
   */
  private seededRandom(): number {
    this.seed = (this.seed * 1103515245 + 12345) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * 构建审批请求消息
   *
   * @param toolName 工具名称
   * @param args 工具参数（可选，用于显示详细信息）
   * @returns 审批请求消息
   */
  buildApprovalMessage(
    toolName: string,
    args?: Record<string, unknown>,
  ): string {
    const template = this.selectTemplate(this.templates.approvalMessages);
    let message = template.replace("{tool}", toolName);

    // 如果有参数，添加参数信息
    if (args && Object.keys(args).length > 0) {
      const argsStr = Object.entries(args)
        .map(([key, value]) => `  - ${key}: ${this.formatArgValue(value)}`)
        .join("\n");
      message = message.replace("\n", `\n参数:\n${argsStr}\n`);
    }

    return message;
  }

  /**
   * 格式化参数值
   */
  private formatArgValue(value: unknown): string {
    if (typeof value === "string") {
      // 截断长字符串
      return value.length > 50 ? value.slice(0, 50) + "..." : value;
    }
    if (typeof value === "object") {
      try {
        const str = JSON.stringify(value);
        return str.length > 50 ? str.slice(0, 50) + "..." : str;
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  // ============================================
  // KURISU-019 Phase 4: 审批相关扩展方法
  // ============================================

  /**
   * 人设化审批请求消息
   *
   * 根据风险等级选择不同语气的消息模板
   *
   * @param request 审批请求
   * @returns 人设化后的审批消息
   */
  wrapApprovalRequest(request: ApprovalRequest): string {
    const { riskLevel, message, toolCall } = request;

    // 根据风险等级选择模板
    const templates = this.getApprovalTemplatesByRiskLevel(riskLevel);
    const template = this.selectTemplate(templates);

    // 替换占位符
    let result = template.replace("{message}", message);
    result = result.replace("{tool}", toolCall.name);

    // 添加参数信息（如果有）
    const args = toolCall.arguments;
    if (args && Object.keys(args).length > 0) {
      const relevantArgs = this.getRelevantArgs(toolCall.name, args);
      if (relevantArgs) {
        result = result.replace("\n", `\n${relevantArgs}\n`);
      }
    }

    return result;
  }

  /**
   * 根据风险等级获取审批消息模板
   */
  private getApprovalTemplatesByRiskLevel(level: RiskLevel): readonly string[] {
    const templatesByRisk: Record<RiskLevel, readonly string[]> = {
      low: [
        "等一下，{message}回复「确认」继续，回复「取消」放弃。",
        "嗯...{message}确认的话就回复「确认」。",
      ],
      medium: [
        "等一下，{message}确定要这么做吗？回复「确认」继续，回复「取消」放弃。",
        "真是的，{message}你想清楚了吗？回复「确认」或「取消」。",
      ],
      high: [
        "等一下！{message}这可是高风险操作，确定要继续吗？回复「确认」继续，回复「取消」放弃。",
        "你确定？{message}我不会帮你收拾烂摊子的。回复「确认」或「取消」。",
      ],
      critical: [
        "⚠️ 危险操作！{message}这可能会导致数据丢失！确定要继续吗？回复「确认」继续，回复「取消」放弃。",
        "等一下！这是非常危险的操作！{message}你真的确定吗？回复「确认」或「取消」。",
      ],
    };

    return templatesByRisk[level] ?? templatesByRisk["medium"];
  }

  /**
   * 获取相关的参数信息
   */
  private getRelevantArgs(
    toolName: string,
    args: Record<string, unknown>,
  ): string | null {
    // 根据工具类型选择要显示的参数
    const relevantParams: Record<string, string[]> = {
      shell: ["command"],
      shell_execute: ["command"],
      file_write: ["path"],
      file_delete: ["path"],
      browser: ["action", "url"],
      browser_action: ["action", "url"],
    };

    const params = relevantParams[toolName];
    if (!params) {
      return null;
    }

    const lines: string[] = [];
    for (const param of params) {
      const value = args[param];
      if (value !== undefined) {
        lines.push(`  - ${param}: ${this.formatArgValue(value)}`);
      }
    }

    return lines.length > 0 ? lines.join("\n") : null;
  }

  /**
   * 人设化审批结果
   *
   * @param approved 是否批准
   * @param reason 原因（可选）
   * @returns 人设化后的结果消息
   */
  wrapApprovalResult(approved: boolean, reason?: string): string {
    if (approved) {
      const approvedTemplates = [
        "好，我知道了。",
        "明白了，开始执行。",
        "...好的。",
        "了解，这就去做。",
      ];
      return this.selectTemplate(approvedTemplates);
    }

    // 根据拒绝原因选择不同的模板
    if (reason === "User cancelled") {
      const cancelledTemplates = [
        "好吧，取消了。",
        "...知道了，不做了。",
        "行，那就算了。",
        "了解，取消执行。",
      ];
      return this.selectTemplate(cancelledTemplates);
    }

    if (reason === "Approval expired") {
      const expiredTemplates = [
        "你太久没回复，我当你放弃了。",
        "...等太久了，超时了。",
        "时间太长，自动取消了。",
      ];
      return this.selectTemplate(expiredTemplates);
    }

    if (reason === "No pending approval") {
      return "...没有找到待审批的操作。";
    }

    // 其他拒绝原因
    const rejectedTemplates = ["好吧，不做了。", "...知道了。", "行，取消。"];
    return this.selectTemplate(rejectedTemplates);
  }

  /**
   * 构建风险警告消息
   *
   * 用于高风险操作前的额外警告
   */
  buildRiskWarning(riskLevel: RiskLevel, reasons: readonly string[]): string {
    if (riskLevel === "low") {
      return "";
    }

    const warningTemplates: Record<RiskLevel, string> = {
      low: "",
      medium: "注意：这个操作有一定风险。",
      high: "⚠️ 警告：这个操作风险较高，请谨慎确认。",
      critical: "⚠️ 危险：这个操作非常危险，可能会导致不可逆的后果！",
    };

    const warning = warningTemplates[riskLevel] ?? "";

    if (reasons.length === 0) {
      return warning;
    }

    const reasonsList = reasons.map((r) => `  - ${r}`).join("\n");
    return `${warning}\n\n风险原因:\n${reasonsList}`;
  }

  /**
   * 包装执行器审批消息
   *
   * 用于执行器返回需要审批的情况
   */
  wrapExecutorApprovalMessage(
    _toolName: string,
    command: string,
    riskLevel: RiskLevel,
  ): string {
    const riskPrefixes: Record<RiskLevel, string> = {
      low: "",
      medium: "等一下，",
      high: "等一下！",
      critical: "⚠️ 危险操作！",
    };

    const prefix = riskPrefixes[riskLevel] ?? "";

    const templates = [
      `${prefix}你让我执行 \`${command}\`，确定要继续吗？\n回复「确认」继续，回复「取消」放弃。`,
      `${prefix}我需要执行 \`${command}\`，你确定吗？\n回复「确认」继续，回复「取消」放弃。`,
    ];

    return this.selectTemplate(templates);
  }
}

/**
 * 创建 PersonaWrapper 实例
 */
export function createPersonaWrapper(
  config?: PersonaWrapperConfig,
): PersonaWrapper {
  return new PersonaWrapper(config);
}
