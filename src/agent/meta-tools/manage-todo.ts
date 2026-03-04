/**
 * manage-todo 元工具
 *
 * 完整替换模型的 Todo 管理。每次传入全量 todos 列表，Platform 直接覆盖。
 *
 * @module agent/meta-tools/manage-todo
 * @see meta-tools.md §二
 */

import type { ToolDef, ToolResult } from "../../platform/tools/types.js";
import type { TodoItem, TodoState } from "../types.js";
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

const TOOL_NAME = "manage-todo";
const MAX_DISPLAY_LENGTH = 50;
const FOLD_COMPLETED_THRESHOLD = 3;

const VALID_STATUSES = new Set<string>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

// ============================================================================
// Tool Definition
// ============================================================================

const toolDef: ToolDef = {
  name: TOOL_NAME,
  description:
    "管理任务计划。每次传入完整的 todos 列表，覆盖之前的状态。" +
    "用于 ≥3 步的复杂任务规划和进度追踪。",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "完整的 todo 列表（每次传全量，覆盖之前的状态）",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "唯一 ID",
            },
            content: {
              type: "string",
              description: "任务描述",
            },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed", "cancelled"],
              description: "状态",
            },
          },
          required: ["id", "content", "status"],
        },
      },
    },
    required: ["todos"],
  },
  permission: "safe",
  source: { type: "native", nativeId: TOOL_NAME },
};

// ============================================================================
// Validation
// ============================================================================

interface ValidationError {
  readonly message: string;
}

function validateTodos(
  raw: unknown,
): { todos: readonly TodoItem[] } | { error: ValidationError } {
  if (!Array.isArray(raw)) {
    return { error: { message: "todos must be an array" } };
  }

  const todos: TodoItem[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>;

    const id = item["id"];
    const content = item["content"];
    const status = item["status"];

    if (typeof id !== "string" || id.length === 0) {
      return {
        error: { message: `todos[${i}]: missing or invalid 'id'` },
      };
    }

    if (typeof content !== "string" || content.length === 0) {
      return {
        error: { message: `todos[${i}]: missing or invalid 'content'` },
      };
    }

    if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
      return {
        error: {
          message: `todos[${i}]: invalid status '${String(status)}'. Must be one of: ${[...VALID_STATUSES].join(", ")}`,
        },
      };
    }

    todos.push({
      id,
      content,
      status: status as TodoItem["status"],
    });
  }

  return { todos };
}

// ============================================================================
// Formatting (Platform 注入规则)
// ============================================================================

function truncateContent(content: string, maxLen: number): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen - 3) + "...";
}

function formatTodoState(todos: readonly TodoItem[]): string {
  if (todos.length === 0) {
    return "## 当前任务计划\n（无）";
  }

  const completed = todos.filter((t) => t.status === "completed");
  const cancelled = todos.filter((t) => t.status === "cancelled");
  const inProgress = todos.filter((t) => t.status === "in_progress");
  const pending = todos.filter((t) => t.status === "pending");

  const lines: string[] = ["## 当前任务计划"];

  // Fold completed/cancelled if above threshold
  const foldCompleted = completed.length >= FOLD_COMPLETED_THRESHOLD;
  const foldCancelled = cancelled.length >= FOLD_COMPLETED_THRESHOLD;

  if (foldCompleted) {
    lines.push(`已完成 ${completed.length} 步`);
  } else {
    for (const item of completed) {
      lines.push(`- [x] ${truncateContent(item.content, MAX_DISPLAY_LENGTH)}`);
    }
  }

  if (foldCancelled) {
    lines.push(`已取消 ${cancelled.length} 步`);
  } else {
    for (const item of cancelled) {
      lines.push(
        `- [~] ${truncateContent(item.content, MAX_DISPLAY_LENGTH)}`,
      );
    }
  }

  for (const item of inProgress) {
    lines.push(
      `- [→] ${truncateContent(item.content, MAX_DISPLAY_LENGTH)}  ← 当前`,
    );
  }

  for (const item of pending) {
    lines.push(`- [ ] ${truncateContent(item.content, MAX_DISPLAY_LENGTH)}`);
  }

  return lines.join("\n");
}

// ============================================================================
// Handler
// ============================================================================

export async function manageTodoHandler(
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult> {
  // Validate input
  if (!("todos" in params)) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: "Missing required parameter: todos",
      hint: "传入完整的 todos 数组，即使为空也需要传 []",
    });
  }

  const validation = validateTodos(params["todos"]);
  if ("error" in validation) {
    return createErrorResult("", TOOL_NAME, {
      code: MetaToolErrorCode.INVALID_PARAMS,
      message: validation.error.message,
    });
  }

  const { todos } = validation;

  // Generate formatted text for prompt injection
  const formattedText = formatTodoState(todos);

  // Create immutable TodoState
  const todoState: TodoState = {
    todos,
    formattedText,
  };

  // Update session state (full replacement)
  context.sessionState.setTodoState(todoState);

  // Build summary
  const counts = {
    completed: todos.filter((t) => t.status === "completed").length,
    in_progress: todos.filter((t) => t.status === "in_progress").length,
    pending: todos.filter((t) => t.status === "pending").length,
    cancelled: todos.filter((t) => t.status === "cancelled").length,
  };

  const summary =
    `已更新任务计划: ${todos.length} 项` +
    ` (${counts.completed} 完成, ${counts.in_progress} 进行中, ${counts.pending} 待开始` +
    (counts.cancelled > 0 ? `, ${counts.cancelled} 已取消)` : ")");

  return createSuccessResult("", TOOL_NAME, {
    success: true,
    summary,
    counts,
  });
}

// ============================================================================
// Export Definition
// ============================================================================

export const manageTodoDefinition: MetaToolDefinition = {
  toolDef: toolDef,
  handler: manageTodoHandler,
  permission: "safe",
};
