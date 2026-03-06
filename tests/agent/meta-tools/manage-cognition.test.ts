/**
 * manage-cognition 元工具测试
 */

import { describe, it, expect, vi } from "vitest";
import { manageCognitionHandler } from "../../../src/agent/meta-tools/manage-cognition.js";
import type { MetaToolContext, SessionState } from "../../../src/agent/meta-tools/types.js";

// ============================================================================
// Helpers
// ============================================================================

function createMockContext(overrides?: {
  cognitionContent?: string;
}): MetaToolContext {
  let cognitionState = overrides?.cognitionContent
    ? { content: overrides.cognitionContent, formattedText: `## 认知\n${overrides.cognitionContent}` }
    : undefined;

  const sessionState: SessionState = {
    getTodoState: () => undefined,
    setTodoState: () => {},
    getCognitionState: () => cognitionState,
    setCognitionState: (state) => { cognitionState = state; },
  };

  return {
    sessionId: "test-session",
    userId: "test-user",
    agentId: "test-agent",
    sessionState,
    skills: {} as MetaToolContext["skills"],
    subAgents: {} as MetaToolContext["subAgents"],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("manage-cognition handler", () => {
  describe("validation", () => {
    it("should reject invalid action", async () => {
      const ctx = createMockContext();
      const result = await manageCognitionHandler({ action: "delete" }, ctx);
      expect(result.success).toBe(false);
    });

    it("should reject write without content", async () => {
      const ctx = createMockContext();
      const result = await manageCognitionHandler({ action: "write" }, ctx);
      expect(result.success).toBe(false);
    });

    it("should reject write with empty content", async () => {
      const ctx = createMockContext();
      const result = await manageCognitionHandler({ action: "write", content: "" }, ctx);
      expect(result.success).toBe(false);
    });
  });

  describe("read action", () => {
    it("should return empty when no cognition set", async () => {
      const ctx = createMockContext();
      const result = await manageCognitionHandler({ action: "read" }, ctx);

      expect(result.success).toBe(true);
      const output = result.output as { content: string; message: string };
      expect(output.content).toBe("");
      expect(output.message).toBe("认知笔记为空");
    });

    it("should return existing cognition content", async () => {
      const ctx = createMockContext({ cognitionContent: "我是牧濑红莉栖" });
      const result = await manageCognitionHandler({ action: "read" }, ctx);

      expect(result.success).toBe(true);
      const output = result.output as { content: string; tokens: number };
      expect(output.content).toBe("我是牧濑红莉栖");
      expect(output.tokens).toBeGreaterThan(0);
    });
  });

  describe("write action", () => {
    it("should update cognition state", async () => {
      const ctx = createMockContext();
      const result = await manageCognitionHandler(
        { action: "write", content: "# 新认知\n\n我学到了。" },
        ctx,
      );

      expect(result.success).toBe(true);
      const output = result.output as { action: string; tokens: number };
      expect(output.action).toBe("write");
      expect(output.tokens).toBeGreaterThan(0);

      // Verify state was updated
      const state = ctx.sessionState.getCognitionState();
      expect(state?.content).toBe("# 新认知\n\n我学到了。");
    });

    it("should reject content exceeding capacity limit", async () => {
      const ctx = createMockContext();
      const hugeContent = "あ".repeat(6001); // > 6000 chars
      const result = await manageCognitionHandler(
        { action: "write", content: hugeContent },
        ctx,
      );

      expect(result.success).toBe(false);
    });

    it("should accept content at capacity limit", async () => {
      const ctx = createMockContext();
      const maxContent = "x".repeat(6000); // exactly 6000 chars
      const result = await manageCognitionHandler(
        { action: "write", content: maxContent },
        ctx,
      );

      expect(result.success).toBe(true);
    });

    it("should format cognition block with header", async () => {
      const ctx = createMockContext();
      await manageCognitionHandler(
        { action: "write", content: "认知内容" },
        ctx,
      );

      const state = ctx.sessionState.getCognitionState();
      expect(state?.formattedText).toContain("## 我的认知笔记");
      expect(state?.formattedText).toContain("认知内容");
    });
  });

  describe("snapshot overwrite pattern", () => {
    it("should replace previous cognition entirely", async () => {
      const ctx = createMockContext({ cognitionContent: "旧认知" });

      await manageCognitionHandler(
        { action: "write", content: "新认知" },
        ctx,
      );

      const state = ctx.sessionState.getCognitionState();
      expect(state?.content).toBe("新认知");
      expect(state?.content).not.toContain("旧认知");
    });
  });
});
