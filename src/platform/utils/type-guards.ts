/**
 * 通用类型守卫工具
 *
 * 提供泛型工厂函数，避免重复编写类型守卫逻辑
 */

/**
 * 创建枚举类型守卫
 *
 * @param allowedValues 允许的值列表
 * @returns 类型守卫函数
 *
 * @example
 * ```typescript
 * const MUTATION_TYPES = ["add", "modify", "delete"] as const;
 * type MutationType = typeof MUTATION_TYPES[number];
 * const isMutationType = createEnumGuard<MutationType>(MUTATION_TYPES);
 *
 * if (isMutationType(value)) {
 *   // value is MutationType
 * }
 * ```
 */
export function createEnumGuard<T extends string>(
  allowedValues: readonly T[],
): (value: unknown) => value is T {
  return (value): value is T =>
    typeof value === "string" && allowedValues.includes(value as T);
}

/**
 * 创建对象形状守卫 (基于 type 字段)
 *
 * @param typeField type 字段名称 (默认 "type")
 * @param expectedType 期望的 type 值
 * @returns 类型守卫函数
 *
 * @example
 * ```typescript
 * interface TextDeltaEvent {
 *   type: "text_delta";
 *   content: string;
 * }
 *
 * const isTextDeltaEvent = createObjectShapeGuard<TextDeltaEvent>("type", "text_delta");
 *
 * if (isTextDeltaEvent(event)) {
 *   // event is TextDeltaEvent
 * }
 * ```
 */
export function createObjectShapeGuard<T>(
  typeField: string,
  expectedType: string,
): (value: unknown) => value is T {
  return (value): value is T =>
    value !== null &&
    typeof value === "object" &&
    typeField in value &&
    (value as Record<string, unknown>)[typeField] === expectedType;
}

/**
 * 创建对象形状守卫 (基于字段存在性)
 *
 * @param requiredFields 必须存在的字段列表
 * @returns 类型守卫函数
 *
 * @example
 * ```typescript
 * interface Config {
 *   host: string;
 *   port: number;
 * }
 *
 * const isConfig = createFieldPresenceGuard<Config>(["host", "port"]);
 *
 * if (isConfig(obj)) {
 *   // obj has host and port fields
 * }
 * ```
 */
export function createFieldPresenceGuard<T>(
  requiredFields: readonly string[],
): (value: unknown) => value is T {
  return (value): value is T => {
    if (value === null || typeof value !== "object") {
      return false;
    }

    const obj = value as Record<string, unknown>;
    return requiredFields.every((field) => field in obj);
  };
}

/**
 * 创建数值范围守卫
 *
 * @param min 最小值 (包含)
 * @param max 最大值 (包含)
 * @returns 类型守卫函数
 *
 * @example
 * ```typescript
 * type EffectivenessScore = 0 | 1 | 2 | 3 | 4 | 5;
 * const isEffectivenessScore = createRangeGuard<EffectivenessScore>(0, 5);
 *
 * if (isEffectivenessScore(value)) {
 *   // value is EffectivenessScore
 * }
 * ```
 */
export function createRangeGuard<T extends number>(
  min: number,
  max: number,
): (value: unknown) => value is T {
  return (value): value is T =>
    typeof value === "number" && value >= min && value <= max;
}

/**
 * 组合多个类型守卫 (OR 逻辑)
 *
 * @param guards 类型守卫函数列表
 * @returns 组合后的类型守卫函数
 *
 * @example
 * ```typescript
 * const isStringOrNumber = combineGuards<string | number>([
 *   (v): v is string => typeof v === "string",
 *   (v): v is number => typeof v === "number",
 * ]);
 * ```
 */
export function combineGuards<T>(
  guards: Array<(value: unknown) => value is T>,
): (value: unknown) => value is T {
  return (value): value is T => guards.some((guard) => guard(value));
}
