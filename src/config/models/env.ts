/**
 * 环境变量注入器
 * 位置: src/config/models/env.ts
 */

import { EnvVarMissingError } from "./types";

/**
 * 环境变量解析器
 * 支持 ${VAR} 和 ${VAR:-default} 语法
 */
export class EnvResolver {
  private static readonly ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

  /**
   * 解析单个字符串中的环境变量
   */
  static resolve(value: string, env: NodeJS.ProcessEnv = process.env): string {
    return value.replace(this.ENV_VAR_PATTERN, (_, varExpr: string) => {
      const parts = varExpr.split(":-");
      const varName = parts[0] ?? "";
      const defaultValue = parts[1];

      if (!varName) {
        return "";
      }

      const envValue = env[varName];

      if (envValue === undefined) {
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        throw new EnvVarMissingError(varName);
      }

      return envValue;
    });
  }

  /**
   * 深度遍历对象，解析所有字符串中的环境变量
   */
  static resolveDeep<T>(obj: T, env: NodeJS.ProcessEnv = process.env): T {
    if (typeof obj === "string") {
      return this.resolve(obj, env) as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.resolveDeep(item, env)) as T;
    }

    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveDeep(value, env);
      }
      return result as T;
    }

    return obj;
  }
}

/**
 * 便捷函数：注入环境变量到配置对象
 */
export function injectEnvVars<T extends Record<string, unknown>>(
  config: T,
  env: NodeJS.ProcessEnv = process.env,
): T {
  return EnvResolver.resolveDeep(config, env);
}

// 导出错误类
export { EnvVarMissingError } from "./types";
