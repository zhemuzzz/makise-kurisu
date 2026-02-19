# KURISU-017 角色创建向导 + Skill System

> **任务类型**: Core Feature
> **优先级**: P0（依赖 KURISU-015 + KURISU-016 完成）
> **状态**: 待启动

---

## 背景

本任务覆盖两件紧密相关的事：

1. **角色创建向导** — 让用户能零门槛创建一个完整角色（人设 + 声音 + 形象 + 工具 + **技能**）
2. **Skill System** — L7 统一插件层，让角色的知识和工具能力可插拔扩展

**两件事放在一起**的原因：向导的 Step 4 就是"安装 Skill"，没有 Skill System，向导就不完整。

---

## Phase 1: Skill System 核心（1.5周）⭐优先

> 先实现 Skill System，向导才能引用它

### 产出文件

```
config/skills/
├── coding-assistant/
│   ├── skill.yaml
│   └── mcp.json
├── steins-gate-lore/
│   └── skill.yaml
└── web-search/
    ├── skill.yaml
    └── mcp.json

src/skills/
├── registry.ts          # 🆕 SkillRegistry - 加载/查询/激活
├── activator.ts         # 🆕 意图检测 → 匹配 Skill
├── injector.ts          # 🆕 知识注入到 Prompt
└── types.ts             # 🆕 Skill 类型定义
```

### skill.yaml 完整格式

```yaml
id: coding-assistant
name: 代码助手
version: "1.0"
type: hybrid                   # knowledge | tool | hybrid
author: kurisu-project

# 意图触发
trigger:
  keywords: ["代码", "报错", "debug", "函数", "bug", "写个"]
  intent: ["coding", "debugging", "code_review"]
  # 触发优先级（多个 skill 同时匹配时，高优先级先注入）
  priority: 10

# 知识注入（knowledge/hybrid 必填）
context: |
  用户在寻求编程帮助。保持 Kurisu 的傲娇风格但专业度不打折。

# Few-Shot 示例（可选，增强人设表现）
examples:
  - user: "这段代码有 bug"
    assistant: "哼，让我看看...这里的类型推断完全错了。"
  - user: "帮我优化一下"
    assistant: "真是的，这种问题还要我来...好吧，给你重构。"

# 绑定 MCP 工具（tool/hybrid 可选）
tools:
  mcp_config: ./mcp.json       # MCP Server 配置路径
  # 或直接内联
  # inline:
  #   - name: run_tests
  #     command: "npm test"
  #     permission: safe

# 元信息
meta:
  description: "TypeScript/Python 代码助手，带傲娇风格"
  tags: ["coding", "debug", "typescript", "python"]
  requires:
    - kurisu-version: ">=2.0"
```

### SkillRegistry 接口

```typescript
interface SkillRegistry {
  // 加载所有 Skill（启动时）
  loadAll(skillsDir: string): Promise<void>;

  // 按意图匹配（每次请求调用）
  match(userInput: string): Skill[];

  // 安装新 Skill
  install(skillPath: string): Promise<void>;

  // 卸载
  remove(skillId: string): Promise<void>;

  // 列出所有
  list(): Skill[];
}
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| Skill 类型定义（types.ts） | P0 | SkillConfig, TriggerRule, SkillContext |
| skill.yaml 解析器 | P0 | 加载并验证 skill.yaml |
| SkillRegistry 实现 | P0 | 注册/查询/匹配 |
| 意图匹配算法（activator.ts） | P0 | 关键词 + 意图向量匹配 |
| 知识注入到 Prompt（injector.ts） | P0 | 将 context + examples 注入 System Prompt |
| coding-assistant skill 编写 | P0 | 第一个内置 Skill，验证设计 |
| steins-gate-lore skill 编写 | P1 | 世界观知识库 |
| web-search skill 编写 | P1 | 绑定 MCP web-search |

---

## Phase 2: 角色创建向导（1周）

> 5步向导，Step 4 使用 Skill System

### 向导流程

```
Step 1: 人设配置
  ├── 基础信息（名字、年龄、职业）
  ├── 性格特征（选择 + 自定义）
  ├── 说话习惯（口癖、常用语）
  └── 背景故事

Step 2: 声音绑定（依赖 KURISU-015）
  ├── 选择预设音色（Fish Audio 列表）
  ├── 上传音色样本（30s 录音）
  └── 试听预览

Step 3: 形象绑定
  ├── 上传头像（文字聊天用）
  ├── 选择 Live2D 模型（依赖 Phase F）
  └── 自定义表情包

Step 4: 技能配置 ⭐核心（依赖 Phase 1）
  ├── 浏览内置 Skill 列表
  ├── 勾选启用的 Skill
  ├── 配置工具权限（安全级/确认级/禁止级）
  └── 上传自定义 skill.yaml

Step 5: 接入平台
  ├── Telegram / Discord / QQ / 本地 CLI
  └── 生成 role.yaml + 启动配置
```

### role.yaml 扩展（加入 skills 字段）

```yaml
id: kurisu
version: "2.0"
meta:
  name: "牧濑红莉栖"

persona:
  core: ./core.yaml
  personality: ./personality.yaml
  speech: ./speech.yaml
  lore: ./lore.yaml

voice:
  provider: fish-audio
  voice_id: "kurisu-v2"

# ⭐ 新增：Skill 配置
skills:
  enabled:
    - coding-assistant          # 内置 Skill
    - steins-gate-lore          # 内置 Skill
    - web-search                # 内置 Skill
  custom:
    - path: ./skills/diary/     # 用户自定义 Skill

tools:
  allowed: [web_search, file_read, screenshot, browser, shell]
  require_confirmation: [shell, file_write]

platforms:
  telegram:
    enabled: true
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| role.yaml 格式定义（含 skills 字段） | P0 | 完整格式规范 |
| 5步向导 CLI 框架 | P0 | inquirer.js 交互式 |
| Step 1-2: 人设 + 声音 | P0 | 声音依赖 KURISU-015 |
| Step 4: Skill 选择 UI | P0 | 列出内置 Skill + 勾选 |
| Kurisu 内置模板 | P0 | 包含默认 Skills 的模板 |
| 导入/导出 YAML | P1 | 分享角色配置文件 |

---

## Phase 3: Skill Store CLI（0.5周）

> 让技能可以像 npm 包一样搜索/安装

```bash
kurisu skill list                      # 列出已安装
kurisu skill list --available          # 列出可安装（内置库）
kurisu skill install coding-assistant  # 安装
kurisu skill remove weather            # 卸载
kurisu skill search "天气"             # 搜索
kurisu skill info coding-assistant     # 查看详情
```

### 任务清单

| 任务 | 优先级 | 说明 |
|------|--------|------|
| kurisu CLI 框架 | P0 | commander.js |
| skill 子命令组 | P0 | list/install/remove/search/info |
| 内置 Skill 目录 | P0 | config/skills/ 内置 5+ Skill |
| 自定义 Skill 导入 | P1 | 从本地路径或 URL 安装 |

---

## 技术决策

| ID | 决策 | 说明 |
|----|------|------|
| T014 | Skill = Knowledge + Tool 统一 | 两者放同一 skill.yaml，不分离 |
| T015 | 意图匹配用关键词 + 向量 | 初期关键词，后期加语义向量 |
| T016 | Skill 目录约定 config/skills/ | 与 personas 同级 |
| T017 | role.yaml 包含 skills 字段 | 角色创建时就绑定 Skill |

---

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 多 Skill 同时激活，Prompt 过长 | Token 超限 | 限制最多 3 个 Skill 同时注入 |
| 意图误匹配 | 注入无关知识 | 保守阈值，关键词匹配优先 |
| 自定义 Skill 安全问题 | 注入恶意内容 | Skill context 做内容校验 |
