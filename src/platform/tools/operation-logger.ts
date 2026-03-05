/**
 * OperationLogger - 操作日志记录器
 *
 * KURISU-023 Phase 2: 操作安全增强
 *
 * 负责:
 * 1. 记录所有工具操作（尤其是写操作和删除操作）
 * 2. 提供操作历史查询
 * 3. 支持日志持久化
 */

import fs from "fs";
import path from "path";
import os from "os";
import type { FilePermissionLevel } from "../models/executor-types.js";

// ===========================================
// 类型定义
// ===========================================

/**
 * 操作结果状态
 */
export type OperationStatus = "success" | "failed" | "rejected" | "timeout";

/**
 * 操作日志条目
 */
export interface OperationLog {
  /** 日志 ID */
  readonly id: string;
  /** 时间戳 */
  readonly timestamp: Date;
  /** 会话 ID */
  readonly sessionId: string;
  /** 用户 ID */
  readonly userId?: string;
  /** 工具名称 */
  readonly toolName: string;
  /** 工具参数（脱敏） */
  readonly arguments: Record<string, unknown>;
  /** 操作结果 */
  readonly status: OperationStatus;
  /** 结果消息 */
  readonly resultMessage?: string;
  /** 当前权限级别 */
  readonly permission: FilePermissionLevel;
  /** 风险等级 */
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  /** 执行时长（毫秒） */
  readonly duration?: number;
}

/**
 * 日志查询过滤器
 */
export interface LogFilter {
  /** 会话 ID */
  readonly sessionId?: string;
  /** 用户 ID */
  readonly userId?: string;
  /** 工具名称 */
  readonly toolName?: string;
  /** 操作状态 */
  readonly status?: OperationStatus;
  /** 开始时间 */
  readonly startTime?: Date;
  /** 结束时间 */
  readonly endTime?: Date;
  /** 限制数量 */
  readonly limit?: number;
}

/**
 * 操作日志记录器配置
 */
export interface OperationLoggerConfig {
  /** 日志文件目录 */
  readonly logDir?: string;
  /** 是否启用持久化 */
  readonly enablePersistence?: boolean;
  /** 内存中保留的最大日志数 */
  readonly maxMemoryLogs?: number;
}

// ===========================================
// OperationLogger 实现
// ===========================================

/**
 * 操作日志记录器
 *
 * @example
 * ```typescript
 * const logger = new OperationLogger();
 *
 * // 记录操作
 * const logId = logger.log({
 *   sessionId: "telegram-123",
 *   toolName: "file_delete",
 *   arguments: { path: "/tmp/test.txt" },
 *   status: "success",
 *   permission: "full_access",
 *   riskLevel: "high",
 * });
 *
 * // 查询日志
 * const logs = logger.query({ sessionId: "telegram-123" });
 * ```
 */
export class OperationLogger {
  private readonly logs: OperationLog[] = [];
  private readonly logDir: string;
  private readonly enablePersistence: boolean;
  private readonly maxMemoryLogs: number;
  private logCounter: number = 0;

  constructor(config: OperationLoggerConfig = {}) {
    this.logDir =
      config.logDir ?? path.join(os.tmpdir(), "kurisu-logs", "operations");
    this.enablePersistence = config.enablePersistence ?? false;
    this.maxMemoryLogs = config.maxMemoryLogs ?? 1000;

    // 确保日志目录存在
    if (this.enablePersistence) {
      this.ensureLogDir();
    }
  }

  /**
   * 记录操作
   *
   * @param entry 操作日志条目（不含 id 和 timestamp）
   * @returns 日志 ID
   */
  log(entry: Omit<OperationLog, "id" | "timestamp">): string {
    const id = this.generateId();
    const logEntry: OperationLog = {
      ...entry,
      id,
      timestamp: new Date(),
    };

    // 添加到内存
    this.logs.push(logEntry);

    // 超出限制时移除最旧的日志
    if (this.logs.length > this.maxMemoryLogs) {
      this.logs.shift();
    }

    // 持久化到文件
    if (this.enablePersistence) {
      this.persistLog(logEntry);
    }

    return id;
  }

  /**
   * 查询日志
   *
   * @param filter 过滤条件
   * @returns 匹配的日志列表
   */
  query(filter: LogFilter = {}): OperationLog[] {
    let result = [...this.logs];

    if (filter.sessionId) {
      result = result.filter((log) => log.sessionId === filter.sessionId);
    }

    if (filter.userId) {
      result = result.filter((log) => log.userId === filter.userId);
    }

    if (filter.toolName) {
      result = result.filter((log) => log.toolName === filter.toolName);
    }

    if (filter.status) {
      result = result.filter((log) => log.status === filter.status);
    }

    if (filter.startTime) {
      result = result.filter((log) => log.timestamp >= filter.startTime!);
    }

    if (filter.endTime) {
      result = result.filter((log) => log.timestamp <= filter.endTime!);
    }

    // 按时间倒序排列
    result.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (filter.limit !== undefined && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * 获取会话的操作日志
   */
  getSessionLogs(sessionId: string, limit?: number): OperationLog[] {
    return this.query({
      sessionId,
      ...(limit !== undefined && { limit }),
    });
  }

  /**
   * 获取最近的危险操作日志
   */
  getRecentDangerousOperations(limit: number = 10): OperationLog[] {
    return this.logs
      .filter((log) => log.riskLevel === "high" || log.riskLevel === "critical")
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalOperations: number;
    successCount: number;
    failedCount: number;
    rejectedCount: number;
    highRiskCount: number;
  } {
    return {
      totalOperations: this.logs.length,
      successCount: this.logs.filter((log) => log.status === "success").length,
      failedCount: this.logs.filter((log) => log.status === "failed").length,
      rejectedCount: this.logs.filter((log) => log.status === "rejected")
        .length,
      highRiskCount: this.logs.filter(
        (log) => log.riskLevel === "high" || log.riskLevel === "critical",
      ).length,
    };
  }

  /**
   * 清除内存中的日志
   */
  clearMemory(): void {
    this.logs.length = 0;
  }

  /**
   * 生成日志 ID
   */
  private generateId(): string {
    this.logCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.logCounter.toString(36).padStart(4, "0");
    return `op-${timestamp}-${counter}`;
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 持久化日志到文件
   */
  private persistLog(log: OperationLog): void {
    try {
      const dateStr = log.timestamp.toISOString().split("T")[0];
      const logFile = path.join(this.logDir, `operations-${dateStr}.jsonl`);
      const logLine = JSON.stringify(log) + "\n";
      fs.appendFileSync(logFile, logLine, "utf-8");
    } catch (error) {
      console.error("Failed to persist operation log:", error);
    }
  }
}

// ===========================================
// 单例实例
// ===========================================

let defaultLogger: OperationLogger | null = null;

/**
 * 获取默认日志记录器
 */
export function getOperationLogger(
  config?: OperationLoggerConfig,
): OperationLogger {
  if (!defaultLogger) {
    defaultLogger = new OperationLogger(config);
  }
  return defaultLogger;
}

/**
 * 创建新的日志记录器实例
 */
export function createOperationLogger(
  config?: OperationLoggerConfig,
): OperationLogger {
  return new OperationLogger(config);
}
