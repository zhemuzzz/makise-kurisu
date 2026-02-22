/**
 * L3 Agent 编排层 - Orchestrator 主类
 *
 * 对外统一接口，隐藏 LangGraph 实现细节
 */

import type {
  AgentState,
  AgentResult,
  OrchestratorConfig,
  OrchestratorDeps,
  StreamResult,
} from "./types";
import type { ToolCall, ToolResult } from "../tools/types";
import { DEFAULT_ORCHESTRATOR_CONFIG, createInitialState } from "./types";
import { createAgentWorkflow } from "./workflow";
import { OrchestratorError } from "./errors";

/**
 * Agent Orchestrator
 *
 * 基于 LangGraph 的状态机编排器
 * 整合 L2 人设引擎 + L4 记忆系统 + L5 模型配置
 */
export class AgentOrchestrator {
  private readonly config: OrchestratorConfig;
  private readonly deps: OrchestratorDeps;
  private readonly workflow: ReturnType<typeof createAgentWorkflow>;

  constructor(
    deps: OrchestratorDeps,
    config: Partial<OrchestratorConfig> = {},
  ) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.deps = deps;
    this.workflow = createAgentWorkflow(deps, this.config);
  }

  /**
   * 处理用户输入（非流式）
   *
   * @param sessionId - 会话 ID
   * @param userId - 用户 ID
   * @param input - 用户输入
   * @returns Agent 执行结果
   */
  async process(
    sessionId: string,
    userId: string,
    input: string,
  ): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // 确保会话存在
      if (!this.deps.memoryEngine.hasSession(sessionId)) {
        this.deps.memoryEngine.createSession(sessionId);
      }

      // 创建初始状态
      const initialState = createInitialState(sessionId, userId, input);

      // 执行工作流
      const finalState = (await this.workflow.invoke(
        initialState,
      )) as AgentState;

      // 检查是否有审批等待
      const approvalState = finalState.approvalState;
      const approvalRequired = approvalState?.status === "pending";

      return {
        success: finalState.currentResponse !== null || approvalRequired,
        response: approvalRequired
          ? approvalState.message
          : (finalState.currentResponse ?? ""),
        context: finalState.context,
        validation: finalState.personaValidation,
        latency: Date.now() - startTime,
        // 审批相关字段
        ...(approvalRequired && {
          approvalRequired: true,
          approvalMessage: approvalState.message,
          pendingToolCall: approvalState.toolCall,
        }),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new OrchestratorError("process", err.message, { cause: err });
    }
  }

  /**
   * 处理用户输入（流式）
   *
   * MVP 阶段：流式响应直接通过模型 stream 实现
   * 完整流式需要在节点层面支持
   *
   * @param sessionId - 会话 ID
   * @param userId - 用户 ID
   * @param input - 用户输入
   * @returns 流式响应
   */
  async processStream(
    sessionId: string,
    _userId: string,
    input: string,
  ): Promise<StreamResult> {
    // 确保会话存在
    if (!this.deps.memoryEngine.hasSession(sessionId)) {
      this.deps.memoryEngine.createSession(sessionId);
    }

    const model = this.deps.modelProvider.getByTask("conversation");
    const systemPrompt = this.deps.personaEngine.getSystemPrompt();
    const recentMessages = this.deps.memoryEngine.getRecentMessages(
      sessionId,
      this.config.maxContextMessages,
    );

    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...recentMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: input },
    ];

    const chunks = model.stream(messages, {
      temperature: 0.8,
      maxTokens: 1024,
    });

    // 收集完整响应用于记忆存储
    let fullResponse = "";
    const finalResponse = (async () => {
      for await (const chunk of chunks) {
        if (chunk.delta) {
          fullResponse += chunk.delta;
        }
      }

      // 人设强化
      const enforced = this.deps.personaEngine.enforcePersona(fullResponse);

      // 记录消息
      this.deps.memoryEngine.addSessionMessage(sessionId, input, "user");
      this.deps.memoryEngine.addSessionMessage(
        sessionId,
        enforced,
        "assistant",
      );

      return enforced;
    })();

    return {
      chunks,
      finalResponse,
    };
  }

  /**
   * 创建新会话
   *
   * @param sessionId - 可选的会话 ID，不提供则自动生成
   * @returns 会话 ID
   */
  createSession(sessionId?: string): string {
    const id = sessionId ?? this.generateSessionId();
    this.deps.memoryEngine.createSession(id);
    return id;
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionId: string): boolean {
    return this.deps.memoryEngine.hasSession(sessionId);
  }

  /**
   * 执行已批准的工具
   *
   * 当用户确认执行 confirm 级工具后，调用此方法执行
   *
   * @param sessionId - 会话 ID（用于日志和上下文）
   * @param toolCall - 工具调用请求
   * @returns 工具执行结果
   */
  async executeTool(
    _sessionId: string,
    toolCall: ToolCall,
  ): Promise<ToolResult> {
    // 检查是否有 toolRegistry 依赖
    if (!this.deps.toolRegistry) {
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        output: null,
        error: "ToolRegistry not configured in OrchestratorDeps",
        latency: 0,
      };
    }

    const startTime = Date.now();

    try {
      const result = await this.deps.toolRegistry.execute(toolCall);
      return result;
    } catch (error) {
      return {
        callId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 静态工厂方法
   */
  static create(
    deps: OrchestratorDeps,
    config?: Partial<OrchestratorConfig>,
  ): AgentOrchestrator {
    return new AgentOrchestrator(deps, config);
  }
}
