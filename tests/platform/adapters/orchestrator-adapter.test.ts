/**
 * OrchestratorAdapter Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorAdapter } from "../../../src/platform/adapters/orchestrator-adapter.js";
import { ChannelType, StreamEventType } from "../../../src/platform/gateway/types.js";
import type { Agent } from "../../../src/agent/agent.js";
import type { AgentEvent, AgentResult } from "../../../src/agent/types.js";
import type { PersonaEngineAPI } from "../../../src/inner-life/types.js";

// ============================================================================
// Mock Agent
// ============================================================================

function createMockAgent(events: AgentEvent[], result: AgentResult): Agent {
  return {
    execute: vi.fn().mockImplementation(function* () {
      for (const event of events) {
        yield event;
      }
      return result;
    }),
    abort: vi.fn(),
  } as unknown as Agent;
}

function makeTextDelta(delta: string): AgentEvent {
  return { type: "text_delta", timestamp: Date.now(), delta } as AgentEvent;
}

function makeResult(finalResponse: string): AgentResult {
  return {
    finalResponse,
    emotionTags: [],
    toolCalls: [],
    success: true,
    aborted: false,
    degraded: false,
    stats: {
      iterations: 1,
      toolCallCount: 0,
      totalTokens: 100,
      inputTokens: 50,
      outputTokens: 50,
      duration: 1000,
      compactCount: 0,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("OrchestratorAdapter", () => {
  let adapter: OrchestratorAdapter;
  let mockAgent: Agent;

  beforeEach(() => {
    mockAgent = createMockAgent(
      [makeTextDelta("Hello"), makeTextDelta(" World")],
      makeResult("Hello World"),
    );
    adapter = new OrchestratorAdapter(mockAgent);
  });

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  describe("session management", () => {
    it("should create and track sessions", () => {
      adapter.createSession({
        sessionId: "s1",
        userId: "u1",
        channelType: ChannelType.TELEGRAM,
      });

      expect(adapter.hasSession("s1")).toBe(true);
      expect(adapter.hasSession("s2")).toBe(false);
    });

    it("should return session info", () => {
      adapter.createSession({
        sessionId: "s1",
        userId: "u1",
        channelType: ChannelType.QQ,
      });

      const info = adapter.getSession!("s1");
      expect(info).not.toBeNull();
      expect(info!.sessionId).toBe("s1");
      expect(info!.userId).toBe("u1");
      expect(info!.channelType).toBe(ChannelType.QQ);
    });

    it("should return null for unknown session", () => {
      const info = adapter.getSession!("unknown");
      expect(info).toBeNull();
    });

    it("should delete sessions", () => {
      adapter.createSession({
        sessionId: "s1",
        userId: "u1",
        channelType: ChannelType.CLI,
      });

      adapter.deleteSession!("s1");
      expect(adapter.hasSession("s1")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // processStream
  // --------------------------------------------------------------------------

  describe("processStream", () => {
    it("should bridge to Agent.execute and return GatewayStreamResult", async () => {
      adapter.createSession({
        sessionId: "s1",
        userId: "u1",
        channelType: ChannelType.TELEGRAM,
      });

      const result = await adapter.processStream({
        sessionId: "s1",
        input: "Hello",
        userId: "u1",
      });

      // Should return GatewayStreamResult (not string)
      expect(typeof result).toBe("object");
      const streamResult = result as { textStream: AsyncGenerator<string>; finalResponse: Promise<string> };

      // Consume text stream
      const chunks: string[] = [];
      for await (const chunk of streamResult.textStream) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["Hello", " World"]);

      // Final response
      const final = await streamResult.finalResponse;
      expect(final).toBe("Hello World");
    });

    it("should inject cognitionText from getCognition getter", async () => {
      const cognitionAdapter = new OrchestratorAdapter(mockAgent, () => "我认识冈部");

      await cognitionAdapter.processStream({
        sessionId: "s1",
        input: "你好",
      });

      const [agentInput] = (mockAgent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentInput.cognitionText).toBe("我认识冈部");

      // Consume
      const result = await cognitionAdapter.processStream({ sessionId: "s1", input: "x" });
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });

    it("should reflect cognition updates on next turn", async () => {
      let cognition = "初始认知";
      const dynamicAdapter = new OrchestratorAdapter(mockAgent, () => cognition);

      // First turn: initial cognition
      await dynamicAdapter.processStream({ sessionId: "s1", input: "a" });
      const [input1] = (mockAgent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(input1.cognitionText).toBe("初始认知");

      // Simulate cognition update (e.g. by manage-cognition meta-tool)
      cognition = "更新后的认知";

      // Need a new mock agent for second call (generator can only be consumed once)
      const mockAgent2 = createMockAgent(
        [makeTextDelta("OK")],
        makeResult("OK"),
      );
      const dynamicAdapter2 = new OrchestratorAdapter(mockAgent2, () => cognition);
      await dynamicAdapter2.processStream({ sessionId: "s1", input: "b" });
      const [input2] = (mockAgent2.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(input2.cognitionText).toBe("更新后的认知");
    });

    it("should not include cognitionText when getCognition returns empty", async () => {
      const emptyAdapter = new OrchestratorAdapter(mockAgent, () => "");

      await emptyAdapter.processStream({ sessionId: "s1", input: "test" });

      const [agentInput] = (mockAgent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentInput.cognitionText).toBeUndefined();

      // Consume
      const result = await emptyAdapter.processStream({ sessionId: "s1", input: "x" });
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });

    it("should build correct AgentInput from gateway params", async () => {
      const result = await adapter.processStream({
        sessionId: "s1",
        input: "Test message",
        userId: "u1",
      });

      // Verify Agent.execute was called
      expect(mockAgent.execute).toHaveBeenCalledOnce();

      const [agentInput, agentConfig] = (mockAgent.execute as ReturnType<typeof vi.fn>).mock.calls[0];

      // AgentInput
      expect(agentInput.userMessage).toBe("Test message");
      expect(agentInput.activatedSkills).toEqual([]);
      expect(agentInput.recalledMemories).toEqual([]);
      expect(agentInput.conversationHistory).toEqual([]);

      // AgentConfig
      expect(agentConfig.sessionId).toBe("s1");
      expect(agentConfig.userId).toBe("u1");
      expect(agentConfig.mode).toBe("conversation");

      // Consume to avoid hanging generator
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });

    it("should produce correct fullStream events", async () => {
      const result = await adapter.processStream({
        sessionId: "s1",
        input: "Hi",
      });

      const streamResult = result as { fullStream: AsyncGenerator<unknown> };
      const events: unknown[] = [];
      for await (const event of streamResult.fullStream) {
        events.push(event);
      }

      // Should have text_delta events + text_complete
      expect(events.length).toBe(3); // 2 deltas + 1 complete
      expect((events[0] as { type: StreamEventType }).type).toBe(StreamEventType.TEXT_DELTA);
      expect((events[1] as { type: StreamEventType }).type).toBe(StreamEventType.TEXT_DELTA);
      expect((events[2] as { type: StreamEventType }).type).toBe(StreamEventType.TEXT_COMPLETE);
    });

    it("should use anonymous userId when not provided", async () => {
      const result = await adapter.processStream({
        sessionId: "s1",
        input: "Hello",
      });

      const [, agentConfig] = (mockAgent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentConfig.userId).toBe("anonymous");

      // Consume
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });
  });

  // --------------------------------------------------------------------------
  // executeTool
  // --------------------------------------------------------------------------

  describe("executeTool", () => {
    it("should delegate to Agent (returns string)", async () => {
      const result = await adapter.executeTool!("s1", {
        id: "tc1",
        name: "test-tool",
        arguments: {},
      } as never);
      expect(typeof result).toBe("string");
    });
  });

  // --------------------------------------------------------------------------
  // ILE Integration (B0)
  // --------------------------------------------------------------------------

  describe("ILE integration", () => {
    function createMockPersonaEngine(
      overrides?: Partial<PersonaEngineAPI>,
    ): PersonaEngineAPI {
      return {
        buildContext: vi.fn().mockReturnValue({
          identity: ["I am Kurisu"],
          mentalModel: ["心境: 略带防御性", "关系: 熟悉"],
          lore: ["Steins;Gate worldline"],
        }),
        processTurn: vi.fn(),
        injectEvent: vi.fn(),
        getDebugSnapshot: vi.fn().mockReturnValue({
          roleId: "kurisu",
          baseMood: { pleasure: -0.2, arousal: 0.3, dominance: 0.6, updatedAt: Date.now() },
          personality: { defaultMood: { pleasure: -0.2, arousal: 0.3, dominance: 0.6, updatedAt: Date.now() } },
          userProjections: {
            u1: {
              userId: "u1",
              projectedMood: { pleasure: 0.1, arousal: 0.4, dominance: 0.5, updatedAt: Date.now() },
              recentEmotions: [
                { tag: "curiosity", timestamp: Date.now() },
                { tag: "pride", timestamp: Date.now() },
              ],
            },
          },
          relationships: {
            u1: {
              userId: "u1",
              stage: "familiar" as const,
              familiarity: 45,
              warmth: 30,
              trust: 50,
              lastInteractionAt: Date.now(),
              interactionCount: 10,
            },
          },
          snapshotAt: Date.now(),
        }),
        ...overrides,
      } as PersonaEngineAPI;
    }

    it("should use PersonaEngine to build mental model when provided", async () => {
      const engine = createMockPersonaEngine();
      const agent = createMockAgent(
        [makeTextDelta("Hi")],
        makeResult("Hi"),
      );
      const ileAdapter = new OrchestratorAdapter(agent, undefined, engine);

      const result = await ileAdapter.processStream({
        sessionId: "s1",
        input: "Hello",
        userId: "u1",
      });

      // Verify buildContext was called
      expect(engine.buildContext).toHaveBeenCalledWith("u1", {
        type: "private",
        targetUserId: "u1",
      });

      // Verify getDebugSnapshot was called
      expect(engine.getDebugSnapshot).toHaveBeenCalledWith("u1");

      // Verify AgentInput has real mental model
      const [agentInput] = (agent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentInput.mentalModel.mood.pleasure).toBe(0.1);
      expect(agentInput.mentalModel.mood.arousal).toBe(0.4);
      expect(agentInput.mentalModel.mood.dominance).toBe(0.5);
      expect(agentInput.mentalModel.activeEmotions).toEqual(["curiosity", "pride"]);
      expect(agentInput.mentalModel.relationshipStage).toBe(3); // familiar
      expect(agentInput.mentalModel.relationshipDescription).toBe("熟悉");
      expect(agentInput.mentalModel.formattedText).toBe("心境: 略带防御性\n关系: 熟悉");

      // Consume stream
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });

    it("should fall back to DEFAULT_MENTAL_MODEL when no PersonaEngine", async () => {
      // Default adapter has no PersonaEngine
      const result = await adapter.processStream({
        sessionId: "s1",
        input: "Hello",
        userId: "u1",
      });

      const [agentInput] = (mockAgent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(agentInput.mentalModel.mood.pleasure).toBe(0);
      expect(agentInput.mentalModel.mood.arousal).toBe(0);
      expect(agentInput.mentalModel.mood.dominance).toBe(0);
      expect(agentInput.mentalModel.activeEmotions).toEqual([]);
      expect(agentInput.mentalModel.relationshipStage).toBe(1);
      expect(agentInput.mentalModel.formattedText).toBe("");

      // Consume
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });

    it("should call processTurn with emotionTags after stream consumption", async () => {
      const engine = createMockPersonaEngine();
      const resultWithEmotions = makeResult("感谢");
      resultWithEmotions.emotionTags = ["gratitude", "warmth"];
      const agent = createMockAgent(
        [makeTextDelta("感谢")],
        resultWithEmotions,
      );
      const ileAdapter = new OrchestratorAdapter(agent, undefined, engine);

      const result = await ileAdapter.processStream({
        sessionId: "s1",
        input: "你帮了大忙",
        userId: "u1",
      });

      // processTurn should NOT be called before stream consumption
      expect(engine.processTurn).not.toHaveBeenCalled();

      // Consume the stream
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }

      // Now processTurn should have been called
      expect(engine.processTurn).toHaveBeenCalledWith(
        "u1",
        ["gratitude", "warmth"],
        "text_chat",
      );
    });

    it("should NOT call processTurn when emotionTags is empty", async () => {
      const engine = createMockPersonaEngine();
      const agent = createMockAgent(
        [makeTextDelta("OK")],
        makeResult("OK"), // empty emotionTags
      );
      const ileAdapter = new OrchestratorAdapter(agent, undefined, engine);

      const result = await ileAdapter.processStream({
        sessionId: "s1",
        input: "test",
        userId: "u1",
      });

      // Consume
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }

      // processTurn should NOT be called (empty emotionTags)
      expect(engine.processTurn).not.toHaveBeenCalled();
    });

    it("should handle stranger relationship stage", async () => {
      const engine = createMockPersonaEngine({
        getDebugSnapshot: vi.fn().mockReturnValue({
          roleId: "kurisu",
          baseMood: { pleasure: 0, arousal: 0, dominance: 0, updatedAt: Date.now() },
          personality: {},
          userProjections: {},
          relationships: {},
          snapshotAt: Date.now(),
        }),
      });
      const agent = createMockAgent(
        [makeTextDelta("Hi")],
        makeResult("Hi"),
      );
      const ileAdapter = new OrchestratorAdapter(agent, undefined, engine);

      const result = await ileAdapter.processStream({
        sessionId: "s1",
        input: "Hello",
        userId: "new-user",
      });

      const [agentInput] = (agent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      // Unknown user → stranger defaults
      expect(agentInput.mentalModel.relationshipStage).toBe(1); // stranger
      expect(agentInput.mentalModel.relationshipDescription).toBe("陌生人");
      expect(agentInput.mentalModel.mood.pleasure).toBe(0);

      // Consume
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });

    it("should work with both cognition and PersonaEngine", async () => {
      const engine = createMockPersonaEngine();
      const agent = createMockAgent(
        [makeTextDelta("OK")],
        makeResult("OK"),
      );
      const ileAdapter = new OrchestratorAdapter(
        agent,
        () => "我认识冈部伦太郎",
        engine,
      );

      const result = await ileAdapter.processStream({
        sessionId: "s1",
        input: "test",
        userId: "u1",
      });

      const [agentInput] = (agent.execute as ReturnType<typeof vi.fn>).mock.calls[0];
      // Both cognition and mental model should be set
      expect(agentInput.cognitionText).toBe("我认识冈部伦太郎");
      expect(agentInput.mentalModel.mood.pleasure).toBe(0.1);
      expect(agentInput.mentalModel.relationshipStage).toBe(3);

      // Consume
      const sr = result as { textStream: AsyncGenerator<string> };
      for await (const _ of sr.textStream) { /* drain */ }
    });
  });
});
