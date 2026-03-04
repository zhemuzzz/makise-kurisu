/**
 * MutationApplicator 接口
 * 位置: src/evolution/applicators/types.ts
 *
 * MP-4 Stage 3: 统一的 Applicator 接口
 */

import type { ValidatedMutation, MutationResult } from "../types.js";

/**
 * MutationApplicator — 将验证后的 mutation 路由写入目标系统
 *
 * 每个目标系统（KnowledgeStore, SkillManager, etc.）提供一个 Applicator 实现
 */
export interface MutationApplicator {
  /** 目标系统标识 */
  readonly targetSystem: string;

  /** 应用 mutation 到目标系统 */
  apply(mutation: ValidatedMutation): Promise<MutationResult>;
}
