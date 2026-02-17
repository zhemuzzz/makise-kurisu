#!/usr/bin/env node
/**
 * Kurisu HTTP Server 入口
 * REST API + 流式响应
 *
 * 注意: 直接使用 AgentOrchestrator，绕过 Gateway 层的接口适配问题
 */

import * as http from "http";
import * as url from "url";
import { ModelProvider } from "../config/models";
import { HybridMemoryEngine } from "../memory";
import { PersonaEngine } from "../core/persona";
import { AgentOrchestrator } from "../agents";
import type { StreamResult, MemoryEngineLike } from "../agents/types";

const VERSION = "0.1.0";

// Session storage (in-memory for MVP)
const sessions = new Map<string, { userId: string; createdAt: Date }>();

/**
 * 简化的 HTTP Server
 */
class SimpleHttpServer {
  private server?: http.Server;
  private startTime = 0;

  constructor(
    private orchestrator: AgentOrchestrator,
    private port: number,
    private host: string
  ) {}

  async start(): Promise<void> {
    this.startTime = Date.now();

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, this.host, () => {
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || "/", true);
    const pathname = parsedUrl.pathname || "/";

    try {
      // Health check
      if (req.method === "GET" && pathname === "/health") {
        this.sendJson(res, 200, {
          status: "healthy",
          version: VERSION,
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Ready check
      if (req.method === "GET" && pathname === "/ready") {
        this.sendJson(res, 200, {
          status: "healthy",
          version: VERSION,
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
        });
        return;
      }

      // Create session
      if (req.method === "POST" && pathname === "/api/sessions") {
        const body = await this.parseBody<{ userId?: string }>(req);
        const sessionId = `session-${Date.now()}`;
        const userId = body.userId ?? `user-${Date.now()}`;
        sessions.set(sessionId, { userId, createdAt: new Date() });
        this.sendJson(res, 201, { sessionId, userId });
        return;
      }

      // Send message (match /api/sessions/:sessionId/messages)
      const messagesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
      if (req.method === "POST" && messagesMatch) {
        const sessionId = messagesMatch[1]!;
        const session = sessions.get(sessionId);

        if (!session) {
          this.sendJson(res, 404, { error: "Session not found" });
          return;
        }

        const body = await this.parseBody<{ message?: string }>(req);
        const message = body.message;

        if (!message) {
          this.sendJson(res, 400, { error: "message is required" });
          return;
        }

        const result = await this.orchestrator.processStream(
          sessionId,
          session.userId,
          message
        );
        const fullResponse = await this.collectStream(result);

        this.sendJson(res, 200, { response: fullResponse });
        return;
      }

      // Stream message (SSE)
      const streamMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/stream$/);
      if (req.method === "POST" && streamMatch) {
        const sessionId = streamMatch[1]!;
        const session = sessions.get(sessionId);

        if (!session) {
          this.sendJson(res, 404, { error: "Session not found" });
          return;
        }

        const body = await this.parseBody<{ message?: string }>(req);
        const message = body.message;

        if (!message) {
          this.sendJson(res, 400, { error: "message is required" });
          return;
        }

        // SSE headers
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        try {
          const result = await this.orchestrator.processStream(
            sessionId,
            session.userId,
            message
          );

          for await (const chunk of result.chunks) {
            const text = chunk.delta ?? chunk.content;
            res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        } catch (error) {
          res.write(
            `data: ${JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown error",
            })}\n\n`
          );
        }
        res.end();
        return;
      }

      // 404
      this.sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      console.error("Request error:", error);
      this.sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Internal error",
      });
    }
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private async parseBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : ({} as T));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  private async collectStream(result: StreamResult): Promise<string> {
    let full = "";
    for await (const chunk of result.chunks) {
      full += chunk.delta ?? chunk.content;
    }
    return full;
  }
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

    // 创建 HTTP Server
    const httpServer = new SimpleHttpServer(orchestrator, port, host);

    // 优雅关闭
    const shutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      await httpServer.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // 启动服务
    await httpServer.start();

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Kurisu HTTP Server started                                  ║
║                                                              ║
║  Listening: http://${host}:${port}                            ║
║                                                              ║
║  Endpoints:                                                  ║
║    GET  /health        - Health check                        ║
║    GET  /ready         - Readiness check                     ║
║    POST /api/sessions  - Create session                      ║
║    POST /api/sessions/:id/messages   - Send message          ║
║    POST /api/sessions/:id/stream     - Stream message (SSE)  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error("Failed to start HTTP Server:", error);
    process.exit(1);
  }
}

main();
