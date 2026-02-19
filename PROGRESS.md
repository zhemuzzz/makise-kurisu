# Kurisu 项目进度追踪

> 最后更新: 2026-02-19
> 状态: MVP 完成，2.0 阶段重新规划

---

## 🎯 项目定位

> **"用户只需创建角色，就能得到能聊天语音视频 + 能用工具操控电脑的个人助手"**

### 核心能力目标

| 能力 | 目标体验 | 状态 |
|------|---------|------|
| **对话真实感** | 用户感受到的是真正的角色 | Phase D 待开发 |
| **语音对话** | 角色专属声音，实时语音交流 | **Phase A 待开发 ← 下一步** |
| **视频形象** | Live2D 虚拟形象，可直播 | Phase F 待开发 |
| **工具使用** | 能搜索、写代码、操控电脑 | **Phase B 待开发 ← 下一步** |
| **零门槛入口** | 创建角色 = 完整助手 | Phase C 待开发 |

---

## 📊 整体进度

```
MVP 阶段 ████████████████████ 100% ✅
  ├── L1 Gateway       ✅
  ├── L2 Persona 1.0   ✅
  ├── L3 Agent         ✅
  ├── L4 Memory        ✅
  └── L5 Infrastructure✅

Telegram 接入 ████████████████░░░░ 80% (KURISU-013)
  ├── Phase 0-2.2 文字对话  ✅ 端到端测试通过
  └── Phase 3 语音消息      🔲 依赖 Phase A

2.0 核心能力 ░░░░░░░░░░░░░░░░░░░░ 0%
  ├── Phase A: 基础语音     🔲 P0 ← 下一步
  ├── Phase B: 工具沙箱     🔲 P0 ← 下一步（可并行）
  ├── Phase C: 角色创建向导 🔲 P0
  ├── Phase D: Persona 2.0  🔲 P1
  ├── Phase E: 实时语音     🔲 P1
  ├── Phase F: 虚拟形象     🔲 P2
  └── Phase G: 自进化       🔲 P2
```

---

## 当前任务

### KURISU-015: 基础语音能力 [P0] ← 下一步

> 详细文档: 待创建 `docs/tasks/active/KURISU-015-VOICE-BASIC.md`

**状态**: 待启动

| 任务 | 状态 | 说明 |
|------|------|------|
| Whisper STT 集成 | 🔲 | 本地语音识别，接收 Telegram 语音消息 |
| Fish Audio TTS 集成 | 🔲 | API 语音合成，合成角色声音 |
| Telegram 语音消息收发 | 🔲 | 接收语音 → STT → 处理 → TTS → 发送 |
| 流式 TTS 输出 | 🔲 | 边生成边播放，降低延迟 |
| 角色音色配置 | 🔲 | role.yaml 中 voice 字段 |

---

### KURISU-016: 工具执行沙箱 [P0] ← 可与 015 并行

> 详细文档: 待创建 `docs/tasks/active/KURISU-016-TOOL-SANDBOX.md`

**状态**: 待启动

| 任务 | 状态 | 说明 |
|------|------|------|
| Docker 工具沙箱设计 | 🔲 | 隔离执行环境 |
| 工具权限分级系统 | 🔲 | 安全/确认/禁止三级 |
| 内置工具: web_search | 🔲 | 搜索网页 |
| 内置工具: file_read | 🔲 | 读取文件 |
| 内置工具: screenshot | 🔲 | 截图+理解 |
| 内置工具: browser | 🔲 | Playwright 浏览器控制 |
| 内置工具: shell | 🔲 | 沙箱内 Shell 执行 |
| 工具输出人设化包装 | 🔲 | PersonaEngine.wrapToolOutput() |

---

### KURISU-017: 角色创建向导 + Skill System [P0]

> 详细文档: `.claude/tasks/KURISU-017-ROLE-WIZARD-SKILL.md` ✅ 已创建

**状态**: 待启动（依赖 015 和 016 完成）

**Phase 1: Skill System（优先）**

| 任务 | 状态 | 说明 |
|------|------|------|
| Skill 类型定义（types.ts） | 🔲 | SkillConfig, TriggerRule |
| skill.yaml 解析器 | 🔲 | 加载并验证 YAML |
| SkillRegistry 实现 | 🔲 | 注册/查询/意图匹配 |
| 知识注入到 Prompt | 🔲 | context + examples 注入 System Prompt |
| coding-assistant 内置 Skill | 🔲 | 第一个 Skill，验证设计 |

**Phase 2: 创建向导**

| 任务 | 状态 | 说明 |
|------|------|------|
| role.yaml 格式定义（含 skills 字段） | 🔲 | 角色配置包含 Skill 绑定 |
| 5步创建向导 CLI | 🔲 | Step 4 = Skill 选择 |
| Kurisu 内置模板 | 🔲 | 包含默认 Skills |

**Phase 3: Skill Store CLI**

| 任务 | 状态 | 说明 |
|------|------|------|
| kurisu skill list/install/remove | 🔲 | 像 npm 一样管理 Skill |

---

### KURISU-014 重新规划：Persona Engine 2.0 [P1]

> 状态: Phase A/B/C 完成后启动

| 任务 | 状态 | 说明 |
|------|------|------|
| 角色知识库 YAML 格式 | 🔲 | config/personas/kurisu/ |
| 10+ 对话示例编写 | 🔲 | Few-Shot 学习基础 |
| Few-Shot 注入机制 | 🔲 | 动态匹配 + Prompt 注入 |
| 情感状态追踪 | 🔲 | 影响 TTS 语调 + Live2D 表情 |

---

## 并行任务

### KURISU-013: 多平台接入

**状态**: QQ Channel 代码完成，待用户配置 NapCat

| Phase | 状态 | 说明 |
|-------|------|------|
| Telegram 文字 | ✅ | 端到端通过 (2026-02-19) |
| **QQ 文字** | ✅ **代码完成** | QQChannel + 19 tests (2026-02-20) |
| QQ 端到端 | 🔲 **待验证** | 需用户配置 NapCat 并扫码登录 |
| QQ 语音 | 🔲 | 依赖 KURISU-015 完成 |
| Telegram 语音 | 🔲 暂缓 | 依赖 KURISU-015 完成 |
| Discord 语音 | 🔲 延后 | 依赖 Phase E |

### 启动方式变化

```bash
# 以前（两个终端）
# terminal 1: cloudflared tunnel --url http://localhost:3000
# terminal 2: pnpm dev 或 docker compose up

# 现在（一条命令）
docker compose --profile qq up       # QQ 测试，无需 Tunnel
docker compose --profile tunnel up   # Telegram Webhook 模式
```

---

## 已完成模块

### MVP 核心功能 ✅

| 层级 | 模块 | 测试数 | 覆盖率 |
|------|------|--------|--------|
| L1 | 交互网关 | 264 | 98%+ |
| L2 | 人设引擎 1.0 | 288 | - |
| L3 | Agent 编排 | 21 | - |
| L4 | 记忆系统 | 184 | - |
| E2E | 端到端测试 | 67 | - |
| L5 | 基础设施 | - | - |

**总计**: 953 tests, 83%+ coverage (+19 QQChannel tests)

---

## 架构演进

### MVP (五层) ✅

```
L1 Gateway → L2 Persona 1.0 → L3 Agent → L4 Memory → L5 Infrastructure
```

### 2.0 目标 (九层)

```
L1 Gateway（多渠道：文字/语音/视频）
    ↓
L2 Multimodal（STT/图像理解/实时流）⭐新增
    ↓
L3 Persona Engine 2.0（角色一致性+情感状态）
    ↓
L4 Agent Orchestrator
    ↓
L5 Memory System（+用户画像）
    ↓
L6 Tool Executor（Docker沙箱+权限管理）⭐重设计
    ↓
L7 Self-Evolution（MCP优先+插件发现）
    ↓
L8 Presentation（TTS+Live2D+虚拟摄像头）⭐新增
    ↓
L9 Role Config（一站式创建向导）⭐重设计
```

---

## 技术决策

| ID | 决策 | 日期 |
|----|------|------|
| T001 | YAML 配置 + 环境变量注入 | 2026-02-16 |
| T002 | Anthropic 兼容 API 优先 | 2026-02-16 |
| T003 | GLM-5 API 先行 | 2026-02-18 |
| T004 | setup.sh 延后 | 2026-02-18 |
| T005 | 对话质量：降低延迟 + 人设微调 | 2026-02-18 |
| T006 | 两大核心能力：角色真实感 + 自进化 | 2026-02-19 |
| T007 | AstrBot 插件桥接，MCP 优先 | 2026-02-19 |
| T008 | 工具输出人设化包装 | 2026-02-19 |
| **T009** | **九层架构：补充多模态+表现+工具沙箱层** | **2026-02-19** |
| **T010** | **路线图重排：语音+工具沙箱优先于 Persona 2.0** | **2026-02-19** |

---

## 关键文件

```
kurisu/
├── CLAUDE.md              # 项目规范（九层架构）
├── PROGRESS.md            # 本文件
├── config/
│   ├── models.yaml        # 模型配置
│   └── personas/          # 角色配置目录（L9）
│       └── kurisu/
│           ├── role.yaml  # 角色总配置（待创建）
│           ├── core.yaml
│           └── examples/
├── src/
│   ├── gateway/           # L1 交互网关 ✅
│   ├── multimodal/        # L2 多模态处理 🔲 待新增
│   ├── core/persona/      # L3 人设引擎 ✅（升级到 2.0）
│   ├── agents/            # L4 Agent 编排 ✅
│   ├── memory/            # L5 记忆系统 ✅
│   ├── tools/             # L6 工具执行层 🔲 待新增
│   ├── evolution/         # L7 自进化层 🔲 待新增
│   ├── presentation/      # L8 表现输出层 🔲 待新增
│   └── config/            # L9 角色配置 🔲 待新增
└── .claude/
    ├── tasks/
    │   ├── KURISU-013-MULTI-CHANNEL-DEPLOY.md ✅
    │   └── KURISU-014-PERSONA-EVOLUTION.md (重新规划)
    ├── INDEX.md
    └── TASK.md
```

---

## 下一步（按优先级）

### 立即启动（P0）

1. **KURISU-015** — 基础语音：Whisper STT + Fish Audio TTS + Telegram 语音消息
2. **KURISU-016** — 工具沙箱：Docker 隔离 + 内置工具集 + 权限分级（可并行）

### 015+016 完成后

3. **KURISU-017** — 角色创建向导：5步 CLI 向导 + role.yaml 格式

### 向导完成后

4. **KURISU-014** — Persona Engine 2.0：Few-Shot + 情感状态追踪
5. 实时语音对话（WebSocket + VAD + Discord）
