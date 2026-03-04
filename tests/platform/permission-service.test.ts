/**
 * PermissionService 测试
 * TDD: RED → GREEN → IMPROVE
 *
 * PS-1: 统一权限判定
 * PS-2: 结构化规则配置
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("PermissionService", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  // 辅助：创建 PermissionService 实例
  async function createService(overrides?: Record<string, unknown>) {
    const { createPermissionService } = await import(
      "@/platform/permission-service"
    );
    return createPermissionService({
      config: {
        version: "1.0",
        defaultLevel: "confirm" as const,
        tools: {
          safe: ["web_search", "file_read", "time"],
          confirm: ["shell", "file_write", "browser"],
          deny: ["file_delete"],
        },
        paths: {
          deny: ["/etc/**", "~/.ssh/**"],
          confirm: ["~/Documents/**"],
          allow: ["./data/**", "/tmp/kurisu-*/**"],
        },
        shell: {
          denyPatterns: ["rm -rf /", "mkfs", "dd if="],
          confirmPatterns: ["sudo", "chmod", "rm"],
        },
        ...overrides,
      },
    });
  }

  // ============ Tool Permission (PS-1) ============

  describe("PS-1: Tool Permission", () => {
    it("PS-01: safe tool → 'allow'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "tool:execute",
        subject: "web_search",
      });
      expect(result).toBe("allow");
    });

    it("PS-02: confirm tool → 'confirm'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "tool:execute",
        subject: "shell",
      });
      expect(result).toBe("confirm");
    });

    it("PS-03: deny tool → 'deny'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "tool:execute",
        subject: "file_delete",
      });
      expect(result).toBe("deny");
    });

    it("PS-04: unknown tool → defaultLevel", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "tool:execute",
        subject: "unknown_tool",
      });
      expect(result).toBe("confirm"); // defaultLevel = confirm
    });

    it("PS-05: deny > confirm > allow 优先级", async () => {
      // 同一工具同时出现在 deny 和 safe 中，deny 胜出
      const svc = await createService({
        tools: {
          safe: ["dual_tool"],
          confirm: ["dual_tool"],
          deny: ["dual_tool"],
        },
      });
      const result = svc.check({
        action: "tool:execute",
        subject: "dual_tool",
      });
      expect(result).toBe("deny");
    });
  });

  // ============ Path Permission (PS-1) ============

  describe("PS-1: Path Permission", () => {
    it("PS-06: file:read + deny path → 'deny'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "file:read",
        subject: "/etc/passwd",
      });
      expect(result).toBe("deny");
    });

    it("PS-07: file:write + confirm path → 'confirm'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "file:write",
        subject: "~/Documents/notes.txt",
      });
      expect(result).toBe("confirm");
    });

    it("PS-08: file:read + allow path → 'allow'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "file:read",
        subject: "./data/test.json",
      });
      expect(result).toBe("allow");
    });

    it("PS-09: file:write + deny path → 'deny'（deny > allow）", async () => {
      const svc = await createService({
        paths: {
          deny: ["./data/secret/**"],
          confirm: [],
          allow: ["./data/**"],
        },
      });
      const result = svc.check({
        action: "file:write",
        subject: "./data/secret/key.pem",
      });
      expect(result).toBe("deny");
    });
  });

  // ============ Shell Permission (PS-1) ============

  describe("PS-1: Shell Permission", () => {
    it("PS-10: shell deny_pattern → 'deny'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "shell:execute",
        subject: "rm -rf / --no-preserve-root",
      });
      expect(result).toBe("deny");
    });

    it("PS-11: shell confirm_pattern → 'confirm'", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "shell:execute",
        subject: "sudo apt install curl",
      });
      expect(result).toBe("confirm");
    });

    it("PS-12: safe shell command → defaultLevel", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "shell:execute",
        subject: "echo hello",
      });
      expect(result).toBe("confirm"); // defaultLevel
    });
  });

  // ============ Other Actions ============

  describe("PS-1: Other Actions", () => {
    it("PS-13: skill:manage → defaultLevel", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "skill:manage",
        subject: "coding-assistant",
      });
      expect(result).toBe("confirm");
    });

    it("PS-14: mutation:submit → defaultLevel", async () => {
      const svc = await createService();
      const result = svc.check({
        action: "mutation:submit",
        subject: "persona-update",
      });
      expect(result).toBe("confirm");
    });
  });

  // ============ getToolAnnotations (PS-1) ============

  describe("PS-1: getToolAnnotations", () => {
    it("PS-15: getToolAnnotations mixed tools", async () => {
      const svc = await createService();
      const annotations = svc.getToolAnnotations([
        "web_search",
        "shell",
        "file_delete",
        "unknown_tool",
      ]);
      expect(annotations).toHaveLength(4);
      expect(annotations[0]).toEqual({
        toolId: "web_search",
        permission: "allow",
      });
      expect(annotations[1]).toEqual({
        toolId: "shell",
        permission: "confirm",
      });
      expect(annotations[2]).toEqual({
        toolId: "file_delete",
        permission: "deny",
      });
      expect(annotations[3]).toEqual({
        toolId: "unknown_tool",
        permission: "confirm",
      });
    });

    it("PS-16: getToolAnnotations empty → []", async () => {
      const svc = await createService();
      const annotations = svc.getToolAnnotations([]);
      expect(annotations).toEqual([]);
    });
  });

  // ============ Pure Function ============

  describe("PS-1: Pure Function", () => {
    it("PS-17: 纯函数：相同输入 → 相同输出", async () => {
      const svc = await createService();
      const req = { action: "tool:execute" as const, subject: "shell" };
      const r1 = svc.check(req);
      const r2 = svc.check(req);
      const r3 = svc.check(req);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    });
  });

  // ============ Default Level Variations ============

  describe("PS-2: Default Level", () => {
    it("PS-18: defaultLevel=safe → unknown tools get 'allow'", async () => {
      const svc = await createService({
        defaultLevel: "safe",
      });
      const result = svc.check({
        action: "tool:execute",
        subject: "unknown_tool",
      });
      expect(result).toBe("allow");
    });

    it("PS-19: defaultLevel=deny → unknown tools get 'deny'", async () => {
      const svc = await createService({
        defaultLevel: "deny",
      });
      const result = svc.check({
        action: "tool:execute",
        subject: "unknown_tool",
      });
      expect(result).toBe("deny");
    });
  });
});
