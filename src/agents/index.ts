/**
 * Agent 编排层
 * 基于 LangGraph 状态机驱动
 */

export enum AgentRole {
  LEAD = 'lead',
  CONVERSATION = 'conversation',
  TASK = 'task',
}

export interface Agent {
  role: AgentRole;
  systemPrompt: string;
}

// TODO: 实现 Agent 编排
