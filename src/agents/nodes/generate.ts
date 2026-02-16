/**
 * 响应生成节点
 *
 * 调用模型生成响应
 */

import type { AgentState, GenerateNodeDeps, AgentMessage } from "../types";
import type { Message } from "../../memory";
import { AgentRole } from "../types";
import { ModelInvocationError } from "../errors";

/**
 * 构建模型消息列表
 */
function buildModelMessages(
  systemPrompt: string,
  recentMessages: Message[],
  currentInput: string,
): Message[] {
  return [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    ...recentMessages,
    { role: "user", content: currentInput, timestamp: Date.now() },
  ];
}

/**
 * 创建对话生成节点
 */
export function createGenerateNode(deps: GenerateNodeDeps) {
  const { modelProvider, personaEngine, memoryEngine, maxContextMessages } =
    deps;

  return async function generateNode(
    state: AgentState,
  ): Promise<Partial<AgentState>> {
    const { sessionId, currentInput, currentAgent } = state;

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

      // 4. 构建消息
      const messages = buildModelMessages(
        systemPrompt,
        recentMessages,
        currentInput,
      );

      // 5. 调用模型
      const response = await model.chat(
        messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        {
          temperature: currentAgent === AgentRole.TASK ? 0.7 : 0.8,
          maxTokens: currentAgent === AgentRole.TASK ? 2048 : 1024,
        },
      );

      // 6. 构建新消息记录
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

      return {
        currentResponse: response.content,
        messages: [newUserMessage, newAssistantMessage],
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
