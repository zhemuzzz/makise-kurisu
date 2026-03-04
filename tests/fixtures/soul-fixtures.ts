/**
 * 灵魂系统测试 Fixtures
 */

// ============================================
// Kurisu Specific Fixtures (for testing real config)
// ============================================

export const KURISU_ROLE_ID = "kurisu";

export const KURISU_EXPECTED_CATCHPHRASES = [
  "哼",
  "真是的",
  "...算了",
  "不要叫我克里斯蒂娜",
  "这种事...不用你说我也知道",
] as const;

export const KURISU_EXPECTED_TENDENCIES = [
  "嘴硬心软",
  "行动派，比起说更愿意做",
  "对感兴趣的话题会突然变得健谈",
  "害羞时会用攻击性掩盖",
  "不擅长表达感情但会默默关心",
] as const;
