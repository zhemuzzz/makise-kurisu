# KURISU-014 Persona Engine 2.0

> **任务类型**: Core Feature
> **优先级**: P1（在 KURISU-015/016/017 之后启动）
> **状态**: 待启动

---

## 背景与重新定位

原 KURISU-014 设计了"自进化"和"Persona 2.0"两件事混在一起。
根据 2026-02-19 架构重排，本任务聚焦：

**Persona Engine 2.0 = 对话真实感提升**（自进化拆分到 KURISU-018）

前置条件：
- ✅ KURISU-015 基础语音完成（情感状态需要影响 TTS）
- ✅ KURISU-016 工具沙箱完成（工具输出人设化需要稳定的工具层）

---

## 核心目标

> 用户感受到的是真正的 Kurisu，不是套了人设的 ChatGPT

### 与 1.0 的差异

| 维度 | 1.0 现状 | 2.0 目标 |
|------|---------|---------|
| 人设注入 | 固定 System Prompt | Few-Shot 动态示例注入 |
| 上下文感知 | 无 | 话题感知 → 注入相关背景 |
| 情感表达 | 无状态 | 情感状态追踪（影响 TTS 语调） |
| 对话示例 | 无 | 10+ 分类示例库 |

---

## Phase 1: 角色知识库 + Few-Shot（1.5周）

### 产出文件

```
config/personas/kurisu/
├── core.yaml           # 核心设定（已有 lore.yaml，扩展）
├── personality.yaml    # 性格特征详细描述
├── speech.yaml         # 说话习惯、口癖、常用语
└── examples/
    ├── daily_chat.yaml     # 日常对话（10个）
    ├── tech_discuss.yaml   # 技术讨论（5个）
    ├── emotional.yaml      # 情感交流（5个）
    └── tool_use.yaml       # 工具使用时的人设表达（5个）

src/core/persona/
├── knowledge-base.ts   # 🆕 知识库加载器
├── few-shot.ts         # 🆕 Few-Shot 意图匹配 + 注入
└── context-injector.ts # 🆕 话题感知上下文注入
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| personality.yaml 编写 | P0 | 性格特征，傲娇层次，不同情境表现 |
| speech.yaml 编写 | P0 | 口癖、句式、禁用词、语气词 |
| 日常对话示例 10+ | P0 | 覆盖：打招呼/聊天/开玩笑/被撩 |
| 技术讨论示例 5+ | P0 | 覆盖：解释代码/讨论论文/技术答疑 |
| KnowledgeBase 加载器 | P0 | 解析 YAML，按 roleId 加载 |
| FewShot 意图匹配 | P0 | 用户输入 → 匹配最相关示例（cosine 相似度） |
| FewShot Prompt 注入 | P0 | 将示例格式化注入 System Prompt |
| 话题感知上下文注入 | P1 | 检测话题 → 注入相关 lore 背景 |

---

## Phase 2: 情感状态追踪（1周）

> 情感状态让 TTS 语调和 Live2D 表情随对话变化

### 情感模型

```typescript
type EmotionState = {
  primary: 'neutral' | 'happy' | 'angry' | 'shy' | 'curious' | 'proud';
  intensity: number;  // 0-1
  // 影响：TTS speed/pitch + Live2D expression
}
```

### 情感触发规则

| 触发条件 | 情绪变化 |
|---------|---------|
| 用户夸 Kurisu | happy + shy |
| 用户说 Kurisu 傲娇 | angry（反驳） |
| 技术话题 | curious + proud |
| 被误解 | angry |
| 聊 Okabe | shy（隐藏） |

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| EmotionState 类型定义 | P0 | |
| EmotionTracker 实现 | P0 | 根据对话内容更新情绪 |
| PersonaEngine 情绪输出 | P0 | 每次响应附带情绪标注 |
| TTS 参数映射 | P0 | 情绪 → speed/pitch 参数 |
| Live2D 表情映射 | P1 | 情绪 → expression 参数（L8 就绪后） |

---

## Phase 3: 工具使用时的人设表达（0.5周）

> 角色用工具时说的话，要符合人设，不能是机器人口吻

### 对话示例设计

```
用户: "帮我查一下今天的天气"

❌ 机器人: "正在调用天气查询工具..."
✅ Kurisu: "哼，你自己不会看天气预报吗..."
           [工具执行中]
           "东京今天 12°C，有小雨。外出记得带伞，
            虽然我也懒得提醒你这种事。"
```

### 人设化模板类型

| 场景 | 模板风格 |
|------|---------|
| 工具调用前 | 傲娇式抱怨，但还是去做了 |
| 工具执行中 | 简短等待语 |
| 工具成功 | 给出结果 + 淡淡傲娇 |
| 工具失败 | 找借口 + 道歉（她很在意失败） |

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| tool_use.yaml 示例编写 | P0 | 各类工具的人设化表达 25+ |
| PersonaEngine.wrapToolOutput() | P0 | 工具结果人设化包装 |
| 错误处理人设化 | P1 | 工具失败时的人设化提示 |

---

## 技术决策

| ID | 决策 | 说明 |
|----|------|------|
| T006 | Few-Shot 优先于微调 | 短期用 Few-Shot，长期准备 LoRA |
| T008 | 工具输出人设化 | 所有工具结果经过 PersonaEngine |
| T011 | 情感状态追踪 | 简单规则触发，不用额外模型 |

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Few-Shot 相似度匹配慢 | 响应延迟 | 用 embedding 缓存，预计算 |
| 示例不够覆盖边缘场景 | 人设出戏 | 持续扩充示例库（目标 100+） |
| 情感状态误判 | 奇怪的语调 | 保守阈值，默认 neutral |
