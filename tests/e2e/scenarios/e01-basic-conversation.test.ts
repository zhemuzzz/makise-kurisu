/**
 * E01: 基础对话流程测试
 *
 * 验证用户输入 → 流式响应的完整链路
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Gateway } from "../../../src/gateway";
import {
  createMockOrchestratorForGateway,
  MOCK_KURISU_RESPONSE,
  generateTestSessionId,
  generateTestUserId,
} from "../fixtures/e2e-fixtures";
import { collectStream, collectStreamText } from "../setup";

describe("E01: Basic Conversation Flow", () => {
  let gateway: Gateway;
  let sessionId: string;
  const userId = generateTestUserId();

  beforeEach(async () => {
    const mockOrchestrator = createMockOrchestratorForGateway();
    gateway = new Gateway({ orchestrator: mockOrchestrator });
    await gateway.start();
    sessionId = generateTestSessionId();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it("should process user input and return streaming response", async () => {
    const result = await gateway.processStream(sessionId, "你好", userId);

    // 验证返回结构
    expect(result).toHaveProperty("textStream");
    expect(result).toHaveProperty("fullStream");
    expect(result).toHaveProperty("finalResponse");
  });

  it("should collect full response from stream chunks", async () => {
    const result = await gateway.processStream(sessionId, "你好", userId);

    // 消费流
    const fullText = await collectStreamText(result.textStream);

    // 验证响应不为空
    expect(fullText.length).toBeGreaterThan(0);
  });

  it("should resolve finalResponse to complete text", async () => {
    const result = await gateway.processStream(sessionId, "你好", userId);

    // 等待最终响应
    const finalResponse = await result.finalResponse;

    expect(finalResponse).toBeDefined();
    expect(typeof finalResponse).toBe("string");
    expect(finalResponse.length).toBeGreaterThan(0);
  });

  it("should respect streaming callbacks (onChunk, onComplete)", async () => {
    const chunks: string[] = [];
    let completeText = "";

    const result = await gateway.processStream(sessionId, "你好", userId, {
      onChunk: (chunk) => {
        chunks.push(chunk);
      },
      onComplete: (text) => {
        completeText = text;
      },
    });

    // 消费流以触发回调
    await collectStreamText(result.textStream);

    // 验证回调被调用
    expect(chunks.length).toBeGreaterThan(0);
    expect(completeText.length).toBeGreaterThan(0);
  });

  it("should handle multi-turn conversation", async () => {
    // 第一轮
    const result1 = await gateway.processStream(sessionId, "你好", userId);
    const response1 = await result1.finalResponse;
    expect(response1).toBeDefined();

    // 第二轮
    const result2 = await gateway.processStream(
      sessionId,
      "在做什么？",
      userId,
    );
    const response2 = await result2.finalResponse;
    expect(response2).toBeDefined();

    // 第三轮
    const result3 = await gateway.processStream(sessionId, "再见", userId);
    const response3 = await result3.finalResponse;
    expect(response3).toBeDefined();
  });

  it("should handle concurrent requests independently", async () => {
    const sessionId2 = generateTestSessionId();
    const sessionId3 = generateTestSessionId();

    // 并发处理三个会话
    const [result1, result2, result3] = await Promise.all([
      gateway.processStream(sessionId, "问题1", userId),
      gateway.processStream(sessionId2, "问题2", userId),
      gateway.processStream(sessionId3, "问题3", userId),
    ]);

    // 验证所有请求都成功
    const [resp1, resp2, resp3] = await Promise.all([
      result1.finalResponse,
      result2.finalResponse,
      result3.finalResponse,
    ]);

    expect(resp1).toBeDefined();
    expect(resp2).toBeDefined();
    expect(resp3).toBeDefined();
  });

  it("should update session lastActiveAt on each request", async () => {
    // 创建会话
    await gateway.processStream(sessionId, "你好", userId);
    const session1 = gateway.getSession(sessionId);
    expect(session1).not.toBeNull();

    // 等待一小段时间
    await new Promise((resolve) => setTimeout(resolve, 10));

    // 再次请求
    await gateway.processStream(sessionId, "你好", userId);
    const session2 = gateway.getSession(sessionId);
    expect(session2).not.toBeNull();

    // lastActiveAt 应该更新
    expect(session2!.lastActiveAt.getTime()).toBeGreaterThanOrEqual(
      session1!.lastActiveAt.getTime(),
    );
  });
});
