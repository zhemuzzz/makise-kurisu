/**
 * 会话设置注册表
 *
 * KURISU-024: 会话设置流水线重构
 *
 * 统一管理所有会话设置处理器（目录切换、权限切换、删除确认等），
 * 提供 O(1) 扩展能力：新增设置只需注册 1 个 Handler + 1 行注册代码。
 *
 * @module gateway/session-setting-registry
 */

// ===========================================
// 类型定义
// ===========================================

/**
 * 意图识别结果（通用）
 */
export interface SessionSettingIntent {
  /** 是否识别到意图 */
  readonly isIntent: boolean;
  /** 置信度 (0-1) */
  readonly confidence: number;
  /** 操作类型（如 "change", "upgrade", "disable"） */
  readonly action?: string;
  /** 目标值（如目标目录、目标权限级别） */
  readonly targetValue?: unknown;
  /** 原始用户输入 */
  readonly originalInput: string;
}

/**
 * 意图处理结果
 */
export interface SessionSettingHandleResult {
  /** 是否已处理 */
  readonly handled: boolean;
  /** 响应消息 */
  readonly message?: string;
  /** 是否需要审批 */
  readonly requiresApproval?: boolean;
  /** 审批提示消息 */
  readonly approvalMessage?: string;
}

/**
 * 审批回复结果
 */
export interface SessionSettingApprovalResult {
  /** 是否是审批回复 */
  readonly isApprovalReply: boolean;
  /** 是否批准（isApprovalReply=true 时有效） */
  readonly approved?: boolean;
  /** 响应消息 */
  readonly message?: string;
}

/**
 * 会话设置处理器接口
 *
 * 每个会话设置类型（目录切换、权限切换、删除确认）需实现此接口。
 *
 * @example
 * ```typescript
 * class ChangeDirHandler implements SessionSettingHandler {
 *   readonly type = "change_dir";
 *
 *   detectIntent(input: string): SessionSettingIntent { ... }
 *   hasPending(sessionId: string): boolean { ... }
 *   handleIntent(sessionId: string, intent: SessionSettingIntent): Promise<SessionSettingHandleResult> { ... }
 *   handleApprovalReply(sessionId: string, userMessage: string): Promise<SessionSettingApprovalResult> { ... }
 * }
 * ```
 */
export interface SessionSettingHandler {
  /**
   * 设置类型标识
   *
   * 用于区分不同类型的处理器，如 "change_dir", "change_permission", "delete_confirm"
   */
  readonly type: string;

  /**
   * 检测用户输入是否包含此设置的意图
   *
   * @param input 用户输入
   * @returns 意图识别结果
   */
  detectIntent(input: string): SessionSettingIntent;

  /**
   * 检查会话是否有待处理的审批
   *
   * @param sessionId 会话 ID
   * @returns 是否有待处理审批
   */
  hasPending(sessionId: string): boolean;

  /**
   * 处理意图（可能触发审批流程）
   *
   * @param sessionId 会话 ID
   * @param intent 意图识别结果
   * @returns 处理结果
   */
  handleIntent(
    sessionId: string,
    intent: SessionSettingIntent,
  ): Promise<SessionSettingHandleResult>;

  /**
   * 处理审批回复（用户确认/拒绝）
   *
   * @param sessionId 会话 ID
   * @param userMessage 用户消息
   * @returns 审批回复结果
   */
  handleApprovalReply(
    sessionId: string,
    userMessage: string,
  ): Promise<SessionSettingApprovalResult>;
}

/**
 * 处理流水线结果（未处理）
 */
export interface PipelineResultNotHandled {
  readonly handled: false;
}

/**
 * 处理流水线结果（已处理）
 */
export interface PipelineResultHandled {
  readonly handled: true;
  /** 处理此消息的 Handler 类型 */
  readonly handlerType: string;
  /** 响应消息 */
  readonly message?: string;
  /** 是否需要审批 */
  readonly requiresApproval?: boolean;
  /** 审批提示消息 */
  readonly approvalMessage?: string;
}

/**
 * 处理流水线结果
 */
export type PipelineResult = PipelineResultNotHandled | PipelineResultHandled;

// ===========================================
// 注册表
// ===========================================

/**
 * 会话设置注册表
 *
 * 统一管理所有会话设置处理器，提供：
 * 1. 注册/获取 Handler
 * 2. 统一处理流水线（替代 processStream 中的 174 行 waterfall）
 * 3. LLM 意图分类兜底（正则快速路径失败时）
 *
 * @example
 * ```typescript
 * const registry = createSessionSettingRegistry();
 * registry
 *   .register(new ChangePermissionHandler(...))
 *   .register(new DeleteConfirmHandler(...))
 *   .register(new ChangeDirHandler(...));
 *
 * // 可选：设置 LLM 分类器兜底
 * registry.setLLMClassifier(llmClassifier);
 *
 * // 在 processStream 中使用
 * const result = await registry.processPipeline(sessionId, userMessage);
 * if (result.handled) {
 *   // 返回响应给用户
 *   return createTextStream(result.message);
 * }
 * // 继续正常消息处理（orchestrator）
 * ```
 */
export class SessionSettingRegistry {
  private readonly handlers: Map<string, SessionSettingHandler> = new Map();
  private llmClassifier: {
    classify(input: string): Promise<{
      readonly isIntent: boolean;
      readonly confidence: number;
      readonly intentType?: string;
      readonly action?: string;
      readonly targetValue?: string;
    }>;
  } | null = null;

  /**
   * 注册处理器
   *
   * @param handler 处理器实例
   * @returns this（支持链式调用）
   * @throws Error 如果类型已注册
   */
  register(handler: SessionSettingHandler): this {
    if (this.handlers.has(handler.type)) {
      throw new Error(
        `SessionSettingHandler type "${handler.type}" already registered`,
      );
    }
    this.handlers.set(handler.type, handler);
    return this;
  }

  /**
   * 设置 LLM 意图分类器（兜底）
   *
   * 当正则快速路径（handler.detectIntent）失败时，
   * 使用 LLM 分类器作为兜底识别自然语言变体。
   *
   * @param classifier LLM 意图分类器实例
   * @returns this（支持链式调用）
   */
  setLLMClassifier(
    classifier: {
      classify(input: string): Promise<{
        readonly isIntent: boolean;
        readonly confidence: number;
        readonly intentType?: string;
        readonly action?: string;
        readonly targetValue?: string;
      }>;
    } | null,
  ): this {
    this.llmClassifier = classifier;
    return this;
  }

  /**
   * 获取 LLM 分类器
   */
  getLLMClassifier(): typeof this.llmClassifier {
    return this.llmClassifier;
  }

  /**
   * 获取处理器
   *
   * @param type 处理器类型
   * @returns 处理器实例，不存在则返回 undefined
   */
  get(type: string): SessionSettingHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * 检查是否有指定类型的处理器
   *
   * @param type 处理器类型
   * @returns 是否存在
   */
  has(type: string): boolean {
    return this.handlers.has(type);
  }

  /**
   * 获取所有处理器（按注册顺序）
   *
   * @returns 处理器列表
   */
  getAll(): readonly SessionSettingHandler[] {
    return [...this.handlers.values()];
  }

  /**
   * 获取已注册的处理器数量
   */
  get size(): number {
    return this.handlers.size;
  }

  /**
   * 统一处理流水线
   *
   * 替代 Gateway.processStream 中的 174 行 waterfall if-else
   *
   * 处理顺序：
   * 1. 按注册顺序检查所有 pending approval
   * 2. 按注册顺序检测所有意图（正则快速路径）
   * 3. 如果正则全部失败，尝试 LLM 兜底分类
   *
   * @param sessionId 会话 ID
   * @param userMessage 用户消息
   * @returns
   *   - handled: false → 继续正常消息处理
   *   - handled: true → 已处理，返回消息
   */
  async processPipeline(
    sessionId: string,
    userMessage: string,
  ): Promise<PipelineResult> {
    // Step 1: 检查 pending approvals（按注册顺序）
    for (const handler of this.getAll()) {
      if (handler.hasPending(sessionId)) {
        const result = await handler.handleApprovalReply(
          sessionId,
          userMessage,
        );
        if (result.isApprovalReply) {
          return {
            handled: true,
            handlerType: handler.type,
            ...(result.message && { message: result.message }),
          };
        }
        // pending 存在但不是审批回复 → 继续检测意图
        // （这是为了支持用户在审批等待期间发出新的意图请求）
      }
    }

    // Step 2: 检测意图（正则快速路径）
    for (const handler of this.getAll()) {
      const intent = handler.detectIntent(userMessage);
      if (intent.isIntent && intent.confidence > 0.5) {
        const result = await handler.handleIntent(sessionId, intent);
        if (result.handled) {
          return {
            handled: true,
            handlerType: handler.type,
            ...(result.message && { message: result.message }),
            ...(result.requiresApproval && {
              requiresApproval: result.requiresApproval,
            }),
            ...(result.approvalMessage && {
              approvalMessage: result.approvalMessage,
            }),
          };
        }
      }
    }

    // Step 3: LLM 兜底分类（当正则快速路径全部失败时）
    if (this.llmClassifier) {
      try {
        const llmResult = await this.llmClassifier.classify(userMessage);

        if (
          llmResult.isIntent &&
          llmResult.confidence >= 0.7 &&
          llmResult.intentType
        ) {
          const handler = this.handlers.get(llmResult.intentType);
          if (handler) {
            // 使用 LLM 分类结果构造意图
            const enhancedIntent: SessionSettingIntent = {
              isIntent: true,
              confidence: llmResult.confidence,
              originalInput: userMessage,
              ...(llmResult.action !== undefined && {
                action: llmResult.action,
              }),
              ...(llmResult.targetValue !== undefined && {
                targetValue: llmResult.targetValue,
              }),
            };

            const result = await handler.handleIntent(
              sessionId,
              enhancedIntent,
            );
            if (result.handled) {
              return {
                handled: true,
                handlerType: handler.type,
                ...(result.message && { message: result.message }),
                ...(result.requiresApproval && {
                  requiresApproval: result.requiresApproval,
                }),
                ...(result.approvalMessage && {
                  approvalMessage: result.approvalMessage,
                }),
              };
            }
          }
        }
      } catch {
        // LLM 分类失败，静默降级
        // 不影响正常流程，返回 handled: false
      }
    }

    return { handled: false };
  }
}

// ===========================================
// 工厂函数
// ===========================================

/**
 * 创建会话设置注册表
 */
export function createSessionSettingRegistry(): SessionSettingRegistry {
  return new SessionSettingRegistry();
}
