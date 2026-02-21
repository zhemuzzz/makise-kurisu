/**
 * 角色配置加载器
 *
 * 配置结构: soul.md + persona.yaml + lore.md + memories/
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
   */
  async load(roleId: string): Promise<RoleConfig> {
    const rolePath = join(this.personasPath, roleId);
    const soulPath = join(rolePath, "soul.md");

    if (!(await this.fileExists(soulPath))) {
      throw new RoleLoadError(
        `Role "${roleId}" not found at ${rolePath}`,
        "NOT_FOUND",
        rolePath,
      );
    }

    return this.loadConfig(roleId, rolePath);
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
    return this.fileExists(join(rolePath, "soul.md"));
  }

  // ============================================
  // 配置加载
  // ============================================

  private async loadConfig(
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
