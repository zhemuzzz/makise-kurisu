/**
 * 响应生成节点
 *
 * 调用模型生成响应，支持 function calling
 */

import type { AgentState, GenerateNodeDeps, AgentMessage } from "../types";
import type { Message as MemoryMessage } from "../../memory";
import type { Message, ChatOptions } from "../../config/models";
import type { ToolCall as KurisuToolCall } from "../../tools/types";
import { AgentRole } from "../types";
import { ModelInvocationError } from "../errors";

/**
 * 构建模型消息列表
 */
function buildModelMessages(
  systemPrompt: string,
  recentMessages: MemoryMessage[],
  currentInput: string,
): MemoryMessage[] {
  return [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...recentMessages,
    { role: "user", content: currentInput, timestamp: Date.now() },
  ];
}

/**
 * 将工具结果转换为 OpenAI 消息格式
 */
function buildToolResultMessages(
  toolResults: AgentState["toolResults"],
): Message[] {
  return toolResults.map(
    (result): Message => ({
      role: "tool" as const,
      tool_call_id: result.callId,
      content: result.success
        ? JSON.stringify(result.output)
        : JSON.stringify({ error: result.error }),
    }),
  );
}

/**
 * 将 LLMToolCall 转换为 Kurisu ToolCall
 */
function convertLLMToolCalls(
  llmToolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>,
): KurisuToolCall[] {
  return llmToolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
  }));
}

/**
 * 创建对话生成节点
 */
export function createGenerateNode(deps: GenerateNodeDeps) {
  const {
    modelProvider,
    personaEngine,
    memoryEngine,
    maxContextMessages,
    toolRegistry,
  } = deps;

  return async function generateNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const {
      sessionId,
      currentInput,
      currentAgent,
      availableTools,
      toolResults,
      toolCallIteration,
    } = state;

    try {
      // 1. 获取模型（根据 Agent 类型）
      const taskType =
        currentAgent === AgentRole.TASK ? "code" : "conversation";
      const model = modelProvider.getByTask(taskType);

      // 2. 获取系统提示词
      const systemPrompt = personaEngine.getSystemPrompt();

      // 3. 获取最近消息
      const recentMessages = memoryEngine.getRecentMessages(
        sessionId,
        maxContextMessages,
      );

      // 4. 构建基础消息
      const baseMessages = buildModelMessages(
        systemPrompt,
        recentMessages,
        currentInput,
      );

      // 5. 构建消息列表（包括工具结果）
      const messages: Message[] = [
        ...baseMessages.map(
          (m): Message => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          }),
        ),
        ...buildToolResultMessages(toolResults),
      ];

      // 6. 构建调用选项
      const chatOptions: ChatOptions = {
        temperature: currentAgent === AgentRole.TASK ? 0.7 : 0.8,
        maxTokens: currentAgent === AgentRole.TASK ? 2048 : 1024,
      };

      // 7. 添加工具（如果有可用工具）
      if (availableTools.length > 0 && toolRegistry) {
        chatOptions.tools = toolRegistry.toOpenAIFormat(
          availableTools.map((t) => t.name),
        );
      }

      // 8. 调用模型
      const response = await model.chat(messages, chatOptions);

      // 9. 处理响应
      const now = Date.now();
      const newUserMessage: AgentMessage = {
        id: `msg-${now}-user`,
        role: "user",
        content: currentInput,
        timestamp: now,
        ...(currentAgent ? { agent: currentAgent } : {}),
      };

      const newAssistantMessage: AgentMessage = {
        id: `msg-${now}-assistant`,
        role: "assistant",
        content: response.content,
        timestamp: now,
        ...(currentAgent ? { agent: currentAgent } : {}),
      };

      // 10. 检查是否有工具调用
      const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
      const pendingToolCalls = hasToolCalls
        ? convertLLMToolCalls(response.toolCalls!)
        : [];

      return {
        currentResponse: response.content || null,
        messages: [newUserMessage, newAssistantMessage],
        // 如果有工具调用，设置 pendingToolCalls
        ...(pendingToolCalls.length > 0
          ? {
              pendingToolCalls,
              toolCallIteration: toolCallIteration + 1,
              // 清空上一次的工具结果
              toolResults: [],
            }
          : {
              // 没有工具调用，清空
              pendingToolCalls: [],
            }),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new ModelInvocationError(
        modelProvider.getByTask("conversation").name,
        err.message,
        { cause: err },
      );
    }
  };
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function generateNode(
  state: AgentState,
  deps: GenerateNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createGenerateNode(deps);
  return node(state);
}
