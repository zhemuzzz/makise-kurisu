/**
 * Platform Skill System
 *
 * 导出所有技能相关模块
 */

// 类型
export * from "./types.js";

// Knowledge Types (Phase 3c)
export * from "./knowledge-types.js";

// Intent Types (Phase 3c)
export * from "./intent-types.js";

// Skill Loader
export { SkillLoader, SkillLoadError, createSkillLoader } from "./loader.js";
export type { SkillLoaderConfig } from "./loader.js";

// KnowledgeStore (Phase 3c)
export { createKnowledgeStore } from "./knowledge-store.js";
export type { IKnowledgeStore, KnowledgeStoreConfig, KnowledgeWriteOptions } from "./knowledge-store.js";

// IntentClassifier (Phase 3c)
export { createSkillIntentClassifier } from "./intent-classifier.js";
export type { ISkillIntentClassifier, SkillIntentClassifierConfig } from "./intent-classifier.js";

// SkillManager (Phase 3c)
export { createSkillManager } from "./skill-manager.js";
export type { ISkillManager, SkillManagerConfig } from "./skill-manager.js";

// Knowledge Injector
export {
  KnowledgeInjector,
  createKnowledgeInjector,
} from "./knowledge-injector.js";
export type { KnowledgeInjectorConfig } from "./knowledge-injector.js";

// Skill Registry
export { SkillRegistry, createSkillRegistry } from "./registry.js";
export type { SkillRegistryConfig } from "./registry.js";
