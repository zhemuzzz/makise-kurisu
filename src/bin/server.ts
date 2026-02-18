#!/usr/bin/env node
/**
 * Kurisu HTTP Server 入口
 * REST API + 流式响应 + Channel 插件化
 *
 * KURISU-013 Phase 1: 统一 Server 骨架
 */

import { ModelProvider } from "../config/models";
import { HybridMemoryEngine } from "../memory";
import { PersonaEngine } from "../core/persona";
import { AgentOrchestrator } from "../agents";
import {
  Gateway,
  KurisuServer,
  MockChannel,
  type IOrchestrator,
} from "../gateway";
import type { MemoryEngineLike } from "../agents/types";

const VERSION = "0.2.0";

/**
 * 创建适配 Gateway 的 Orchestrator
 */
function createGatewayOrchestrator(
  orchestrator: AgentOrchestrator,
): IOrchestrator {
  return {
    processStream: async (params) => {
      const result = await orchestrator.processStream(
        params.sessionId,
        params.userId ?? "unknown",
        params.input,
      );

      // 转换为 Gateway 期望的格式
      async function* textStream() {
        for await (const chunk of result.chunks) {
          yield chunk.delta ?? chunk.content ?? "";
        }
      }

      async function* fullStream() {
        for await (const chunk of result.chunks) {
          yield {
            type: 0, // TEXT_DELTA
            text: chunk.delta ?? chunk.content ?? "",
            isFinal: false,
            timestamp: new Date(),
          };
        }
      }

      return {
        textStream: textStream(),
        fullStream: fullStream(),
        finalResponse: (async () => {
          let full = "";
          for await (const chunk of result.chunks) {
            full += chunk.delta ?? chunk.content ?? "";
          }
          return full;
        })(),
      };
    },
    createSession: (params) => {
      // AgentOrchestrator 内部管理 session
    },
    hasSession: (sessionId) => {
      return true; // AgentOrchestrator 内部管理
    },
  };
}

/**
 * 根据环境变量创建 Channel
 */
function createChannels(): { mock?: MockChannel } {
  const channels: { mock?: MockChannel } = {};

  // Mock Channel (开发测试用)
  if (process.env["ENABLE_MOCK_CHANNEL"] === "true") {
    channels.mock = new MockChannel({ echo: false });
    console.log("  ✓ MockChannel enabled");
  }

  // Phase 2: Telegram Channel
  // if (process.env['TELEGRAM_BOT_TOKEN']) {
  //   channels.telegram = new TelegramChannel({ ... });
  //   console.log('  ✓ TelegramChannel enabled');
  // }

  return channels;
}

async function main(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  console.log(`Starting Kurisu HTTP Server v${VERSION}...\n`);

  try {
    // 初始化依赖
    const modelProvider = new ModelProvider();
    const personaEngine = new PersonaEngine();
    const memoryEngine = new HybridMemoryEngine({
      sessionConfig: { maxMessages: 50, ttl: 30 * 60 * 1000 },
    });

    // 创建 Orchestrator
    const orchestrator = new AgentOrchestrator({
      modelProvider,
      personaEngine,
      memoryEngine: memoryEngine as unknown as MemoryEngineLike,
    });

    // 创建 Gateway
    const gatewayOrchestrator = createGatewayOrchestrator(orchestrator);
    const gateway = new Gateway({ orchestrator: gatewayOrchestrator });

    // 创建 Server
    const server = new KurisuServer(
      { gateway },
      { port, host },
    );

    // 注册 Channel
    const channels = createChannels();
    for (const [name, channel] of Object.entries(channels)) {
      if (channel) {
        server.registerChannel(name, channel);
      }
    }

    // 优雅关闭
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // 启动服务
    await server.start();

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Kurisu HTTP Server v${VERSION} started                           ║
║                                                              ║
║  Listening: http://${host}:${port}                            ║
║                                                              ║
║  Endpoints:                                                  ║
║    GET  /health        - Health check                        ║
║    GET  /ready         - Readiness check                     ║
║                                                              ║
║  Channels:                                                   ║
║    ${channels.mock ? "POST /mock/webhook - Mock Channel webhook" : "No channels enabled"}${" ".repeat(36 - (channels.mock ? 37 : 19))}║
║                                                              ║
║  Environment:                                                ║
║    ENABLE_MOCK_CHANNEL=${process.env["ENABLE_MOCK_CHANNEL"] ?? "false"}${" ".repeat(23 - (process.env["ENABLE_MOCK_CHANNEL"]?.length ?? 5))}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error("Failed to start HTTP Server:", error);
    process.exit(1);
  }
}

main();
