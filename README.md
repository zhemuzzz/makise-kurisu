# Makise Kurisu

> 拟人化 AI 角色助手 — 创建角色，获得能聊天、用工具的个人助手

## 项目定位

用户创建一个角色（定义灵魂、人设、世界观），即可获得：

- **真实对话** — 角色有情绪、记忆、成长，不是机器式应答
- **工具能力** — 搜索、写代码、操控文件，通过 MCP 插件扩展
- **多平台接入** — Telegram、QQ 文字对话

## 架构

Agent-Platform 二层架构：

```
Agent（自主实体）
  ├── Identity（soul.md + persona.yaml）
  ├── Meta-tools（任务管理、技能调度、子代理）
  └── ReAct Loop（思考-行动循环）

Platform（共享基础设施）
  ├── Foundation — ConfigManager, RoleDataStore, TracingService
  ├── Core — PermissionService, ContextManager
  ├── Domain — SkillManager, KnowledgeStore, SubAgentManager
  ├── Gateway — Telegram / QQ 多渠道接入
  └── Background — Scheduler, EventBus
```

核心原则：Agent 决策，Platform 执行。

## 目录结构

```
src/
├── agent/        # Agent Core — Pipeline + ReAct 循环 + 元工具
├── platform/     # Platform Services — 全部基础设施
├── inner-life/   # Inner Life Engine — 情绪/心境/关系/成长
└── evolution/    # 自进化（预留）

config/
├── personas/     # 角色配置（soul.md, persona.yaml, lore.md, memories/）
├── skills/       # 内置技能（file-tools, git-tools, web-search）
└── system/       # 系统配置（platform.yaml, permissions.yaml, safety.yaml）
```

## 技术栈

| 模块 | 选型 |
|------|------|
| 语言 | TypeScript (strict) |
| 运行时 | Node.js |
| 测试 | Vitest |
| 存储 | SQLite (better-sqlite3) + Qdrant (向量) |
| 插件 | MCP SDK |
| 容器 | Docker + Docker Compose |
| 配置 | YAML + Zod schema |

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API Key

# 启动开发模式
pnpm dev
```

### 部署

```bash
# QQ 文字对话（无需公网）
docker compose --profile qq up

# Telegram Webhook（需要公网 URL）
docker compose --profile tunnel up

# 两者都开
docker compose --profile tunnel --profile qq up
```

## 角色配置

每个角色由以下文件定义：

```
config/personas/<role-id>/
├── soul.md              # 角色灵魂（"我是谁"，第一人称）
├── persona.yaml         # 角色表现（说话方式、行为模式）
├── lore.md              # 世界观（角色所在的世界）
└── memories/            # 记忆（经历、关系）
    ├── episodes.yaml
    └── relationships.yaml
```

详见 [角色灵魂系统规范](docs/design/ROLE-SOUL-SPEC.md)。

## License

MIT
