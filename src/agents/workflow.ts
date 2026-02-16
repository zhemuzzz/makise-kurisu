/**
 * L3 Agent 编排层 - LangGraph 工作流
 *
 * 组装状态机：START → context_build → route → conversation/task → validate → enforce → END
 */

import { StateGraph, END, START } from "@langchain/langgraph";
import type { OrchestratorDeps, OrchestratorConfig } from "./types";
import { DEFAULT_ORCHESTRATOR_CONFIG } from "./types";
import { intentRouter, validationRouter } from "./routers";

// 节点工厂
import { createContextBuildNode } from "./nodes/context-build";
import { createRouteNode } from "./nodes/route";
import { createGenerateNode } from "./nodes/generate";
import { createValidateNode } from "./nodes/validate";
import { createEnforceNode } from "./nodes/enforce";

/**
 * 创建 Agent 工作流
 */
export function createAgentWorkflow(
  deps: OrchestratorDeps,
  config: Partial<OrchestratorConfig> = {},
) {
  const fullConfig: OrchestratorConfig = {
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    ...config,
  };

  // 创建节点
  const contextBuildNode = createContextBuildNode({
    memoryEngine: deps.memoryEngine,
  });

  const routeNode = createRouteNode({});

  const generateNode = createGenerateNode({
    modelProvider: deps.modelProvider,
    personaEngine: deps.personaEngine,
    memoryEngine: deps.memoryEngine,
    maxContextMessages: fullConfig.maxContextMessages,
  });

  const validateNodeInst = createValidateNode({
    personaEngine: deps.personaEngine,
    maxRetries: fullConfig.maxRetries,
  });

  const enforceNodeInst = createEnforceNode({
    personaEngine: deps.personaEngine,
    memoryEngine: deps.memoryEngine,
  });

  // 构建状态图 - 使用 null 表示默认 reducer
  // LangGraph 类型推断问题，使用类型断言绕过
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channels = {
    sessionId: null,
    userId: null,
    currentInput: null,
    currentResponse: null,
    messages: null,
    currentAgent: null,
    routeDecision: null,
    personaValidation: null,
    retryCount: null,
    context: null,
    createdAt: null,
    updatedAt: null,
    metadata: null,
  } as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflow: any = new StateGraph({ channels });

  // 添加节点
  workflow
    .addNode("context_build", contextBuildNode)
    .addNode("route", routeNode)
    .addNode("conversation", generateNode)
    .addNode("task", generateNode)
    .addNode("validate", validateNodeInst)
    .addNode("enforce", enforceNodeInst);

  // 定义边：START → context_build → route
  workflow.addEdge(START, "context_build").addEdge("context_build", "route");

  // 条件路由：route → conversation/task
  workflow.addConditionalEdges("route", intentRouter, {
    conversation: "conversation",
    task: "task",
  });

  // Agent → validate
  workflow.addEdge("conversation", "validate").addEdge("task", "validate");

  // 条件路由：validate → enforce/retry
  workflow.addConditionalEdges("validate", validationRouter, {
    end: "enforce",
    conversation: "conversation",
    task: "task",
  });

  // enforce → END
  workflow.addEdge("enforce", END);

  return workflow.compile();
}

/**
 * 工作流类型导出
 */
export type CompiledWorkflow = ReturnType<typeof createAgentWorkflow>;
