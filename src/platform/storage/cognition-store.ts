/**
 * CognitionStore — 认知内容持久化
 *
 * 快照式覆写 cognition.md 到 RoleDataStore.stateDir
 * 加载优先级: stateDir/cognition.md > 初始配置内容
 *
 * @module platform/storage/cognition-store
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";

// ============================================================================
// Types
// ============================================================================

export interface CognitionStore {
  /** 读取认知内容（优先 stateDir，回退 initialContent） */
  read(): Promise<string>;

  /** 快照覆写认知内容到 stateDir */
  write(content: string): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

export function createCognitionStore(options: {
  readonly stateDir: string;
  readonly initialContent: string;
}): CognitionStore {
  const filePath = join(options.stateDir, "cognition.md");

  return {
    async read(): Promise<string> {
      try {
        return await readFile(filePath, "utf-8");
      } catch {
        // 文件不存在，返回初始内容
        return options.initialContent;
      }
    },

    async write(content: string): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");
    },
  };
}
