/**
 * ConfigApplicator — stub (Phase 6)
 * 位置: src/evolution/applicators/config-applicator.ts
 *
 * 配置变更目前不支持直接应用，返回 not-supported
 */

import type { MutationResult, ValidatedMutation } from "../types.js";
import type { MutationApplicator } from "./types.js";

export function createConfigApplicator(): MutationApplicator {
  return {
    targetSystem: "config-manager",

    async apply(_mutation: ValidatedMutation): Promise<MutationResult> {
      return {
        status: "rejected",
        reason: "Config mutations not yet supported (Phase 6)",
      };
    },
  };
}
