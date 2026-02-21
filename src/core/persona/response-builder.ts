/**
 * 响应构建器
 *
 * 职责：将结构化安全错误转换为角色风格表达
 *
 * 关键设计：
 * - 角色不知道"安全规则"的存在
 * - 角色只是用自己方式回应"执行失败"这个事实
 */

import type { SafetyError } from "../safety/types";
import type { PersonaConfig } from "./soul-types";

/**
 * 响应构建器
 * 将安全错误转换为角色风格的表达
 */
export class ResponseBuilder {
  constructor(private readonly persona: PersonaConfig) {}

  /**
   * 从安全错误构建响应
   * 角色用自己方式表达，不提及"安全规则"
   */
  buildFromSafetyError(error: SafetyError): string {
    switch (error.code) {
      case "NEED_CONFIRMATION":
        return this.generateConfirmationPrompt(error.toolName);
      case "FORBIDDEN":
        return this.generateForbiddenResponse(error.toolName);
      case "UNAUTHORIZED":
        return this.generateUnauthorizedResponse();
      case "RATE_LIMITED":
        return this.generateRateLimitedResponse();
      default:
        return this.generateGenericErrorResponse();
    }
  }

  /**
   * 生成确认提示
   */
  private generateConfirmationPrompt(toolName: string): string {
    const patterns = this.persona.speech.patterns;
    const confirmations = patterns["when_confirming_dangerous"] ??
      patterns["when_confirming"] ?? [
        "等一下...你确定？",
        "这个...真的要做吗？",
      ];

    const index = this.deterministicIndex(toolName, confirmations.length);
    return confirmations[index] ?? confirmations[0]!;
  }

  /**
   * 生成禁止响应
   */
  private generateForbiddenResponse(toolName: string): string {
    const patterns = this.persona.speech.patterns;
    const responses = patterns["when_refusing"] ??
      patterns["when_forbidden"] ?? [
        "这个我做不了。别问我为什么。",
        "...你是认真的吗？这种事我不会做的。",
      ];

    const index = this.deterministicIndex(toolName, responses.length);
    return responses[index] ?? responses[0]!;
  }

  /**
   * 生成未授权响应
   */
  private generateUnauthorizedResponse(): string {
    return "...不行。";
  }

  /**
   * 生成频率限制响应
   */
  private generateRateLimitedResponse(): string {
    return "等一下，太快了。";
  }

  /**
   * 生成通用错误响应
   */
  private generateGenericErrorResponse(): string {
    return "...出问题了。";
  }

  /**
   * 确定性索引选择
   * 相同输入产生相同输出
   */
  private deterministicIndex(input: string, max: number): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % max;
  }

  /**
   * 包装工具输出
   * 将工具的正常输出转换为角色风格
   */
  wrapToolOutput(result: string, _toolName: string): string {
    const catchphrases = this.persona.speech.catchphrases;

    // 如果没有口癖，直接返回
    if (catchphrases.length === 0) {
      return result;
    }

    // 随机选择一个口癖前缀（确定性）
    const index = this.deterministicIndex(result, catchphrases.length);
    const prefix = catchphrases[index];

    // 返回带角色风格的输出
    return `${prefix}，${result}`;
  }
}
