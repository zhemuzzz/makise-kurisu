/**
 * 跨平台执行器 - 工厂测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ExecutorFactory,
  createExecutor,
  getRecommendedExecutorType,
} from "../../../../src/platform/tools/executors/factory";
import { clearPlatformCache } from "../../../../src/platform/tools/executors/platform";

// Mock dockerode
vi.mock("dockerode", () => {
  const mockContainer = {
    start: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ StatusCode: 0 }),
    logs: vi.fn().mockResolvedValue(Buffer.from("")),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const mockDocker = vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue("OK"),
    version: vi.fn().mockResolvedValue({ Version: "24.0.0" }),
    createContainer: vi.fn().mockResolvedValue(mockContainer),
    getImage: vi.fn().mockReturnValue({
      inspect: vi.fn().mockResolvedValue({}),
    }),
  }));

  return { default: mockDocker };
});

describe("ExecutorFactory", () => {
  let factory: ExecutorFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    clearPlatformCache();
    factory = ExecutorFactory.getInstance();
    factory.clearCache();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = ExecutorFactory.getInstance();
      const instance2 = ExecutorFactory.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("createExecutor", () => {
    it("should create executor", async () => {
      const result = await factory.createExecutor();

      expect(result.executor).toBeDefined();
      expect(result.type).toBeDefined();
      expect(result.reason).toBeDefined();
    });

    it("should cache created executor", async () => {
      const result1 = await factory.createExecutor();
      const result2 = await factory.createExecutor();

      expect(result1).toBe(result2);
    });

    it("should force recreate when requested", async () => {
      const result1 = await factory.createExecutor();
      const result2 = await factory.createExecutor(undefined, true);

      expect(result1).not.toBe(result2);
    });
  });

  describe("clearCache", () => {
    it("should clear cached executor", async () => {
      await factory.createExecutor();
      factory.clearCache();
      const cached = factory.getCachedExecutor();

      expect(cached).toBeNull();
    });
  });
});

describe("createExecutor", () => {
  beforeEach(() => {
    ExecutorFactory.getInstance().clearCache();
    clearPlatformCache();
  });

  it("should create executor", async () => {
    const result = await createExecutor();

    expect(result.executor).toBeDefined();
    expect(["docker", "process", "cloud"]).toContain(result.type);
  });
});

describe("getRecommendedExecutorType", () => {
  beforeEach(() => {
    clearPlatformCache();
  });

  it("should return recommended type", async () => {
    const result = await getRecommendedExecutorType();

    expect(["docker", "process", "cloud"]).toContain(result.type);
    expect(result.reason).toBeDefined();
  });
});
