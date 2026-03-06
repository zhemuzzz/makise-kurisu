/**
 * formatTimeContext 测试
 */

import { describe, it, expect } from "vitest";
import { formatTimeContext } from "../../../src/inner-life/core/time-context.js";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// 固定时间: 2026-03-06 14:30 周五 (UTC+8)
// UTC: 2026-03-06T06:30:00.000Z
const FIXED_TIME = new Date("2026-03-06T06:30:00.000Z").getTime();

describe("formatTimeContext", () => {
  // --------------------------------------------------------------------------
  // elapsed 格式化
  // --------------------------------------------------------------------------

  it("should format < 1 minute as '刚刚'", () => {
    const result = formatTimeContext(30_000, FIXED_TIME);
    expect(result).toContain("刚刚还在对话");
  });

  it("should format minutes correctly", () => {
    const result = formatTimeContext(15 * MS_PER_MINUTE, FIXED_TIME);
    expect(result).toContain("15 分钟");
  });

  it("should format exact hours without minutes", () => {
    const result = formatTimeContext(3 * MS_PER_HOUR, FIXED_TIME);
    expect(result).toContain("3 小时");
    expect(result).not.toContain("分钟");
  });

  it("should format hours + minutes", () => {
    const result = formatTimeContext(2 * MS_PER_HOUR + 30 * MS_PER_MINUTE, FIXED_TIME);
    expect(result).toContain("2 小时 30 分钟");
  });

  it("should format 1 day", () => {
    const result = formatTimeContext(MS_PER_DAY, FIXED_TIME);
    expect(result).toContain("1 天");
  });

  it("should format multiple days", () => {
    const result = formatTimeContext(5 * MS_PER_DAY, FIXED_TIME);
    expect(result).toContain("5 天");
  });

  // --------------------------------------------------------------------------
  // 当前时间格式化
  // --------------------------------------------------------------------------

  it("should include weekday", () => {
    const result = formatTimeContext(MS_PER_HOUR, FIXED_TIME);
    // 2026-03-06 is a Friday
    expect(result).toMatch(/周[一二三四五六日]/);
  });

  it("should include time period (上午/下午/晚上)", () => {
    const result = formatTimeContext(MS_PER_HOUR, FIXED_TIME);
    expect(result).toMatch(/凌晨|上午|中午|下午|晚上/);
  });

  // --------------------------------------------------------------------------
  // 完整输出格式
  // --------------------------------------------------------------------------

  it("should produce complete context string", () => {
    const result = formatTimeContext(MS_PER_HOUR, FIXED_TIME);
    // Should have both elapsed part and time part
    expect(result).toContain("距上次对话已过去");
    expect(result).toContain("现在是");
  });
});
