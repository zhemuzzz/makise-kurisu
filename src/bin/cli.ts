#!/usr/bin/env node
/**
 * Kurisu CLI 入口
 * 命令行交互模式
 *
 * 注意: 直接使用 AgentOrchestrator，跳过 Gateway 层
 */

import * as readline from "readline";
import { ModelProvider, loadConfig } from "../config/models";
import { HybridMemoryEngine } from "../memory";
import { PersonaEngine } from "../core/persona";
import { AgentOrchestrator } from "../agents";
import type { StreamResult } from "../agents/types";

const VERSION = "0.1.0";

const WELCOME_MESSAGE = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   欢迎来到未来道具实验室                                      ║
║   Lab Mem No.004 - 牧濑红莉栖                                 ║
║                                                              ║
║   输入 /help 查看帮助，/quit 或 /exit 退出                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

const GOODBYE_MESSAGE = `
哼，这就走了吗？...那、那个，下次再来吧。
`;

/**
 * CLI Application
 */
class KurisuCLI {
  private orchestrator: AgentOrchestrator;
  private rl?: readline.Interface;
  private sessionId: string;
  private userId: string;
  private running = false;

  private constructor(orchestrator: AgentOrchestrator) {
    this.sessionId = `cli-session-${Date.now()}`;
    this.userId = `cli-user-${Date.now()}`;
    this.orchestrator = orchestrator;
  }

  /**
   * 创建 CLI 实例（异步工厂方法）
   */
  static async create(): Promise<KurisuCLI> {
    // 加载模型配置
    const configPath = process.env["MODELS_CONFIG"] ?? "config/models.yaml";
    const modelConfig = await loadConfig(configPath);

    // 初始化依赖
    const modelProvider = new ModelProvider(
      modelConfig.models,
      modelConfig.defaults,
    );

    // 加载默认角色
    const defaultRole = modelConfig.defaults["role"] ?? "kurisu";
    const personaEngine = new PersonaEngine();
    await personaEngine.loadRole(defaultRole);

    const memoryEngine = new HybridMemoryEngine({
      sessionConfig: { maxMessages: 50, ttl: 30 * 60 * 1000 },
    });

    const orchestrator = new AgentOrchestrator({
      modelProvider,
      personaEngine,
      memoryEngine:
        memoryEngine as unknown as import("../agents/types").MemoryEngineLike,
    });

    return new KurisuCLI(orchestrator);
  }

  /**
   * 启动 CLI
   */
  async start(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.running = true;

    console.log(WELCOME_MESSAGE);

    this.rl.on("close", () => {
      this.running = false;
    });

    // 处理退出信号
    process.on("SIGINT", () => {
      console.log("\n" + GOODBYE_MESSAGE);
      process.exit(0);
    });

    // 开始输入循环
    this.promptLoop();
  }

  /**
   * 输入循环
   */
  private promptLoop(): void {
    if (!this.rl || !this.running) {
      return;
    }

    this.rl.question("> ", async (input) => {
      await this.handleInput(input.trim());

      if (this.running) {
        this.promptLoop();
      }
    });
  }

  /**
   * 处理用户输入
   */
  private async handleInput(input: string): Promise<void> {
    if (!input) {
      return;
    }

    // 检查退出命令
    if (["/quit", "/exit"].includes(input.toLowerCase())) {
      console.log(GOODBYE_MESSAGE);
      this.running = false;
      this.rl?.close();
      return;
    }

    // 帮助命令
    if (input.toLowerCase() === "/help") {
      console.log(`
可用命令:
  /help  - 显示帮助
  /quit  - 退出程序
  /exit  - 退出程序
`);
      return;
    }

    try {
      // 显示输入指示器
      process.stdout.write("...");

      const result = await this.orchestrator.processStream(
        this.sessionId,
        this.userId,
        input,
      );

      // 清除输入指示器
      process.stdout.write("\r\x1b[K");

      // 输出响应
      await this.outputResponse(result);
    } catch (error) {
      process.stdout.write("\r\x1b[K");
      console.error(
        "Error:",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  /**
   * 输出响应
   */
  private async outputResponse(result: StreamResult): Promise<void> {
    // 流式输出
    for await (const chunk of result.chunks) {
      const text = chunk.delta ?? chunk.content;
      if (text) {
        process.stdout.write(text);
      }
    }
    console.log();
  }
}

// 主函数
async function main(): Promise<void> {
  console.log(`Kurisu CLI v${VERSION}\n`);

  try {
    const cli = await KurisuCLI.create();
    await cli.start();
  } catch (error) {
    console.error("Failed to start CLI:", error);
    process.exit(1);
  }
}

main();
