/**
 * Gateway Orchestrator
 * 处理流式消息和工具调用
 */

import type {
  GatewayStreamResult,
  StreamCallbacks,
  IOrchestrator,
  ToolCall,
} from "./types.js";
import type { SessionManager } from "./session-manager.js";
import type { StreamHandler } from "./stream-handler.js";
import type { SessionSettingRegistry } from "./session-setting-registry.js";
import { GatewayError, InputValidationError } from "./errors.js";

/**
 * 流处理器
 * 负责处理用户输入流和工具调用
 */
export class GatewayOrchestrator {
  constructor(
    private readonly orchestrator: IOrchestrator,
    private readonly streamHandler: StreamHandler,
    private readonly settingRegistry: SessionSettingRegistry,
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
        "SESSION_NOT_FOUND",
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

    // 调用 orchestrator
    const session = sessionManager.get(sessionId);
    const result = await this.orchestrator.processStream({
      sessionId,
      input: trimmedInput,
      ...(userId ? { userId } : {}),
      ...(session?.channelType ? { channelType: session.channelType } : {}),
    });

    // 如果返回字符串，包装为流结果
    if (typeof result === "string") {
      const textStream = this.streamHandler.textStreamFromChunks([result]);
      return this.streamHandler.createStreamResult(textStream, callbacks);
    }

    // 使用 createStreamResult 统一处理
    const streamResult = this.streamHandler.createStreamResult(
      result.textStream,
      callbacks,
    );

    // KURISU-033: 传递审批字段到 Channel 层（不可变构造）
    if ("approvalRequired" in result && result.approvalRequired) {
      return {
        ...streamResult,
        approvalRequired: true,
        ...("approvalMessage" in result &&
          typeof result.approvalMessage === "string" && {
            approvalMessage: result.approvalMessage,
          }),
        ...("pendingToolCall" in result &&
          result.pendingToolCall && {
            pendingToolCall: result.pendingToolCall,
          }),
      };
    }

    return streamResult;
  }

  /**
   * 执行已批准的工具
   */
  async executeApprovedTool(
    sessionId: string,
    toolCall: ToolCall,
  ): Promise<string> {
    // 检查 orchestrator 是否支持 executeTool
    if (!this.orchestrator.executeTool) {
      throw new GatewayError(
        "Orchestrator does not support tool execution",
        "TOOL_EXECUTION_NOT_SUPPORTED",
      );
    }

    return this.orchestrator.executeTool(sessionId, toolCall);
  }
}
