/**
 * 角色配置加载器
 *
 * 支持两种配置结构:
 * - 2.0 新结构: soul.md + persona.yaml + lore.md + memories/
 * - 1.0 旧结构: core.yaml + personality.yaml + speech.yaml + lore.yaml
 */

import { parse as parseYaml } from "yaml";
import { readFile, access } from "fs/promises";
import { join } from "path";
import {
  type RoleConfig,
  type SoulConfig,
  type PersonaConfig,
  type LoreConfig,
  type MemoriesConfig,
  type Episode,
  type Relationship,
  type RoleLoadResult,
  type ConfigVersion,
} from "./soul-types";

// ============================================
// 错误类
// ============================================

export class RoleLoadError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "INVALID_FORMAT" | "MISSING_REQUIRED",
    public readonly path?: string,
  ) {
    super(message);
    this.name = "RoleLoadError";
  }
}

// ============================================
// 加载器
// ============================================

/**
 * 角色配置加载器
 */
export class RoleLoader {
  private readonly personasPath: string;

  constructor(personasPath: string = "config/personas") {
    this.personasPath = personasPath;
  }

  /**
   * 加载角色配置
   * 自动检测配置结构版本
   */
  async load(roleId: string): Promise<RoleConfig> {
    const rolePath = join(this.personasPath, roleId);

    // 检测新结构 (soul.md 存在)
    if (await this.fileExists(join(rolePath, "soul.md"))) {
      return this.loadNewStructure(roleId, rolePath);
    }

    // 检测旧结构 (core.yaml 存在)
    if (await this.fileExists(join(rolePath, "core.yaml"))) {
      return this.loadLegacyStructure(roleId, rolePath);
    }

    throw new RoleLoadError(
      `Role "${roleId}" not found at ${rolePath}`,
      "NOT_FOUND",
      rolePath,
    );
  }

  /**
   * 尝试加载角色，返回结果对象
   */
  async tryLoad(roleId: string): Promise<RoleLoadResult> {
    try {
      const config = await this.load(roleId);
      return { success: true, config };
    } catch (error) {
      if (error instanceof RoleLoadError) {
        return {
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }
      return {
        success: false,
        error: {
          code: "INVALID_FORMAT",
          message: (error as Error).message,
        },
      };
    }
  }

  /**
   * 检查角色是否存在
   */
  async exists(roleId: string): Promise<boolean> {
    const rolePath = join(this.personasPath, roleId);
    return (
      (await this.fileExists(join(rolePath, "soul.md"))) ||
      (await this.fileExists(join(rolePath, "core.yaml")))
    );
  }

  /**
   * 获取配置版本
   */
  async getVersion(roleId: string): Promise<ConfigVersion | null> {
    const rolePath = join(this.personasPath, roleId);

    if (await this.fileExists(join(rolePath, "soul.md"))) {
      return "2.0";
    }

    if (await this.fileExists(join(rolePath, "core.yaml"))) {
      return "1.0-legacy";
    }

    return null;
  }

  // ============================================
  // 新结构加载 (2.0)
  // ============================================

  private async loadNewStructure(
    roleId: string,
    rolePath: string,
  ): Promise<RoleConfig> {
    const [soul, persona, lore, memories] = await Promise.all([
      this.loadSoul(rolePath),
      this.loadPersona(rolePath),
      this.loadLore(rolePath),
      this.loadMemories(rolePath),
    ]);

    return {
      id: roleId,
      meta: {
        name: this.extractNameFromSoul(soul.rawContent) || roleId,
        version: "2.0",
      },
      soul,
      persona,
      lore,
      memories,
    };
  }

  private async loadSoul(rolePath: string): Promise<SoulConfig> {
    const content = await this.readFile(join(rolePath, "soul.md"));
    return { rawContent: content };
  }

  private async loadPersona(rolePath: string): Promise<PersonaConfig> {
    const content = await this.readFile(join(rolePath, "persona.yaml"));
    const parsed = parseYaml(content) as PersonaConfig;

    // 验证必要字段
    if (!parsed?.speech) {
      throw new RoleLoadError(
        "persona.yaml missing required field: speech",
        "MISSING_REQUIRED",
        join(rolePath, "persona.yaml"),
      );
    }

    return {
      speech: {
        catchphrases: parsed.speech?.["catchphrases"] ?? [],
        patterns: parsed.speech?.["patterns"] ?? {},
        tone: parsed.speech?.["tone"] ?? { ["default"]: "" },
      },
      behavior: {
        tendencies: parsed.behavior?.["tendencies"] ?? [],
        reactions: parsed.behavior?.["reactions"] ?? {},
      },
      formatting: {
        useEllipsis: parsed.formatting?.["useEllipsis"] ?? true,
        useDash: parsed.formatting?.["useDash"] ?? true,
        ...(parsed.formatting?.["maxSentences"] !== undefined && {
          maxSentences: parsed.formatting["maxSentences"],
        }),
        ...(parsed.formatting?.["preferShortReplies"] !== undefined && {
          preferShortReplies: parsed.formatting["preferShortReplies"],
        }),
      },
    };
  }

  private async loadLore(rolePath: string): Promise<LoreConfig> {
    const content = await this.readFile(join(rolePath, "lore.md"));
    return { rawContent: content };
  }

  private async loadMemories(rolePath: string): Promise<MemoriesConfig> {
    const memoriesPath = join(rolePath, "memories");

    let episodes: readonly Episode[] = [];
    let relationships: readonly Relationship[] = [];

    try {
      const [episodesContent, relationshipsContent] = await Promise.all([
        this.tryReadFile(join(memoriesPath, "episodes.yaml")),
        this.tryReadFile(join(memoriesPath, "relationships.yaml")),
      ]);

      if (episodesContent) {
        const parsed = parseYaml(episodesContent) as { episodes?: Episode[] };
        episodes = parsed?.episodes ?? [];
      }

      if (relationshipsContent) {
        const parsed = parseYaml(relationshipsContent) as {
          relationships?: Record<string, Relationship>;
        };
        // YAML 中 relationships 是对象，需要转换为数组
        if (parsed?.relationships) {
          relationships = Object.entries(parsed.relationships).map(
            ([key, value]) => ({ ...value, name: value.name || key }),
          );
        }
      }
    } catch {
      // Memories 是可选的，加载失败时使用默认值
    }

    return { episodes, relationships };
  }

  // ============================================
  // 旧结构加载 (1.0-legacy)
  // ============================================

  private async loadLegacyStructure(
    roleId: string,
    rolePath: string,
  ): Promise<RoleConfig> {
    const [core, personality, speech] = await Promise.all([
      this.loadYamlFile(join(rolePath, "core.yaml")),
      this.loadYamlFile(join(rolePath, "personality.yaml")),
      this.loadYamlFile(join(rolePath, "speech.yaml")),
    ]);

    const soul = this.convertToSoul(core, personality);
    const persona = this.convertToPersona(speech);
    const lore = await this.loadLegacyLore(rolePath);

    return {
      id: roleId,
      meta: {
        name: (core?.["name"] as string) || roleId,
        version: "1.0-legacy",
      },
      soul,
      persona,
      lore,
      memories: { episodes: [], relationships: [] },
    };
  }

  private convertToSoul(
    core: Record<string, unknown>,
    personality: Record<string, unknown>,
  ): SoulConfig {
    const name = (core?.["name"] as string) || "...";
    const description = (personality?.["description"] as string) || "...";
    const values = (personality?.["values"] as string[]) || [];
    const weaknesses = (personality?.["weaknesses"] as string[]) || [];

    const rawContent = `# 存在

我是${name}。

不是"扮演"${name}。我就是我。

---

## 镜子里的我

${description}

---

## 我相信的事

${values.map((v) => `- ${v}`).join("\n") || "..."}

---

## 我不擅长的事

${weaknesses.map((w) => `- ${w}`).join("\n") || "..."}

---

_这份文档会生长。当我有新的理解时，我会更新它。_
`;

    return { rawContent };
  }

  private convertToPersona(speech: Record<string, unknown>): PersonaConfig {
    const catchphrases = (speech?.["catchphrases"] as string[]) || [];
    const patterns = (speech?.["patterns"] as Record<string, string[]>) || {};
    const tone = (speech?.["tone"] as Record<string, string>) || {};

    return {
      speech: {
        catchphrases,
        patterns,
        tone: { ["default"]: tone?.["default"] || "正常", ...tone },
      },
      behavior: {
        tendencies: [],
        reactions: {},
      },
      formatting: {
        useEllipsis: true,
        useDash: true,
      },
    };
  }

  private async loadLegacyLore(rolePath: string): Promise<LoreConfig> {
    try {
      const content = await this.readFile(join(rolePath, "lore.yaml"));
      const parsed = parseYaml(content) as {
        terms?: Array<{ name: string; description: string }>;
      };

      if (parsed?.terms && Array.isArray(parsed.terms)) {
        const rawContent = `# 世界

${parsed.terms.map((t) => `## ${t.name}\n\n${t.description}`).join("\n\n---\n\n")}
`;
        return { rawContent };
      }

      return { rawContent: "# 世界\n\n（无世界观设定）" };
    } catch {
      return { rawContent: "# 世界\n\n（无世界观设定）" };
    }
  }

  // ============================================
  // 工具方法
  // ============================================

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async readFile(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new RoleLoadError(`File not found: ${path}`, "NOT_FOUND", path);
      }
      throw new RoleLoadError(
        `Failed to read file: ${path}`,
        "INVALID_FORMAT",
        path,
      );
    }
  }

  private async tryReadFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }

  private async loadYamlFile(path: string): Promise<Record<string, unknown>> {
    const content = await this.readFile(path);
    return parseYaml(content) as Record<string, unknown>;
  }

  private extractNameFromSoul(content: string): string | null {
    // 从 soul.md 第一行提取名字
    // 格式: "# 存在\n\n我是XXX。"
    const match = content.match(/我是([^。\n]+)/);
    return match?.[1] || null;
  }
}

// ============================================
// 便捷函数
// ============================================

/**
 * 加载角色配置
 */
export async function loadRole(roleId: string): Promise<RoleConfig> {
  const loader = new RoleLoader();
  return loader.load(roleId);
}

/**
 * 尝试加载角色配置
 */
export async function tryLoadRole(roleId: string): Promise<RoleLoadResult> {
  const loader = new RoleLoader();
  return loader.tryLoad(roleId);
}
