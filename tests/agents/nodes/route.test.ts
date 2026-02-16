/**
 * L3 Agent 编排层 - 路由节点测试
 */

import { describe, it, expect } from 'vitest';
import { routeNode } from '@/agents/nodes/route';
import { createInitialState, AgentRole, IntentType } from '@/agents';
import type { AgentState, RouteNodeDeps } from '@/agents';

describe('Route Node', () => {
  const deps: RouteNodeDeps = {};

  describe('intent classification', () => {
    it('should classify conversation keywords as conversation', async () => {
      const state = createInitialState('session-1', 'user-1', '你好，今天怎么样？');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.intent).toBe(IntentType.CONVERSATION);
      expect(result.currentAgent).toBe(AgentRole.CONVERSATION);
    });

    it('should classify question as conversation', async () => {
      const state = createInitialState('session-1', 'user-1', '你觉得怎么样？');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.intent).toBe(IntentType.CONVERSATION);
    });

    it('should classify task keywords as task', async () => {
      const state = createInitialState('session-1', 'user-1', '帮我写一个函数');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.intent).toBe(IntentType.TASK);
      expect(result.currentAgent).toBe(AgentRole.TASK);
    });

    it('should classify command-style input as task', async () => {
      const state = createInitialState('session-1', 'user-1', '请搜索一下这个主题');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.intent).toBe(IntentType.TASK);
    });

    it('should default to conversation for ambiguous input', async () => {
      const state = createInitialState('session-1', 'user-1', '随便说说');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.intent).toBe(IntentType.CONVERSATION);
    });

    it('should provide confidence score', async () => {
      const state = createInitialState('session-1', 'user-1', '你好');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.confidence).toBeGreaterThan(0);
      expect(result.routeDecision?.confidence).toBeLessThanOrEqual(1);
    });

    it('should provide reason for decision', async () => {
      const state = createInitialState('session-1', 'user-1', '你好');
      const result = await routeNode(state, deps);

      expect(result.routeDecision?.reason).toBeDefined();
      expect(result.routeDecision?.reason.length).toBeGreaterThan(0);
    });
  });

  describe('state updates', () => {
    it('should not modify original state', async () => {
      const state = createInitialState('session-1', 'user-1', '你好');
      const originalInput = state.currentInput;

      await routeNode(state, deps);

      expect(state.currentInput).toBe(originalInput);
    });

    it('should only return partial state', async () => {
      const state = createInitialState('session-1', 'user-1', '你好');
      const result = await routeNode(state, deps);

      // Result should only contain route-specific fields
      expect(Object.keys(result)).toEqual(expect.arrayContaining(['routeDecision', 'currentAgent']));
      expect(result).not.toHaveProperty('sessionId');
      expect(result).not.toHaveProperty('currentInput');
    });
  });
});
