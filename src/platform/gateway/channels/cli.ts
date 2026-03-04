/**
 * L1 交互网关 - CLI 渠道
 * 命令行交互实现
 */

import * as readline from "readline";
import { ChannelType, type IOrchestrator } from "../types";
import { ChannelError } from "../errors";

/**
 * CLI 渠道配置
 */
export interface CLIChannelConfig {
  /** 提示符 */
  prompt?: string;
  /** 欢迎消息 */
  welcomeMessage?: string;
  /** 退出消息 */
  goodbyeMessage?: string;
  /** 退出命令列表 */
  exitCommands?: string[];
  /** 是否启用流式输出 */
  streamOutput?: boolean;
  /** 是否显示输入指示器 */
  showTypingIndicator?: boolean;
  /** 是否启用多行输入 */
  multilineEnabled?: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: Required<
  Omit<CLIChannelConfig, "welcomeMessage" | "goodbyeMessage">
> & {
  welcomeMessage?: string | undefined;
  goodbyeMessage?: string | undefined;
} = {
  prompt: "> ",
  exitCommands: ["/quit", "/exit"],
  streamOutput: true,
  showTypingIndicator: true,
  multilineEnabled: false,
  welcomeMessage: undefined,
  goodbyeMessage: undefined,
};

/**
 * CLI 渠道内部配置类型
 */
type CLIChannelInternalConfig = Required<
  Omit<CLIChannelConfig, "welcomeMessage" | "goodbyeMessage">
> & {
  welcomeMessage?: string | undefined;
  goodbyeMessage?: string | undefined;
};

/**
 * CLI 渠道类
 * 处理命令行交互
 */
export class CLIChannel {
  readonly channelType = ChannelType.CLI;

  private readonly orchestrator: IOrchestrator;
  private readonly config: CLIChannelInternalConfig;
  private rl?: readline.Interface;
  private _isRunning = false;
  private currentSessionId: string | undefined;
  private userId: string;

  constructor(orchestrator: IOrchestrator, config: CLIChannelConfig = {}) {
    if (!orchestrator) {
      throw new ChannelError("Orchestrator is required");
    }

    this.orchestrator = orchestrator;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.userId = `cli-user-${Date.now()}`;
  }

  /**
   * 启动 CLI
   */
  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this._isRunning = true;

    // 显示欢迎消息
    if (this.config.welcomeMessage) {
      console.log(this.config.welcomeMessage);
    }

    // 监听关闭事件
    this.rl.on("close", () => {
      this.handleClose();
    });

    // 开始输入循环
    this.promptLoop();
  }

  /**
   * 停止 CLI
   */
  stop(): void {
    if (this.rl && this._isRunning) {
      this.rl.close();
      this._isRunning = false;
    }
  }

  /**
   * 检查是否运行中
   */
  isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * 输入循环
   */
  private promptLoop(): void {
    if (!this.rl || !this._isRunning) {
      return;
    }

    this.rl.question(this.config.prompt, async (input) => {
      await this.handleInput(input);

      // 继续循环
      if (this._isRunning) {
        this.promptLoop();
      }
    });
  }

  /**
   * 处理用户输入
   */
  private async handleInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    // 忽略空输入
    if (!trimmedInput) {
      return;
    }

    // 检查退出命令
    if (this.config.exitCommands.includes(trimmedInput.toLowerCase())) {
      this.handleExit();
      return;
    }

    try {
      // 确保会话存在
      await this.ensureSession();

      // 显示输入指示器
      if (this.config.showTypingIndicator) {
        process.stdout.write("...");
      }

      // 处理流
      const result = await this.orchestrator.processStream({
        sessionId: this.currentSessionId!,
        input: trimmedInput,
        userId: this.userId,
        channelType: ChannelType.CLI,
      });

      // 清除输入指示器
      if (this.config.showTypingIndicator) {
        process.stdout.write("\r\x1b[K");
      }

      // 输出响应
      await this.outputResponse(result);
    } catch (error) {
      // 清除输入指示器
      if (this.config.showTypingIndicator) {
        process.stdout.write("\r\x1b[K");
      }

      const err = error as Error & { code?: string };
      console.error(`Error: ${err.message}`);

      // 会话相关错误时重置会话，下次使用时重新创建
      // 保持 CLI 可继续使用
      if (
        err.code === "SESSION_NOT_FOUND" ||
        err.code === "SESSION_EXPIRED" ||
        err.message.toLowerCase().includes("session")
      ) {
        this.currentSessionId = undefined as string | undefined;
      }
    }
  }

  /**
   * 确保会话存在
   */
  private async ensureSession(): Promise<void> {
    if (
      !this.currentSessionId ||
      !this.orchestrator.hasSession(this.currentSessionId)
    ) {
      this.currentSessionId = `cli-session-${Date.now()}`;
      this.orchestrator.createSession({
        sessionId: this.currentSessionId,
        userId: this.userId,
        channelType: ChannelType.CLI,
      });
    }
  }

  /**
   * 输出响应
   */
  private async outputResponse(
    result: Awaited<ReturnType<IOrchestrator["processStream"]>>,
  ): Promise<void> {
    if (typeof result === "string") {
      // 简单字符串响应
      console.log(result);
      return;
    }

    // 流式响应
    if (this.config.streamOutput && result.textStream) {
      for await (const chunk of result.textStream) {
        process.stdout.write(chunk);
      }
      console.log(); // 添加换行
    } else {
      // 等待完整响应
      const fullResponse = await result.finalResponse;
      console.log(fullResponse);
    }
  }

  /**
   * 处理退出
   */
  private handleExit(): void {
    if (this.config.goodbyeMessage) {
      console.log(this.config.goodbyeMessage);
    }
    this.stop();
  }

  /**
   * 处理关闭
   */
  private handleClose(): void {
    this._isRunning = false;
  }
}
