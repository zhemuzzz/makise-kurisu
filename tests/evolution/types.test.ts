/**
 * Evolution 类型测试
 * 位置: tests/evolution/types.test.ts
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RISK_MATRIX,
  generateMutationId,
  isMutationRisk,
  isMutationSourceType,
  isMutationStatus,
  isMutationType,
  MUTATION_TYPES,
  type MutationContent,
  type MutationTarget,
  type MutationType,
} from "../../src/evolution/types.js";

describe("Evolution Types", () => {
  // ============ generateMutationId ============

  describe("generateMutationId", () => {
    const target: MutationTarget = { system: "knowledge-store" };
    const content: MutationContent = {
      action: "create",
      payload: { text: "Docker 调试技巧" },
      reason: "用户频繁问 Docker 问题",
    };

    it("should produce deterministic SHA-256 hex", () => {
      const id1 = generateMutationId("knowledge", target, content);
      const id2 = generateMutationId("knowledge", target, content);
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(64); // SHA-256 = 64 hex chars
      expect(id1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce different IDs for different types", () => {
      const id1 = generateMutationId("knowledge", target, content);
      const id2 = generateMutationId("anti-pattern", target, content);
      expect(id1).not.toBe(id2);
    });

    it("should produce different IDs for different targets", () => {
      const target2: MutationTarget = { system: "skill-manager" };
      const id1 = generateMutationId("knowledge", target, content);
      const id2 = generateMutationId("knowledge", target2, content);
      expect(id1).not.toBe(id2);
    });

    it("should produce different IDs for different actions", () => {
      const content2: MutationContent = { ...content, action: "update" };
      const id1 = generateMutationId("knowledge", target, content);
      const id2 = generateMutationId("knowledge", target, content2);
      expect(id1).not.toBe(id2);
    });

    it("should produce different IDs for different payloads", () => {
      const content2: MutationContent = {
        ...content,
        payload: { text: "另一条知识" },
      };
      const id1 = generateMutationId("knowledge", target, content);
      const id2 = generateMutationId("knowledge", target, content2);
      expect(id1).not.toBe(id2);
    });

    it("should ignore reason field in ID computation", () => {
      const content2: MutationContent = {
        ...content,
        reason: "不同的原因",
      };
      const id1 = generateMutationId("knowledge", target, content);
      const id2 = generateMutationId("knowledge", target, content2);
      // reason 不参与 ID 计算（ID 只取 type+system+action+payload）
      expect(id1).toBe(id2);
    });
  });

  // ============ DEFAULT_RISK_MATRIX ============

  describe("DEFAULT_RISK_MATRIX", () => {
    it("should cover all mutation types", () => {
      for (const t of MUTATION_TYPES) {
        expect(DEFAULT_RISK_MATRIX[t]).toBeDefined();
      }
    });

    it("should assign correct risk levels per design (MP-4)", () => {
      expect(DEFAULT_RISK_MATRIX["knowledge"]).toBe("low");
      expect(DEFAULT_RISK_MATRIX["anti-pattern"]).toBe("low");
      expect(DEFAULT_RISK_MATRIX["skill-extension"]).toBe("medium");
      expect(DEFAULT_RISK_MATRIX["routine"]).toBe("medium");
      expect(DEFAULT_RISK_MATRIX["skill"]).toBe("high");
      expect(DEFAULT_RISK_MATRIX["code"]).toBe("high");
      expect(DEFAULT_RISK_MATRIX["config"]).toBe("high");
    });

    it("should be frozen (immutable)", () => {
      expect(Object.isFrozen(DEFAULT_RISK_MATRIX)).toBe(true);
    });
  });

  // ============ Type Guards ============

  describe("isMutationType", () => {
    it("should accept valid types", () => {
      const valid: MutationType[] = [
        "knowledge",
        "anti-pattern",
        "skill",
        "skill-extension",
        "routine",
        "code",
        "config",
      ];
      for (const t of valid) {
        expect(isMutationType(t)).toBe(true);
      }
    });

    it("should reject invalid values", () => {
      expect(isMutationType("invalid")).toBe(false);
      expect(isMutationType(42)).toBe(false);
      expect(isMutationType(null)).toBe(false);
      expect(isMutationType(undefined)).toBe(false);
    });
  });

  describe("isMutationRisk", () => {
    it("should accept valid risks", () => {
      expect(isMutationRisk("low")).toBe(true);
      expect(isMutationRisk("medium")).toBe(true);
      expect(isMutationRisk("high")).toBe(true);
      expect(isMutationRisk("forbidden")).toBe(true);
    });

    it("should reject invalid values", () => {
      expect(isMutationRisk("critical")).toBe(false);
      expect(isMutationRisk(1)).toBe(false);
    });
  });

  describe("isMutationStatus", () => {
    it("should accept valid statuses", () => {
      expect(isMutationStatus("applied")).toBe(true);
      expect(isMutationStatus("merged")).toBe(true);
      expect(isMutationStatus("skipped")).toBe(true);
      expect(isMutationStatus("rejected")).toBe(true);
      expect(isMutationStatus("pending")).toBe(true);
    });

    it("should reject invalid values", () => {
      expect(isMutationStatus("cancelled")).toBe(false);
    });
  });

  describe("isMutationSourceType", () => {
    it("should accept valid source types", () => {
      expect(isMutationSourceType("reflection")).toBe(true);
      expect(isMutationSourceType("active-learning")).toBe(true);
      expect(isMutationSourceType("user-correction")).toBe(true);
      expect(isMutationSourceType("usage-feedback")).toBe(true);
      expect(isMutationSourceType("system-observation")).toBe(true);
    });

    it("should reject invalid values", () => {
      expect(isMutationSourceType("manual")).toBe(false);
    });
  });
});
