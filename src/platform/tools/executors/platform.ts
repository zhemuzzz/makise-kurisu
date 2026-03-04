/**
 * 跨平台工具执行器 - 平台检测
 *
 * 检测当前运行平台和 Docker 可用性
 */

import fs from "fs";
import path from "path";
import os from "os";
import type { Platform } from "./types";

/**
 * 平台检测结果
 */
export interface PlatformInfo {
  /** 检测到的平台 */
  readonly platform: Platform;
  /** 操作系统类型 */
  readonly osType: "linux" | "darwin" | "win32" | "unknown";
  /** 是否是 Termux 环境 */
  readonly isTermux: boolean;
  /** 主目录 */
  readonly homeDir: string;
  /** 临时目录 */
  readonly tempDir: string;
}

/**
 * Docker 可用性检测结果
 */
export interface DockerAvailability {
  /** Docker 是否可用 */
  readonly available: boolean;
  /** 不可用原因 */
  readonly reason?: string;
  /** Docker 版本 */
  readonly version?: string;
}

/**
 * 缓存的平台信息
 */
let cachedPlatformInfo: PlatformInfo | null = null;

/**
 * 缓存的 Docker 可用性
 */
let cachedDockerAvailability: DockerAvailability | null = null;

/**
 * 检测当前平台
 *
 * 优先使用缓存，避免重复检测
 */
export function detectPlatform(): PlatformInfo {
  if (cachedPlatformInfo) {
    return cachedPlatformInfo;
  }

  const osType = process.platform as "linux" | "darwin" | "win32";
  const homeDir = os.homedir();
  const tempDir = os.tmpdir();

  let platform: Platform;
  let isTermux = false;

  // 检测平台类型
  if (osType === "darwin") {
    platform = "macos";
  } else if (osType === "win32") {
    platform = "windows";
  } else if (osType === "linux") {
    // 检测是否是 Android Termux
    isTermux = isTermuxEnvironment();

    if (isTermux) {
      platform = "android";
    } else {
      platform = "linux";
    }
  } else {
    platform = "linux"; // 默认
  }

  cachedPlatformInfo = {
    platform,
    osType: osType ?? "unknown",
    isTermux,
    homeDir,
    tempDir,
  };

  return cachedPlatformInfo;
}

/**
 * 检测是否是 Termux 环境
 */
function isTermuxEnvironment(): boolean {
  // 检查 TERMUX_VERSION 环境变量
  if (process.env["TERMUX_VERSION"]) {
    return true;
  }

  // 检查 Termux 特有路径
  const termuxPaths = [
    "/data/data/com.termux",
    "/data/data/com.termux/files",
    path.join(os.homedir(), ".termux"),
  ];

  for (const termuxPath of termuxPaths) {
    if (fs.existsSync(termuxPath)) {
      return true;
    }
  }

  // 检查 PREFIX 环境变量（Termux 特有）
  if (process.env["PREFIX"]?.includes("/data/data/com.termux")) {
    return true;
  }

  return false;
}

/**
 * 检查 Docker 是否可用
 *
 * 使用 dockerode 进行检测，避免直接调用 docker 命令
 */
export async function checkDockerAvailable(): Promise<DockerAvailability> {
  // 检查缓存
  if (cachedDockerAvailability) {
    return cachedDockerAvailability;
  }

  // Android/iOS 不支持 Docker
  const platformInfo = detectPlatform();
  if (platformInfo.platform === "android" || platformInfo.platform === "ios") {
    cachedDockerAvailability = {
      available: false,
      reason: `${platformInfo.platform} does not support Docker`,
    };
    return cachedDockerAvailability;
  }

  try {
    // 动态导入 dockerode，避免在没有 Docker 的环境报错
    const Docker = (await import("dockerode")).default;

    const docker = new Docker();
    await docker.ping();

    // 获取 Docker 版本信息
    const version = await docker.version();

    cachedDockerAvailability = {
      available: true,
      version: version.Version,
    };

    return cachedDockerAvailability;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";

    cachedDockerAvailability = {
      available: false,
      reason: `Docker not available: ${reason}`,
    };

    return cachedDockerAvailability;
  }
}

/**
 * 同步检查 Docker 是否可能可用（快速检查，不保证准确）
 *
 * 仅检查 Docker 命令是否存在，不验证连接
 */
export function isDockerLikelyAvailable(): boolean {
  const platformInfo = detectPlatform();

  // Android/iOS 不支持
  if (platformInfo.platform === "android" || platformInfo.platform === "ios") {
    return false;
  }

  // macOS/Windows: Docker Desktop 通常安装到特定位置
  if (platformInfo.platform === "macos") {
    const dockerDesktopPaths = [
      "/Applications/Docker.app",
      path.join(os.homedir(), "Applications/Docker.app"),
    ];
    for (const p of dockerDesktopPaths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }
  }

  if (platformInfo.platform === "windows") {
    const dockerDesktopPaths = [
      "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
      path.join(os.homedir(), "AppData\\Local\\Docker\\Docker Desktop.exe"),
    ];
    for (const p of dockerDesktopPaths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }
  }

  // Linux: 检查 docker 命令
  if (platformInfo.platform === "linux") {
    const dockerSocketPaths = ["/var/run/docker.sock"];
    for (const p of dockerSocketPaths) {
      if (fs.existsSync(p)) {
        return true;
      }
    }
  }

  // 检查 PATH 中的 docker 命令
  const pathEnv = process.env["PATH"] ?? "";
  const pathSeparator = platformInfo.osType === "win32" ? ";" : ":";
  const paths = pathEnv.split(pathSeparator);

  for (const p of paths) {
    const dockerPath =
      platformInfo.osType === "win32"
        ? path.join(p, "docker.exe")
        : path.join(p, "docker");

    if (fs.existsSync(dockerPath)) {
      return true;
    }
  }

  return false;
}

/**
 * 清除缓存（用于测试）
 */
export function clearPlatformCache(): void {
  cachedPlatformInfo = null;
  cachedDockerAvailability = null;
}

/**
 * 获取推荐的工作目录
 */
export function getRecommendedWorkDir(): string {
  const platformInfo = detectPlatform();

  if (platformInfo.isTermux) {
    // Termux 环境使用主目录下的 kurisu-workspace
    return path.join(platformInfo.homeDir, "kurisu-workspace");
  }

  // 其他环境使用临时目录
  return path.join(platformInfo.tempDir, "kurisu-workspace");
}
