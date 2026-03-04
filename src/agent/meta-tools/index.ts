/**
 * Meta-tools 入口
 *
 * 导出所有元工具定义和注册函数
 *
 * @module agent/meta-tools
 */

import { manageTodoDefinition } from "./manage-todo.js";
import { findSkillDefinition } from "./find-skill.js";
import { manageSkillDefinition } from "./manage-skill.js";
import { spawnSubAgentDefinition } from "./spawn-sub-agent.js";
import type { MetaToolDefinition, MetaToolContext } from "./types.js";
import type { ToolDef, ToolResult } from "../../platform/tools/types.js";

// ============================================================================
// All meta-tool definitions
// ============================================================================

/**
 * 所有元工具定义（不可变数组）
 */
export const META_TOOL_DEFINITIONS: readonly MetaToolDefinition[] = [
  manageTodoDefinition,
  findSkillDefinition,
  manageSkillDefinition,
  spawnSubAgentDefinition,
] as const;

/**
 * 元工具名称→定义映射
 */
const META_TOOL_MAP: ReadonlyMap<string, MetaToolDefinition> = new Map(
  META_TOOL_DEFINITIONS.map((def) => [def.toolDef.name, def]),
);

// ============================================================================
// Registration helpers
// ============================================================================

/**
 * 获取所有元工具的 ToolDef（用于 LLM 工具列表）
 */
export function getMetaToolDefs(): readonly ToolDef[] {
  return META_TOOL_DEFINITIONS.map((def) => def.toolDef);
}

/**
 * 检查是否为元工具
 */
export function isMetaTool(toolName: string): boolean {
  return META_TOOL_MAP.has(toolName);
}

/**
 * 执行元工具
 *
 * @param toolName - 工具名称
 * @param params - 工具参数
 * @param context - 元工具上下文
 * @returns 执行结果，如果不是元工具则返回 undefined
 */
export async function executeMetaTool(
  toolName: string,
  params: Record<string, unknown>,
  context: MetaToolContext,
): Promise<ToolResult | undefined> {
  const definition = META_TOOL_MAP.get(toolName);
  if (!definition) return undefined;

  return definition.handler(params, context);
}

/**
 * 获取元工具的权限级别
 */
export function getMetaToolPermission(
  toolName: string,
): "safe" | "confirm" | "deny" | undefined {
  return META_TOOL_MAP.get(toolName)?.permission;
}

// ============================================================================
// Re-exports
// ============================================================================

export type { MetaToolDefinition, MetaToolContext, SessionState } from "./types.js";
export { manageTodoDefinition } from "./manage-todo.js";
export { findSkillDefinition } from "./find-skill.js";
export { manageSkillDefinition } from "./manage-skill.js";
export { spawnSubAgentDefinition } from "./spawn-sub-agent.js";
