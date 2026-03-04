/**
 * manage-skill 元工具
 *
 * Skill 生命周期管理: create / update / archive
 * 所有写操作需 confirm 权限。
 *
 * @module agent/meta-tools/manage-skill
 * @see meta-tools.md §五
 */

import type { ToolDef, ToolResult } from "../../platform/tools/types.js";
import type { SkillDraft } from "../ports/platform-services.js";
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

const TOOL_NAME = "manage-skill";

const VALID_ACTIONS = new Set(["create", "update", "archive"]);

// ============================================================================
// Tool Definition
// ============================================================================

const toolDef: ToolDef = {
  name: TOOL_NAME,
  description:
    "管理 Skill 生命周期。支持三种操作: " +
    "create（创建新 Skill 草稿）、update（更新已有 Skill）、archive（归档 Skill）。" +
    "所有操作需用户确认后生效。建议先用 find-skill 搜索。",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "archive"],
        description: "操作类型",
      },
      skill_id: {
        type: "string",
        description: "Skill ID（update/archive 时必填）",
      },
      draft: {
        type: "object",
        description: "Skill 草稿（create/update 时必填）",
        properties: {
          name: { type: "string", description: "Skill 名称" },
          description: { type: "string", description: "Skill 描述" },
          category: { type: "string", description: "分类" },
          knowledge: { type: "string", description: "知识内容" },
          tools: { type: "object", description: "工具配置" },
          examples: {
            type: "array",
            description: "示例",
            items: {
              type: "object",
              properties: {
                user: { type: "string" },
                assistant: { type: "string" },
              },
            },
          },
        },
      },
      reason: {
        type: "string",
        description: "归档原因（archive 时必填）",
      },
    },
    required: ["action"],
  },
  permission: "confirm",
  source: { type: "native", nativeId: TOOL_NAME },
};

// ============================================================================
// Validation
// ============================================================================

function validateDraft(
  raw: unknown,
): { draft: SkillDraft } | { error: string } {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { error: "Missing required parameter: draft" };
  }

  const obj = raw as Record<string, unknown>;
  const name = obj["name"];
  const description = obj["description"];
  const category = obj["category"];
  const knowledge = obj["knowledge"];

  if (typeof name !== "string" || name.length === 0) {
    return { error: "draft.name is required" };
  }
  if (typeof description !== "string" || description.length === 0) {
    return { error: "draft.description is required" };
  }
  if (typeof category !== "string" || category.length === 0) {
    return { error: "draft.category is required" };
  }

  const draft: SkillDraft = {
    name,
    description,
    category,
  };

  // Optional fields
  if (typeof knowledge === "string") {
    return { draft: { ...draft, knowledge } };
  }

  return { draft };
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleCreate(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  const validation = validateDraft(params["draft"]);
  if ("error" in validation) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: validation.error,
    });
  }

  try {
    const draftId = await context.skills.createDraft(validation.draft);
    return createSuccessResult("", TOOL_NAME, {
      success: true,
      draftId,
      message: `已创建 Skill 草稿「${validation.draft.name}」，等待确认`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.EXECUTION_FAILED,
      message,
    });
  }
}

async function handleUpdate(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  const skillId = params["skill_id"];
  if (typeof skillId !== "string" || skillId.length === 0) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: "Missing required parameter: skill_id (for update)",
    });
  }

  const validation = validateDraft(params["draft"]);
  if ("error" in validation) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: validation.error,
    });
  }

  try {
    const draftId = await context.skills.createDraft(validation.draft);
    return createSuccessResult("", TOOL_NAME, {
      success: true,
      draftId,
      skillId,
      message: `已创建 Skill「${skillId}」的更新草稿，等待确认`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.EXECUTION_FAILED,
      message,
    });
  }
}

async function handleArchive(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  const skillId = params["skill_id"];
  if (typeof skillId !== "string" || skillId.length === 0) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: "Missing required parameter: skill_id (for archive)",
    });
  }

  const reason = params["reason"];
  if (typeof reason !== "string" || reason.length === 0) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: "Missing required parameter: reason (for archive)",
      hint: "请说明为什么要归档这个 Skill",
    });
  }

  try {
    const archived = await context.skills.archive(skillId, reason);
    if (!archived) {
      return createErrorResult("", TOOL_NAME, {
        code: MetaToolErrorCode.EXECUTION_FAILED,
        message: `归档 Skill「${skillId}」失败`,
        hint: "Skill 可能不存在或已被归档",
      });
    }
    return createSuccessResult("", TOOL_NAME, {
      success: true,
      skillId,
      message: `已归档 Skill「${skillId}」: ${reason}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.EXECUTION_FAILED,
      message,
    });
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export async function manageSkillHandler(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  const action = params["action"];

  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: `Invalid action: ${String(action)}. Must be one of: create, update, archive`,
    });
  }

  switch (action) {
    case "create":
      return handleCreate(params, context);
    case "update":
      return handleUpdate(params, context);
    case "archive":
      return handleArchive(params, context);
    default:
      return createErrorResult("", TOOL_NAME, {
        code: MetaToolErrorCode.INVALID_PARAMS,
        message: `Unknown action: ${action}`,
      });
  }
}

// ============================================================================
// Export Definition
// ============================================================================

export const manageSkillDefinition: MetaToolDefinition = {
  toolDef: toolDef,
  handler: manageSkillHandler,
  permission: "confirm",
};
