/**
 * 状态存储
 *
 * @module inner-life/orchestrator/state-store
 * @description In-Memory 实现，接口清晰便于后续换 RoleDataStore
 *
 * @see persona-inner-life.md IL-3
 */

import type {
  CharacterState,
  UserMoodProjection,
  RelationshipState,
  GrowthState,
} from "../types.js";

// ============================================================================
// 接口
// ============================================================================

/**
 * 状态存储接口
 *
 * 抽象数据访问，便于后续从 In-Memory 切换到 RoleDataStore (SQLite/Qdrant)。
 */
export interface StateStore {
  getCharacterState(roleId: string): CharacterState | undefined;
  saveCharacterState(roleId: string, state: CharacterState): void;
  getUserProjection(
    roleId: string,
    userId: string,
  ): UserMoodProjection | undefined;
  saveUserProjection(
    roleId: string,
    userId: string,
    projection: UserMoodProjection,
  ): void;
  getRelationship(
    roleId: string,
    userId: string,
  ): RelationshipState | undefined;
  saveRelationship(
    roleId: string,
    userId: string,
    state: RelationshipState,
  ): void;
  getGrowthState(roleId: string): GrowthState | undefined;
  saveGrowthState(roleId: string, state: GrowthState): void;
}

// ============================================================================
// In-Memory 实现
// ============================================================================

/**
 * In-Memory 状态存储
 *
 * 适用于单进程部署和测试。
 * 数据生命周期 = 进程生命周期。
 */
class InMemoryStateStore implements StateStore {
  private readonly characters = new Map<string, CharacterState>();
  private readonly projections = new Map<string, UserMoodProjection>();
  private readonly relationships = new Map<string, RelationshipState>();
  private readonly growthStates = new Map<string, GrowthState>();

  getCharacterState(roleId: string): CharacterState | undefined {
    return this.characters.get(roleId);
  }

  saveCharacterState(roleId: string, state: CharacterState): void {
    this.characters.set(roleId, state);
  }

  getUserProjection(
    roleId: string,
    userId: string,
  ): UserMoodProjection | undefined {
    return this.projections.get(compositeKey(roleId, userId));
  }

  saveUserProjection(
    roleId: string,
    userId: string,
    projection: UserMoodProjection,
  ): void {
    this.projections.set(compositeKey(roleId, userId), projection);
  }

  getRelationship(
    roleId: string,
    userId: string,
  ): RelationshipState | undefined {
    return this.relationships.get(compositeKey(roleId, userId));
  }

  saveRelationship(
    roleId: string,
    userId: string,
    state: RelationshipState,
  ): void {
    this.relationships.set(compositeKey(roleId, userId), state);
  }

  getGrowthState(roleId: string): GrowthState | undefined {
    return this.growthStates.get(roleId);
  }

  saveGrowthState(roleId: string, state: GrowthState): void {
    this.growthStates.set(roleId, state);
  }
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 创建 In-Memory 状态存储
 */
export function createInMemoryStateStore(): StateStore {
  return new InMemoryStateStore();
}

// ============================================================================
// 工具函数
// ============================================================================

function compositeKey(roleId: string, userId: string): string {
  return `${roleId}::${userId}`;
}
