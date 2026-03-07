/**
 * spawn-sub-agent 元工具
 *
 * 委派复杂任务给 Sub-Agent，等待结果返回。
 *
 * @module agent/meta-tools/spawn-sub-agent
 * @see meta-tools.md §三, sub-agent.md SA-10
 */

import type { ToolDef, ToolResult } from "../../platform/tools/types.js";
import type { SubAgentConfig } from "../ports/platform-services.js";
import type {
  MetaToolContext,
  MetaToolDefinition,
} from "./types.js";
import {
  MetaToolErrorCode,
  createSuccessResult,
  createErrorResult,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const TOOL_NAME = "spawn-sub-agent";

// ============================================================================
// Tool Definition
// ============================================================================

const toolDef: ToolDef = {
  name: TOOL_NAME,
  description:
    "委派复杂子任务给 Sub-Agent。Sub-Agent 会使用指定的 Skills 独立执行任务并返回结果。" +
    "适用于: 需要长时间执行的独立子任务、需要特定 Skill 的专项任务。",
  inputSchema: {
    type: "object",
    properties: {
      task_goal: {
        type: "string",
        description: "任务目标描述（清晰、具体）",
      },
      skill_ids: {
        type: "array",
        description: "分配给 Sub-Agent 的 Skill ID 列表",
        items: { type: "string" },
      },
      model: {
        type: "string",
        description:
          "覆盖默认模型。通常不需要指定 — 系统根据 skill 自动选择。" +
          "仅在 skill 默认模型不适合当前任务时才指定。",
      },
      template_id: {
        type: "string",
        description: "Sub-Agent 模板 ID（可选）",
      },
      context_slice: {
        type: "array",
        description: "上下文切片（相关对话历史）",
        items: { type: "object" },
      },
      max_iterations: {
        type: "number",
        description: "最大迭代次数（默认 15）",
      },
      timeout: {
        type: "number",
        description: "超时时间（毫秒，默认 60000）",
      },
      return_format: {
        type: "string",
        enum: ["structured", "natural"],
        description: "返回格式（默认 natural）",
      },
    },
    required: ["task_goal"],
  },
  permission: "safe",
  source: { type: "native", nativeId: TOOL_NAME },
};

// ============================================================================
// Handler
// ============================================================================

export async function spawnSubAgentHandler(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  // Validate task_goal
  const taskGoal = params["task_goal"];
  if (typeof taskGoal !== "string" || taskGoal.length === 0) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: "Missing or invalid required parameter: task_goal (string)",
      hint: "请提供清晰、具体的任务目标描述",
    });
  }

  const contextSlice = params["context_slice"];
  const skillIds = params["skill_ids"];
  const maxIterations = params["max_iterations"];
  const timeout = params["timeout"];
  const returnFormat = params["return_format"];
  const modelParam = params["model"];

  // 模型选择优先级: (1) LLM 显式指定 → (2) Skill 声明默认 → (3) undefined（走 defaults.main）
  let resolvedModelId: string | undefined;
  if (typeof modelParam === "string" && modelParam.length > 0) {
    // (1) LLM 显式指定
    resolvedModelId = modelParam;
  } else if (Array.isArray(skillIds) && skillIds.length > 0) {
    // (2) 查询第一个 skill 的声明模型
    const firstSkillId = skillIds[0] as string;
    const skillModel = context.skills.getSkillModel?.(firstSkillId);
    if (skillModel) {
      resolvedModelId = skillModel;
    }
  }

  // Build SubAgentConfig (exactOptionalPropertyTypes: no undefined assignment)
  const baseConfig = {
    parentAgentId: context.agentId,
    sessionId: context.sessionId,
    taskGoal,
    contextSlice: Array.isArray(contextSlice)
      ? contextSlice
      : [],
    skillIds: Array.isArray(skillIds)
      ? (skillIds as string[])
      : [],
    returnFormat:
      (returnFormat === "structured" ? "structured" : "natural") as SubAgentConfig["returnFormat"],
  };

  // Build config with optional fields (exactOptionalPropertyTypes)
  const optionalFields: Record<string, unknown> = {};
  if (typeof maxIterations === "number") optionalFields["maxIterations"] = maxIterations;
  if (typeof timeout === "number") optionalFields["timeout"] = timeout;
  if (resolvedModelId !== undefined) optionalFields["modelId"] = resolvedModelId;

  const config: SubAgentConfig = { ...baseConfig, ...optionalFields } as SubAgentConfig;

  try {
    // Spawn sub-agent
    const subAgentId = await context.subAgents.spawn(config);

    // Await result (blocking)
    const subResult = await context.subAgents.awaitResult(
      subAgentId,
      undefined,
    );

    if (subResult.success) {
      return createSuccessResult("", TOOL_NAME, {
        success: true,
        subAgentId,
        result: subResult.result,
        stats: subResult.stats,
      });
    }

    // Sub-agent failed
    return createErrorResult("", TOOL_NAME, {
      code:
        subResult.error?.code === "TIMEOUT"
          ? MetaToolErrorCode.TIMEOUT
          : MetaToolErrorCode.EXECUTION_FAILED,
      message: subResult.error?.message ?? "Sub-Agent 执行失败",
      hint: "可以尝试简化任务目标或增加超时时间",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.EXECUTION_FAILED,
      message,
      hint: "Sub-Agent 创建或执行过程出错",
    });
  }
}

// ============================================================================
// Dynamic Tool Definition
// ============================================================================

/**
 * 生成工具定义（注入运行时可用模型列表到 model.enum）
 */
export function getSpawnSubAgentToolDef(availableModels: string[]): ToolDef {
  if (availableModels.length === 0) {
    return toolDef;
  }

  const schema = { ...toolDef.inputSchema };
  const props = { ...(schema.properties ?? {}) };
  props["model"] = {
    type: "string",
    enum: availableModels,
    description:
      "覆盖默认模型。通常不需要指定 — 系统根据 skill 自动选择。" +
      "仅在 skill 默认模型不适合当前任务时才指定。",
  };

  return { ...toolDef, inputSchema: { ...schema, properties: props } };
}

// ============================================================================
// Export Definition
// ============================================================================

export const spawnSubAgentDefinition: MetaToolDefinition = {
  toolDef: toolDef,
  handler: spawnSubAgentHandler,
  permission: "safe",
};
