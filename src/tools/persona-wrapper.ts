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
 */

import type { ToolResult } from "./types";

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
const DEFAULT_CONFIG: Required<PersonaWrapperConfig> = {
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
  private readonly config: Required<PersonaWrapperConfig>;
  private readonly templates: ResponseTemplates;
  private seed: number;

  constructor(config?: PersonaWrapperConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.templates = KURISU_TEMPLATES;
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
}

/**
 * 创建 PersonaWrapper 实例
 */
export function createPersonaWrapper(
  config?: PersonaWrapperConfig,
): PersonaWrapper {
  return new PersonaWrapper(config);
}
