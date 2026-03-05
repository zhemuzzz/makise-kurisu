/**
 * Skill System 2.0 Integration Tests
 *
 * KURISU-039: 验证 SkillRegistry → IntentClassifier → SkillManager 链路
 *
 * 使用真实的 SkillRegistry + IntentClassifier + SkillManager
 * 通过文件系统加载 Skill 配置，无 MCP 连接
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createSkillRegistry } from "../../../src/platform/skills/registry";
import { createSkillIntentClassifier } from "../../../src/platform/skills/intent-classifier";
import { createSkillManager } from "../../../src/platform/skills/skill-manager";
import type { SkillRegistry } from "../../../src/platform/skills/registry";
import type { ISkillIntentClassifier } from "../../../src/platform/skills/intent-classifier";
import type { ISkillManager } from "../../../src/platform/skills/skill-manager";

// ============================================================================
// Helpers
// ============================================================================

function createSkillDir(
  baseDir: string,
  skillId: string,
  yaml: string,
): string {
  const skillDir = join(baseDir, skillId);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "skill.yaml"), yaml);
  return skillDir;
}

// ============================================================================
// Tests
// ============================================================================

describe("Skill System 2.0 Integration", () => {
  let tempDir: string;
  let skillsDir: string;
  let registry: SkillRegistry;
  let classifier: ISkillIntentClassifier;
  let manager: ISkillManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "kurisu-skill-integ-"));
    skillsDir = join(tempDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * 构建完整的 Skill System 链路
   */
  function buildSkillSystem(): {
    registry: SkillRegistry;
    classifier: ISkillIntentClassifier;
    manager: ISkillManager;
  } {
    registry = createSkillRegistry({ skillsDir });
    classifier = createSkillIntentClassifier({
      skillRegistry: registry,
      // 不配置 modelProvider → 仅 L1 命令匹配
    });
    manager = createSkillManager({
      skillRegistry: registry,
      intentClassifier: classifier,
      maxActivePerSession: 5,
    });
    return { registry, classifier, manager };
  }

  // =============================================
  // Chain Wiring
  // =============================================

  describe("链路连接", () => {
    it("INT-01: SkillRegistry → IntentClassifier → SkillManager 链路正确创建", () => {
      const system = buildSkillSystem();

      expect(system.registry).toBeDefined();
      expect(system.classifier).toBeDefined();
      expect(system.manager).toBeDefined();

      // 基本方法存在
      expect(typeof system.manager.findSkill).toBe("function");
      expect(typeof system.manager.activate).toBe("function");
      expect(typeof system.manager.getActiveSkills).toBe("function");
      expect(typeof system.classifier.classify).toBe("function");
      expect(typeof system.classifier.classifyAsync).toBe("function");
    });

    it("INT-02: 无 Skills 时 findSkill 返回空数组", async () => {
      const system = buildSkillSystem();

      const results = await system.manager.findSkill("anything");
      expect(results).toEqual([]);
    });
  });

  // =============================================
  // Load → Search → Activate Flow
  // =============================================

  describe("加载 → 搜索 → 激活 完整流程", () => {
    it("INT-03: 加载并激活 Skill 后通过命令匹配找到", async () => {
      const system = buildSkillSystem();

      // 创建并加载 Skill
      createSkillDir(
        skillsDir,
        "file-tools",
        `
id: file-tools
name: 文件工具
version: "1.0"
type: tool
trigger:
  commands:
    - /files
    - /ls
`,
      );

      await system.registry.load(join(skillsDir, "file-tools"));
      // IntentClassifier 只匹配 active 状态的 Skill
      await system.registry.activate(["file-tools"]);

      // L1 命令匹配 (通过 IntentClassifier)
      const classifyResult = system.classifier.classify("/files list");
      expect(classifyResult.matches.length).toBeGreaterThanOrEqual(1);
      expect(classifyResult.matches[0]!.skillId).toBe("file-tools");
      expect(classifyResult.matches[0]!.reason).toBe("command");
    });

    it("INT-04: 加载 Skill 后通过 SkillManager.findSkill 搜索", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "git-tools",
        `
id: git-tools
name: Git 工具
version: "1.0"
type: tool
trigger:
  commands:
    - /git
metadata:
  description: "Git 版本控制操作"
`,
      );

      await system.registry.load(join(skillsDir, "git-tools"));

      // findSkill 使用文本搜索 (名称包含 query)
      const results = await system.manager.findSkill("git");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.id).toBe("git-tools");
      expect(results[0]!.name).toBe("Git 工具");
    });

    it("INT-05: 完整流程 — 加载 → 激活 → 搜索 → 查询激活列表", async () => {
      const system = buildSkillSystem();

      // 1. 加载 2 个 Skills
      createSkillDir(
        skillsDir,
        "web-search",
        `
id: web-search
name: 网页搜索
version: "1.0"
type: tool
trigger:
  commands:
    - /search
    - /web
`,
      );

      createSkillDir(
        skillsDir,
        "code-runner",
        `
id: code-runner
name: 代码运行器
version: "1.0"
type: tool
trigger:
  commands:
    - /run
    - /code
`,
      );

      await system.registry.load(join(skillsDir, "web-search"));
      await system.registry.load(join(skillsDir, "code-runner"));
      await system.registry.activate(["web-search", "code-runner"]);

      expect(system.registry.list().length).toBe(2);

      // 2. 搜索 (文本匹配名称 "搜索")
      const searchResults = await system.manager.findSkill("搜索");
      expect(searchResults.length).toBeGreaterThanOrEqual(1);
      expect(searchResults[0]!.id).toBe("web-search");

      // 3. 激活到 session
      const sessionId = "test-session-1";
      const activation = await system.manager.activate(
        "web-search",
        sessionId,
        "full",
      );
      expect(activation.id).toBe("web-search");
      expect(activation.name).toBe("网页搜索");
      expect(activation.injectionLevel).toBe("full");

      // 4. 查询激活列表
      const activeSkills = await system.manager.getActiveSkills(sessionId);
      expect(activeSkills.length).toBe(1);
      expect(activeSkills[0]!.id).toBe("web-search");
    });
  });

  // =============================================
  // Multi-Skill Scenarios
  // =============================================

  describe("多 Skill 场景", () => {
    it("INT-06: 多 Skill 加载 + 命令匹配区分", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "skill-a",
        `
id: skill-a
name: Skill A
version: "1.0"
type: knowledge
trigger:
  commands:
    - /alpha
`,
      );

      createSkillDir(
        skillsDir,
        "skill-b",
        `
id: skill-b
name: Skill B
version: "1.0"
type: tool
trigger:
  commands:
    - /beta
`,
      );

      await system.registry.loadFromDirectory(skillsDir);
      await system.registry.activate(["skill-a", "skill-b"]);
      expect(system.registry.list().length).toBe(2);

      // 命令匹配 skill-a
      const resultA = system.classifier.classify("/alpha test");
      expect(resultA.matches.some((m) => m.skillId === "skill-a")).toBe(true);

      // 命令匹配 skill-b
      const resultB = system.classifier.classify("/beta test");
      expect(resultB.matches.some((m) => m.skillId === "skill-b")).toBe(true);

      // 不匹配的命令
      const resultC = system.classifier.classify("/gamma test");
      expect(resultC.matches.length).toBe(0);
    });

    it("INT-07: 多 Skill 激活 + 容量限制", async () => {
      // 容量限制为 2
      registry = createSkillRegistry({ skillsDir });
      classifier = createSkillIntentClassifier({ skillRegistry: registry });
      manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 2,
      });

      for (const id of ["s1", "s2", "s3"]) {
        createSkillDir(
          skillsDir,
          id,
          `
id: ${id}
name: ${id}
version: "1.0"
type: tool
trigger:
  commands:
    - /${id}
`,
        );
        await registry.load(join(skillsDir, id));
      }

      const sessionId = "cap-test";

      // 激活前 2 个成功
      await manager.activate("s1", sessionId, "full");
      await manager.activate("s2", sessionId, "full");

      // 第 3 个超过容量
      await expect(
        manager.activate("s3", sessionId, "full"),
      ).rejects.toThrow(/Max active skills reached/);

      const active = await manager.getActiveSkills(sessionId);
      expect(active.length).toBe(2);
    });

    it("INT-08: archive 后可以激活新 Skill", async () => {
      registry = createSkillRegistry({ skillsDir });
      classifier = createSkillIntentClassifier({ skillRegistry: registry });
      manager = createSkillManager({
        skillRegistry: registry,
        intentClassifier: classifier,
        maxActivePerSession: 1,
      });

      for (const id of ["x1", "x2"]) {
        createSkillDir(
          skillsDir,
          id,
          `
id: ${id}
name: ${id}
version: "1.0"
type: tool
trigger:
  commands: []
`,
        );
        await registry.load(join(skillsDir, id));
      }

      const sessionId = "archive-test";

      await manager.activate("x1", sessionId, "tools-only");
      await expect(
        manager.activate("x2", sessionId, "tools-only"),
      ).rejects.toThrow(/Max active skills/);

      // Archive x1 释放容量
      await manager.archive("x1", "not needed");

      // 现在可以激活 x2
      const activation = await manager.activate("x2", sessionId, "tools-only");
      expect(activation.id).toBe("x2");
    });
  });

  // =============================================
  // Registry matchIntent (2-level)
  // =============================================

  describe("Registry matchIntent 2 级分类", () => {
    it("INT-09: L1 命令匹配 — 精确前缀匹配", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "cmd-skill",
        `
id: cmd-skill
name: 命令 Skill
version: "1.0"
type: tool
trigger:
  commands:
    - /cmd
    - /command
`,
      );

      await system.registry.load(join(skillsDir, "cmd-skill"));

      const results = system.registry.matchIntent("/cmd do something");
      expect(results.length).toBe(1);
      expect(results[0]!.skillId).toBe("cmd-skill");
      expect(results[0]!.confidence).toBe(0.95);
      expect(results[0]!.reason).toBe("command");
    });

    it("INT-10: L1 命令匹配 — 大小写不敏感", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "case-skill",
        `
id: case-skill
name: Case Skill
version: "1.0"
type: tool
trigger:
  commands:
    - /Test
`,
      );

      await system.registry.load(join(skillsDir, "case-skill"));

      const results = system.registry.matchIntent("/TEST something");
      expect(results.length).toBe(1);
      expect(results[0]!.skillId).toBe("case-skill");
    });

    it("INT-11: L1 无匹配 + 无 LLM — 返回空", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "only-cmd",
        `
id: only-cmd
name: Only CMD
version: "1.0"
type: tool
trigger:
  commands:
    - /specific
`,
      );

      await system.registry.load(join(skillsDir, "only-cmd"));

      // 不匹配的输入
      const results = system.registry.matchIntent("random text");
      expect(results.length).toBe(0);
    });
  });

  // =============================================
  // Gate Checking
  // =============================================

  describe("环境依赖 Gate", () => {
    it("INT-12: OS gate — 当前平台通过", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "os-skill",
        `
id: os-skill
name: OS Skill
version: "1.0"
type: tool
trigger:
  commands: []
requires:
  os:
    - ${process.platform}
`,
      );

      await system.registry.load(join(skillsDir, "os-skill"));
      await system.registry.activate(["os-skill"]);

      const skill = system.registry.get("os-skill");
      expect(skill!.status).toBe("active");
    });

    it("INT-13: OS gate — 不支持的平台拒绝", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "bad-os",
        `
id: bad-os
name: Bad OS
version: "1.0"
type: tool
trigger:
  commands: []
requires:
  os:
    - fake-os-that-doesnt-exist
`,
      );

      await system.registry.load(join(skillsDir, "bad-os"));
      await system.registry.activate(["bad-os"]);

      const skill = system.registry.get("bad-os");
      expect(skill!.status).toBe("error");
      expect(skill!.error).toContain("OS not supported");
    });

    it("INT-14: Bins gate — 缺少可执行文件拒绝", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "missing-bin",
        `
id: missing-bin
name: Missing Bin
version: "1.0"
type: tool
trigger:
  commands: []
requires:
  bins:
    - nonexistent-binary-xyz-12345
`,
      );

      await system.registry.load(join(skillsDir, "missing-bin"));
      await system.registry.activate(["missing-bin"]);

      const skill = system.registry.get("missing-bin");
      expect(skill!.status).toBe("error");
      expect(skill!.error).toContain("Required binary not found");
    });
  });

  // =============================================
  // Session Lifecycle
  // =============================================

  describe("Session 生命周期", () => {
    it("INT-15: endSession 清除激活状态", async () => {
      const system = buildSkillSystem();

      createSkillDir(
        skillsDir,
        "sess-skill",
        `
id: sess-skill
name: Session Skill
version: "1.0"
type: tool
trigger:
  commands: []
`,
      );

      await system.registry.load(join(skillsDir, "sess-skill"));

      const sessionId = "sess-lifecycle";
      await system.manager.activate("sess-skill", sessionId, "full");

      let active = await system.manager.getActiveSkills(sessionId);
      expect(active.length).toBe(1);

      // 结束 session
      system.manager.endSession(sessionId);

      active = await system.manager.getActiveSkills(sessionId);
      expect(active.length).toBe(0);
    });
  });
});
