/**
 * SkillManager 实现
 *
 * @module platform/skills/skill-manager
 * @description SkillManagerPort adapter — Skill 搜索/激活/归档/草稿
 *
 * 设计来源:
 * - skill-system.md D7, D14, D15
 * - platform-execution.md D9 (SkillManagerPort)
 */

import type { ISkillRegistry, SkillInstance } from "./types.js";
import type { ISkillIntentClassifier } from "./intent-classifier.js";
import type {
  SkillManagerPort,
  SkillSearchResult,
  SkillActivation,
  SkillDraft,
} from "../../agent/ports/platform-services.js";

// ============================================================================
// Config
// ============================================================================

export interface SkillManagerConfig {
  readonly skillRegistry: ISkillRegistry;
  readonly intentClassifier: ISkillIntentClassifier;
  readonly maxActivePerSession: number;
  readonly draftTTL?: number; // ms, default 10 min
}

// ============================================================================
// Interface (extends SkillManagerPort)
// ============================================================================

export type ISkillManager = SkillManagerPort & {
  /** 清理 session 状态 */
  endSession(sessionId: string): void;
  /** 清理过期 draft */
  cleanExpiredDrafts(): number;
};

// ============================================================================
// Internal state
// ============================================================================

interface SessionState {
  readonly activations: ReadonlyMap<string, SkillActivation>;
}

interface DraftEntry {
  readonly draft: SkillDraft;
  readonly createdAt: number;
}

// ============================================================================
// Factory
// ============================================================================

export function createSkillManager(config: SkillManagerConfig): ISkillManager {
  const registry = config.skillRegistry;
  const classifier = config.intentClassifier;
  const maxActive = config.maxActivePerSession;
  const draftTTL = config.draftTTL ?? 10 * 60 * 1000; // 10 min

  const sessions = new Map<string, SessionState>();
  const drafts = new Map<string, DraftEntry>();
  let draftCounter = 0;

  // ---- helpers ----

  function getSession(sessionId: string): SessionState {
    let session = sessions.get(sessionId);
    if (!session) {
      session = { activations: new Map() };
      sessions.set(sessionId, session);
    }
    return session;
  }

  function skillToSearchResult(
    skill: SkillInstance,
    relevanceScore: number,
  ): SkillSearchResult {
    return {
      id: skill.config.id,
      name: skill.config.name,
      description: skill.config.metadata?.description ?? "",
      category: skill.config.type,
      status: skill.status === "active" ? "active" : "archived",
      relevanceScore,
    };
  }

  // ---- findSkill ----

  async function findSkill(
    query: string,
    limit?: number,
  ): Promise<SkillSearchResult[]> {
    const resultsMap = new Map<string, SkillSearchResult>();

    // 1. IntentClassifier 搜索
    const intentResult = await classifier.classifyAsync(query);
    for (const match of intentResult.matches) {
      const skill = registry.get(match.skillId);
      if (skill) {
        resultsMap.set(match.skillId, skillToSearchResult(skill, match.confidence));
      }
    }

    // 2. Registry 文本搜索 (名称/描述包含 query)
    const allSkills = registry.list();
    const queryLower = query.toLowerCase();
    for (const skill of allSkills) {
      if (resultsMap.has(skill.config.id)) continue;

      const nameMatch = skill.config.name.toLowerCase().includes(queryLower);
      const descMatch = (skill.config.metadata?.description ?? "")
        .toLowerCase()
        .includes(queryLower);

      if (nameMatch || descMatch) {
        resultsMap.set(
          skill.config.id,
          skillToSearchResult(skill, nameMatch ? 0.6 : 0.4),
        );
      }
    }

    // 排序 + limit
    const results = [...resultsMap.values()].sort(
      (a, b) => b.relevanceScore - a.relevanceScore,
    );

    return limit !== null && limit !== undefined ? results.slice(0, limit) : results;
  }

  // ---- getActiveSkills ----

  async function getActiveSkills(
    sessionId: string,
  ): Promise<SkillActivation[]> {
    const session = sessions.get(sessionId);
    if (!session) return [];
    return [...session.activations.values()];
  }

  // ---- activate ----

  async function activate(
    skillId: string,
    sessionId: string,
    injectionLevel: "full" | "tools-only",
  ): Promise<SkillActivation> {
    const skill = registry.get(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    const session = getSession(sessionId);

    // 幂等: 已激活则直接返回
    const existing = session.activations.get(skillId);
    if (existing) return existing;

    // 容量检查
    if (session.activations.size >= maxActive) {
      throw new Error(
        `Max active skills reached (${maxActive}). Deactivate a skill first.`,
      );
    }

    // 调用 registry activate
    await registry.activate([skillId]);

    const activation: SkillActivation = {
      id: skillId,
      name: skill.config.name,
      injectionLevel,
      activatedAt: Date.now(),
    };

    // 不可变更新: 创建新 Map
    const newActivations = new Map(session.activations);
    newActivations.set(skillId, activation);
    sessions.set(sessionId, { activations: newActivations });
    return activation;
  }

  // ---- archive ----

  async function archive(skillId: string, _reason: string): Promise<boolean> {
    // 从所有 session 中移除 (不可变更新)
    for (const [sessionId, session] of sessions) {
      if (session.activations.has(skillId)) {
        const newActivations = new Map(session.activations);
        newActivations.delete(skillId);
        sessions.set(sessionId, { activations: newActivations });
      }
    }
    return true;
  }

  // ---- createDraft ----

  async function createDraft(draft: SkillDraft): Promise<string> {
    draftCounter++;
    const draftId = `draft-${draftCounter}-${Date.now()}`;
    drafts.set(draftId, {
      draft,
      createdAt: Date.now(),
    });
    return draftId;
  }

  // ---- confirmDraft ----

  async function confirmDraft(draftId: string): Promise<boolean> {
    const entry = drafts.get(draftId);
    if (!entry) return false;

    // TTL 检查
    if (Date.now() - entry.createdAt > draftTTL) {
      drafts.delete(draftId);
      return false;
    }

    // 消费 draft
    drafts.delete(draftId);
    return true;
  }

  // ---- endSession ----

  function endSession(sessionId: string): void {
    sessions.delete(sessionId);
  }

  // ---- cleanExpiredDrafts ----

  function cleanExpiredDrafts(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of drafts) {
      if (now - entry.createdAt > draftTTL) {
        drafts.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  return {
    findSkill,
    getActiveSkills,
    activate,
    archive,
    createDraft,
    confirmDraft,
    endSession,
    cleanExpiredDrafts,
  };
}
