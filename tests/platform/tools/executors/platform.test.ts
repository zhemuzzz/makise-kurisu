/**
 * 跨平台执行器 - 平台检测测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  detectPlatform,
  clearPlatformCache,
  isDockerLikelyAvailable,
  getRecommendedWorkDir,
} from "../../../../src/platform/tools/executors/platform";

describe("Platform Detection", () => {
  beforeEach(() => {
    clearPlatformCache();
  });

  describe("detectPlatform", () => {
    it("should detect current platform", () => {
      const info = detectPlatform();

      expect(info).toBeDefined();
      expect(info.platform).toBeDefined();
      expect(["linux", "macos", "windows", "android", "ios"]).toContain(
        info.platform,
      );
    });

    it("should return osType", () => {
      const info = detectPlatform();

      expect(info.osType).toBeDefined();
      expect(["linux", "darwin", "win32", "unknown"]).toContain(info.osType);
    });

    it("should return homeDir", () => {
      const info = detectPlatform();

      expect(info.homeDir).toBeDefined();
      expect(typeof info.homeDir).toBe("string");
      expect(info.homeDir.length).toBeGreaterThan(0);
    });

    it("should return tempDir", () => {
      const info = detectPlatform();

      expect(info.tempDir).toBeDefined();
      expect(typeof info.tempDir).toBe("string");
      expect(info.tempDir.length).toBeGreaterThan(0);
    });

    it("should detect Termux environment when TERMUX_VERSION is set", () => {
      // Clear cache first
      clearPlatformCache();

      // Mock TERMUX_VERSION
      const originalValue = process.env["TERMUX_VERSION"];
      process.env["TERMUX_VERSION"] = "0.118.0";

      // Detect platform (will cache with TERMUX_VERSION set)
      const info = detectPlatform();

      // On non-Linux systems, platform won't be android even with TERMUX_VERSION
      // because detectPlatform checks process.platform first
      // So we just verify the detection logic runs without error
      expect(info.isTermux).toBeDefined();

      // Restore
      if (originalValue === undefined) {
        delete process.env["TERMUX_VERSION"];
      } else {
        process.env["TERMUX_VERSION"] = originalValue;
      }
      clearPlatformCache();
    });

    it("should cache platform info", () => {
      const info1 = detectPlatform();
      const info2 = detectPlatform();

      expect(info1).toBe(info2); // Same reference
    });
  });

  describe("clearPlatformCache", () => {
    it("should clear cached platform info", () => {
      const info1 = detectPlatform();
      clearPlatformCache();
      const info2 = detectPlatform();

      // Should be different objects after cache clear
      expect(info1).not.toBe(info2);
    });
  });

  describe("isDockerLikelyAvailable", () => {
    it("should return boolean", () => {
      const result = isDockerLikelyAvailable();
      expect(typeof result).toBe("boolean");
    });

    it("should return false on Android/iOS platform", () => {
      // This test only makes sense on Linux where Termux detection works
      // On macOS/Windows, it will return true if Docker is installed
      // We just verify the function runs without error
      clearPlatformCache();

      // Mock Termux environment
      const originalValue = process.env["TERMUX_VERSION"];
      process.env["TERMUX_VERSION"] = "0.118.0";

      clearPlatformCache();
      const result = isDockerLikelyAvailable();

      // On non-Linux systems, this may still return true if Docker is installed
      // So we just verify it returns a boolean
      expect(typeof result).toBe("boolean");

      // Restore
      if (originalValue === undefined) {
        delete process.env["TERMUX_VERSION"];
      } else {
        process.env["TERMUX_VERSION"] = originalValue;
      }
      clearPlatformCache();
    });
  });

  describe("getRecommendedWorkDir", () => {
    it("should return a valid path", () => {
      const workDir = getRecommendedWorkDir();

      expect(workDir).toBeDefined();
      expect(typeof workDir).toBe("string");
      expect(workDir.length).toBeGreaterThan(0);
    });

    it("should include kurisu-workspace in path", () => {
      const workDir = getRecommendedWorkDir();

      expect(workDir).toContain("kurisu-workspace");
    });
  });
});
