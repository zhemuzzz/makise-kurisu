/**
 * PermissionValidator Tests
 *
 * KURISU-019 Phase 3.3: 测试权限验证器
 */

import { describe, it, expect, beforeEach } from "vitest";
import path from "path";
import os from "os";
import {
  PermissionValidator,
  createPermissionValidator,
  type OperationType,
} from "../../../src/platform/tools/permission-validator";
import type { RoleToolConfig } from "../../../src/platform/models/executor-types";

describe("PermissionValidator", () => {
  let validator: PermissionValidator;
  let sandboxDir: string;

  beforeEach(() => {
    // 使用动态沙箱目录，适配不同平台
    sandboxDir = path.join(os.tmpdir(), "kurisu-workspace");
    validator = createPermissionValidator({ sandboxDir });
  });

  const sandboxConfig: RoleToolConfig = {
    filePermission: "sandbox",
    networkAccess: false,
  };

  const restrictedConfig: RoleToolConfig = {
    filePermission: "restricted",
    networkAccess: false,
    allowedPaths: ["~/Documents", "~/Projects"],
  };

  const fullAccessConfig: RoleToolConfig = {
    filePermission: "full_access",
    networkAccess: true,
  };

  describe("validate", () => {
    describe("sandbox 权限模式", () => {
      it("应该允许沙箱内的读取操作", () => {
        const result = validator.validate(
          "file_read",
          sandboxConfig,
          path.join(sandboxDir, "test.txt"),
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
        expect(result.riskLevel).toBe("low");
      });

      it("应该拒绝沙箱外的路径访问", () => {
        const result = validator.validate(
          "file_read",
          sandboxConfig,
          "/etc/passwd",
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("outside sandbox directory");
      });

      it("应该拒绝网络操作", () => {
        const result = validator.validate("network", sandboxConfig);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Network access is disabled");
      });

      it("应该对写操作要求审批", () => {
        const result = validator.validate(
          "file_write",
          sandboxConfig,
          path.join(sandboxDir, "test.txt"),
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
      });
    });

    describe("restricted 权限模式", () => {
      it("应该允许允许路径内的读取操作", () => {
        const result = validator.validate(
          "file_read",
          restrictedConfig,
          "~/Documents/test.txt",
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
      });

      it("应该拒绝非允许路径的访问", () => {
        const result = validator.validate(
          "file_read",
          restrictedConfig,
          "/etc/passwd",
        );

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("not in allowed paths");
      });

      it("应该对写操作要求审批", () => {
        const result = validator.validate(
          "file_write",
          restrictedConfig,
          "~/Documents/test.txt",
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("medium");
      });

      it("应该拒绝网络操作", () => {
        const result = validator.validate("network", restrictedConfig);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("Network access is disabled");
      });
    });

    describe("full_access 权限模式", () => {
      it("应该允许所有路径访问", () => {
        const result = validator.validate(
          "file_read",
          fullAccessConfig,
          "/etc/passwd",
        );

        expect(result.allowed).toBe(true);
      });

      it("应该对读取操作要求审批", () => {
        const result = validator.validate(
          "file_read",
          fullAccessConfig,
          "/etc/passwd",
        );

        expect(result.requiresApproval).toBe(true);
      });

      it("应该允许网络操作", () => {
        const configWithNetwork: RoleToolConfig = {
          ...fullAccessConfig,
          networkAccess: true,
        };
        const result = validator.validate("network", configWithNetwork);

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
      });

      it("应该对 shell 操作标记为高风险", () => {
        const result = validator.validate("shell", fullAccessConfig);

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
      });
    });

    describe("未知权限级别", () => {
      it("应该拒绝未知权限级别", () => {
        const invalidConfig = {
          filePermission: "invalid" as never,
          networkAccess: false,
        };

        const result = validator.validate("file_read", invalidConfig);

        expect(result.allowed).toBe(false);
        expect(result.riskLevel).toBe("critical");
      });
    });

    // KURISU-023: 删除操作永远需要确认
    describe("file_delete 操作 (KURISU-023)", () => {
      it("sandbox 模式下删除操作应该需要确认", () => {
        const result = validator.validate(
          "file_delete",
          sandboxConfig,
          path.join(sandboxDir, "test.txt"),
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
      });

      it("restricted 模式下删除操作应该需要确认", () => {
        const result = validator.validate(
          "file_delete",
          restrictedConfig,
          "~/Documents/test.txt",
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
      });

      it("full_access 模式下删除操作也应该需要确认", () => {
        const result = validator.validate(
          "file_delete",
          fullAccessConfig,
          "/tmp/test.txt",
        );

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(true);
        expect(result.riskLevel).toBe("high");
      });
    });
  });

  // KURISU-023: 敏感路径黑名单
  describe("敏感路径黑名单 (KURISU-023)", () => {
    it("应该拒绝黑名单中的路径", () => {
      const validatorWithDeny = createPermissionValidator({
        denyPaths: ["~/Documents/重要文件"],
      });

      const result = validatorWithDeny.validate(
        "file_read",
        fullAccessConfig,
        "~/Documents/重要文件/secret.txt",
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("保护列表");
    });

    it("应该允许不在黑名单中的路径", () => {
      const validatorWithDeny = createPermissionValidator({
        denyPaths: ["~/Documents/重要文件"],
      });

      const result = validatorWithDeny.validate(
        "file_read",
        fullAccessConfig,
        "~/Documents/normal.txt",
      );

      expect(result.allowed).toBe(true);
    });

    it("addDenyPath 应该添加路径到黑名单", () => {
      const validatorWithDeny = createPermissionValidator();
      validatorWithDeny.addDenyPath("~/Desktop");

      const paths = validatorWithDeny.getDenyPaths();
      expect(paths).toContain("~/Desktop");
    });

    it("removeDenyPath 应该从黑名单移除路径", () => {
      const validatorWithDeny = createPermissionValidator({
        denyPaths: ["~/Desktop", "~/Documents"],
      });

      const removed = validatorWithDeny.removeDenyPath("~/Desktop");
      expect(removed).toBe(true);

      const paths = validatorWithDeny.getDenyPaths();
      expect(paths).not.toContain("~/Desktop");
      expect(paths).toContain("~/Documents");
    });

    it("移除不存在的路径应该返回 false", () => {
      const validatorWithDeny = createPermissionValidator();
      const removed = validatorWithDeny.removeDenyPath("~/nonexistent");
      expect(removed).toBe(false);
    });
  });

  describe("validateShellCommand", () => {
    it("应该检测危险命令 rm -rf", () => {
      const result = validator.validateShellCommand("rm -rf /");

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("critical");
      expect(result.reason).toContain("Recursive force delete");
    });

    it("应该检测 dd 命令", () => {
      const result = validator.validateShellCommand(
        "dd if=/dev/zero of=/dev/sda",
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("critical");
    });

    it("应该检测 sudo 命令", () => {
      const result = validator.validateShellCommand("sudo apt update");

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("high");
    });

    it("应该检测普通 rm 命令", () => {
      const result = validator.validateShellCommand("rm test.txt");

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.riskLevel).toBe("medium");
    });

    it("应该允许安全命令", () => {
      const result = validator.validateShellCommand("ls -la");

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.riskLevel).toBe("low");
    });
  });

  describe("getToolPermissionLevel", () => {
    it("应该返回 safe 级别给安全工具", () => {
      expect(validator.getToolPermissionLevel("web_search")).toBe("safe");
      expect(validator.getToolPermissionLevel("file_read")).toBe("safe");
      expect(validator.getToolPermissionLevel("screenshot")).toBe("safe");
    });

    it("应该返回 confirm 级别给需要确认的工具", () => {
      expect(validator.getToolPermissionLevel("shell")).toBe("confirm");
      expect(validator.getToolPermissionLevel("file_write")).toBe("confirm");
      expect(validator.getToolPermissionLevel("file_delete")).toBe("confirm");
    });

    it("应该返回 confirm 级别给未知工具", () => {
      expect(validator.getToolPermissionLevel("unknown_tool")).toBe("confirm");
    });
  });

  describe("mapToolToOperation", () => {
    it("应该正确映射工具到操作类型", () => {
      expect(validator.mapToolToOperation("file_read")).toBe("file_read");
      expect(validator.mapToolToOperation("file_write")).toBe("file_write");
      expect(validator.mapToolToOperation("shell")).toBe("shell");
      expect(validator.mapToolToOperation("web_search")).toBe("network");
    });

    it("应该将未知工具映射到 shell 操作", () => {
      expect(validator.mapToolToOperation("unknown")).toBe("shell");
    });
  });
});
