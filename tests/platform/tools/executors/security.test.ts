/**
 * 跨平台执行器 - 安全验证测试
 */

import { describe, it, expect } from "vitest";
import {
  validateToolName,
  checkDangerousCommand,
  filterSensitiveEnvVars,
  validateAllowedPaths,
  buildSafeCommand,
  decodeBase64Args,
} from "../../../../src/platform/tools/executors/security";

describe("Security Validation", () => {
  describe("validateToolName", () => {
    it("should accept valid tool names", () => {
      expect(validateToolName("web_search").valid).toBe(true);
      expect(validateToolName("file-read").valid).toBe(true);
      expect(validateToolName("tool_123").valid).toBe(true);
      expect(validateToolName("TOOL").valid).toBe(true);
    });

    it("should reject empty names", () => {
      const result = validateToolName("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject names that are too long", () => {
      const longName = "a".repeat(100);
      const result = validateToolName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too long");
    });

    it("should reject names with special characters", () => {
      expect(validateToolName("rm -rf").valid).toBe(false);
      expect(validateToolName("tool;rm").valid).toBe(false);
      expect(validateToolName("tool$(cmd)").valid).toBe(false);
      expect(validateToolName("tool`cmd`").valid).toBe(false);
      expect(validateToolName("tool|cmd").valid).toBe(false);
      expect(validateToolName("tool&cmd").valid).toBe(false);
    });
  });

  describe("checkDangerousCommand", () => {
    it("should allow safe commands", () => {
      expect(checkDangerousCommand("echo hello").safe).toBe(true);
      expect(checkDangerousCommand("ls -la").safe).toBe(true);
      expect(checkDangerousCommand("cat file.txt").safe).toBe(true);
    });

    it("should detect rm -rf", () => {
      const result = checkDangerousCommand("rm -rf /");
      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes("delete"))).toBe(true);
    });

    it("should detect sudo", () => {
      const result = checkDangerousCommand("sudo apt install");
      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes("Privilege"))).toBe(true);
    });

    it("should detect dd command", () => {
      const result = checkDangerousCommand("dd if=/dev/zero of=/dev/sda");
      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes("Disk"))).toBe(true);
    });

    it("should detect fork bomb", () => {
      const result = checkDangerousCommand(":(){ :|:& };:");
      expect(result.safe).toBe(false);
      expect(result.warnings.some((w) => w.includes("Fork"))).toBe(true);
    });
  });

  describe("filterSensitiveEnvVars", () => {
    it("should allow safe environment variables", () => {
      const env = {
        TOOL_PATH: "/usr/bin",
        APP_MODE: "production",
        PATH: "/usr/bin",
        HOME: "/home/user",
        LANG: "en_US.UTF-8",
      };

      const filtered = filterSensitiveEnvVars(env);
      expect(filtered).toEqual(env);
    });

    it("should block API keys", () => {
      const env = {
        API_KEY: "secret123",
        TOOL_PATH: "/usr/bin",
      };

      const filtered = filterSensitiveEnvVars(env);
      expect(filtered).toEqual({ TOOL_PATH: "/usr/bin" });
      expect(filtered).not.toHaveProperty("API_KEY");
    });

    it("should block tokens", () => {
      const env = {
        ACCESS_TOKEN: "abc123",
        AUTH_TOKEN: "xyz789",
        APP_NAME: "test",
      };

      const filtered = filterSensitiveEnvVars(env);
      expect(filtered).toEqual({ APP_NAME: "test" });
    });

    it("should block passwords", () => {
      const env = {
        DB_PASSWORD: "secret",
        USER_PASSWORD: "123456",
        TOOL_DEBUG: "true",
      };

      const filtered = filterSensitiveEnvVars(env);
      expect(filtered).toEqual({ TOOL_DEBUG: "true" });
    });

    it("should block credentials", () => {
      const env = {
        AWS_CREDENTIAL: "xxx",
        CREDENTIAL_FILE: "/etc/creds",
        KURISU_PATH: "/opt/kurisu",
      };

      const filtered = filterSensitiveEnvVars(env);
      expect(filtered).toEqual({ KURISU_PATH: "/opt/kurisu" });
    });
  });

  describe("validateAllowedPaths", () => {
    it("should allow safe paths", () => {
      const paths = ["/home/user", "/tmp/workspace", "/Users/test/Documents"];
      const result = validateAllowedPaths(paths);
      expect(result.valid).toEqual(paths);
      expect(result.rejected).toEqual([]);
    });

    it("should reject root path", () => {
      const result = validateAllowedPaths(["/"]);
      expect(result.valid).toEqual([]);
      expect(result.rejected).toEqual(["/"]);
    });

    it("should reject critical system paths", () => {
      const result = validateAllowedPaths(["/etc", "/var", "/root", "/usr"]);
      expect(result.valid).toEqual([]);
      expect(result.rejected.length).toBe(4);
    });

    it("should reject paths starting with critical paths", () => {
      const result = validateAllowedPaths(["/etc/passwd", "/var/log"]);
      expect(result.valid).toEqual([]);
      expect(result.rejected.length).toBe(2);
    });

    it("should mix valid and rejected paths", () => {
      const result = validateAllowedPaths(["/home/user", "/etc", "/tmp/ws"]);
      expect(result.valid).toEqual(["/home/user", "/tmp/ws"]);
      expect(result.rejected).toEqual(["/etc"]);
    });
  });

  describe("buildSafeCommand", () => {
    it("should build safe command with valid tool name", () => {
      const result = buildSafeCommand("web_search", { query: "test" });
      expect(result.error).toBeUndefined();
      expect(result.command).toContain("web_search");
      expect(result.command).toContain("--args-base64");
    });

    it("should reject invalid tool name", () => {
      const result = buildSafeCommand("rm -rf", { path: "/" });
      expect(result.error).toBeDefined();
      expect(result.command).toBe("");
    });

    it("should encode arguments as base64", () => {
      const args = { query: "hello world", limit: 10 };
      const result = buildSafeCommand("search", args);
      expect(result.error).toBeUndefined();

      // Verify we can decode the arguments
      const base64Match = result.command.match(/--args-base64 (\S+)/);
      expect(base64Match).not.toBeNull();

      const decoded = decodeBase64Args(base64Match![1]);
      expect(decoded).toEqual(args);
    });
  });

  describe("decodeBase64Args", () => {
    it("should decode base64 encoded arguments", () => {
      const args = { foo: "bar", num: 42 };
      const base64 = Buffer.from(JSON.stringify(args)).toString("base64");
      const decoded = decodeBase64Args(base64);
      expect(decoded).toEqual(args);
    });
  });
});
