/**
 * RoutineRegistryApplicator
 * 位置: src/evolution/applicators/routine-registry-applicator.ts
 *
 * 将 routine 类 mutation 路由到 RoutineSystem
 */

import type { MutationResult, ValidatedMutation } from "../types.js";
import type { MutationApplicator } from "./types.js";

export interface RoutineRegistryTarget {
  add(entry: Record<string, unknown>): Promise<string>;
  update(id: string, updates: Record<string, unknown>): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createRoutineRegistryApplicator(
  registry: RoutineRegistryTarget,
): MutationApplicator {
  return {
    targetSystem: "routine-registry",

    async apply(mutation: ValidatedMutation): Promise<MutationResult> {
      const { action, payload } = mutation.content;
      const p = payload as Record<string, unknown>;

      switch (action) {
        case "create": {
          const id = await registry.add(p);
          return { status: "applied", id, action: "create" };
        }
        case "update": {
          const routineId = mutation.target.existingId ?? String(p["id"] ?? "");
          await registry.update(routineId, p);
          return { status: "applied", id: routineId, action: "update" };
        }
        case "delete": {
          const routineId = mutation.target.existingId ?? String(p["id"] ?? "");
          await registry.remove(routineId);
          return { status: "applied", id: routineId, action: "delete" };
        }
        default:
          return { status: "rejected", reason: `Unsupported action: ${action}` };
      }
    },
  };
}
