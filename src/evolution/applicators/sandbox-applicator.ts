/**
 * SandboxApplicator
 * 位置: src/evolution/applicators/sandbox-applicator.ts
 *
 * 将 code 类 mutation 路由到 ToolExecutorPort（文件写入）
 */

import type { MutationResult, ValidatedMutation } from "../types.js";
import type { MutationApplicator } from "./types.js";

export interface SandboxTarget {
  execute(
    command: string,
    options?: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string; exitCode: number }>;
}

export function createSandboxApplicator(
  executor: SandboxTarget,
): MutationApplicator {
  return {
    targetSystem: "sandbox",

    async apply(mutation: ValidatedMutation): Promise<MutationResult> {
      const { action, payload } = mutation.content;
      const p = payload as Record<string, unknown>;

      switch (action) {
        case "create":
        case "update": {
          const code = String(p["code"] ?? p["content"] ?? "");
          const filePath = String(p["path"] ?? mutation.target.path ?? "script.ts");
          const result = await executor.execute(
            `cat > ${filePath} << 'MUTATION_EOF'\n${code}\nMUTATION_EOF`,
            { timeout: 30000 },
          );
          if (result.success) {
            return { status: "applied", id: mutation.id, action };
          }
          return { status: "rejected", reason: `Sandbox write failed: ${result.output}` };
        }
        default:
          return { status: "rejected", reason: `Unsupported action: ${action}` };
      }
    },
  };
}
