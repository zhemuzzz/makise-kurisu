/**
 * ShortTermMemory - 短期记忆
 * 基于 Mem0 的语义记忆存储和检索
 *
 * 特点：
 * - 封装 mem0ai SDK
 * - 会话隔离（使用 user_id）
 * - 语义搜索能力
 */

import {
  Memory,
  MemoryMetadata,
  MemorySearchResult,
  Mem0Client,
  Mem0Memory,
  ShortTermMemoryConfig,
} from "./types";
import { InvalidSessionIdError, Mem0APIError, ValidationError } from "./errors";

/**
 * ShortTermMemory 类
 * 管理基于 Mem0 的短期记忆
 */
export class ShortTermMemory {
  private readonly _client: Mem0Client;
  private readonly _sessionId: string;
  private readonly _defaultImportance: number;

  constructor(config: ShortTermMemoryConfig) {
    // Validate session ID
    if (
      !config.sessionId ||
      typeof config.sessionId !== "string" ||
      config.sessionId.trim() === ""
    ) {
      throw new InvalidSessionIdError(config.sessionId);
    }

    // Validate Mem0 client
    if (!config.mem0Client) {
      throw new ValidationError("mem0Client", "Mem0 client is required");
    }

    this._client = config.mem0Client;
    this._sessionId = config.sessionId;
    this._defaultImportance = config.defaultImportance ?? 0.5;
  }

  /**
   * 添加记忆
   * 返回记忆 ID
   */
  async addMemory(
    content: string,
    metadata?: Partial<MemoryMetadata>,
  ): Promise<string> {
    if (!content || typeof content !== "string" || content.trim() === "") {
      throw new ValidationError(
        "content",
        "Content must be a non-empty string",
      );
    }

    const memoryMetadata: MemoryMetadata = {
      timestamp: metadata?.timestamp ?? Date.now(),
      importance: metadata?.importance ?? this._defaultImportance,
      role: metadata?.role ?? "user",
      sessionId: this._sessionId,
      ...metadata,
    };

    try {
      const result = await this._client.add(content, {
        user_id: this._sessionId,
        metadata: memoryMetadata,
      });

      // Handle different response formats
      if (Array.isArray(result) && result.length > 0) {
        const first = result[0];
        return first?.id ?? `mem-${Date.now()}`;
      }
      if (result && typeof result === "object" && "id" in result) {
        return (result as { id: string }).id;
      }

      // Generate a fallback ID if none returned
      return `mem-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    } catch (error) {
      throw new Mem0APIError("add", (error as Error).message, error as Error);
    }
  }

  /**
   * 搜索记忆
   */
  async searchMemory(
    query: string,
    limit: number = 10,
  ): Promise<MemorySearchResult[]> {
    if (!query || typeof query !== "string") {
      throw new ValidationError("query", "Query must be a non-empty string");
    }

    try {
      const results = await this._client.search(query, {
        user_id: this._sessionId,
        limit,
      });

      return results.map((item) => this._convertToMemory(item));
    } catch (error) {
      throw new Mem0APIError(
        "search",
        (error as Error).message,
        error as Error,
      );
    }
  }

  /**
   * 获取所有记忆
   */
  async getAllMemories(): Promise<Memory[]> {
    try {
      const results = await this._client.getAll({
        user_id: this._sessionId,
      });

      return results.map((item) => this._convertToMemory(item));
    } catch (error) {
      throw new Mem0APIError(
        "getAll",
        (error as Error).message,
        error as Error,
      );
    }
  }

  /**
   * 删除记忆
   */
  async deleteMemory(id: string): Promise<void> {
    if (!id || typeof id !== "string") {
      throw new ValidationError("id", "Memory ID must be a non-empty string");
    }

    try {
      await this._client.delete(id);
    } catch (error) {
      throw new Mem0APIError(
        "delete",
        (error as Error).message,
        error as Error,
      );
    }
  }

  /**
   * 更新记忆
   */
  async updateMemory(id: string, content: string): Promise<void> {
    if (!id || typeof id !== "string") {
      throw new ValidationError("id", "Memory ID must be a non-empty string");
    }

    if (!content || typeof content !== "string") {
      throw new ValidationError(
        "content",
        "Content must be a non-empty string",
      );
    }

    if (!this._client.update) {
      throw new Mem0APIError(
        "update",
        "Update operation not supported by client",
      );
    }

    try {
      await this._client.update(id, content);
    } catch (error) {
      throw new Mem0APIError(
        "update",
        (error as Error).message,
        error as Error,
      );
    }
  }

  // ============================================
  // Getters
  // ============================================

  get sessionId(): string {
    return this._sessionId;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * 将 Mem0 响应转换为统一的 Memory 类型
   */
  private _convertToMemory(item: Mem0Memory): MemorySearchResult {
    const content = item.memory ?? item.data?.memory ?? "";
    const itemMetadata = item.metadata ?? {};
    const metadata: MemoryMetadata = {
      timestamp: (itemMetadata["timestamp"] as number) ?? Date.now(),
      importance: (itemMetadata["importance"] as number) ?? 0.5,
      role: (itemMetadata["role"] as MemoryMetadata["role"]) ?? "user",
      sessionId:
        (itemMetadata["sessionId"] as string) ??
        item.user_id ??
        this._sessionId,
      ...itemMetadata,
    };

    return {
      id: item.id,
      content,
      metadata,
      score: item.score ?? 1.0,
    };
  }
}
