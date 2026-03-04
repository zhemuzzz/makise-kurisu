/**
 * 会话设置确认/拒绝常量
 *
 * 统一 index.ts 中 3 处重复定义（原行 625、799、946）
 * KURISU-024: 会话设置流水线重构
 */

/**
 * 确认指令模式
 *
 * 用户回复这些关键词表示同意/确认
 */
export const CONFIRM_PATTERNS = [
  "y",
  "是",
  "确定",
  "ok",
  "yes",
  "确认",
  "好的",
  "可以",
] as const;

/**
 * 拒绝指令模式
 *
 * 用户回复这些关键词表示拒绝/取消
 */
export const REJECT_PATTERNS = [
  "n",
  "否",
  "取消",
  "no",
  "拒绝",
  "不用",
  "不要",
] as const;

/**
 * 检测用户消息是否为确认
 *
 * @param message 用户消息
 * @returns 是否包含确认关键词
 */
export function isUserConfirm(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return CONFIRM_PATTERNS.some((p) => trimmed.includes(p));
}

/**
 * 检测用户消息是否为拒绝
 *
 * @param message 用户消息
 * @returns 是否包含拒绝关键词
 */
export function isUserReject(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return REJECT_PATTERNS.some((p) => trimmed.includes(p));
}

/**
 * 用户审批意图类型
 */
export type UserApprovalIntent = "confirm" | "reject" | "unknown";

/**
 * 检测用户审批意图
 *
 * @param message 用户消息
 * @returns 意图类型：confirm/reject/unknown
 */
export function detectUserApprovalIntent(message: string): UserApprovalIntent {
  if (isUserConfirm(message)) return "confirm";
  if (isUserReject(message)) return "reject";
  return "unknown";
}
