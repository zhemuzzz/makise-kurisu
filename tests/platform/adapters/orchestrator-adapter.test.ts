/**
 * OrchestratorAdapter Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratorAdapter } from "../../../src/platform/adapters/orchestrator-adapter.js";
import { ChannelType, StreamEventType } from "../../../src/platform/gateway/types.js";
import type { Agent } from "../../../src/agent/agent.js";
import type { AgentEvent, AgentResult } from "../../../src/agent/types.js";

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
});
