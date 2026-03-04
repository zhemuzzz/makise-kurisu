/**
 * Platform Skill System
 *
 * 导出所有技能相关模块
 */

// 类型
export * from "./types";

// Knowledge Types (Phase 3c)
export * from "./knowledge-types";

// Intent Types (Phase 3c)
export * from "./intent-types";

// Skill Loader
export { SkillLoader, SkillLoadError, createSkillLoader } from "./loader";
export type { SkillLoaderConfig } from "./loader";

// KnowledgeStore (Phase 3c)
export { createKnowledgeStore } from "./knowledge-store";
export type { IKnowledgeStore, KnowledgeStoreConfig, KnowledgeWriteOptions } from "./knowledge-store";

// IntentClassifier (Phase 3c)
export { createSkillIntentClassifier } from "./intent-classifier";
export type { ISkillIntentClassifier, SkillIntentClassifierConfig } from "./intent-classifier";

// SkillManager (Phase 3c)
export { createSkillManager } from "./skill-manager";
export type { ISkillManager, SkillManagerConfig } from "./skill-manager";

// Knowledge Injector
export {
  KnowledgeInjector,
  createKnowledgeInjector,
} from "./knowledge-injector";
export type { KnowledgeInjectorConfig } from "./knowledge-injector";

// Skill Registry
export { SkillRegistry, createSkillRegistry } from "./registry";
export type { SkillRegistryConfig } from "./registry";
