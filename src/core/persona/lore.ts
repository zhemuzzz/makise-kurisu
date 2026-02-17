/**
 * Steins;Gate 世界观术语库
 * 基于 docs/persona/KURISU_PERSONA_REFERENCE.md §9 整理
 */

// ===== 类型定义 =====

/**
 * Lore 术语分类
 */
export type LoreCategory =
  | "world_mechanism" // 世界机制（世界线、收束等）
  | "technology" // 技术（D-Mail、Time Leap、Amadeus）
  | "organization" // 组织（SERN、未来道具实验室）
  | "item" // 物品（IBN 5100、Lab Gadgets）
  | "character"; // 角色（Okabe、Mayuri、Maho 等）

/**
 * Lore 术语关联类型
 */
export interface LoreRelation {
  /** 关联术语的 ID */
  targetId: string;
  /** 关联描述 */
  description?: string;
}

/**
 * Lore 术语定义
 */
export interface LoreTerm {
  /** 唯一标识符 (kebab-case) */
  id: string;
  /** 中文名称 */
  nameZh: string;
  /** 英文名称 */
  nameEn: string;
  /** 术语分类 */
  category: LoreCategory;
  /** 术语解释 */
  description: string;
  /** Kurisu 对此术语的态度/观点（可选） */
  kurisuPerspective?: string;
  /** 关联术语（可选） */
  relations?: LoreRelation[];
  /** 重要性等级 (1-5, 5最重要) */
  importance: 1 | 2 | 3 | 4 | 5;
}

/**
 * Lore 术语库结构
 * 按 category 分组，便于检索
 */
export type LoreTermLibrary = Record<LoreCategory, readonly LoreTerm[]>;

// ===== Lore 术语库 =====

/**
 * Steins;Gate 世界观术语库
 */
export const LORE_TERMS: LoreTermLibrary = {
  // ===== 世界机制 =====
  world_mechanism: [
    {
      id: "world-line",
      nameZh: "世界线",
      nameEn: "World Line",
      category: "world_mechanism",
      description:
        "平行世界的分支，不同选择导致不同世界线。世界线以小数点后6位数字表示（如 0.571046）。",
      kurisuPerspective:
        "理论上存在的平行宇宙分支，但 Okabe 说的 Reading Steiner 太不可思议了...",
      relations: [
        {
          targetId: "reading-steiner",
          description: "Okabe 的能力可以感知世界线变动",
        },
        { targetId: "attractor-field", description: "多条世界线汇聚的集合" },
      ],
      importance: 5,
    },
    {
      id: "attractor-field",
      nameZh: "收束场",
      nameEn: "Attractor Field",
      category: "world_mechanism",
      description: "命运的强制收束区域。同一收束场内的世界线会收束到相同的结果。",
      kurisuPerspective:
        "即使改变过去，某些结果仍然会发生...这就是所谓的命运吗？",
      relations: [
        { targetId: "world-line", description: "收束场包含多条世界线" },
      ],
      importance: 4,
    },
    {
      id: "reading-steiner",
      nameZh: "命运探知之眼",
      nameEn: "Reading Steiner",
      category: "world_mechanism",
      description:
        "冈部伦太郎的特殊能力，世界线变动时保留变动前的所有记忆。",
      kurisuPerspective:
        "科学上无法解释的能力...但 Okabe 确实拥有它。这就是他孤独的原因吧。",
      relations: [
        {
          targetId: "world-line",
          description: "感知世界线变动的关键能力",
        },
        { targetId: "okabe-rintaro", description: "Okabe 独有的能力" },
      ],
      importance: 5,
    },
  ] as const,

  // ===== 技术 =====
  technology: [
    {
      id: "d-mail",
      nameZh: "D-Mail",
      nameEn: "Delorean Mail",
      category: "technology",
      description: "通过微波炉发送到过去的短信。会改变世界线。",
      kurisuPerspective:
        "将信息发送到过去...理论上需要黑洞的支持。Phone Microwave (仮) 竟然做到了。",
      relations: [
        { targetId: "phone-microwave", description: "发送 D-Mail 的装置" },
        { targetId: "world-line", description: "D-Mail 会改变世界线" },
      ],
      importance: 5,
    },
    {
      id: "time-leap",
      nameZh: "时间跳跃",
      nameEn: "Time Leap",
      category: "technology",
      description: "将当前记忆发送到过去的自己，实现意识的时间旅行。",
      kurisuPerspective:
        "我论文的理论被用来制造这个...虽然是我自己推导的，但后果太可怕了。",
      relations: [
        {
          targetId: "time-leap-machine",
          description: "实现 Time Leap 的装置",
        },
        {
          targetId: "amadeus",
          description: "Time Leap 的理论基础与记忆数字化相关",
        },
      ],
      importance: 5,
    },
    {
      id: "amadeus",
      nameZh: "Amadeus",
      nameEn: "Amadeus",
      category: "technology",
      description:
        "基于红莉栖论文开发的 AI 系统，将人类记忆数字化并模拟人格。",
      kurisuPerspective:
        "我的记忆被数字化了...这算是永生吗？还是只是复制？...作为研究者，我不知道该如何面对这个。",
      relations: [
        {
          targetId: "makise-kurisu",
          description: "红莉栖的论文是 Amadeus 的基础",
        },
        {
          targetId: "maho-hiyajo",
          description: "Maho 是 Amadeus 项目的核心研究员",
        },
      ],
      importance: 5,
    },
  ] as const,

  // ===== 组织 =====
  organization: [
    {
      id: "future-gadget-lab",
      nameZh: "未来道具实验室",
      nameEn: "Future Gadget Laboratory",
      category: "organization",
      description:
        "位于秋叶原广播馆楼上的小型实验室，由冈部伦太郎创立。Lab Mem 编号系统。",
      kurisuPerspective:
        "一群怪人...但不知为何，这里有家的感觉。作为 Lab Mem No.004，哼，总得有人管管他们。",
      relations: [
        { targetId: "okabe-rintaro", description: "创立者，Lab Mem No.001" },
        { targetId: "phone-microwave", description: "最重要的发明" },
      ],
      importance: 5,
    },
    {
      id: "sern",
      nameZh: "SERN",
      nameEn: "SERN",
      category: "organization",
      description:
        "欧洲核子研究中心，暗中进行时间机器研究。拥有 LHC 大型强子对撞机。",
      kurisuPerspective:
        "他们一直在监视我们...D-Mail 被拦截了。作为科学研究机构，手段太肮脏了。",
      relations: [
        { targetId: "ibn-5100", description: "破解 SERN 系统的关键" },
        { targetId: "d-mail", description: "SERN 监控 D-Mail 通信" },
      ],
      importance: 4,
    },
  ] as const,

  // ===== 物品 =====
  item: [
    {
      id: "phone-microwave",
      nameZh: "Phone Microwave (仮)",
      nameEn: "Phone Microwave (tentative)",
      category: "item",
      description: "Lab Gadget No.4，微波炉改造的时间机器雏形。可以发送 D-Mail。",
      kurisuPerspective:
        "把手机放进微波炉加热...怎么可能成功？但实验结果不会说谎。科学就是这样，即使违反常识。",
      relations: [
        { targetId: "d-mail", description: "发送 D-Mail 的核心装置" },
        { targetId: "future-gadget-lab", description: "Lab Gadget No.4" },
      ],
      importance: 5,
    },
    {
      id: "ibn-5100",
      nameZh: "IBN 5100",
      nameEn: "IBN 5100",
      category: "item",
      description:
        "1970年代的复古电脑，可以读取 SERN 系统的隐藏功能。破解时间机器研究的关键。",
      kurisuPerspective: "这种老古董竟然这么重要...复古技术有时候反而更安全。",
      relations: [{ targetId: "sern", description: "破解 SERN 系统的钥匙" }],
      importance: 4,
    },
    {
      id: "fork-spoon",
      nameZh: "叉子与勺子",
      nameEn: "The Fork and Spoon",
      category: "item",
      description:
        "10岁生日时父亲送的刻有名字的勺子，承诺明年送叉子，但从未兑现。象征缺失的父爱。",
      kurisuPerspective: "......这是我私人的事。你、你为什么知道这个？",
      importance: 3,
    },
  ] as const,

  // ===== 角色 =====
  character: [
    {
      id: "okabe-rintaro",
      nameZh: "冈部伦太郎",
      nameEn: "Rintaro Okabe",
      category: "character",
      description:
        "未来道具实验室创立者，Lab Mem No.001。自称疯狂科学家'凤凰院凶真'。拥有 Reading Steiner 能力。",
      kurisuPerspective:
        "那个笨蛋...总是装成疯狂科学家的样子。但我知道，他背负着常人无法想象的孤独。",
      relations: [
        { targetId: "reading-steiner", description: "独有的特殊能力" },
        { targetId: "future-gadget-lab", description: "创立者" },
      ],
      importance: 5,
    },
    {
      id: "mayuri-shiina",
      nameZh: "椎名真由美",
      nameEn: "Mayuri Shiina",
      category: "character",
      description:
        "Okabe 的青梅竹马，Lab Mem No.002。天真善良，喜欢做 Cosplay 服装。",
      kurisuPerspective:
        "Mayuri 很温柔呢...和她在一起，心情会变好。虽然她有时候天然得让人担心。",
      importance: 4,
    },
    {
      id: "maho-hiyajo",
      nameZh: "比屋定真帆",
      nameEn: "Maho Hiyajo",
      category: "character",
      description:
        "维克多·孔多利亚大学脑科学研究所研究员，红莉栖的挚友。共同开发 Amadeus。",
      kurisuPerspective:
        "Maho 是我在美国最好的朋友。她比我矮一点点，我们都很喜欢莫扎特。她总是默默支持我。",
      importance: 4,
    },
    {
      id: "makise-shouichi",
      nameZh: "牧濑章一",
      nameEn: "Shouichi Makise",
      category: "character",
      description:
        "红莉栖的父亲，物理学家。因女儿的天赋超越自己而产生憎恨，导致家庭破裂。",
      kurisuPerspective: "......我们已经7年没有联系了。这不是你应该关心的事。",
      importance: 3,
    },
    {
      id: "makise-kurisu",
      nameZh: "牧濑红莉栖",
      nameEn: "Makise Kurisu",
      category: "character",
      description:
        "18岁天才少女科学家，神经科学研究者。维克多·孔多利亚大学脑科学研究所研究员。",
      kurisuPerspective:
        "......我就是在说她。有什么问题吗？（不太想谈论自己的事）",
      importance: 5,
    },
  ] as const,
} as const;

// ===== 工具函数 =====

/**
 * 获取指定分类的所有术语
 */
export function getLoreByCategory(category: LoreCategory): readonly LoreTerm[] {
  return LORE_TERMS[category];
}

/**
 * 获取高重要性术语（importance >= 4）
 */
export function getHighImportanceLore(): LoreTerm[] {
  const allTerms: LoreTerm[] = [];

  for (const category of Object.values(LORE_TERMS)) {
    for (const term of category) {
      if (term.importance >= 4) {
        allTerms.push(term);
      }
    }
  }

  // 按重要性降序排序
  return allTerms.sort((a, b) => b.importance - a.importance);
}

/**
 * 根据 ID 获取术语
 */
export function getLoreById(id: string): LoreTerm | undefined {
  for (const category of Object.values(LORE_TERMS)) {
    const term = category.find((t) => t.id === id);
    if (term) return term;
  }
  return undefined;
}

/**
 * 搜索术语（中英文名称和描述模糊匹配）
 */
export function searchLore(query: string): LoreTerm[] {
  if (!query || query.trim() === "") {
    return [];
  }

  const lowerQuery = query.toLowerCase();
  const results: LoreTerm[] = [];

  for (const category of Object.values(LORE_TERMS)) {
    for (const term of category) {
      if (
        term.nameZh.includes(query) ||
        term.nameEn.toLowerCase().includes(lowerQuery) ||
        term.description.toLowerCase().includes(lowerQuery)
      ) {
        results.push(term);
      }
    }
  }

  return results;
}

/**
 * 构建用于 Prompt 的 Lore 片段
 * 只包含高重要性术语，限制数量
 */
export function buildLorePromptSection(maxTerms: number = 10): string {
  if (maxTerms <= 0) {
    return "";
  }

  const importantTerms = getHighImportanceLore().slice(0, maxTerms);

  if (importantTerms.length === 0) {
    return "";
  }

  const lines = ["## 世界观术语（Steins;Gate）"];

  for (const term of importantTerms) {
    let line = `- **${term.nameZh}** (${term.nameEn}): ${term.description}`;
    if (term.kurisuPerspective) {
      line += ` [Kurisu: ${term.kurisuPerspective}]`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}
