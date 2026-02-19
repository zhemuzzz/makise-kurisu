#!/usr/bin/env node
/**
 * Kurisu HTTP Server 入口
 * REST API + 流式响应 + Channel 插件化
 *
 * KURISU-013 Phase 1: 统一 Server 骨架
 */

import { ModelProvider, loadConfig } from "../config/models";
import { HybridMemoryEngine } from "../memory";
import { PersonaEngine } from "../core/persona";
import { AgentOrchestrator } from "../agents";
import {
  Gateway,
  KurisuServer,
  MockChannel,
  TelegramChannel,
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

      // 直接使用 orchestrator 的 finalResponse
      // 注意：不能同时消费 result.chunks 和 result.finalResponse
      // 因为 AsyncGenerator 只能被消费一次
      const textPromise = result.finalResponse;

      // 创建流式生成器（基于 finalResponse，因为 chunks 已被消费）
      async function* textStream() {
        const text = await textPromise;
        // 简单地一次性返回完整文本（非真正流式）
        yield text;
      }

      async function* fullStream() {
        const text = await textPromise;
        yield {
          type: 0, // TEXT_DELTA
          text,
          isFinal: true,
          timestamp: new Date(),
        };
      }

      return {
        textStream: textStream(),
        fullStream: fullStream(),
        finalResponse: result.finalResponse,
      };
    },
    createSession: (_params) => {
      // AgentOrchestrator 内部管理 session
    },
    hasSession: (_sessionId) => {
      return true; // AgentOrchestrator 内部管理
    },
  };
}

/**
 * 根据环境变量创建 Channel
 * @param gateway Gateway 实例，用于处理消息
 */
function createChannels(gateway: Gateway): {
  mock?: MockChannel;
  telegram?: TelegramChannel;
} {
  const channels: { mock?: MockChannel; telegram?: TelegramChannel } = {};

  // Mock Channel (开发测试用)
  if (process.env["ENABLE_MOCK_CHANNEL"] === "true") {
    channels.mock = new MockChannel({ echo: false });
    console.log("  ✓ MockChannel enabled");
  }

  // Telegram Channel (KURISU-013 Phase 2.1: Gateway 集成)
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    const webhookUrl = process.env["TELEGRAM_WEBHOOK_URL"];

    // 创建适配 TelegramChannel 的 Gateway 接口
    const telegramGateway = {
      processStream: async (
        sessionId: string,
        input: string,
        userId?: string,
      ) => {
        const result = await gateway.processStream(sessionId, input, userId);
        return {
          textStream: result.textStream,
          finalResponse: result.finalResponse,
        };
      },
    };

    channels.telegram = new TelegramChannel({
      botToken: process.env["TELEGRAM_BOT_TOKEN"],
      gateway: telegramGateway,
      ...(webhookUrl && { webhookUrl }),
    });
    console.log("  ✓ TelegramChannel enabled");
  }

  return channels;
}

async function main(): Promise<void> {
  const port = parseInt(process.env["PORT"] ?? "3000", 10);
  const host = process.env["HOST"] ?? "0.0.0.0";

  console.log(`Starting Kurisu HTTP Server v${VERSION}...\n`);

  try {
    // 加载模型配置
    const configPath = process.env["MODELS_CONFIG"] ?? "config/models.yaml";
    const modelConfig = await loadConfig(configPath);

    // 初始化依赖
    const modelProvider = new ModelProvider(
      modelConfig.models,
      modelConfig.defaults,
    );
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
    const server = new KurisuServer({ gateway }, { port, host });

    // 注册 Channel (传入 Gateway)
    const channels = createChannels(gateway);
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

    // 构建 Channel 显示信息
    const channelLines: string[] = [];
    if (channels.mock) {
      channelLines.push("POST /mock/webhook     - Mock Channel");
    }
    if (channels.telegram) {
      channelLines.push("POST /telegram/webhook - Telegram Bot");
    }
    const channelInfo =
      channelLines.length > 0
        ? channelLines.join("\n║    ")
        : "No channels enabled";

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
║    ${channelInfo}
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error("Failed to start HTTP Server:", error);
    process.exit(1);
  }
}

main();
