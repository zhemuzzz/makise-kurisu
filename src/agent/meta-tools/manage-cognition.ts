/**
 * manage-cognition 元工具
 *
 * 角色的"活跃认知笔记本"。每次更新为快照覆写（不是追加），
 * 容量上限 ~2000 tokens，强制 LLM 做取舍。
 *
 * @module agent/meta-tools/manage-cognition
 * @see KURISU-040 Phase A
 */

import type { ToolDef, ToolResult } from "../../platform/tools/types.js";
import type { CognitionState } from "../types.js";
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

const TOOL_NAME = "manage-cognition";

/** 容量上限 (~2000 tokens ≈ 6000 字符，中文约 3 字符/token) */
const MAX_CONTENT_CHARS = 6000;

/** Token 估算除数 (与 ContextManager 一致) */
const TOKEN_ESTIMATE_DIVISOR = 3;

// ============================================================================
// Tool Definition
// ============================================================================

const toolDef: ToolDef = {
  name: TOOL_NAME,
  description:
    "读取或更新我的认知笔记。" +
    "action=read 返回当前认知内容；" +
    "action=write 覆写全部认知（快照式，不是追加）。" +
    "认知笔记上限约 2000 tokens，写入时请精炼内容。",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "write"],
        description: "操作类型: read（读取） 或 write（覆写）",
      },
      content: {
        type: "string",
        description: "新的认知内容（仅 write 时需要，Markdown 格式）",
      },
    },
    required: ["action"],
  },
  permission: "safe",
  source: { type: "native", nativeId: TOOL_NAME },
};

// ============================================================================
// Validation
// ============================================================================

interface ValidatedInput {
  readonly action: "read" | "write";
  readonly content?: string;
}

function validateInput(
  params: Record<string, unknown>,
): ValidatedInput | { error: string } {
  const action = params["action"];
  if (action !== "read" && action !== "write") {
    return { error: "action must be 'read' or 'write'" };
  }

  if (action === "write") {
    const content = params["content"];
    if (typeof content !== "string" || content.length === 0) {
      return { error: "write action requires non-empty 'content'" };
    }
    return { action, content };
  }

  return { action };
}

// ============================================================================
// Formatting
// ============================================================================

function formatCognitionBlock(content: string): string {
  return `## 我的认知笔记\n\n${content}`;
}

function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / TOKEN_ESTIMATE_DIVISOR);
}

// ============================================================================
// Handler
// ============================================================================

export async function manageCognitionHandler(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  const validated = validateInput(params);
  if ("error" in validated) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: validated.error,
    });
  }

  // READ
  if (validated.action === "read") {
    const current = context.sessionState.getCognitionState();
    if (!current) {
      return createSuccessResult("", TOOL_NAME, {
        success: true,
        action: "read",
        content: "",
        message: "认知笔记为空",
      });
    }
    return createSuccessResult("", TOOL_NAME, {
      success: true,
      action: "read",
      content: current.content,
      tokens: estimateTokens(current.content),
    });
  }

  // WRITE
  const content = validated.content!;

  // 容量检查
  if (content.length > MAX_CONTENT_CHARS) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: `内容超过上限: ${content.length} 字符 (上限 ${MAX_CONTENT_CHARS})。请精炼内容后重试。`,
      hint: `当前约 ${estimateTokens(content)} tokens，上限约 ${estimateTokens(MAX_CONTENT_CHARS.toString())} tokens`,
    });
  }

  // 创建不可变状态
  const cognitionState: CognitionState = {
    content,
    formattedText: formatCognitionBlock(content),
  };

  // 更新 session 状态（快照覆写）
  context.sessionState.setCognitionState(cognitionState);

  const tokens = estimateTokens(content);
  return createSuccessResult("", TOOL_NAME, {
    success: true,
    action: "write",
    tokens,
    message: `认知已更新 (${tokens} tokens)`,
  });
}

// ============================================================================
// Export Definition
// ============================================================================

export const manageCognitionDefinition: MetaToolDefinition = {
  toolDef,
  handler: manageCognitionHandler,
  permission: "safe",
};
