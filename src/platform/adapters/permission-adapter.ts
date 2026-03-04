/**
 * PermissionAdapter - PermissionService → PermissionPort
 *
 * 适配 Platform 的 PermissionService 到 Agent 的 PermissionPort 接口。
 * - sync check() 包装为 async
 * - PermissionDecision 扩展为 PermissionResult
 * - ToolPermissionAnnotation 字段映射 (toolId→toolName, "allow"→"safe")
 *
 * @module platform/adapters/permission-adapter
 */

import type {
  PermissionPort,
  PermissionResult,
  ToolPermissionAnnotation as PortToolAnnotation,
} from "../../agent/ports/platform-services.js";
import type {
  PermissionService,
  PermissionDecision,
} from "../permission-service.js";

// ============================================================================
// Decision Mapping
// ============================================================================

function decisionToLevel(decision: PermissionDecision): "safe" | "confirm" | "deny" {
  switch (decision) {
    case "allow":
      return "safe";
    case "confirm":
      return "confirm";
    case "deny":
      return "deny";
  }
}

// ============================================================================
// Adapter
// ============================================================================

export class PermissionAdapter implements PermissionPort {
  private readonly service: PermissionService;

  constructor(service: PermissionService) {
    this.service = service;
  }

  async check(
    toolName: string,
    args: unknown,
    sessionId: string,
  ): Promise<PermissionResult> {
    const decision = this.service.check({
      action: "tool:execute",
      subject: toolName,
      context: {
        sessionId,
        args: args as Record<string, unknown>,
      },
    });

    const base = {
      level: decision,
      allowed: decision !== "deny",
      requiresConfirmation: decision === "confirm",
    } as const;

    if (decision === "deny") {
      return { ...base, reason: `Permission denied for tool: ${toolName}` };
    }

    return base;
  }

  getToolAnnotation(toolName: string): PortToolAnnotation {
    const annotations = this.service.getToolAnnotations([toolName]);
    const found = annotations[0];

    if (found === undefined) {
      return { toolName, level: "confirm" };
    }

    return {
      toolName: found.toolId,
      level: decisionToLevel(found.permission),
    };
  }

  getToolAnnotations(
    toolNames: string[],
  ): Record<string, PortToolAnnotation> {
    const annotations = this.service.getToolAnnotations(toolNames);

    const result: Record<string, PortToolAnnotation> = {};
    for (const ann of annotations) {
      result[ann.toolId] = {
        toolName: ann.toolId,
        level: decisionToLevel(ann.permission),
      };
    }

    // Fill in missing tools with default
    for (const name of toolNames) {
      if (!(name in result)) {
        result[name] = { toolName: name, level: "confirm" };
      }
    }

    return result;
  }
}
