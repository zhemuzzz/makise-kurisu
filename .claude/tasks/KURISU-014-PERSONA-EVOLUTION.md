# KURISU-014 角色真实感 + 自进化能力

> **任务类型**: Core Feature
> **优先级**: P0
> **状态**: 规划阶段

---

## 核心目标

> **"能自主进化的角色 AI - 既能像 Neuro-sama 一样真实交流，又能自己学会新技能"**

### 两大核心能力

| 能力 | 目标 | 参考 |
|------|------|------|
| **角色真实感** | 像 Neuro-sama 一样自然的交流体验 | Persona Engine 2.0 |
| **自进化能力** | 通过对话自主使用/添加插件 | Self-Evolution System |

---

## 当前状态

| Phase | 状态 | 说明 |
|-------|------|------|
| Phase 1 | 🔲 待开发 | Persona Engine 2.0 核心设计 |
| Phase 2 | 🔲 待开发 | 自进化系统基础 |
| Phase 3 | 🔲 待开发 | 工具使用 + 人设包装 |
| Phase 4 | 🔲 待开发 | 角色配置系统 |
| Phase 5 | 🔲 持续 | 优化 + 微调准备 |

---

## Phase 1: Persona Engine 2.0（1-2周）

### 目标

提升 Kurisu 对话真实感，接近 Neuro-sama 水平

### 核心设计

```
┌─────────────────────────────────────────────────────────────┐
│              Persona Engine 2.0（角色真实感引擎）             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 角色知识库 (Persona Knowledge Base)                      │
│     config/persona/kurisu/                                  │
│     ├── core.yaml          # 核心设定                       │
│     ├── personality.yaml    # 性格特征                      │
│     ├── speech.yaml         # 说话习惯                      │
│     ├── lore.yaml           # 世界观/背景                   │
│     └── examples/           # 对话示例库                    │
│         ├── daily_chat.yaml                                │
│         ├── tech_discuss.yaml                              │
│         └── emotional.yaml                                 │
│                                                             │
│  2. Few-Shot 学习（对话示例注入）                            │
│     - 分析用户意图                                          │
│     - 匹配最相关的 3-5 个对话示例                            │
│     - 注入到 Prompt 中                                      │
│                                                             │
│  3. 动态上下文注入                                          │
│     - 聊时间旅行 → Steins;Gate 设定                         │
│     - 聊科研 → Kurisu 的科学家背景                          │
│     - 聊傲娇 → 傲娇反应模式                                 │
│                                                             │
│  4. 实时校验修正                                            │
│     - 检查是否符合性格特征                                  │
│     - 检查是否符合说话习惯                                  │
│     - 检查没有出戏                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 角色知识库格式定义 | P0 | YAML 结构化格式 |
| core.yaml 编写 | P0 | Kurisu 核心设定 |
| personality.yaml 编写 | P0 | 性格特征详细描述 |
| speech.yaml 编写 | P0 | 说话习惯、口癖、常用语 |
| 10+ 对话示例编写 | P0 | Few-Shot 学习基础 |
| Few-Shot 注入机制 | P0 | 动态匹配 + Prompt 注入 |
| 动态上下文注入 | P1 | 根据主题注入设定 |

### 产出文件

```
config/persona/kurisu/
├── core.yaml           # 核心设定
├── personality.yaml    # 性格特征
├── speech.yaml         # 说话习惯
├── lore.yaml           # 世界观（现有）
└── examples/
    ├── daily_chat.yaml     # 日常对话示例
    ├── tech_discuss.yaml   # 技术讨论示例
    └── emotional.yaml      # 情感交流示例

src/core/persona/
├── knowledge-base.ts   # 🆕 知识库加载器
├── few-shot.ts         # 🆕 Few-Shot 注入
└── context-injector.ts # 🆕 动态上下文注入
```

---

## Phase 2: 自进化系统基础（2-3周）

### 目标

实现插件自动搜索和安装

### 核心设计

```
┌─────────────────────────────────────────────────────────────┐
│              Self-Evolution System（自进化系统）              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  自进化流程:                                                 │
│                                                             │
│  用户请求 → PluginSearchAgent → PluginSelectAgent           │
│                  ↓                     ↓                    │
│           搜索插件市场            选择最佳插件               │
│                                        ↓                    │
│  PluginInstallAgent → PluginUseAgent → PersonaEngine包装     │
│         ↓                   ↓                              │
│    安装配置             调用插件                             │
│                                                             │
│  工具来源:                                                   │
│  ├── 内置工具: web_search, shell, file, code                │
│  ├── AstrBot 插件市场: 复用现有生态                          │
│  ├── MCP servers: 标准接口                                  │
│  └── 自主开发: 简单 API 调用场景 (fallback)                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Agent 设计

| Agent | 职责 |
|-------|------|
| PluginSearchAgent | 搜索 AstrBot 插件市场 / MCP servers / npm |
| PluginSelectAgent | 评估并选择最佳插件 |
| PluginInstallAgent | 下载、安装依赖、配置 API Key |
| PluginDevAgent | 自主开发简单工具（fallback） |

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| ToolRegistry 设计 | P0 | 统一工具注册表 |
| PluginSearchAgent | P0 | 连接 AstrBot 插件市场 API |
| PluginSelectAgent | P0 | 插件评估和选择逻辑 |
| PluginInstallAgent | P0 | 下载、安装、配置 |
| 内置工具实现 | P0 | web_search, shell, file, code |
| AstrBot 市场 API 集成 | P1 | 复用现有生态 |

### 产出文件

```
src/tools/
├── registry.ts         # 🆕 工具注册表
├── built-in/
│   ├── web-search.ts   # 🆕 Web 搜索
│   ├── shell.ts        # 🆕 Shell 命令
│   ├── file.ts         # 🆕 文件操作
│   └── code.ts         # 🆕 代码执行
└── types.ts            # 🆕 工具类型定义

src/evolution/
├── plugin-search.ts    # 🆕 插件搜索 Agent
├── plugin-select.ts    # 🆕 插件选择 Agent
├── plugin-install.ts   # 🆕 插件安装 Agent
└── plugin-dev.ts       # 🆕 插件开发 Agent
```

---

## Phase 3: 工具使用 + 人设包装（1-2周）

### 目标

所有工具输出符合 Kurisu 人设

### 核心设计

**工具输出人设化**（关键差异化）：

```typescript
// 工具执行流程
async function executeTool(toolName: string, input: any) {
  // 1. 执行工具
  const result = await toolRegistry.get(toolName).execute(input);

  // 2. 人设化包装（核心！）
  const wrappedResult = await personaEngine.wrapResponse({
    content: result,
    toolName,
    context: { success: result.success }
  });

  // 3. 返回人设化结果
  return wrappedResult;
}
```

### 对话示例

```
用户: "Kurisu，帮我查一下腾讯股票"

[PluginSearchAgent 搜索插件市场]
[PluginInstallAgent 安装 stock-query-lite]
[PluginUseAgent 调用插件]

Kurisu: "股票？这种事情你自己不会查吗..."
        "算了，让我看看有没有现成的工具..."
        "哼，搞定了。腾讯控股今天收盘 380.40 港元，涨了 2.15%。"
        "以后这种小事直接问我就行。"
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| PluginUseAgent | P0 | 调用工具 + 结果处理 |
| PersonaEngine.wrapToolOutput() | P0 | 工具输出人设化包装 |
| 人设化模板设计 | P0 | 不同工具类型的包装模板 |
| 错误处理人设化 | P1 | 工具失败时的人设化提示 |

---

## Phase 4: 角色配置系统（2-3周）

### 目标

方便用户配置和分享角色

### 功能设计

```
┌─────────────────────────────────────────────────────────────┐
│              Role Config System（角色配置系统）               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 选择角色模板                                             │
│     ├── 内置模板: Kurisu, Rem, Megumin...                   │
│     └── 导入社区模板                                         │
│                                                             │
│  2. 自定义角色                                               │
│     ├── 基础设定（名字、年龄、职业）                          │
│     ├── 性格特征（傲娇、温柔、毒舌...）                       │
│     ├── 说话习惯（口癖、常用语）                              │
│     └── 背景故事                                             │
│                                                             │
│  3. 高级配置                                                 │
│     ├── 对话示例（Few-Shot）                                 │
│     ├── 特殊触发词                                           │
│     └── 知识库关联                                           │
│                                                             │
│  4. 导入/导出                                                │
│     ├── 导出为 YAML 文件                                     │
│     └── 分享给其他用户                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 角色配置格式定义 | P1 | YAML 格式 |
| 角色模板库 | P1 | 内置 3-5 个角色 |
| CLI 配置工具 | P1 | 命令行配置接口 |
| WebUI 配置工具 | P2 | 可视化配置界面 |
| 导入/导出功能 | P2 | YAML 文件支持 |

---

## Phase 5: 持续优化

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 对话示例扩充 | P1 | 目标 100+ 示例 |
| 微调数据集准备 | P2 | 为 LoRA 微调做准备 |
| LoRA 微调实验 | P2 | 人设内化 |
| 性能优化 | P2 | 延迟优化 |

---

## 技术决策

| ID | 决策 | 说明 |
|----|------|------|
| T006 | 两大核心能力 | 角色真实感 + 自进化能力 |
| T007 | 复用 AstrBot 生态 | 不重复造轮子 |
| T008 | 工具输出人设化 | 所有工具结果经过 Persona Engine |

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Few-Shot 效果不如微调 | 人设自然度 | 短期用 Few-Shot，长期准备微调 |
| 自进化只能覆盖简单场景 | 功能覆盖 | 复杂插件依赖社区生态 |
| AstrBot API 变更 | 插件搜索 | 维护 API 适配层 |

---

## 参考资源

- [Neuro-sama](https://en.wikipedia.org/wiki/Neuro-sama) - 人设内化参考
- [AstrBot](https://github.com/Soulter/AstrBot) - 插件生态参考
- [OpenClaw](https://github.com/openclaw/openclaw) - 工具能力参考
