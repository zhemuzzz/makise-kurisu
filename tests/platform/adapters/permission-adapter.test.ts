/**
 * PermissionAdapter 测试
 *
 * 适配 PermissionService → PermissionPort
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionAdapter } from "../../../src/platform/adapters/permission-adapter.js";
import type { PermissionPort } from "../../../src/agent/ports/platform-services.js";
import type {
  PermissionService,
  PermissionDecision,
} from "../../../src/platform/permission-service.js";

// ============================================================================
// Test Helpers
// ============================================================================

function createMockPermissionService(
  defaultDecision: PermissionDecision = "allow",
): {
  service: PermissionService;
  check: ReturnType<typeof vi.fn>;
  getToolAnnotations: ReturnType<typeof vi.fn>;
} {
  const check = vi.fn().mockReturnValue(defaultDecision);
  const getToolAnnotations = vi.fn().mockReturnValue([]);

  const service = {
    check,
    getToolAnnotations,
  } as unknown as PermissionService;

  return { service, check, getToolAnnotations };
}

// ============================================================================
// Tests
// ============================================================================

describe("PermissionAdapter", () => {
  let adapter: PermissionPort;
  let check: ReturnType<typeof vi.fn>;
  let getToolAnnotations: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockPermissionService();
    adapter = new PermissionAdapter(mock.service);
    check = mock.check;
    getToolAnnotations = mock.getToolAnnotations;
  });

  describe("check", () => {
    it("should map to PermissionRequest and return PermissionResult", async () => {
      check.mockReturnValue("allow");

      const result = await adapter.check("web_search", { q: "test" }, "session-1");

      expect(check).toHaveBeenCalledWith({
        action: "tool:execute",
        subject: "web_search",
        context: { sessionId: "session-1", args: { q: "test" } },
      });
      expect(result).toEqual({
        level: "allow",
        allowed: true,
        requiresConfirmation: false,
      });
    });

    it("should handle confirm decision", async () => {
      check.mockReturnValue("confirm");

      const result = await adapter.check("shell", {}, "s1");

      expect(result).toEqual({
        level: "confirm",
        allowed: true,
        requiresConfirmation: true,
      });
    });

    it("should handle deny decision", async () => {
      check.mockReturnValue("deny");

      const result = await adapter.check("dangerous_tool", {}, "s1");

      expect(result).toEqual({
        level: "deny",
        allowed: false,
        requiresConfirmation: false,
        reason: "Permission denied for tool: dangerous_tool",
      });
    });
  });

  describe("getToolAnnotation", () => {
    it("should return annotation for a single tool", () => {
      getToolAnnotations.mockReturnValue([
        { toolId: "shell", permission: "confirm" },
      ]);

      const annotation = adapter.getToolAnnotation("shell");

      expect(annotation).toEqual({
        toolName: "shell",
        level: "confirm",
      });
    });

    it("should map allow → safe", () => {
      getToolAnnotations.mockReturnValue([
        { toolId: "web_search", permission: "allow" },
      ]);

      const annotation = adapter.getToolAnnotation("web_search");

      expect(annotation.level).toBe("safe");
    });

    it("should map deny → deny", () => {
      getToolAnnotations.mockReturnValue([
        { toolId: "rm_rf", permission: "deny" },
      ]);

      const annotation = adapter.getToolAnnotation("rm_rf");

      expect(annotation.level).toBe("deny");
    });

    it("should default to confirm for unknown tools", () => {
      getToolAnnotations.mockReturnValue([]);

      const annotation = adapter.getToolAnnotation("unknown");

      expect(annotation).toEqual({
        toolName: "unknown",
        level: "confirm",
      });
    });
  });

  describe("getToolAnnotations", () => {
    it("should return record keyed by tool name", () => {
      getToolAnnotations.mockReturnValue([
        { toolId: "shell", permission: "confirm" },
        { toolId: "web_search", permission: "allow" },
      ]);

      const annotations = adapter.getToolAnnotations(["shell", "web_search"]);

      expect(annotations["shell"]).toEqual({ toolName: "shell", level: "confirm" });
      expect(annotations["web_search"]).toEqual({ toolName: "web_search", level: "safe" });
    });
  });
});
