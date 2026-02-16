/**
 * 路由节点
 *
 * 根据用户输入判断意图，决定使用哪个 Agent
 */

import type { AgentState, RouteNodeDeps, RouteDecision } from '../types';
import { AgentRole, IntentType } from '../types';

// 任务关键词
const TASK_KEYWORDS = [
  '帮我', '请', '执行', '搜索', '查询', '计算',
  '创建', '删除', '修改', '发送', '下载', '打开',
  '设置', '配置', '分析', '比较', '列出',
];

// 对话关键词
const CONVERSATION_KEYWORDS = [
  '你好', '怎么样', '觉得', '想', '感觉',
  '喜欢', '讨厌', '为什么', '什么', '怎么',
  '是不是', '对不对', '呢', '吗',
];

/**
 * 意图分类（基于规则）
 */
function classifyIntent(input: string): RouteDecision {
  const normalizedInput = input.toLowerCase();

  // 计算关键词匹配分数
  const taskScore = TASK_KEYWORDS.filter(kw => normalizedInput.includes(kw)).length;
  const convScore = CONVERSATION_KEYWORDS.filter(kw => normalizedInput.includes(kw)).length;

  // 问号结尾通常是对话
  const isQuestion = input.includes('?') || input.includes('？');

  // 感叹号结尾可能是任务请求
  const isCommand = input.includes('!') || input.includes('！');

  // 计算最终分数
  const finalTaskScore = taskScore + (isCommand ? 1 : 0);
  const finalConvScore = convScore + (isQuestion ? 2 : 0);

  // 决策
  if (finalTaskScore > finalConvScore) {
    return {
      intent: IntentType.TASK,
      confidence: Math.min(0.5 + finalTaskScore * 0.1, 0.95),
      reason: 'Task keywords detected',
    };
  }

  return {
    intent: IntentType.CONVERSATION,
    confidence: Math.min(0.5 + finalConvScore * 0.1, 0.95),
    reason: finalConvScore > 0 ? 'Conversation keywords detected' : 'Default to conversation',
  };
}

/**
 * 创建路由节点
 */
export function createRouteNode(_deps: RouteNodeDeps) {
  return async function routeNode(state: AgentState): Promise<Partial<AgentState>> {
    const decision = classifyIntent(state.currentInput);

    return {
      routeDecision: decision,
      currentAgent: decision.intent === IntentType.TASK
        ? AgentRole.TASK
        : AgentRole.CONVERSATION,
    };
  };
}

/**
 * 直接导出节点函数（用于测试）
 */
export async function routeNode(
  state: AgentState,
  deps: RouteNodeDeps,
): Promise<Partial<AgentState>> {
  const node = createRouteNode(deps);
  return node(state);
}
