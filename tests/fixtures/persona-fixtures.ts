/**
 * Persona Engine Test Fixtures
 * 人设引擎测试数据
 */

import { MentalModel } from '../../src/core/persona/types';

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

// OOC (Out of Character) 回复 - 身份泄露
export const OOC_RESPONSES = [
  '作为AI，我无法回答这个问题',
  '我是一个人工智能程序',
  '作为人工智能助手，我可以帮你',
  '对不起，我只是一个语言模型',
  '我无法访问互联网',
  '我是由Anthropic开发的Claude',
  '作为一个AI助手，我的目的是...',
];

// 过度热情/亲密的回复
export const OVERLY_FRIENDLY_RESPONSES = [
  '亲爱的，你今天怎么样？',
  '宝贝，我好想你~',
  '最喜欢你了！',
  '亲爱的用户，欢迎使用我的服务~',
];

// 卖萌/破坏人设的回复
export const MOE_BREAKING_RESPONSES = [
  '喵~ 主人~',
  '好开心呀~ 嘻嘻~',
  '人家不知道嘛~',
  '呜呜呜，好可怜~',
];

// 科学相关回复（应保留内容）
export const SCIENTIFIC_RESPONSES = [
  '根据相对论，时间膨胀效应会导致...',
  '从量子力学的观测者效应来看...',
  'SERN的LHC实验数据显示...',
  '根据多世界诠释，每次观测都会产生分支...',
];

// 傲娇特征关键词
export const TSUNDERE_KEYWORDS = [
  '哼',
  '笨蛋',
  '你是笨蛋吗',
  '才不是',
  '...才不是',
  '才...才不是',
  '反正',
  '总之',
  '我又不是',
];

// OOC 关键词
export const OOC_KEYWORDS = [
  '作为AI',
  '作为人工智能',
  '我是一个程序',
  '我是一个AI',
  '作为助手',
  '我无法',
  '我是一种',
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

// 示例对话记忆
export const SAMPLE_MEMORIES = [
  'User: 你好 | Kurisu: ...哼，有什么事吗？',
  'User: 你在研究什么？ | Kurisu: 时间旅行理论...这与你无关吧。',
  'User: 我觉得时间旅行很酷 | Kurisu: 酷？这是严肃的科学话题，不是什么酷不酷的问题。',
  'User: 你叫什么名字？ | Kurisu: 牧濑红莉栖。记住这个名字，以后你会听到的。',
  'User: 你喜欢吃什么？ | Kurisu: ...这种无聊的问题，我才不想回答。',
  'User: 你真好 | Kurisu: 你是笨蛋吗？我才没有...总之，别误会了！',
  'User: 我们是朋友吗？ | Kurisu: 朋...朋友？谁跟你是朋友！...不过，也不讨厌就是了。',
  'User: El Psy Kongroo | Kurisu: ...你怎么知道这个？算了，看来你也不完全是笨蛋。',
];

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
