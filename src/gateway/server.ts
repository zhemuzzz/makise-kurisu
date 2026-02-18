/**
 * L1 交互网关 - KurisuServer
 * @description KURISU-013 统一 HTTP Server，Channel 插件化路由
 */

import * as http from "http";
import * as url from "url";
import { Gateway } from "./index";
import { BaseChannel } from "./channels/base";

const VERSION = "0.2.0";

/**
 * KurisuServer 配置
 */
export interface KurisuServerConfig {
  /** 服务端口，默认 3000 */
  port?: number;
  /** 绑定地址，默认 0.0.0.0 */
  host?: string;
}

/**
 * KurisuServer 依赖
 */
export interface KurisuServerDeps {
  gateway: Gateway;
}

/**
 * 路由处理器类型
 * @param req 原始请求对象
 * @param res 响应对象
 * @param body 已解析的请求体
 */
type RouteHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: unknown,
) => Promise<void>;

/**
 * 支持的 HTTP 方法
 */
type SupportedMethod = "GET" | "POST";

/**
 * Kurisu 统一 HTTP Server
 * @description 自动注册 Channel 路由，统一健康检查
 */
export class KurisuServer {
  private readonly gateway: Gateway;
  private readonly channels: Map<string, BaseChannel> = new Map();
  private readonly routes: Map<string, RouteHandler> = new Map();
  private server: http.Server | undefined = undefined;
  private startTime = 0;
  private config: Required<KurisuServerConfig>;

  constructor(deps: KurisuServerDeps, config: KurisuServerConfig = {}) {
    this.gateway = deps.gateway;
    this.config = {
      port: config.port ?? 3000,
      host: config.host ?? "0.0.0.0",
    };
  }

  /**
   * 注册 Channel
   * @param name Channel 名称标识
   * @param channel Channel 实例
   */
  registerChannel(name: string, channel: BaseChannel): void {
    this.channels.set(name, channel);

    // 自动注册 Channel 路由
    const routes = channel.getRoutes();
    for (const route of routes) {
      const key = this.routeKey(route.method, route.path);
      this.routes.set(key, async (req, res, body) => {
        // 将 body 附加到 req 对象以兼容现有 Channel 实现
        // TODO: 后续重构 Channel 接口，直接传递 body 参数
        const reqWithBody = req as http.IncomingMessage & { body: unknown };
        reqWithBody.body = body;
        await channel.handleRequest(reqWithBody, res);
      });
    }
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    this.startTime = Date.now();

    // 初始化所有 Channel
    for (const channel of this.channels.values()) {
      await channel.initialize();
    }

    // 启动 Gateway
    if (!this.gateway.isRunning()) {
      await this.gateway.start();
    }

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    // 关闭所有 Channel
    for (const channel of this.channels.values()) {
      await channel.shutdown();
    }

    // 停止 Gateway
    if (this.gateway.isRunning()) {
      await this.gateway.stop();
    }

    const server = this.server;
    if (!server) {
      return;
    }

    // 检查 server 是否正在监听
    if (!server.listening) {
      this.server = undefined;
      return;
    }

    return new Promise((resolve) => {
      // 添加超时保护，防止 close 回调永不触发
      const timeout = setTimeout(() => {
        resolve();
      }, 1000);

      server.close(() => {
        clearTimeout(timeout);
        this.server = undefined;
        // 忽略所有错误，确保总是 resolve
        resolve();
      });
    });
  }

  /**
   * 获取服务信息
   */
  getInfo(): {
    port: number;
    host: string;
    version: string;
    channelCount: number;
  } {
    return {
      port: this.config.port,
      host: this.config.host,
      version: VERSION,
      channelCount: this.channels.size,
    };
  }

  /**
   * 处理请求
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
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

    const parsedUrl = url.parse(req.url ?? "/", true);
    const pathname = parsedUrl.pathname ?? "/";

    try {
      // 健康检查
      if (req.method === "GET" && pathname === "/health") {
        this.sendJson(res, 200, {
          status: "healthy",
          version: VERSION,
          uptime: Math.floor((Date.now() - this.startTime) / 1000),
          timestamp: new Date().toISOString(),
          channels: this.channels.size,
        });
        return;
      }

      // 就绪检查
      if (req.method === "GET" && pathname === "/ready") {
        const gatewayReady = this.gateway.isRunning();
        const channelHealthChecks = await Promise.all(
          Array.from(this.channels.values()).map((c) => c.healthCheck()),
        );
        const channelsReady = channelHealthChecks.every((ready) => ready);

        this.sendJson(res, gatewayReady && channelsReady ? 200 : 503, {
          status: gatewayReady && channelsReady ? "ready" : "not_ready",
          gateway: gatewayReady,
          channels: channelsReady,
        });
        return;
      }

      // Channel 路由
      // 验证 HTTP 方法
      const method = req.method;
      if (method !== "GET" && method !== "POST") {
        this.sendJson(res, 405, { error: "Method not allowed" });
        return;
      }

      const routeKey = this.routeKey(method, pathname);
      const handler = this.routes.get(routeKey);

      if (handler) {
        // 解析请求 body 并传递给 handler
        const body = await this.parseBody(req);
        await handler(req, res, body);
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

  /**
   * 生成路由 key
   */
  private routeKey(method: SupportedMethod, path: string): string {
    return `${method} ${path}`;
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(
    res: http.ServerResponse,
    status: number,
    data: unknown,
  ): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  /**
   * 解析请求 body
   */
  private parseBody<T>(req: http.IncomingMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf-8");
      });
      req.on("end", () => {
        try {
          resolve(body ? (JSON.parse(body) as T) : ({} as T));
        } catch {
          reject(new Error("Invalid JSON"));
        }
      });
      req.on("error", reject);
    });
  }
}
