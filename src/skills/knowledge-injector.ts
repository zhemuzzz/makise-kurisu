/**
 * Knowledge Injector
 *
 * 将激活的 Skills 的知识注入到 Prompt 中
 */

import type { SkillInstance, SkillExample } from "./types";

/**
 * 知识注入配置
 */
export interface KnowledgeInjectorConfig {
  /** 最大 Few-Shot 示例数 */
  maxExamples?: number;
  /** 示例格式 */
  exampleFormat?: "chat" | "prompt";
  /** 是否包含工具说明 */
  includeToolDescriptions?: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<KnowledgeInjectorConfig> = {
  maxExamples: 3,
  exampleFormat: "chat",
  includeToolDescriptions: true,
};

/**
 * 知识注入器
 *
 * 负责：
 * 1. 将 skill.context 注入到 System Prompt
 * 2. 将 skill.examples 格式化为 Few-Shot 示例
 * 3. 可选地包含工具使用说明
 */
export class KnowledgeInjector {
  private config: Required<KnowledgeInjectorConfig>;

  constructor(config: KnowledgeInjectorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 构建知识注入内容
   *
   * @param skills - 激活的 Skills
   * @returns 注入到 Prompt 的内容
   */
  inject(skills: readonly SkillInstance[]): string {
    if (skills.length === 0) {
      return "";
    }

    const parts: string[] = [];

    // 1. 注入每个 Skill 的 context
    for (const skill of skills) {
      if (skill.config.context) {
        parts.push(this.formatContext(skill.config.context, skill.config.name));
      }
    }

    // 2. 注入 Few-Shot 示例
    const allExamples = this.collectExamples(skills);
    if (allExamples.length > 0) {
      parts.push(this.formatExamples(allExamples));
    }

    // 3. 注入工具说明（可选）
    if (this.config.includeToolDescriptions) {
      const toolDescriptions = this.collectToolDescriptions(skills);
      if (toolDescriptions.length > 0) {
        parts.push(this.formatToolDescriptions(toolDescriptions));
      }
    }

    return parts.filter(Boolean).join("\n\n");
  }

  /**
   * 构建 System Prompt（更完整的格式）
   */
  buildSystemPrompt(
    skills: readonly SkillInstance[],
    baseSystemPrompt?: string,
  ): string {
    const injected = this.inject(skills);

    if (!injected) {
      return baseSystemPrompt ?? "";
    }

    const parts: string[] = [];

    if (baseSystemPrompt) {
      parts.push(baseSystemPrompt);
    }

    parts.push("---");
    parts.push("## 激活的技能");
    parts.push(injected);

    return parts.join("\n");
  }

  /**
   * 格式化 context
   */
  private formatContext(context: string, skillName: string): string {
    return `### ${skillName}\n${context}`;
  }

  /**
   * 收集所有 Skills 的示例
   */
  private collectExamples(
    skills: readonly SkillInstance[],
  ): readonly SkillExample[] {
    const examples: SkillExample[] = [];

    for (const skill of skills) {
      if (skill.config.examples) {
        // 限制每个 Skill 的示例数
        const skillExamples = skill.config.examples.slice(
          0,
          this.config.maxExamples,
        );
        examples.push(...skillExamples);
      }
    }

    // 限制总示例数
    return examples.slice(0, this.config.maxExamples * 2);
  }

  /**
   * 格式化 Few-Shot 示例
   */
  private formatExamples(examples: readonly SkillExample[]): string {
    if (examples.length === 0) return "";

    const parts: string[] = ["### 对话示例"];
    parts.push("");
    parts.push("以下是一些相关示例：");
    parts.push("");

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      if (!example) continue;

      if (this.config.exampleFormat === "chat") {
        parts.push(`**示例 ${i + 1}:**`);
        parts.push(`用户: ${example.user}`);
        parts.push(`助手: ${example.assistant}`);

        // 如果有工具调用，添加工具说明
        if (example.toolCalls && example.toolCalls.length > 0) {
          parts.push("");
          parts.push("*工具调用:*");
          for (const call of example.toolCalls) {
            parts.push(`- ${call.name}(${JSON.stringify(call.arguments)})`);
          }
        }

        parts.push("");
      } else {
        // prompt 格式
        parts.push(`Input: ${example.user}`);
        parts.push(`Output: ${example.assistant}`);
        parts.push("");
      }
    }

    return parts.join("\n");
  }

  /**
   * 收集工具描述
   */
  private collectToolDescriptions(
    skills: readonly SkillInstance[],
  ): readonly string[] {
    const descriptions: string[] = [];
    const seenTools = new Set<string>();

    for (const skill of skills) {
      for (const tool of skill.toolDefs) {
        if (!seenTools.has(tool.name)) {
          seenTools.add(tool.name);
          descriptions.push(`- **${tool.name}**: ${tool.description}`);
        }
      }
    }

    return descriptions;
  }

  /**
   * 格式化工具描述
   */
  private formatToolDescriptions(descriptions: readonly string[]): string {
    if (descriptions.length === 0) return "";

    const parts: string[] = ["### 可用工具"];
    parts.push("");
    parts.push("你可以使用以下工具：");
    parts.push("");
    parts.push(...descriptions);

    return parts.join("\n");
  }

  /**
   * 构建工具定义（用于 LLM function calling）
   */
  buildToolDefinitions(skills: readonly SkillInstance[]): readonly {
    name: string;
    description: string;
    parameters: unknown;
  }[] {
    const tools: { name: string; description: string; parameters: unknown }[] =
      [];
    const seenTools = new Set<string>();

    for (const skill of skills) {
      for (const tool of skill.toolDefs) {
        if (!seenTools.has(tool.name)) {
          seenTools.add(tool.name);
          tools.push({
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          });
        }
      }
    }

    return tools;
  }
}

/**
 * 创建 Knowledge Injector 实例
 */
export function createKnowledgeInjector(
  config?: KnowledgeInjectorConfig,
): KnowledgeInjector {
  return new KnowledgeInjector(config);
}
