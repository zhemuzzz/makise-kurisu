# Makise Kurisu - 项目指令

> Claude Code 项目专用配置和设计文档

## ⚠️ 开发规范

> **开发任何新任务前必须阅读**: [.claude/INDEX.md](.claude/INDEX.md)

**强制流程**:
```
创建任务文档 → 制定 Plan → 等待用户确认 → 执行 → commit → /compact
```

---

## 核心目标

> **"用户只需创建角色，就能得到能聊天语音视频 + 能用工具操控电脑的个人助手"**

### 最终体验目标

| 维度 | 目标体验 | 参考 |
|------|---------|------|
| **对话真实感** | 用户感受到的是真正的角色，不是机器 | Neuro-sama |
| **语音交互** | 角色专属声音，实时语音对话 | Neuro-sama |
| **视频形象** | Live2D/Avatar 虚拟形象，可直播 | VTuber |
| **工具使用** | 能搜索、写代码、操控电脑 | OpenClaw |
| **极简入口** | 创建角色 = 完整助手，零门槛启动 | — |

### 用户完整链路

```
创建角色（填写人设 + 绑定声音 + 绑定形象 + 设置工具权限）
    ↓
选择接入平台（Telegram / Discord / 本地 / 直播）
    ↓
立即可用：文字聊天 + 语音对话 + 工具调用 + 电脑操控
    ↓
持续进化：角色记住用户习惯，自主学会新技能
```

---

## 核心架构

九层分层解耦架构：

```
L1. 交互网关层 (Gateway)         - 多渠道接入，文字/语音/视频
L2. 多模态处理层 (Multimodal)    - STT语音识别 + 图像理解 + 实时流
L3. 人设引擎层 (Persona Engine)  - 角色一致性 + 情感表达 ⭐核心
L4. Agent 编排层 (Orchestrator)  - 任务路由 + 工具调用决策
L5. 记忆系统层 (Memory)          - 四层记忆 + 用户画像
L6. 工具执行层 (Tool Executor)   - Docker沙箱 + 权限管理 ⭐核心
L7. 自进化层 (Self-Evolution)    - 插件发现 + 动态加载
L8. 表现输出层 (Presentation)    - TTS + Live2D + 虚拟摄像头 ⭐核心
L9. 角色配置层 (Role Config)     - 一站式角色创建向导
```

---

## L2 多模态处理层（语音/视频输入）

> 目标：让角色能听懂语音、看懂图片，实现真正的多模态交互

```
┌─────────────────────────────────────────────────────────────┐
│              Multimodal Layer（多模态处理层）                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  输入处理:                                                   │
│  ├── STT 语音识别                                           │
│  │   ├── 实时：Whisper large-v3 本地 (优先，无费用)          │
│  │   └── 备选：Azure Speech / OpenAI Whisper API            │
│  │                                                          │
│  ├── 图像理解                                               │
│  │   └── GLM-5 Vision / GPT-4o 处理用户发送的图片            │
│  │                                                          │
│  └── 实时音频流处理                                          │
│      └── WebSocket 音频分块 → VAD 端点检测 → STT            │
│                                                             │
│  输出处理（交 L8 处理）:                                     │
│  ├── 文字 → TTS 音频
│  └── 情感标注 → 表情驱动信号
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## L3 Persona Engine 2.0（角色真实感）

> 目标：用户感受到的是真正的角色，不是机器

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│              Persona Engine 2.0（角色真实感引擎）             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 角色知识库 (Persona Knowledge Base)                      │
│     config/personas/{role-id}/                              │
│     ├── core.yaml          # 核心设定                       │
│     ├── personality.yaml    # 性格特征                      │
│     ├── speech.yaml         # 说话习惯                      │
│     ├── lore.yaml           # 世界观/背景                   │
│     └── examples/           # 对话示例库 (10+)              │
│                                                             │
│  2. Few-Shot 学习（对话示例注入）                            │
│     - 分析用户意图 → 匹配最相关 3-5 个示例 → 注入 Prompt     │
│                                                             │
│  3. 动态上下文注入                                          │
│     - 聊时间旅行 → Steins;Gate 设定                         │
│     - 聊科研 → Kurisu 的科学家背景                          │
│                                                             │
│  4. 情感状态追踪（新）                                       │
│     - 当前情绪：开心/生气/害羞/好奇                          │
│     - 情绪影响 TTS 语调 + Live2D 表情                       │
│                                                             │
│  5. 实时校验修正                                            │
│     - 检查人设一致性，检查没有出戏                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 三层管控架构（保留）

```
Layer 1: 核心人设硬约束（不可修改）
    ↓
Layer 2: 动态心智模型（持续更新）
    ↓
Layer 3: 实时合规校验（每轮检查）
```

---

## L6 工具执行层（电脑控制）

> 目标：安全地让角色操控电脑，所有工具输出人设化

### 执行架构（安全优先）

```
用户请求工具
    ↓
权限检查（角色配置中定义了哪些工具可用）
    ↓
危险级别判断:
  安全级（web_search、read file）→ 直接执行
  确认级（write file、shell）→ 展示给用户审批后执行
  禁止级（不在允许列表）→ 拒绝并告知
    ↓
Docker Sandbox 执行（隔离）
    ↓
PersonaEngine 包装结果 → 输出
```

### 内置工具集

| 工具 | 危险级别 | 说明 |
|------|---------|------|
| `web_search` | 安全 | 搜索网页 |
| `file_read` | 安全 | 读取文件 |
| `screenshot` | 安全 | 截图理解 |
| `browser` | 确认 | 浏览器控制（Playwright） |
| `file_write` | 确认 | 写入文件 |
| `shell` | 确认 | 执行 Shell 命令（沙箱内） |
| `computer_use` | 确认 | 鼠标键盘控制 |

### Docker 沙箱设计

```yaml
# 工具执行沙箱
sandbox:
  image: kurisu-sandbox:latest
  volumes:
    - workspace:/workspace:rw   # 工作目录
  network: bridge               # 隔离网络
  resources:
    cpu: 0.5
    memory: 512m
  timeout: 30s
```

### 工具输出人设化（关键设计）

所有工具输出必须经过 Persona Engine 包装：

```typescript
async function executeTool(toolName: string, input: unknown) {
  const result = await toolRegistry.get(toolName).execute(input);
  return await personaEngine.wrapToolOutput({ result, toolName });
  // 例如: "哼，帮你查到了..." 或 "真是的，执行失败了..."
}
```

---

## L7 Skill System（统一插件层）

> 目标：角色能像 MCP 一样安装技能，知识注入和工具调用统一管理

### 两种插件类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **Knowledge Skill** | 知识注入 + Few-Shot 示例（纯静态） | steins-gate-lore, math-expert |
| **Tool Skill** | 仅 MCP 工具绑定（纯执行） | weather-api, github-tools |
| **Hybrid Skill** | 知识 + 工具（最常见） | coding-assistant, web-search |

### Skill 目录结构

```
config/skills/
├── coding-assistant/          # Hybrid: 知识 + 工具
│   ├── skill.yaml             # 元信息 + 触发规则 + 知识注入
│   └── mcp.json               # 绑定 MCP Server（可选）
├── steins-gate-lore/          # Knowledge only
│   └── skill.yaml
└── weather/                   # Tool only
    ├── skill.yaml
    └── mcp.json
```

### Skill 格式（skill.yaml）

```yaml
id: coding-assistant
name: 代码助手
version: "1.0"
type: hybrid                   # knowledge | tool | hybrid

# 意图触发（何时激活此 Skill）
trigger:
  keywords: ["代码", "报错", "debug", "函数", "bug"]
  intent: ["coding", "debugging", "code_review"]

# 知识注入（激活时注入 System Prompt，Knowledge/Hybrid 类型必填）
context: |
  用户在寻求编程帮助。保持 Kurisu 的傲娇风格但专业度不打折。
  擅长 TypeScript/Python，对低质量代码会毒舌但仍会认真解决。

# Few-Shot 对话示例
examples:
  - user: "这段代码有 bug"
    assistant: "哼，让我看看...你这里的类型推断完全错了，亏你还写得出来。"
  - user: "帮我优化一下"
    assistant: "真是的，这种基础问题还要我来...好吧，给你重构。"

# 绑定 MCP 工具（Tool/Hybrid 类型可选）
tools:
  mcp_config: ./mcp.json       # 指向 MCP Server 配置文件
```

### 请求处理流程（加入 Skill 激活）

```
用户消息: "帮我 debug 这段代码"
    ↓
L4 Agent: 意图检测
    ↓
Skill Registry: 匹配 [coding-assistant]
    ↓
Prompt 组装:
  [L3 核心人设] + [skill.context 知识注入] + [skill.examples Few-Shot]
  + [skill.tools 可用工具列表]
    ↓
LLM 生成回复 + 可能的工具调用
    ↓
L6 Tool Executor 执行工具（在沙箱内）
    ↓
L3 人设校验 → 输出
```

### 插件来源优先级

```
1. 内置 Skill（官方维护，config/skills/ 内置）
2. 自定义 skill.yaml（用户编写，role.yaml 中引用）
3. MCP Servers（纯工具类 Skill，直接绑定）
4. HTTP 工具（轻量 REST API，简单场景）
5. AstrBot 插件（Python 桥接，复杂场景，最后 fallback）
```

### Skill 管理 CLI（KURISU-017 实现）

```bash
kurisu skill list                    # 列出已安装 Skill
kurisu skill install coding-assistant  # 安装 Skill
kurisu skill remove weather          # 卸载 Skill
kurisu skill search "代码"           # 搜索 Skill Store
```

### 自进化流程（升级：工具 + 知识一起进化）

```
用户发出请求 → Agent 判断缺少哪个 Skill
    ↓
Skill 搜索（内置库 / Skill Store / MCP Registry）
    ↓
Skill 评估（知识覆盖度 + 工具安全性 + 匹配度）
    ↓
用户确认安装 → 下载 skill.yaml + 可选 mcp.json
    ↓
注册到 SkillRegistry → 下次同类请求自动激活
```

---

## L8 表现输出层（语音+视频）

> 目标：角色有专属声音和形象，可以语音对话和直播

### TTS 语音合成

```
文字响应
    ↓
情感分析（PersonaEngine 提供情绪标注）
    ↓
TTS 引擎选择:
  Phase A: Fish Audio API / ElevenLabs（预设角色音色）
  Phase B: XTTS-v2 本地（音色克隆，用户上传样本）
    ↓
流式音频输出（边生成边播放，降低首字节延迟）
```

### TTS 引擎路线

| 阶段 | 引擎 | 延迟 | 优势 |
|------|------|------|------|
| Phase A | Fish Audio API | ~1s | 中文支持好，有现成 Kurisu 音色 |
| Phase B | ElevenLabs | ~1.5s | 音色质量高 |
| Phase C | XTTS-v2 本地 | ~0.8s | 音色克隆，无费用 |

### Live2D 虚拟形象

```
语音输出
    ↓
口型同步（音素 → 口型参数）
情绪驱动（PersonaEngine 情绪 → 表情参数）
    ↓
Live2D 渲染（Web/Electron）
    ↓
OBS 虚拟摄像头（可直播）
```

### 实时语音对话架构

```
麦克风输入
    ↓
VAD（端点检测，识别说话起止）
    ↓
Whisper STT（本地，~200ms）
    ↓
L3 Persona Engine 处理
    ↓
LLM 生成回复（流式）
    ↓
TTS 流式合成（首字节 <500ms）
    ↓
扬声器播放 + Live2D 口型同步
```

目标端到端延迟：< 1.5s（接近 Neuro-sama 水平）

---

## L9 角色配置层（创建向导）

> 目标：用户创建角色 = 完整助手，零门槛

### 角色创建向导（5步）

```
Step 1: 人设配置
  ├── 基础信息（名字、年龄、职业）
  ├── 性格特征（傲娇/温柔/毒舌/理智...）
  ├── 说话习惯（口癖、常用语）
  └── 背景故事 + 对话示例上传

Step 2: 声音绑定 ⭐新增
  ├── 选择预设音色（Fish Audio 角色库）
  ├── 上传音色样本（自定义克隆，30s录音）
  └── 试听预览

Step 3: 形象绑定 ⭐新增
  ├── 上传头像（文字/Telegram 聊天用）
  ├── 选择 Live2D 模型（.model3.json）
  └── 自定义表情包预设

Step 4: 工具权限配置 ⭐新增
  ├── 勾选允许使用的工具类别
  ├── 危险操作（shell/写文件）是否每次确认
  └── 工具配额（每日调用次数上限）

Step 5: 接入平台
  ├── Telegram（即时通讯）
  ├── Discord（语音频道）
  ├── 本地 CLI（终端直接聊）
  └── 直播模式（OBS + 虚拟摄像头）
```

### 角色配置文件格式

```yaml
# config/personas/kurisu/role.yaml
id: kurisu
version: "2.0"
meta:
  name: "牧濑红莉栖"
  author: "kurisu-project"

persona:
  core: ./core.yaml
  personality: ./personality.yaml
  speech: ./speech.yaml
  lore: ./lore.yaml
  examples: ./examples/

voice:
  provider: fish-audio          # fish-audio | elevenlabs | xtts
  voice_id: "kurisu-v2"        # 预设音色 ID
  sample_path: null             # 自定义音色样本路径
  emotion_mapping:              # 情绪 → 语调参数
    happy: { speed: 1.1, pitch: 1.05 }
    angry: { speed: 1.2, pitch: 0.95 }
    shy:   { speed: 0.9, pitch: 1.1 }

avatar:
  type: live2d                  # live2d | image | none
  model_path: ./avatar/kurisu.model3.json
  expressions:
    default: idle
    happy: smile
    angry: pout

tools:
  allowed:
    - web_search
    - file_read
    - screenshot
    - browser
    - shell
  require_confirmation:
    - shell
    - file_write
    - computer_use

platforms:
  telegram:
    enabled: true
  discord:
    enabled: false
  local:
    enabled: true
```

---

## 模型策略

### 当前阶段：GLM-5 API 验证

| 模型 | 用途 |
|------|------|
| GLM-5 | 对话生成、代码、嵌入 |
| MiniMax-M2.5 | 推理决策 |
| Whisper large-v3 | 语音识别（本地） |
| Fish Audio / XTTS-v2 | 语音合成 |

### 模型演进路线

```
Phase 1: GLM-5 API + Fish Audio TTS（当前）
    ↓ 收集基准：人设遵循率、延迟、语音体验
Phase 2: Whisper 本地 STT + 实时语音对话
    ↓ 验证端到端延迟目标 <1.5s
Phase 3: XTTS-v2 本地 TTS + 音色克隆
    ↓ 实现角色专属声音，无 API 费用
Phase 4: LoRA 微调 Kurisu 人设
    ↓ 人设内化，减少工程兜底
Phase 5: 量化压缩 + 延迟优化（目标 <1s）
```

---

## Agent 架构

| Agent | 职责 | 占比 |
|-------|------|------|
| ConversationAgent | 日常对话 + 人设维护 | 65% |
| TaskAgent | 工具调用 + 任务执行 | 20% |
| SelfEvolutionAgent | 自主搜索/安装/使用插件 | 10% |
| VoiceAgent | 语音流处理 + TTS 调度 | 5% |

状态流转: `START → context_build → route → generate → validate → enforce → [tts] → END`

---

## 记忆系统

四层记忆：`SessionMemory(瞬时)` → `ShortTermMemory(短期)` → `LongTermMemory(长期)` → `SkillDatabase(技能)`

新增：**用户画像**（记住用户名字、偏好、习惯，让角色"认识"用户）

---

## 部署策略

### 启动方式（按场景选择）

```bash
# 场景1：仅文字对话（QQ Polling 模式，无需 Tunnel，最简单）
docker compose --profile qq up

# 场景2：Telegram Webhook 模式（需要公网 URL）
docker compose --profile tunnel up

# 场景3：两者都开
docker compose --profile tunnel --profile qq up

# 场景4：本地开发（不跑 Docker，直接 pnpm dev）
pnpm dev
```

### Webhook vs Polling

| 模式 | 适用场景 | 优缺点 |
|------|---------|--------|
| **Polling（轮询）** | 本地开发、QQ测试 | 无需公网 URL，延迟略高 (~1-2s) |
| **Webhook** | Telegram、生产环境 | 低延迟，但需要公网 URL |

> QQ（NapCat）默认用 HTTP 回调模式，Kurisu 主动拉取即可，**不需要 Tunnel**。
> Telegram 用 Webhook 模式，开发阶段需要 Cloudflare Tunnel。

### Cloudflare Tunnel 两种方式

```bash
# 方式1：Quick Tunnel（免费，每次重启 URL 变化，需重新注册 Webhook）
# 在 docker-compose 中设置 command: tunnel --no-autoupdate --url http://kurisu:3000
# 不需要 CLOUDFLARE_TUNNEL_TOKEN

# 方式2：Named Tunnel（免费，固定 URL，推荐）
# 1. 先在 Cloudflare Dashboard 创建 Named Tunnel，获取 Token
# 2. 在 .env 中设置 CLOUDFLARE_TUNNEL_TOKEN=xxx
# 3. docker compose --profile tunnel up
```

### 部署演进路线

| 阶段 | 方式 | 命令 | 触发时机 |
|------|------|------|----------|
| **当前** | 本地 + Named Tunnel（Telegram）| `docker compose --profile tunnel up` | 现在 |
| **QQ 测试** | 本地 + NapCat Polling | `docker compose --profile qq up` | 切换 QQ 后 |
| 语音支持后 | 增加 Whisper + TTS 容器 | — | Phase A 完成后 |
| 多人使用 | 云服务器（公网 IP，无需 Tunnel）| `docker compose up` | ~100 元/月 |
| 正式发布 | 完整 setup.sh + Control UI | — | 面向普通用户时 |

---

## 多平台接入 (KURISU-013)

### 当前状态

- ✅ Phase 0-2.2: Telegram 文字对话端到端测试通过
- 🔲 Phase 3: Telegram 语音消息支持（语音 → STT → 回复 → TTS）[下一步]
- 🔲 Phase 4: Discord 语音频道实时对话 [P1]
- 🔲 Phase 5: QQ Bot 接入 [P2]

---

## 开发规范

1. 先跑通最小闭环，再堆功能
2. 所有模块接口抽象，强依赖注入
3. TypeScript 严格类型，禁止 any
4. 核心模块先写测试，再写业务代码
5. 敏感信息禁止硬编码
6. **每次 git commit 后必须**：更新 PROGRESS.md → 保存记忆 → 执行 `/compact`

---

## 路线图（按用户体验优先）

### Phase A: 基础语音（P0，2-3周）

> 目标：用户能和角色语音对话

- [ ] Whisper STT 集成（本地，接收语音消息）
- [ ] Fish Audio TTS 集成（API，合成角色声音）
- [ ] Telegram 语音消息收发
- [ ] 流式 TTS（边生成边播放）
- [ ] 角色创建向导中的声音绑定步骤

### Phase B: 工具沙箱（P0，2-3周）

> 目标：角色能安全地搜索网页、操控电脑

- [ ] Docker 工具沙箱设计
- [ ] 工具权限分级（安全/确认/禁止）
- [ ] 内置工具：web_search, file_read, screenshot
- [ ] 内置工具：browser（Playwright）, shell（沙箱内）
- [ ] 工具输出人设化包装
- [ ] 角色创建向导中的工具权限配置步骤

### Phase C: 角色创建向导（P0，1-2周）

> 目标：用户创建角色 = 完整助手，零门槛

- [ ] 5步创建向导 CLI 版本
- [ ] role.yaml 角色配置格式定义
- [ ] 角色模板库（Kurisu 内置模板）
- [ ] 导入/导出功能

### Phase D: Persona Engine 2.0（P1，1-2周）

> 目标：对话真实感提升，接近 Neuro-sama

- [ ] 角色知识库 YAML 格式定义
- [ ] 10+ Kurisu 对话示例编写
- [ ] Few-Shot 注入机制
- [ ] 情感状态追踪（影响 TTS 语调）

### Phase E: 实时语音对话（P1，2-3周）

> 目标：端到端延迟 < 1.5s，实时语音交流

- [ ] WebSocket 实时音频流
- [ ] VAD 端点检测
- [ ] Discord 语音频道接入
- [ ] 首字节延迟优化

### Phase F: 虚拟形象（P2，3-4周）

> 目标：角色有 Live2D 形象，可以直播

- [ ] Live2D 渲染集成
- [ ] 口型同步（音素驱动）
- [ ] 表情情绪驱动
- [ ] OBS 虚拟摄像头输出

### Phase G: 自进化能力（P2，2-3周）

> 目标：角色自主学会新工具

- [ ] MCP Server 动态加载
- [ ] 工具搜索 Agent
- [ ] 工具安装 + 注册流程

### Phase H: 持续优化（持续）

- [ ] 音色克隆（XTTS-v2 本地）
- [ ] 100+ 对话示例库
- [ ] LoRA 微调实验
- [ ] 延迟优化（目标 <1s）

---

## 调研结论

### Neuro-sama（语音+对话质量参考）
- 自训练 2B 参数模型，q2_k 量化，非 GPT/Claude
- 核心优势：低延迟（本地推理 <1s）+ 人设深度内化（微调）+ **专属声音**
- 启示：语音是 Neuro-sama 体验的核心，必须优先实现

### OpenClaw（工具+部署体验参考）
- Docker Gateway + CLI + **Sandbox 三层架构**（安全隔离是重点）
- `docker-setup.sh` 一键部署
- 启示：工具必须在沙箱内执行，安全是前提

### AstrBot（插件生态参考）
- 16,716 stars，900+ 插件，15+ 平台，**MCP 支持**
- 插件是 Python，跨语言桥接有成本
- 启示：优先用 MCP Servers（TypeScript 原生），AstrBot 作为补充

---

## 参考资源

- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [OpenClaw Architecture](https://ppaolo.substack.com/p/openclaw-system-architecture-overview)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [Neuro-sama Wikipedia](https://en.wikipedia.org/wiki/Neuro-sama)
- [AstrBot GitHub](https://github.com/Soulter/AstrBot)
- [Fish Audio TTS](https://fish.audio)
- [XTTS-v2](https://github.com/coqui-ai/TTS)
- [Whisper](https://github.com/openai/whisper)
- [Live2D Cubism SDK](https://www.live2d.com/sdk/)
