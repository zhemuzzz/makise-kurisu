/**
 * OrchestratorAdapter - Agent → IOrchestrator
 *
 * 桥接新架构 Agent.execute() 到旧架构 Gateway 依赖的 IOrchestrator 接口。
 *
 * - processStream: 构建 AgentInput → 调用 Agent.execute() → 转换为 GatewayStreamResult
 * - createSession / hasSession / deleteSession: 管理 session 状态
 *
 * @module platform/adapters/orchestrator-adapter
 */

import type { Agent } from "../../agent/agent.js";
import type {
  AgentConfig,
  AgentEvent,
  AgentInput,
  AgentResult,
  MentalModelSnapshot,
} from "../../agent/types.js";
import type {
  IOrchestrator,
  GatewayStreamResult,
  ChannelType,
  SessionInfo,
  AnyStreamEvent,
  ToolCall,
} from "../gateway/types.js";
import { StreamEventType } from "../gateway/types.js";

// ============================================================================
// Types
// ============================================================================

interface SessionState {
  readonly sessionId: string;
  readonly userId: string;
  readonly channelType: ChannelType;
  readonly createdAt: Date;
  lastActiveAt: Date;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_MENTAL_MODEL: MentalModelSnapshot = {
  mood: { pleasure: 0, arousal: 0, dominance: 0 },
  activeEmotions: [],
  relationshipStage: 1,
  relationshipDescription: "",
  formattedText: "",
};

// ============================================================================
// Adapter
// ============================================================================

export class OrchestratorAdapter implements IOrchestrator {
  private readonly agent: Agent;
  private readonly sessions = new Map<string, SessionState>();
  private cognitionContent: string;

  constructor(agent: Agent, initialCognition?: string) {
    this.agent = agent;
    this.cognitionContent = initialCognition ?? "";
  }

  /**
   * 更新认知内容 (由 manage-cognition 元工具调用)
   */
  updateCognition(content: string): void {
    this.cognitionContent = content;
  }

  // --------------------------------------------------------------------------
  // processStream: Gateway → Agent bridge
  // --------------------------------------------------------------------------

  async processStream(params: {
    sessionId: string;
    input: string;
    userId?: string;
    channelType?: ChannelType;
  }): Promise<GatewayStreamResult | string> {
    const session = this.sessions.get(params.sessionId);

    // Build minimal AgentInput from gateway params
    const agentInput: AgentInput = {
      userMessage: params.input,
      activatedSkills: [],
      recalledMemories: [],
      conversationHistory: [],
      mentalModel: DEFAULT_MENTAL_MODEL,
      ...(this.cognitionContent.length > 0 ? { cognitionText: this.cognitionContent } : {}),
    };

    const agentConfig: AgentConfig = {
      mode: "conversation",
      maxIterations: 25,
      timeout: 120000,
      sessionId: params.sessionId,
      userId: params.userId ?? session?.userId ?? "anonymous",
      isSubAgent: false,
      debugEnabled: false,
    };

    // Start Agent execution
    const generator = this.agent.execute(agentInput, agentConfig);

    // Collect text deltas and build streams
    const textChunks: string[] = [];
    let finalResponseResolve: (value: string) => void;
    const finalResponsePromise = new Promise<string>((resolve) => {
      finalResponseResolve = resolve;
    });

    // Create the text stream async generator
    async function* createTextStream(): AsyncGenerator<string> {
      let iter = await generator.next();
      while (!iter.done) {
        const event: AgentEvent = iter.value;
        if (event.type === "text_delta" && "delta" in event) {
          const delta = (event as { delta: string }).delta;
          textChunks.push(delta);
          yield delta;
        }
        iter = await generator.next();
      }

      // Extract final response from AgentResult
      const result: AgentResult = iter.value;
      finalResponseResolve!(result.finalResponse);
    }

    // Create the full event stream
    async function* createFullStream(
      textStream: AsyncGenerator<string>,
    ): AsyncGenerator<AnyStreamEvent> {
      for await (const delta of textStream) {
        yield {
          type: StreamEventType.TEXT_DELTA,
          text: delta,
          isFinal: false,
          timestamp: new Date(),
        };
      }

      const finalText = textChunks.join("");
      yield {
        type: StreamEventType.TEXT_COMPLETE,
        text: finalText,
        timestamp: new Date(),
      };
    }

    const textStream = createTextStream();
    const fullStream = createFullStream(textStream);

    // Update session activity
    if (session !== undefined) {
      session.lastActiveAt = new Date();
    }

    return {
      textStream,
      fullStream,
      finalResponse: finalResponsePromise,
    };
  }

  // --------------------------------------------------------------------------
  // Session management
  // --------------------------------------------------------------------------

  createSession(params: {
    sessionId: string;
    userId: string;
    channelType: ChannelType;
  }): void {
    const now = new Date();
    this.sessions.set(params.sessionId, {
      sessionId: params.sessionId,
      userId: params.userId,
      channelType: params.channelType,
      createdAt: now,
      lastActiveAt: now,
    });
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSession(sessionId: string): SessionInfo | null {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return null;
    }
    return {
      sessionId: state.sessionId,
      userId: state.userId,
      channelType: state.channelType,
      createdAt: state.createdAt,
      lastActiveAt: state.lastActiveAt,
      metadata: {},
    };
  }

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  async executeTool(
    _sessionId: string,
    _toolCall: ToolCall,
  ): Promise<string> {
    // Tool execution is handled internally by Agent's ReAct loop
    return "Tool execution delegated to Agent";
  }
}
