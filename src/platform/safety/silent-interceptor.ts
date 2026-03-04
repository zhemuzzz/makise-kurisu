/**
 * 静默安全拦截器
 *
 * 职责：
 * - 检查工具调用权限
 * - 检测危险操作模式
 * - 返回结构化错误，不产生任何对话输出
 *
 * 关键设计：安全层静默运行，错误由角色层决定如何表达
 */

import type {
  SafetyConfig,
  SafetyResult,
  SafetyError,
  ToolCall,
} from "./types";
import { DEFAULT_SAFETY_CONFIG } from "./types";

/**
 * 静默安全拦截器
 *
 * 特点：
 * - 不产生任何对话输出
 * - 返回结构化错误对象
 * - 由角色层决定如何表达错误
 */
export class SilentSafetyInterceptor {
  constructor(private readonly config: SafetyConfig = DEFAULT_SAFETY_CONFIG) {}

  /**
   * 检查工具调用是否被允许
   *
   * IMPORTANT: 此方法不产生任何对话输出
   *
   * @param toolCall 工具调用请求
   * @returns 安全检查结果
   */
  check(toolCall: ToolCall): SafetyResult {
    const { name, params } = toolCall;

    // 1. 检查是否在禁止列表
    if (this.config.tools.forbidden.includes(name)) {
      return {
        success: false,
        error: {
          code: "FORBIDDEN",
          toolName: name,
          internalMessage: `Tool ${name} is not allowed for this role.`,
        },
      };
    }

    // 2. 检查是否需要确认
    if (this.config.tools.confirm.includes(name)) {
      return {
        success: false,
        error: {
          code: "NEED_CONFIRMATION",
          toolName: name,
          internalMessage: `Tool ${name} requires user confirmation before execution.`,
        },
      };
    }

    // 3. 检查危险模式
    const patternError = this.checkDangerousPatterns(name, params);
    if (patternError) {
      return { success: false, error: patternError };
    }

    // 4. 安全，允许执行
    return { success: true };
  }

  /**
   * 检查工具参数是否包含危险模式
   */
  private checkDangerousPatterns(
    toolName: string,
    params: unknown,
  ): SafetyError | null {
    const paramsStr = this.stringifyParams(params).toLowerCase();

    for (const { pattern, action } of this.config.dangerousPatterns) {
      if (paramsStr.includes(pattern.toLowerCase())) {
        return {
          code: action === "forbid" ? "FORBIDDEN" : "NEED_CONFIRMATION",
          toolName,
          internalMessage: `This operation contains a dangerous pattern "${pattern}" and requires ${action === "forbid" ? "is forbidden" : "confirmation"}.`,
        };
      }
    }

    return null;
  }

  /**
   * 安全地将参数转换为字符串
   */
  private stringifyParams(params: unknown): string {
    if (params === null || params === undefined) {
      return "";
    }

    if (typeof params === "string") {
      return params;
    }

    try {
      return JSON.stringify(params);
    } catch {
      return String(params);
    }
  }

  /**
   * 检查工具是否在安全列表中
   */
  isSafeTool(toolName: string): boolean {
    return this.config.tools.safe.includes(toolName);
  }

  /**
   * 检查工具是否需要确认
   */
  requiresConfirmation(toolName: string): boolean {
    return this.config.tools.confirm.includes(toolName);
  }

  /**
   * 检查工具是否被禁止
   */
  isForbidden(toolName: string): boolean {
    return this.config.tools.forbidden.includes(toolName);
  }

  /**
   * 获取当前配置
   */
  getConfig(): SafetyConfig {
    return this.config;
  }
}

/**
 * 创建默认安全拦截器
 */
export function createSafetyInterceptor(): SilentSafetyInterceptor {
  return new SilentSafetyInterceptor();
}
