/**
 * PermissionService - 统一权限判定
 * 位置: src/platform/permission-service.ts
 *
 * PS-1: 纯函数 check() — deny > confirm > allow > defaultLevel
 * PS-2: 结构化规则配置（tools/paths/shell）
 *
 * 职责: 只做判定，不做交互（ApprovalService 负责交互）
 */

import type { PermissionConfig } from "./types/config.js";

// ============ Types ============

export type PermissionDecision = "allow" | "confirm" | "deny";

export type PermissionAction =
  | "tool:execute"
  | "file:read"
  | "file:write"
  | "skill:manage"
  | "subagent:spawn"
  | "shell:execute"
  | "knowledge:write"
  | "mutation:submit";

export interface PermissionRequest {
  readonly action: PermissionAction;
  readonly subject: string;
  readonly context?: {
    readonly sessionId?: string;
    readonly userId?: string;
    readonly roleId?: string;
    readonly args?: Record<string, unknown>;
  };
}

export interface ToolPermissionAnnotation {
  readonly toolId: string;
  readonly permission: PermissionDecision;
}

// ============ Interface ============

export interface PermissionService {
  /** 判定单个操作的权限 */
  check(request: PermissionRequest): PermissionDecision;

  /** 批量获取工具的权限标注（供 Prompt 注入） */
  getToolAnnotations(
    toolIds: readonly string[],
  ): readonly ToolPermissionAnnotation[];
}

// ============ Options ============

export interface PermissionServiceOptions {
  readonly config: PermissionConfig;
}

// ============ Implementation ============

class PermissionServiceImpl implements PermissionService {
  private readonly config: PermissionConfig;
  private readonly defaultDecision: PermissionDecision;

  constructor(options: PermissionServiceOptions) {
    this.config = options.config;
    this.defaultDecision = this.mapLevelToDecision(
      this.config.defaultLevel,
    );
  }

  check(request: PermissionRequest): PermissionDecision {
    switch (request.action) {
      case "tool:execute":
        return this.checkTool(request.subject);
      case "file:read":
      case "file:write":
        return this.checkPath(request.subject);
      case "shell:execute":
        return this.checkShell(request.subject);
      default:
        return this.defaultDecision;
    }
  }

  getToolAnnotations(
    toolIds: readonly string[],
  ): readonly ToolPermissionAnnotation[] {
    return toolIds.map((toolId) => ({
      toolId,
      permission: this.checkTool(toolId),
    }));
  }

  // ============ Private ============

  private checkTool(toolName: string): PermissionDecision {
    // deny > confirm > safe > default
    if (this.config.tools.deny.includes(toolName)) {
      return "deny";
    }
    if (this.config.tools.confirm.includes(toolName)) {
      return "confirm";
    }
    if (this.config.tools.safe.includes(toolName)) {
      return "allow";
    }
    return this.defaultDecision;
  }

  private checkPath(filePath: string): PermissionDecision {
    // deny > confirm > allow > default
    if (this.matchAnyPattern(filePath, this.config.paths.deny)) {
      return "deny";
    }
    if (this.matchAnyPattern(filePath, this.config.paths.confirm)) {
      return "confirm";
    }
    if (this.matchAnyPattern(filePath, this.config.paths.allow)) {
      return "allow";
    }
    return this.defaultDecision;
  }

  private checkShell(command: string): PermissionDecision {
    // deny > confirm > default
    for (const pattern of this.config.shell.denyPatterns) {
      if (command.includes(pattern)) {
        return "deny";
      }
    }
    for (const pattern of this.config.shell.confirmPatterns) {
      if (command.includes(pattern)) {
        return "confirm";
      }
    }
    return this.defaultDecision;
  }

  /**
   * 轻量 glob 匹配
   * 支持: ** (任意路径), * (单级匹配)
   */
  private matchAnyPattern(
    filePath: string,
    patterns: readonly string[],
  ): boolean {
    return patterns.some((pattern) => matchGlob(pattern, filePath));
  }

  private mapLevelToDecision(
    level: "safe" | "confirm" | "deny",
  ): PermissionDecision {
    switch (level) {
      case "safe":
        return "allow";
      case "confirm":
        return "confirm";
      case "deny":
        return "deny";
    }
  }
}

// ============ Glob Matcher ============

/**
 * 轻量 glob 匹配函数
 *
 * 支持:
 * - `**` 匹配任意路径段（包括多级）
 * - `*` 匹配单个路径段内的任意字符
 * - 精确匹配
 *
 * 不引入 minimatch 依赖，patterns 足够简单。
 */
export function matchGlob(pattern: string, target: string): boolean {
  // 将 glob pattern 转为正则
  const regexStr = pattern
    // 转义特殊正则字符（除 * 外）
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // ** 匹配任意路径（先处理 **，再处理 *）
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    // * 匹配非分隔符的任意字符
    .replace(/\*/g, "[^/]*")
    // 还原 globstar
    .replace(/<<GLOBSTAR>>/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(target);
}

// ============ Factory ============

export function createPermissionService(
  options: PermissionServiceOptions,
): PermissionService {
  return new PermissionServiceImpl(options);
}
