/**
 * EmbeddingProvider 测试
 * TDD: RED → GREEN → IMPROVE
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

describe("EmbeddingProvider", () => {
  describe("ZhipuEmbeddingProvider", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("EP-01: embed() 返回正确维度的向量", async () => {
      const mockVector = Array.from({ length: 1024 }, (_, i) => i * 0.001);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [{ embedding: mockVector, index: 0 }],
            model: "embedding-3",
            usage: { prompt_tokens: 10, total_tokens: 10 },
          }),
        }),
      );

      const { ZhipuEmbeddingProvider } = await import(
        "@/platform/storage/embedding-provider"
      );

      const provider = new ZhipuEmbeddingProvider({
        apiKey: "test-key",
        endpoint: "https://api.example.com",
      });

      const result = await provider.embed("hello world");
      expect(result).toHaveLength(1024);
      expect(provider.dimensions).toBe(1024);
      expect(provider.modelId).toBe("embedding-3");
    });

    it("EP-02: embedBatch() 返回正确数量的向量", async () => {
      const mockVectors = [
        Array.from({ length: 1024 }, () => Math.random()),
        Array.from({ length: 1024 }, () => Math.random()),
        Array.from({ length: 1024 }, () => Math.random()),
      ];

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: mockVectors.map((v, i) => ({ embedding: v, index: i })),
            model: "embedding-3",
            usage: { prompt_tokens: 30, total_tokens: 30 },
          }),
        }),
      );

      const { ZhipuEmbeddingProvider } = await import(
        "@/platform/storage/embedding-provider"
      );

      const provider = new ZhipuEmbeddingProvider({
        apiKey: "test-key",
        endpoint: "https://api.example.com",
      });

      const results = await provider.embedBatch(["a", "b", "c"]);
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveLength(1024);
    });

    it("EP-03: API 错误时抛出有意义的错误", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => "Unauthorized",
        }),
      );

      const { ZhipuEmbeddingProvider } = await import(
        "@/platform/storage/embedding-provider"
      );

      const provider = new ZhipuEmbeddingProvider({
        apiKey: "bad-key",
        endpoint: "https://api.example.com",
      });

      await expect(provider.embed("test")).rejects.toThrow("401");
    });

    it("EP-04: 空文本数组时 embedBatch 返回空数组", async () => {
      const { ZhipuEmbeddingProvider } = await import(
        "@/platform/storage/embedding-provider"
      );

      const provider = new ZhipuEmbeddingProvider({
        apiKey: "test-key",
        endpoint: "https://api.example.com",
      });

      const results = await provider.embedBatch([]);
      expect(results).toEqual([]);
    });
  });
});
