/**
 * SkillManagerApplicator
 * 位置: src/evolution/applicators/skill-manager-applicator.ts
 *
 * 将 skill/skill-extension 类 mutation 路由到 SkillManagerPort
 */

import type { MutationResult, ValidatedMutation } from "../types.js";
import type { MutationApplicator } from "./types.js";

export interface SkillManagerTarget {
  createDraft(skillData: Record<string, unknown>): Promise<string>;
  confirmDraft(draftId: string): Promise<void>;
  archive(skillId: string, reason: string): Promise<void>;
}

export function createSkillManagerApplicator(
  manager: SkillManagerTarget,
): MutationApplicator {
  return {
    targetSystem: "skill-manager",

    async apply(mutation: ValidatedMutation): Promise<MutationResult> {
      const { action, payload, reason } = mutation.content;
      const p = payload as Record<string, unknown>;

      switch (action) {
        case "create":
        case "update": {
          // D15 草稿模式: 创建草稿，不直接确认
          const draftId = await manager.createDraft(p);
          return { status: "pending-approval", approvalId: draftId };
        }
        case "archive": {
          const skillId = mutation.target.existingId ?? String(p["id"] ?? "");
          await manager.archive(skillId, reason);
          return { status: "applied", id: skillId, action: "archive" };
        }
        default:
          return { status: "rejected", reason: `Unsupported action: ${action}` };
      }
    },
  };
}
