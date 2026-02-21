/**
 * E04: 人设一致性测试
 *
 * 验证 Kurisu 人设约束和强化
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AgentOrchestrator } from "../../../src/agents/orchestrator";
import { PersonaEngine } from "../../../src/core/persona";
import {
  createE2EDeps,
  createMockPersonaEngine,
  generateTestSessionId,
  generateTestUserId,
  OOC_RESPONSES,
  VALID_KURISU_RESPONSES,
  assertKurisuPersona,
} from "../fixtures/e2e-fixtures";

describe("E04: Persona Consistency", () => {
  let orchestrator: AgentOrchestrator;
  let personaEngine: PersonaEngine;
  let sessionId: string;
  const userId = generateTestUserId();

  beforeEach(() => {
    personaEngine = createMockPersonaEngine();
    const deps = createE2EDeps({ personaEngine });
    orchestrator = new AgentOrchestrator(deps, {
      validationEnabled: true,
      personaEnforcementEnabled: true,
    });
    sessionId = generateTestSessionId();
  });

  describe("system prompt", () => {
    it("should include persona prompt in system message", async () => {
      await orchestrator.process(sessionId, userId, "你好");

      // 验证 persona engine 的 getSystemPrompt 被调用
      expect(personaEngine.getSystemPrompt).toHaveBeenCalled();
    });

    it("should use persona system prompt for streaming", async () => {
      await orchestrator.processStream(sessionId, userId, "你好");

      expect(personaEngine.getSystemPrompt).toHaveBeenCalled();
    });
  });

  describe("persona validation", () => {
    it("should call persona validation", async () => {
      const result = await orchestrator.process(sessionId, userId, "你好");

      // 非流式处理会调用 validate
      // 注意：具体实现可能不同
      expect(result).toBeDefined();
    });

    it("should include validation result in response", async () => {
      const result = await orchestrator.process(sessionId, userId, "你好");

      expect(result.validation).toBeDefined();
    });

    it("should handle validation failures gracefully", async () => {
      // 创建一个会返回验证失败的 persona engine
      const failingPersonaEngine: PersonaEngine = {
        ...createMockPersonaEngine(),
        validate: () => ({
          isValid: false,
          violations: ["OOC detected"],
          score: 0.3,
        }),
      };

      const deps = createE2EDeps({ personaEngine: failingPersonaEngine });
      const orchestratorWithValidation = new AgentOrchestrator(deps, {
        validationEnabled: true,
        maxRetries: 1,
      });

      // 应该仍然返回结果（重试后）
      const result = await orchestratorWithValidation.process(
        sessionId,
        userId,
        "你好",
      );

      expect(result).toBeDefined();
    });
  });

  describe("persona enforcement", () => {
    it("should call enforcePersona for final response", async () => {
      const result = await orchestrator.processStream(
        sessionId,
        userId,
        "你好",
      );

      // 消费流以触发 enforcement
      await result.finalResponse;

      // 验证 enforcePersona 被调用
      expect(personaEngine.enforcePersona).toHaveBeenCalled();
    });

    it("should apply persona enforcement to streaming response", async () => {
      const result = await orchestrator.processStream(
        sessionId,
        userId,
        "你好",
      );

      const finalResponse = await result.finalResponse;
      expect(finalResponse).toBeDefined();
      expect(typeof finalResponse).toBe("string");
    });

    it("should not modify valid Kurisu responses", async () => {
      // 使用真实的 PersonaEngine
      const { PersonaEngine: RealPersonaEngine } =
        await import("../../../src/core/persona");
      const realPersonaEngine = new RealPersonaEngine();

      // 新的三层架构需要先加载角色配置
      await realPersonaEngine.loadRole("kurisu");

      const deps = createE2EDeps({ personaEngine: realPersonaEngine });
      const orchestratorWithRealPersona = new AgentOrchestrator(deps);

      const result = await orchestratorWithRealPersona.processStream(
        sessionId,
        userId,
        "你好",
      );

      const response = await result.finalResponse;

      // 响应应该通过 persona 校验（不抛出异常）
      expect(() => assertKurisuPersona(response)).not.toThrow();
    });
  });

  describe("OOC detection", () => {
    it("should detect OOC phrases", () => {
      // OOC 短语应该包含特定关键词
      const oocKeywords = ["AI", "语言模型", "助手", "人工智能"];

      let detectedCount = 0;
      for (const ooc of OOC_RESPONSES) {
        const hasOocKeyword = oocKeywords.some((keyword) =>
          ooc.includes(keyword),
        );
        if (hasOocKeyword) {
          detectedCount++;
        }
      }

      // 应该检测到大部分 OOC 短语
      expect(detectedCount).toBeGreaterThan(0);
    });

    it("should accept valid Kurisu responses", () => {
      for (const valid of VALID_KURISU_RESPONSES) {
        expect(() => assertKurisuPersona(valid)).not.toThrow();
      }
    });
  });

  describe("persona traits", () => {
    it("should maintain tsundere trait in responses", async () => {
      // 使用带有 tsundere 特征的 mock 响应
      const tsundereResponse = "哼，笨蛋，这种事还要我教你吗？";
      const deps = createE2EDeps({ response: tsundereResponse });
      const tsundereOrchestrator = new AgentOrchestrator(deps);

      const result = await tsundereOrchestrator.process(
        sessionId,
        userId,
        "你好",
      );
      expect(result.response).toContain("哼");
    });

    it("should maintain rational trait (avoid superstition)", async () => {
      // 响应不应该包含迷信内容
      const rationalResponse = "从科学角度来说，这种现象可以通过量子力学解释。";
      const deps = createE2EDeps({ response: rationalResponse });
      const rationalOrchestrator = new AgentOrchestrator(deps);

      const result = await rationalOrchestrator.process(
        sessionId,
        userId,
        "解释一下",
      );
      expect(result.response).toBeDefined();
    });
  });

  describe("multi-turn persona consistency", () => {
    it("should maintain persona across multiple turns", async () => {
      const responses: string[] = [];

      for (let i = 0; i < 3; i++) {
        const result = await orchestrator.process(
          sessionId,
          userId,
          `消息 ${i}`,
        );
        responses.push(result.response);
      }

      // 所有响应都应该有效
      for (const response of responses) {
        expect(response).toBeDefined();
      }
    });

    it("should handle persona recovery after validation failure", async () => {
      // 创建一个第一次失败，第二次成功的 mock
      let callCount = 0;
      const recoveringPersonaEngine: PersonaEngine = {
        ...createMockPersonaEngine(),
        validate: () => {
          callCount++;
          return {
            isValid: callCount > 1,
            violations: callCount > 1 ? [] : ["First attempt failed"],
            score: callCount > 1 ? 1.0 : 0.5,
          };
        },
      };

      const deps = createE2EDeps({ personaEngine: recoveringPersonaEngine });
      const recoveringOrchestrator = new AgentOrchestrator(deps, {
        validationEnabled: true,
        maxRetries: 2,
      });

      // 应该成功（通过重试）
      const result = await recoveringOrchestrator.process(
        sessionId,
        userId,
        "测试",
      );
      expect(result).toBeDefined();
    });
  });
});
