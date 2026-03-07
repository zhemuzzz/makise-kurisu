/**
 * Kurisu 生产入口
 *
 * bootstrapFull → createAgent → AgentHandle → Gateway → KurisuServer → Channels
 */

import { join } from "path";
import { bootstrapFull, type BootstrapResult } from "./platform/bootstrap.js";
import { createAgent } from "./agent/index.js";
import {
  Gateway,
  KurisuServer,
  TelegramChannel,
  QQChannel,
  CLIChannel,
} from "./platform/gateway/index.js";
import type { AgentHandle } from "./platform/gateway/types.js";
import type { AgentEvent, AgentResult } from "./agent/types.js";

// ============ Main ============

async function main(): Promise<void> {
  const configDir = join(process.cwd(), "config");
  const personasDir = join(configDir, "personas");

  // Phase 1: Bootstrap — 所有 Platform Services
  console.log("[main] Starting bootstrap...");
  const result = await bootstrapFull({
    configDir,
    personasDir,
    roles: ["kurisu"],
    skipQdrant: !!process.env["SKIP_QDRANT"],
  });

  // Phase 2: Agent + AgentHandle（单角色 MVP）
  const firstEntry = [...result.roles.entries()][0];
  if (!firstEntry) {
    throw new Error("No roles configured");
  }
  const [roleId, role] = firstEntry;
  const agent = createAgent(role.identity, role.services);

  const agentHandle: AgentHandle = {
    agent,
    getCognition: role.getCognition,
    personaEngine: role.personaEngine,
  };

  console.log(`[main] Agent created for role: ${roleId}`);

  // Phase 3: Wire setExecuteTask（sub-agent 支持）
  result.setExecuteTask(async (config) => {
    const subAgent = createAgent(role.identity, role.services);
    const gen = subAgent.execute(
      {
        userMessage: config.taskGoal,
        activatedSkills: [],
        recalledMemories: [],
        conversationHistory: config.contextSlice,
        mentalModel: {
          mood: { pleasure: 0, arousal: 0, dominance: 0 },
          activeEmotions: [],
          relationshipStage: 1,
          relationshipDescription: "",
          formattedText: "",
        },
        taskGoal: config.taskGoal,
      },
      {
        sessionId: config.sessionId,
        mode: "background",
        maxIterations: config.maxIterations ?? 15,
        timeout: config.timeout ?? 60000,
        isSubAgent: true,
        userId: config.parentAgentId,
        ...(config.modelId !== undefined ? { modelId: config.modelId } : {}),
        debugEnabled: false,
      },
    );
    // Consume generator to get final result
    let agentResult: AgentResult | undefined;
    let next: IteratorResult<AgentEvent, AgentResult>;
    do {
      next = await gen.next();
      if (next.done) {
        agentResult = next.value;
      }
    } while (!next.done);

    return {
      result: agentResult?.finalResponse ?? "",
      stats: agentResult?.stats ?? {
        iterations: 0,
        toolCallCount: 0,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        duration: 0,
        compactCount: 0,
      },
    };
  });

  // Phase 4: Gateway
  const gateway = new Gateway({
    agentHandle,
    tracing: result.foundation.tracing,
  });

  // Phase 5: KurisuServer
  const port = Number(process.env["PORT"] ?? 3000);
  const host = process.env["HOST"] ?? "0.0.0.0";
  const server = new KurisuServer({ gateway }, { port, host });

  // Phase 6: 按配置注册 Channels
  registerChannels(result, server, gateway);

  // Phase 7: 启动 HTTP Server + Gateway + Channels
  await server.start();
  console.log(`[main] Server listening on ${host}:${port}`);

  // Phase 8: 后台服务 — 注册日常任务到调度器
  result.background.routineSystem.syncToScheduler();
  console.log("[main] Background services synced");

  // Phase 9: CLI 模式（可选，--cli 参数）
  if (process.argv.includes("--cli")) {
    const cli = new CLIChannel(gateway, {
      welcomeMessage: `\nKurisu v0.2 [${roleId}]\nType /quit to exit.\n`,
    });
    await cli.start();
  }

  // Phase 10: Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log("\n[main] Shutting down...");
    await server.stop();
    result.shutdown();
    console.log("[main] Bye.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

// ============ Channel Registration ============

function registerChannels(
  result: BootstrapResult,
  server: KurisuServer,
  gateway: Gateway,
): void {
  const secrets = result.foundation.config.get("secrets");
  const gwConfig = result.foundation.config.get("gateway");

  // Telegram
  if (secrets.telegramBotToken) {
    const tgBase = {
      botToken: secrets.telegramBotToken,
      gateway,
    };
    const tgConfig = gwConfig.telegram?.webhookUrl
      ? { ...tgBase, webhookUrl: gwConfig.telegram.webhookUrl }
      : tgBase;
    const tgChannel = new TelegramChannel(tgConfig);
    server.registerChannel("telegram", tgChannel);
    console.log("[main] Telegram channel registered");
  }

  // QQ (NapCat OneBot11)
  if (secrets.qqBotToken) {
    const qqCfg = gwConfig.qq;
    const httpUrl = qqCfg
      ? `http://${qqCfg.host}:${qqCfg.port}`
      : (process.env["NAPCAT_HTTP_URL"] ?? "http://localhost:3001");
    const qqBase = {
      httpUrl,
      pollInterval: Number(process.env["QQ_POLL_INTERVAL"] ?? 1000),
      gateway,
    };
    const accessToken = process.env["NAPCAT_ACCESS_TOKEN"];
    const qqConfig = accessToken
      ? { ...qqBase, accessToken }
      : qqBase;
    const qqChannel = new QQChannel(qqConfig);
    server.registerChannel("qq", qqChannel);
    console.log("[main] QQ channel registered");
  }
}

// ============ Entry Point ============

main().catch((err: unknown) => {
  console.error("[main] Fatal error:", err);
  process.exit(1);
});
