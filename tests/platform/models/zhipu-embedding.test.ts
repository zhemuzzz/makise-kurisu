/**
 * Zhipu Embedding 模型测试
 *
 * KURISU-028 Phase 1: T1.6 - T1.9
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createZhipuEmbeddingModel } from "../../../src/platform/models/zhipu-embedding";
import type { IModel } from "../../../src/platform/models/types";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("ZhipuEmbeddingModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("T1.6: embed() 返回正确维度向量", async () => {
    const model = createZhipuEmbeddingModel({
      apiKey: "test-key",
      endpoint: "https://open.bigmodel.cn/api/paas/v4",
    });

    // Mock API 响应
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: [{ embedding: Array.from({ length: 2048 }, () => Math.random()) }],
        }),
    });

    const result = await model.embed!(["test text"]);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2048);
  });

  it("T1.7: embed() 批量输入返回批量结果", async () => {
    const model = createZhipuEmbeddingModel({
      apiKey: "test-key",
      endpoint: "https://open.bigmodel.cn/api/paas/v4",
    });

    const inputs = ["text1", "text2", "text3"];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          data: inputs.map(() => ({
            embedding: Array.from({ length: 2048 }, () => Math.random()),
          })),
        }),
    });

    const result = await model.embed!(inputs);
    expect(result).toHaveLength(3);
    result.forEach((vec) => expect(vec).toHaveLength(2048));
  });

  it("T1.8: embed() API 失败抛出明确错误", async () => {
    const model = createZhipuEmbeddingModel({
      apiKey: "test-key",
      endpoint: "https://open.bigmodel.cn/api/paas/v4",
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    await expect(model.embed!(["test"])).rejects.toThrow(
      /Embedding API error.*401/,
    );
  });

  it("T1.9: IModel.embed 为可选，不实现时为 undefined", () => {
    // 构造一个不带 embed 的 mock model
    const modelWithoutEmbed: IModel = {
      name: "test",
      type: "api",
      provider: "test",
      chat: vi.fn(),
      stream: vi.fn() as unknown as IModel["stream"],
      supportsStreaming: () => false,
      supportsVision: () => false,
      supportsFunctionCalling: () => false,
      estimateCost: () => 0,
      getAverageLatency: () => 0,
    };

    expect(modelWithoutEmbed.embed).toBeUndefined();
  });

  it("embed() 空输入抛出错误", async () => {
    const model = createZhipuEmbeddingModel({
      apiKey: "test-key",
      endpoint: "https://open.bigmodel.cn/api/paas/v4",
    });

    await expect(model.embed!([])).rejects.toThrow(/empty/i);
  });
});
