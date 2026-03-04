/**
 * KnowledgeStoreApplicator
 * 位置: src/evolution/applicators/knowledge-store-applicator.ts
 *
 * 将 knowledge/anti-pattern 类 mutation 路由到 IKnowledgeStore
 */

import type { MutationResult, ValidatedMutation } from "../types.js";
import type { MutationApplicator } from "./types.js";

export interface KnowledgeStoreTarget {
  write(entry: {
    content: string;
    source: string;
    category?: string;
    tags?: readonly string[];
    skillId?: string;
  }): Promise<string>;
  archive(id: string, reason: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export function createKnowledgeStoreApplicator(
  store: KnowledgeStoreTarget,
): MutationApplicator {
  return {
    targetSystem: "knowledge-store",

    async apply(mutation: ValidatedMutation): Promise<MutationResult> {
      const { action, payload, reason } = mutation.content;
      const p = payload as Record<string, unknown>;

      switch (action) {
        case "create": {
          const tags = Array.isArray(p["tags"]) ? (p["tags"] as string[]) : null;
          const skillId = typeof p["skillId"] === "string" ? p["skillId"] : null;
          const writeArg: Parameters<typeof store.write>[0] = {
            content: String(p["text"] ?? p["content"] ?? ""),
            source: mutation.source.type,
            category: mutation.type === "anti-pattern" ? "anti-pattern" : String(p["category"] ?? "general"),
          };
          if (tags) writeArg.tags = tags;
          if (skillId) writeArg.skillId = skillId;
          const id = await store.write(writeArg);
          return { status: "applied", id, action: "create" };
        }
        case "archive": {
          const existingId = mutation.target.existingId ?? String(p["id"] ?? "");
          await store.archive(existingId, reason);
          return { status: "applied", id: existingId, action: "archive" };
        }
        case "delete": {
          const existingId = mutation.target.existingId ?? String(p["id"] ?? "");
          await store.delete(existingId);
          return { status: "applied", id: existingId, action: "delete" };
        }
        case "merge": {
          // Merge = archive old + create new
          const existingId = mutation.target.existingId ?? String(p["mergeFrom"] ?? "");
          if (existingId) {
            await store.archive(existingId, `Merged: ${reason}`);
          }
          const id = await store.write({
            content: String(p["text"] ?? p["content"] ?? ""),
            source: mutation.source.type,
            category: String(p["category"] ?? "general"),
          });
          return { status: "merged", id, mergedInto: existingId };
        }
        default:
          return { status: "rejected", reason: `Unsupported action: ${action}` };
      }
    },
  };
}
