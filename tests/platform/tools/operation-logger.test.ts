/**
 * OperationLogger 测试
 *
 * KURISU-023 Phase 2: 操作日志记录器
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OperationLogger,
  createOperationLogger,
  getOperationLogger,
  type OperationLog,
} from "../../../src/platform/tools/operation-logger";
import fs from "fs";
import path from "path";
import os from "os";

describe("OperationLogger", () => {
  let logger: OperationLogger;

  beforeEach(() => {
    logger = createOperationLogger({ enablePersistence: false });
  });

  describe("log", () => {
    it("应该记录操作并返回日志 ID", () => {
      const logId = logger.log({
        sessionId: "session-1",
        toolName: "file_write",
        arguments: { path: "/tmp/test.txt", content: "hello" },
        status: "success",
        permission: "sandbox",
        riskLevel: "medium",
      });

      expect(logId).toBeDefined();
      expect(logId).toMatch(/^op-/);
    });

    it("记录的日志应该包含时间戳", () => {
      const beforeTime = new Date();

      logger.log({
        sessionId: "session-1",
        toolName: "file_read",
        arguments: { path: "/tmp/test.txt" },
        status: "success",
        permission: "sandbox",
        riskLevel: "low",
      });

      const afterTime = new Date();
      const logs = logger.query({ sessionId: "session-1" });

      expect(logs.length).toBe(1);
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeTime.getTime(),
      );
      expect(logs[0].timestamp.getTime()).toBeLessThanOrEqual(
        afterTime.getTime(),
      );
    });

    it("应该正确记录不同状态的操作", () => {
      const statuses: Array<"success" | "failed" | "rejected" | "timeout"> = [
        "success",
        "failed",
        "rejected",
        "timeout",
      ];

      for (const status of statuses) {
        logger.log({
          sessionId: "session-1",
          toolName: "shell",
          arguments: { command: "test" },
          status,
          permission: "full_access",
          riskLevel: "high",
        });
      }

      const logs = logger.query({ sessionId: "session-1" });
      expect(logs.length).toBe(4);

      const statusCounts = statuses.map(
        (s) => logs.filter((l) => l.status === s).length,
      );
      expect(statusCounts).toEqual([1, 1, 1, 1]);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      // 添加测试数据
      logger.log({
        sessionId: "session-1",
        userId: "user-a",
        toolName: "file_write",
        arguments: {},
        status: "success",
        permission: "sandbox",
        riskLevel: "medium",
      });

      logger.log({
        sessionId: "session-1",
        userId: "user-a",
        toolName: "file_delete",
        arguments: {},
        status: "success",
        permission: "full_access",
        riskLevel: "high",
      });

      logger.log({
        sessionId: "session-2",
        userId: "user-b",
        toolName: "shell",
        arguments: {},
        status: "rejected",
        permission: "full_access",
        riskLevel: "critical",
      });
    });

    it("按 sessionId 过滤", () => {
      const logs = logger.query({ sessionId: "session-1" });
      expect(logs.length).toBe(2);
    });

    it("按 userId 过滤", () => {
      const logs = logger.query({ userId: "user-a" });
      expect(logs.length).toBe(2);
    });

    it("按 toolName 过滤", () => {
      const logs = logger.query({ toolName: "file_delete" });
      expect(logs.length).toBe(1);
      expect(logs[0].toolName).toBe("file_delete");
    });

    it("按 status 过滤", () => {
      const logs = logger.query({ status: "rejected" });
      expect(logs.length).toBe(1);
      expect(logs[0].status).toBe("rejected");
    });

    it("限制返回数量", () => {
      const logs = logger.query({ limit: 2 });
      expect(logs.length).toBe(2);
    });

    it("组合过滤条件", () => {
      const logs = logger.query({
        sessionId: "session-1",
        toolName: "file_delete",
      });
      expect(logs.length).toBe(1);
    });
  });

  describe("getSessionLogs", () => {
    it("应该返回指定会话的日志", () => {
      logger.log({
        sessionId: "session-a",
        toolName: "file_read",
        arguments: {},
        status: "success",
        permission: "sandbox",
        riskLevel: "low",
      });

      logger.log({
        sessionId: "session-b",
        toolName: "file_read",
        arguments: {},
        status: "success",
        permission: "sandbox",
        riskLevel: "low",
      });

      const logs = logger.getSessionLogs("session-a");
      expect(logs.length).toBe(1);
      expect(logs[0].sessionId).toBe("session-a");
    });
  });

  describe("getRecentDangerousOperations", () => {
    it("应该返回高风险操作", () => {
      logger.log({
        sessionId: "session-1",
        toolName: "file_read",
        arguments: {},
        status: "success",
        permission: "sandbox",
        riskLevel: "low",
      });

      logger.log({
        sessionId: "session-1",
        toolName: "file_delete",
        arguments: {},
        status: "success",
        permission: "full_access",
        riskLevel: "high",
      });

      logger.log({
        sessionId: "session-1",
        toolName: "shell",
        arguments: { command: "rm -rf /" },
        status: "rejected",
        permission: "full_access",
        riskLevel: "critical",
      });

      const dangerousOps = logger.getRecentDangerousOperations();
      expect(dangerousOps.length).toBe(2);
      expect(
        dangerousOps.every(
          (op) => op.riskLevel === "high" || op.riskLevel === "critical",
        ),
      ).toBe(true);
    });
  });

  describe("getStats", () => {
    it("应该返回正确的统计信息", () => {
      logger.log({
        sessionId: "session-1",
        toolName: "file_read",
        arguments: {},
        status: "success",
        permission: "sandbox",
        riskLevel: "low",
      });

      logger.log({
        sessionId: "session-1",
        toolName: "file_write",
        arguments: {},
        status: "failed",
        permission: "sandbox",
        riskLevel: "medium",
      });

      logger.log({
        sessionId: "session-1",
        toolName: "shell",
        arguments: {},
        status: "rejected",
        permission: "full_access",
        riskLevel: "high",
      });

      const stats = logger.getStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.successCount).toBe(1);
      expect(stats.failedCount).toBe(1);
      expect(stats.rejectedCount).toBe(1);
      expect(stats.highRiskCount).toBe(1);
    });
  });

  describe("clearMemory", () => {
    it("应该清除内存中的日志", () => {
      logger.log({
        sessionId: "session-1",
        toolName: "file_read",
        arguments: {},
        status: "success",
        permission: "sandbox",
        riskLevel: "low",
      });

      expect(logger.query().length).toBe(1);

      logger.clearMemory();

      expect(logger.query().length).toBe(0);
    });
  });

  describe("maxMemoryLogs", () => {
    it("超出限制时应该移除最旧的日志", async () => {
      const smallLogger = createOperationLogger({
        maxMemoryLogs: 3,
        enablePersistence: false,
      });

      const sessionIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        smallLogger.log({
          sessionId: `session-${i}`,
          toolName: "file_read",
          arguments: {},
          status: "success",
          permission: "sandbox",
          riskLevel: "low",
        });
        sessionIds.push(`session-${i}`);
        // 添加小延迟确保时间戳不同
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const logs = smallLogger.query();
      expect(logs.length).toBe(3);

      // 最新的 3 个日志应该在列表中（session-2, session-3, session-4）
      const returnedSessionIds = logs.map((l) => l.sessionId).sort();
      expect(returnedSessionIds).toEqual(
        ["session-2", "session-3", "session-4"].sort(),
      );
    });
  });
});

describe("getOperationLogger", () => {
  it("应该返回单例实例", () => {
    const logger1 = getOperationLogger();
    const logger2 = getOperationLogger();
    expect(logger1).toBe(logger2);
  });
});
