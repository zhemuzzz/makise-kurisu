/**
 * L3 Agent 编排层 - 路由器测试
 */

import { describe, it, expect } from "vitest";
import {
  intentRouter,
  validationRouter,
  shouldRegenerate,
} from "@/agents/routers/intent-router";
import { AgentRole, IntentType, createInitialState } from "@/agents";

describe("Intent Router", () => {
  describe("intentRouter", () => {
    it("should route conversation intent to conversation node", () => {
      const state = createInitialState("session-1", "user-1", "你好");
      state.routeDecision = {
        intent: IntentType.CONVERSATION,
        confidence: 0.8,
        reason: "test",
      };

      const result = intentRouter(state);
      expect(result).toBe("conversation");
    });

    it("should route task intent to task node", () => {
      const state = createInitialState("session-1", "user-1", "帮我");
      state.routeDecision = {
        intent: IntentType.TASK,
        confidence: 0.8,
        reason: "test",
      };

      const result = intentRouter(state);
      expect(result).toBe("task");
    });

    it("should default to conversation for unknown intent", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.routeDecision = {
        intent: IntentType.UNKNOWN,
        confidence: 0.5,
        reason: "test",
      };

      const result = intentRouter(state);
      expect(result).toBe("conversation");
    });

    it("should default to conversation when no route decision", () => {
      const state = createInitialState("session-1", "user-1", "test");

      const result = intentRouter(state);
      expect(result).toBe("conversation");
    });
  });

  describe("validationRouter", () => {
    it("should route to enforce when validation passes", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.currentResponse = "哼，我知道了。笨蛋。";
      state.personaValidation = {
        isValid: true,
        violations: [],
        shouldRegenerate: false,
      };

      const result = validationRouter(state);
      expect(result).toBe("end");
    });

    it("should route to conversation for retry when validation fails", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.currentResponse = "作为AI，我可以帮你。";
      state.currentAgent = AgentRole.CONVERSATION;
      state.personaValidation = {
        isValid: false,
        violations: ["包含不符合人设的表达"],
        shouldRegenerate: true,
      };
      state.retryCount = 0;

      const result = validationRouter(state);
      expect(result).toBe("conversation");
    });

    it("should route to task for retry when validation fails on task agent", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.currentResponse = "作为AI，我可以帮你。";
      state.currentAgent = AgentRole.TASK;
      state.personaValidation = {
        isValid: false,
        violations: ["包含不符合人设的表达"],
        shouldRegenerate: true,
      };
      state.retryCount = 0;

      const result = validationRouter(state);
      expect(result).toBe("task");
    });

    it("should route to end when no response", () => {
      const state = createInitialState("session-1", "user-1", "test");

      const result = validationRouter(state);
      expect(result).toBe("end");
    });

    it("should route to end when shouldRegenerate is false even if validation fails", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.currentResponse = "作为AI，我可以帮你。";
      state.currentAgent = AgentRole.CONVERSATION;
      state.personaValidation = {
        isValid: false,
        violations: ["包含不符合人设的表达"],
        shouldRegenerate: false,
      };

      const result = validationRouter(state);
      expect(result).toBe("end");
    });
  });

  describe("shouldRegenerate", () => {
    it("should return true when shouldRegenerate is true", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.personaValidation = {
        isValid: false,
        violations: ["test"],
        shouldRegenerate: true,
      };

      expect(shouldRegenerate(state)).toBe(true);
    });

    it("should return false when shouldRegenerate is false", () => {
      const state = createInitialState("session-1", "user-1", "test");
      state.personaValidation = {
        isValid: true,
        violations: [],
        shouldRegenerate: false,
      };

      expect(shouldRegenerate(state)).toBe(false);
    });

    it("should return false when personaValidation is null", () => {
      const state = createInitialState("session-1", "user-1", "test");

      expect(shouldRegenerate(state)).toBe(false);
    });
  });
});
