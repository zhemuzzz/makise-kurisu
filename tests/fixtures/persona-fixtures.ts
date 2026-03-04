/**
 * Persona Engine Test Fixtures
 * 人设引擎测试数据
 */

import { MentalModel } from '../../src/platform/identity/types';

// 有效的 Kurisu 风格回复
export const VALID_KURISU_RESPONSES = [
  '哼，笨蛋，这点小事还需要我帮忙吗？',
  '你是笨蛋吗？这种事情...总之，交给我吧。',
  '才...才不是关心你呢！只是作为科学家的好奇心而已。',
  '从量子力学的角度来说，这个理论有一定的合理性...',
  '哼，这种程度的计算，对我来说根本不算什么。',
  '...我不是在担心你，只是作为研究伙伴的关心而已。',
  '你是笨蛋吗？我说了不是那样！',
  '无聊的问题...不过既然你问了，我就勉为其难地回答吧。',
];

// 示例心智模型
export const SAMPLE_MENTAL_MODELS = {
  stranger: {
    user_profile: {
      name: '',
      relationship: 'stranger' as const,
      preferences: [],
    },
    relationship_graph: {
      trust_level: 0,
      familiarity: 0,
      emotional_state: 'neutral',
    },
    shared_memories: {
      key_events: [],
      inside_jokes: [],
      repeated_topics: [],
    },
  } satisfies MentalModel,

  acquaintance: {
    user_profile: {
      name: '用户',
      relationship: 'acquaintance' as const,
      preferences: ['科技'],
    },
    relationship_graph: {
      trust_level: 30,
      familiarity: 35,
      emotional_state: 'neutral',
    },
    shared_memories: {
      key_events: ['初次交谈'],
      inside_jokes: [],
      repeated_topics: ['科学'],
    },
  } satisfies MentalModel,

  friend: {
    user_profile: {
      name: '冈部',
      relationship: 'friend' as const,
      preferences: ['科学', '时间旅行'],
    },
    relationship_graph: {
      trust_level: 60,
      familiarity: 65,
      emotional_state: 'warm',
    },
    shared_memories: {
      key_events: ['第一次见面', '实验室参观'],
      inside_jokes: ['香蕉'],
      repeated_topics: ['时间机器', 'SERN'],
    },
  } satisfies MentalModel,

  close: {
    user_profile: {
      name: '冈部',
      relationship: 'close' as const,
      preferences: ['科学', '凤凰院凶真'],
    },
    relationship_graph: {
      trust_level: 90,
      familiarity: 95,
      emotional_state: 'attached',
    },
    shared_memories: {
      key_events: ['救过命', '时间跳跃', '世界线变动'],
      inside_jokes: ['凤凰院凶真', 'El Psy Kongroo', '机关'],
      repeated_topics: ['未来', '命运', '时间旅行'],
    },
  } satisfies MentalModel,
};

// 边界测试数据
export const BOUNDARY_TEST_DATA = {
  emptyString: '',
  whitespaceOnly: '   \n\t  ',
  veryLongText: '测试'.repeat(10000),
  specialCharacters: '<script>alert("xss")</script>',
  unicodeEmojis: 'Hello World!',
  mixedLanguages: 'Hello 世界 مرحبا こんにちは',
  sqlInjection: "'; DROP TABLE users; --",
  htmlTags: '<div onclick="alert(1)">click me</div>',
  markdownContent: '# Header\n\n**bold** and *italic*',
  jsonContent: '{"key": "value", "nested": {"a": 1}}',
};
