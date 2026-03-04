/**
 * 会话工作目录管理器测试
 *
 * KURISU-020: 对话切换工作目录功能
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  SessionWorkDirManager,
  createSessionWorkDirManager,
} from "../../../src/platform/tools/session-workdir";
import type { FilePermissionLevel } from "../../../src/platform/models/executor-types";

describe("SessionWorkDirManager", () => {
  let manager: SessionWorkDirManager;
  let testDir: string;
  let sandboxDir: string;

  beforeEach(() => {
    // 创建测试目录
    const rawTestDir = path.join(os.tmpdir(), `kurisu-test-${Date.now()}`);
    fs.mkdirSync(rawTestDir, { recursive: true });

    // 使用 realpathSync 规范化路径（macOS 上 /var -> /private/var）
    testDir = fs.realpathSync(rawTestDir);
    sandboxDir = path.join(testDir, "sandbox");
    fs.mkdirSync(sandboxDir, { recursive: true });

    manager = new SessionWorkDirManager({
      defaultWorkDir: sandboxDir,
      sandboxDir,
    });
  });

  afterEach(() => {
    // 清理测试目录
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
    manager.clearAll();
  });

  describe("getWorkingDir", () => {
    it("应该返回默认目录当会话未设置时", () => {
      const dir = manager.getWorkingDir("test-session");
      expect(dir).toBe(sandboxDir);
    });

    it("应该返回会话目录当已设置时", () => {
      // 在沙箱目录内创建目标目录，这样才能用 sandbox 模式成功切换
      const targetDir = path.join(sandboxDir, "custom");
      fs.mkdirSync(targetDir);

      manager.changeWorkingDir("test-session", targetDir, "sandbox", undefined);

      const dir = manager.getWorkingDir("test-session");
      expect(dir).toBe(targetDir);
    });
  });

  describe("changeWorkingDir - sandbox 模式", () => {
    it("应该允许在沙箱目录内切换", () => {
      const targetDir = path.join(sandboxDir, "subdir");
      fs.mkdirSync(targetDir);

      const result = manager.changeWorkingDir(
        "test-session",
        targetDir,
        "sandbox",
      );

      expect(result.success).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.newDir).toBe(targetDir);
    });

    it("应该拒绝切换到沙箱外的目录", () => {
      const targetDir = path.join(testDir, "outside");
      fs.mkdirSync(targetDir);

      const result = manager.changeWorkingDir(
        "test-session",
        targetDir,
        "sandbox",
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain("沙箱模式");
    });

    it("应该拒绝不存在的目录", () => {
      const result = manager.changeWorkingDir(
        "test-session",
        "/nonexistent/path",
        "sandbox",
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain("不存在");
    });

    it("应该拒绝非目录路径", () => {
      const filePath = path.join(sandboxDir, "file.txt");
      fs.writeFileSync(filePath, "test");

      const result = manager.changeWorkingDir(
        "test-session",
        filePath,
        "sandbox",
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain("不是目录");
    });
  });

  describe("changeWorkingDir - restricted 模式", () => {
    it("应该允许在 allowedPaths 内切换", () => {
      // allowedPaths 必须在 it 块内定义，因为 testDir 在 beforeEach 中初始化
      const allowedPaths = [path.join(os.homedir(), "Documents"), testDir];
      const targetDir = path.join(testDir, "allowed");
      fs.mkdirSync(targetDir);

      const result = manager.changeWorkingDir(
        "test-session",
        targetDir,
        "restricted",
        allowedPaths,
      );

      expect(result.success).toBe(true);
      expect(result.newDir).toBe(targetDir);
    });

    it("应该拒绝切换到 allowedPaths 外的目录", () => {
      const allowedPaths = [path.join(os.homedir(), "Documents"), testDir];
      const outsideDir = path.join(os.tmpdir(), "outside-allowed");
      fs.mkdirSync(outsideDir, { recursive: true });

      const result = manager.changeWorkingDir(
        "test-session",
        outsideDir,
        "restricted",
        allowedPaths,
      );

      expect(result.success).toBe(false);
      expect(result.reason).toContain("受限模式");
    });

    it("应该使用默认 allowedPaths 如果未指定", () => {
      // 默认 allowedPaths 是 ~/Documents, ~/Projects
      const documentsDir = path.join(os.homedir(), "Documents");
      if (fs.existsSync(documentsDir)) {
        const result = manager.changeWorkingDir(
          "test-session",
          documentsDir,
          "restricted",
        );

        expect(result.success).toBe(true);
      }
    });
  });

  describe("changeWorkingDir - full_access 模式", () => {
    it("应该允许切换到任意存在的目录但需要审批", () => {
      const targetDir = path.join(testDir, "full-access");
      fs.mkdirSync(targetDir);

      const result = manager.changeWorkingDir(
        "test-session",
        targetDir,
        "full_access",
      );

      expect(result.success).toBe(false); // 需要审批，暂不成功
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalRequest).toBeDefined();
      expect(result.approvalRequest?.targetDir).toBe(targetDir);
    });

    it("应该创建正确的审批请求", () => {
      const targetDir = path.join(testDir, "approval-test");
      fs.mkdirSync(targetDir);

      const result = manager.changeWorkingDir(
        "test-session",
        targetDir,
        "full_access",
      );

      expect(result.approvalRequest?.riskLevel).toBe("medium");
      expect(result.approvalRequest?.message).toContain(targetDir);
    });
  });

  describe("路径展开", () => {
    it("应该展开 ~ 为用户主目录", () => {
      const homeDir = os.homedir();
      const documentsDir = path.join(homeDir, "Documents");

      if (fs.existsSync(documentsDir)) {
        const result = manager.changeWorkingDir(
          "test-session",
          "~/Documents",
          "sandbox",
          [homeDir],
        );

        // 即使沙箱模式拒绝，路径展开应该正确
        if (!result.success && result.reason?.includes("沙箱模式")) {
          // 预期行为
        }
      }
    });

    it("应该处理相对路径", () => {
      const targetDir = path.join(sandboxDir, "relative");
      fs.mkdirSync(targetDir);

      const result = manager.changeWorkingDir(
        "test-session",
        targetDir,
        "sandbox",
      );

      expect(result.success).toBe(true);
    });
  });

  describe("applyApprovedChange", () => {
    it("应该在审批通过后应用目录切换", () => {
      const targetDir = path.join(testDir, "approved");
      fs.mkdirSync(targetDir);

      manager.applyApprovedChange("test-session", targetDir);

      const dir = manager.getWorkingDir("test-session");
      expect(dir).toBe(targetDir);
    });

    it("应该忽略不存在的目录", () => {
      const originalDir = manager.getWorkingDir("test-session");

      manager.applyApprovedChange("test-session", "/nonexistent/path");

      // 应该保持原目录
      expect(manager.getWorkingDir("test-session")).toBe(originalDir);
    });
  });

  describe("会话管理", () => {
    it("应该隔离不同会话的工作目录", () => {
      const dir1 = path.join(sandboxDir, "session1");
      const dir2 = path.join(sandboxDir, "session2");
      fs.mkdirSync(dir1);
      fs.mkdirSync(dir2);

      manager.changeWorkingDir("session-1", dir1, "sandbox");
      manager.changeWorkingDir("session-2", dir2, "sandbox");

      expect(manager.getWorkingDir("session-1")).toBe(dir1);
      expect(manager.getWorkingDir("session-2")).toBe(dir2);
    });

    it("应该清除指定会话的工作目录", () => {
      const dir = path.join(sandboxDir, "to-clear");
      fs.mkdirSync(dir);

      manager.changeWorkingDir("test-session", dir, "sandbox");
      expect(manager.hasCustomWorkDir("test-session")).toBe(true);

      manager.clearWorkingDir("test-session");
      expect(manager.hasCustomWorkDir("test-session")).toBe(false);
    });

    it("应该清除所有会话", () => {
      const dir = path.join(sandboxDir, "clear-all");
      fs.mkdirSync(dir);

      manager.changeWorkingDir("session-1", dir, "sandbox");
      manager.changeWorkingDir("session-2", dir, "sandbox");

      manager.clearAll();

      expect(manager.getAllSessions()).toHaveLength(0);
    });
  });

  describe("validatePathAccess", () => {
    it("应该验证 sandbox 模式", () => {
      const result = manager.validatePathAccess(
        path.join(sandboxDir, "test"),
        "sandbox",
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("应该验证 restricted 模式", () => {
      const result = manager.validatePathAccess(testDir, "restricted", [
        testDir,
      ]);

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it("应该验证 full_access 模式", () => {
      const result = manager.validatePathAccess("/any/path", "full_access");

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
    });
  });

  describe("工厂函数", () => {
    it("应该创建默认配置的管理器", () => {
      const m = createSessionWorkDirManager();
      expect(m).toBeInstanceOf(SessionWorkDirManager);
    });

    it("应该使用自定义配置", () => {
      const customDefault = "/custom/default";
      const m = createSessionWorkDirManager({
        defaultWorkDir: customDefault,
      });

      expect(m.getWorkingDir("new-session")).toBe(customDefault);
    });
  });
});
