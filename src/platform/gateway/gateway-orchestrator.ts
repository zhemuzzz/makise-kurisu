/**
 * Gateway Orchestrator
 *
 * KURISU-041: 直接持有 AgentHandle，不再通过 IOrchestrator 兼容层。
 * 核心职责: 构建 AgentInput → 调用 Agent.execute() → 转换为 GatewayStreamResult
 */

import type {
  GatewayStreamResult,
  StreamCallbacks,
  AgentHandle,
  ToolCall,
  AnyStreamEvent,
  TracingServiceLike,
} from "./types.js";
import { StreamEventType } from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { StreamHandler } from "./stream-handler.js";
import type { SessionSettingRegistry } from "./session-setting-registry.js";
import { GatewayError, InputValidationError } from "./errors.js";
import type {
  AgentConfig,
  AgentEvent,
  AgentInput,
  AgentResult,
  MentalModelSnapshot,
} from "../../agent/types.js";
import type { RelationshipStage } from "../../inner-life/types.js";

// ============================================================================
// Stage Conversion Constants
// ============================================================================

const STAGE_TO_NUMBER: Readonly<Record<RelationshipStage, number>> = {
  stranger: 1,
  acquaintance: 2,
  familiar: 3,
  friend: 4,
  close_friend: 5,
};

const STAGE_DESCRIPTIONS: Readonly<Record<RelationshipStage, string>> = {
  stranger: "陌生人",
  acquaintance: "认识",
  familiar: "熟悉",
  friend: "朋友",
  close_friend: "挚友",
};

const DEFAULT_MENTAL_MODEL: MentalModelSnapshot = {
  mood: { pleasure: 0, arousal: 0, dominance: 0 },
  activeEmotions: [],
  relationshipStage: 1,
  relationshipDescription: "",
  formattedText: "",
};

// ============================================================================
// GatewayOrchestrator
// ============================================================================

/**
 * 流处理器
 * 负责处理用户输入流和工具调用
 */
export class GatewayOrchestrator {
  constructor(
    private readonly agentHandle: AgentHandle,
    private readonly streamHandler: StreamHandler,
    private readonly settingRegistry: SessionSettingRegistry,
    private readonly tracing?: TracingServiceLike,
  ) {}

  /**
   * 处理流
   */
  async processStream(
    sessionManager: SessionManager,
    sessionId: string,
    input: string,
    userId?: string,
    callbacks?: StreamCallbacks,
  ): Promise<GatewayStreamResult> {
    // 验证输入
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      throw new InputValidationError("Invalid input: cannot be empty");
    }

    // 确保会话存在
    if (!sessionManager.has(sessionId)) {
      if (!userId) {
        throw new GatewayError("userId is required for new session");
      }

      throw new GatewayError(
        "Session must be created before processing stream",
        "session_not_found",
      );
    }

    // 更新活跃时间
    sessionManager.touch(sessionId);

    // KURISU-024: 使用 SessionSettingRegistry 统一处理会话设置流水线
    const pipelineResult = await this.settingRegistry.processPipeline(
      sessionId,
      trimmedInput,
    );

    if (pipelineResult.handled) {
      const textStream = this.streamHandler.textStreamFromChunks([
        pipelineResult.message ?? "",
      ]);
      const streamResult = this.streamHandler.createStreamResult(
        textStream,
        callbacks,
      );

      if (pipelineResult.requiresApproval && pipelineResult.approvalMessage) {
        return {
          ...streamResult,
          approvalRequired: true,
          approvalMessage: pipelineResult.approvalMessage,
        };
      }

      return streamResult;
    }

    // 构建 AgentInput 并调用 Agent.execute()
    const session = sessionManager.get(sessionId);
    const resolvedUserId = userId ?? session?.userId ?? "anonymous";

    return this.executeAgent(sessionId, trimmedInput, resolvedUserId, callbacks);
  }

  /**
   * 执行已批准的工具
   */
  async executeApprovedTool(
    _sessionId: string,
    _toolCall: ToolCall,
  ): Promise<string> {
    // Tool execution is handled internally by Agent's ReAct loop
    return "Tool execution delegated to Agent";
  }

  // --------------------------------------------------------------------------
  // Agent Execution
  // --------------------------------------------------------------------------

  /**
   * 构建 AgentInput → 调用 Agent.execute() → 转换为 GatewayStreamResult
   */
  private async executeAgent(
    sessionId: string,
    input: string,
    userId: string,
    callbacks?: StreamCallbacks,
  ): Promise<GatewayStreamResult> {
    const { agent, getCognition, personaEngine } = this.agentHandle;
    const startTime = Date.now();

    this.tracing?.log({
      level: "info",
      category: "gateway",
      event: "gateway:agent_start",
      sessionId,
      data: { userId, inputLength: input.length },
      timestamp: startTime,
    });

    // Build AgentInput
    const cognition = getCognition();
    const mentalModel = this.buildMentalModel(userId);
    const agentInput: AgentInput = {
      userMessage: input,
      activatedSkills: [],
      recalledMemories: [],
      conversationHistory: [],
      mentalModel,
      ...(cognition.length > 0 ? { cognitionText: cognition } : {}),
    };

    const agentConfig: AgentConfig = {
      mode: "conversation",
      maxIterations: 25,
      timeout: 120000,
      sessionId,
      userId,
      isSubAgent: false,
      debugEnabled: false,
    };

    // Start Agent execution
    const generator = agent.execute(agentInput, agentConfig);

    // Collect text deltas and build streams
    const textChunks: string[] = [];
    let finalResponseResolve: (value: string) => void;
    const finalResponsePromise = new Promise<string>((resolve) => {
      finalResponseResolve = resolve;
    });

    // Create the text stream async generator with error handling
    const pe = personaEngine;
    const tracing = this.tracing;
    async function* createTextStream(): AsyncGenerator<string> {
      try {
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
        const durationMs = Date.now() - startTime;

        // Trace agent completion
        if (result.error) {
          tracing?.log({
            level: "warn",
            category: "gateway",
            event: "gateway:agent_degraded",
            sessionId,
            errorCode: result.error.type,
            data: {
              message: result.error.message,
              degraded: result.degraded,
              responseLength: result.finalResponse.length,
              durationMs,
            },
            timestamp: Date.now(),
          });
        } else {
          tracing?.log({
            level: "info",
            category: "gateway",
            event: "gateway:agent_complete",
            sessionId,
            data: {
              success: result.success,
              degraded: result.degraded,
              responseLength: result.finalResponse.length,
              toolCallCount: result.toolCalls.length,
              durationMs,
            },
            timestamp: Date.now(),
          });
        }

        finalResponseResolve!(result.finalResponse);

        // Post-turn ILE update: feed emotion tags back to PersonaEngine
        if (pe !== null && result.emotionTags.length > 0) {
          pe.processTurn(userId, result.emotionTags, "text_chat");
        }
      } catch (error) {
        const durationMs = Date.now() - startTime;
        tracing?.log({
          level: "error",
          category: "gateway",
          event: "gateway:agent_error",
          sessionId,
          errorCode: "gateway_error",
          data: {
            error: error instanceof Error ? error.message : String(error),
            durationMs,
          },
          timestamp: Date.now(),
        });

        const fallback = "抱歉，处理你的消息时出了点问题。再试一次？";
        yield fallback;
        finalResponseResolve!(fallback);
      }
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

    // Wrap with StreamHandler for callback support
    const streamResult = this.streamHandler.createStreamResult(
      textStream,
      callbacks,
    );

    return {
      ...streamResult,
      fullStream,
      finalResponse: finalResponsePromise,
    };
  }

  // --------------------------------------------------------------------------
  // ILE Integration
  // --------------------------------------------------------------------------

  /**
   * 构建 MentalModel 快照（从 PersonaEngine 获取情绪/关系状态）
   */
  private buildMentalModel(userId: string): MentalModelSnapshot {
    const { personaEngine } = this.agentHandle;

    if (personaEngine === null) {
      return DEFAULT_MENTAL_MODEL;
    }

    const segments = personaEngine.buildContext(userId, {
      type: "private",
      targetUserId: userId,
    });

    // Extract relationship info from debug snapshot
    const snapshot = personaEngine.getDebugSnapshot(userId);
    const relationship = snapshot.relationships[userId];
    const stage = relationship?.stage ?? "stranger";
    const projection = snapshot.userProjections[userId];
    const mood = projection?.projectedMood ?? {
      pleasure: 0,
      arousal: 0,
      dominance: 0,
      updatedAt: Date.now(),
    };
    const emotions = projection?.recentEmotions ?? [];

    return {
      mood: {
        pleasure: mood.pleasure,
        arousal: mood.arousal,
        dominance: mood.dominance,
      },
      activeEmotions: emotions.map((e) => e.tag),
      relationshipStage: STAGE_TO_NUMBER[stage],
      relationshipDescription: STAGE_DESCRIPTIONS[stage],
      formattedText: segments.mentalModel.join("\n"),
    };
  }
}
