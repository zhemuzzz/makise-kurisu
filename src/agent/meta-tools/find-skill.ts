/**
 * find-skill 元工具
 *
 * 只读 Skill 搜索，委派给 SkillManagerPort.findSkill()
 *
 * @module agent/meta-tools/find-skill
 * @see meta-tools.md §2.5
 */

import type { ToolDef, ToolResult } from "../../platform/tools/types.js";
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

const TOOL_NAME = "find-skill";

// ============================================================================
// Tool Definition
// ============================================================================

const toolDef: ToolDef = {
  name: TOOL_NAME,
  description:
    "搜索可用的 Skill。返回匹配的 Skill 列表（包含 ID、名称、描述、分类、状态）。" +
    "用于发现新能力或查找已归档的 Skill。",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "搜索关键词",
      },
      limit: {
        type: "number",
        description: "返回数量限制（默认 10）",
      },
    },
    required: ["query"],
  },
  permission: "safe",
  source: { type: "native", nativeId: TOOL_NAME },
};

// ============================================================================
// Handler
// ============================================================================

export async function findSkillHandler(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  // Validate input
  const rawQuery = params["query"];
  if (typeof rawQuery !== "string" || rawQuery.length === 0) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: "Missing or invalid required parameter: query (string)",
    });
  }

  const query = rawQuery;
  const rawLimit = params["limit"];
  const limit =
    typeof rawLimit === "number" && rawLimit > 0
      ? rawLimit
      : undefined;

  try {
    const results = await context.skills.findSkill(query, limit);

    return createSuccessResult("", TOOL_NAME, {
      success: true,
      results,
      count: results.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.EXECUTION_FAILED,
      message,
      hint: "Skill 搜索服务可能暂时不可用，稍后重试",
    });
  }
}

// ============================================================================
// Export Definition
// ============================================================================

export const findSkillDefinition: MetaToolDefinition = {
  toolDef: toolDef,
  handler: findSkillHandler,
  permission: "safe",
};
