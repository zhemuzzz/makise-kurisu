/**
 * coding Skill 测试（v1.0 — 编程助手）
 *
 * 验证 skill.yaml 配置、ToolMultiServerRef 解析、触发命令等
 */

import { describe, it, expect } from "vitest";
import { join } from "path";
import { readFileSync } from "fs";
import { parse } from "yaml";
import { createSkillLoader } from "../../../src/platform/skills/loader.js";
import {
  isToolMultiServerRef,
  isToolServerRef,
  isToolBindingLegacy,
} from "../../../src/platform/skills/types.js";
import type { ToolMultiServerRef } from "../../../src/platform/skills/types.js";

const SKILL_PATH = join(__dirname, "../../../config/skills/coding");
const FILE_TOOLS_PATH = join(__dirname, "../../../config/skills/file-tools");

describe("coding Skill", () => {
  const loader = createSkillLoader();

  describe("skill.yaml 解析", () => {
    it("应该能加载 skill 配置", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect(instance.config.id).toBe("coding");
      expect(instance.config.name).toBe("编程助手");
      expect(instance.config.version).toBe("1.0");
      expect(instance.config.type).toBe("hybrid");
    });

    it("应该有 L1 命令触发", async () => {
      const instance = await loader.load(SKILL_PATH);
      const commands = instance.config.trigger.commands ?? [];

      expect(commands).toContain("/code");
      expect(commands).toContain("/coding");
      expect(commands).toContain("/run");
      expect(commands).toContain("/shell");
    });

    it("不应有 keywords/patterns/intent 死字段", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect(instance.config.trigger.keywords).toBeUndefined();
      expect(instance.config.trigger.patterns).toBeUndefined();
      expect(instance.config.trigger.intent).toBeUndefined();
    });

    it("应该有 context 包含工具概览", async () => {
      const instance = await loader.load(SKILL_PATH);
      const context = instance.config.context ?? "";

      expect(context).toContain("execute_command");
      expect(context).toContain("read_file");
      expect(context).toContain("list_directory");
      expect(context).toContain("get_platform_info");
    });

    it("应该有 description 字段", async () => {
      const raw = readFileSync(join(SKILL_PATH, "skill.yaml"), "utf-8");
      const parsed = parse(raw) as Record<string, unknown>;

      expect(parsed.description).toBeDefined();
      expect(typeof parsed.description).toBe("string");
      expect((parsed.description as string).length).toBeGreaterThan(0);
    });

    it("应该有 Few-Shot 示例", async () => {
      const instance = await loader.load(SKILL_PATH);
      const examples = instance.config.examples ?? [];

      expect(examples.length).toBeGreaterThanOrEqual(2);

      // 验证 execute_command 示例
      const execExample = examples.find((e) =>
        e.toolCalls?.some((t) => t.name === "execute_command"),
      );
      expect(execExample).toBeDefined();

      // 验证 list_directory 示例
      const listExample = examples.find((e) =>
        e.toolCalls?.some((t) => t.name === "list_directory"),
      );
      expect(listExample).toBeDefined();
    });

    it("应该声明 npx 依赖", async () => {
      const instance = await loader.load(SKILL_PATH);

      expect(instance.config.requires).toBeDefined();
      expect(instance.config.requires?.bins).toContain("npx");
    });
  });

  describe("ToolMultiServerRef 解析", () => {
    it("应该使用 ToolMultiServerRef（多 server 引用）", async () => {
      const instance = await loader.load(SKILL_PATH);
      const tools = instance.config.tools;

      expect(tools).toBeDefined();
      expect(isToolMultiServerRef(tools!)).toBe(true);
      expect(isToolServerRef(tools!)).toBe(false);
      expect(isToolBindingLegacy(tools!)).toBe(false);
    });

    it("应该引用 filesystem 和 shell 两个 server", async () => {
      const instance = await loader.load(SKILL_PATH);
      const tools = instance.config.tools as ToolMultiServerRef;
      const serverNames = tools.servers.map((s) => s.server);

      expect(serverNames).toContain("filesystem");
      expect(serverNames).toContain("shell");
      expect(tools.servers.length).toBe(2);
    });

    it("shell server 应该有 include 过滤", async () => {
      const instance = await loader.load(SKILL_PATH);
      const tools = instance.config.tools as ToolMultiServerRef;
      const shellRef = tools.servers.find((s) => s.server === "shell");

      expect(shellRef).toBeDefined();
      expect(shellRef!.include).toContain("execute_command");
      expect(shellRef!.include).toContain("get_platform_info");
    });

    it("filesystem server 不应有 include（使用全部工具）", async () => {
      const instance = await loader.load(SKILL_PATH);
      const tools = instance.config.tools as ToolMultiServerRef;
      const fsRef = tools.servers.find((s) => s.server === "filesystem");

      expect(fsRef).toBeDefined();
      expect(fsRef!.include).toBeUndefined();
    });
  });

  describe("与 file-tools 的区别", () => {
    it("coding 比 file-tools 多了 shell server", async () => {
      const codingInstance = await loader.load(SKILL_PATH);
      const fileToolsInstance = await loader.load(FILE_TOOLS_PATH);

      // coding 使用 ToolMultiServerRef（多 server）
      expect(isToolMultiServerRef(codingInstance.config.tools!)).toBe(true);

      // file-tools 使用 ToolServerRef（单 server）
      expect(isToolServerRef(fileToolsInstance.config.tools!)).toBe(true);
    });

    it("coding 和 file-tools 的触发命令不重叠", async () => {
      const codingInstance = await loader.load(SKILL_PATH);
      const fileToolsInstance = await loader.load(FILE_TOOLS_PATH);

      const codingCmds = new Set(codingInstance.config.trigger.commands ?? []);
      const fileToolsCmds = fileToolsInstance.config.trigger.commands ?? [];

      for (const cmd of fileToolsCmds) {
        expect(codingCmds.has(cmd)).toBe(false);
      }
    });
  });
});
