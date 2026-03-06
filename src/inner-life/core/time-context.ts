/**
 * 时间上下文格式化 — 纯函数
 *
 * @module inner-life/core/time-context
 * @description 将时间差和当前时间格式化为角色可理解的中文描述
 */

// ============================================================================
// Constants
// ============================================================================

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const WEEKDAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

// ============================================================================
// Public API
// ============================================================================

/**
 * 格式化时间上下文
 *
 * @param elapsedMs - 距上次交互的毫秒数
 * @param currentTime - 当前时间戳 (ms)
 * @returns 中文描述字符串
 *
 * @example
 * formatTimeContext(3_600_000, Date.now())
 * // → "距上次对话已过去 1 小时。现在是下午 2:30，周四。"
 */
export function formatTimeContext(
  elapsedMs: number,
  currentTime: number,
): string {
  const elapsedPart = formatElapsed(elapsedMs);
  const timePart = formatCurrentTime(currentTime);
  return `${elapsedPart}${timePart}`;
}

// ============================================================================
// Internal
// ============================================================================

function formatElapsed(elapsedMs: number): string {
  if (elapsedMs < MS_PER_MINUTE) {
    return "刚刚还在对话。";
  }
  if (elapsedMs < MS_PER_HOUR) {
    const minutes = Math.floor(elapsedMs / MS_PER_MINUTE);
    return `距上次对话已过去 ${minutes} 分钟。`;
  }
  if (elapsedMs < MS_PER_DAY) {
    const hours = Math.floor(elapsedMs / MS_PER_HOUR);
    const remainMinutes = Math.floor((elapsedMs % MS_PER_HOUR) / MS_PER_MINUTE);
    if (remainMinutes === 0) {
      return `距上次对话已过去 ${hours} 小时。`;
    }
    return `距上次对话已过去 ${hours} 小时 ${remainMinutes} 分钟。`;
  }
  const days = Math.floor(elapsedMs / MS_PER_DAY);
  if (days === 1) {
    return "距上次对话已过去 1 天。";
  }
  return `距上次对话已过去 ${days} 天。`;
}

function formatCurrentTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const weekday = WEEKDAY_NAMES[date.getDay()];

  const period = hour < 6
    ? "凌晨"
    : hour < 12
      ? "上午"
      : hour < 14
        ? "中午"
        : hour < 18
          ? "下午"
          : "晚上";

  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayMinute = String(minute).padStart(2, "0");

  return `现在是${period} ${displayHour}:${displayMinute}，${weekday}。`;
}
