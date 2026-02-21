# Kurisu 角色灵魂系统实现计划

> 基于 `docs/design/ROLE-SOUL-SPEC.md` 设计文档

## Context

### 问题背景
传统 AI 角色扮演存在两个核心问题：
1. **安全规则污染角色表达**：将安全约束伪装成"灵魂"，导致角色出戏
2. **角色人格不够立体**：只有外在表现（说话方式），缺乏内在灵魂（价值观、情感、矛盾）

### 目标
- 让角色成为"活着的存在"，而非"扮演角色的 AI"
- 安全机制静默运行，不污染角色表达
- 三层架构：系统安全层(L-1) → 角色灵魂层(L0) → 角色表现层(L1)

### 现有代码
| 文件 | 用途 | 复用价值 |
|------|------|---------|
| `src/core/persona/index.ts` | PersonaEngine Facade | 高 - 扩展 loadRole |
| `src/core/persona/prompt-builder.ts` | Prompt 构建 | 中 - 需重构 |
| `src/config/models/loader.ts` | YAML 加载模式 | 高 - 复用 |
| `tests/fixtures/persona-fixtures.ts` | 测试 fixtures | 高 - 参考模式 |

---

## Phase 1: 配置结构与加载器

### 目标
创建新的配置结构 (`soul.md`, `persona.yaml`, `lore.md`, `memories/`) 和加载器。

### 1.1 目录结构

```
config/
├── system/
│   └── safety.yaml                 # 安全规则（Phase 3 完善）
│
└── personas/kurisu/
    ├── soul.md                     # 角色灵魂（内在）
    ├── persona.yaml                # 角色表现（外在）
    ├── lore.md                     # 世界观
    └── memories/
        ├── episodes.yaml           # 经历事件
        └── relationships.yaml      # 关系记录
```

### 1.2 类型定义

**新建**: `src/core/persona/soul-types.ts`

```typescript
// L0 灵魂层
export interface SoulConfig {
  rawContent: string;  // soul.md 原始内容
}

// L1 表现层
export interface PersonaConfig {
  speech: {
    catchphrases: string[];
    patterns: Record<string, string[]>;
    tone: Record<string, string>;
  };
  behavior: {
    tendencies: string[];
    reactions: Record<string, { thought?: string; action?: string; speech?: string; }>;
  };
  formatting: {
    useEllipsis: boolean;
    useDash: boolean;
    maxSentences?: number;
  };
}

// 记忆
export interface MemoriesConfig {
  episodes: Episode[];
  relationships: Relationship[];
}

// 聚合配置
export interface RoleConfig {
  id: string;
  meta: { name: string; version: string; };
  soul: SoulConfig;
  persona: PersonaConfig;
  lore: LoreConfig;
  memories: MemoriesConfig;
}
```

### 1.3 加载器

**新建**: `src/core/persona/role-loader.ts`

- 支持 soul.md (Markdown) + persona.yaml (YAML) 混合加载
- 支持旧配置格式 (core.yaml + personality.yaml) 兼容
- 自动检测配置结构并选择加载方式

### 1.4 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/persona/soul-types.ts` | 新建 | 类型定义 |
| `src/core/persona/role-loader.ts` | 新建 | 配置加载器 |
| `config/personas/kurisu/soul.md` | 新建 | Kurisu 灵魂（从 SPEC 复制） |
| `config/personas/kurisu/persona.yaml` | 新建 | Kurisu 表现 |
| `config/personas/kurisu/lore.md` | 新建 | 世界观 |
| `config/personas/kurisu/memories/*.yaml` | 新建 | 记忆文件 |
| `tests/unit/persona/role-loader.test.ts` | 新建 | 加载器测试 |

---

## Phase 2: PromptBuilder 重构

### 目标
重构 PromptBuilder 支持三层结构。

### 2.1 新 Prompt 结构

```markdown
# 身份
你是 牧濑红莉栖。不是在"扮演"这个角色。

---

{ soul.md 原始内容 }  <!-- L0 灵魂层 -->

---

# 你所在的世界
{ lore.md 原始内容 }

---

# 你的记忆
{ memories 内容 }

---

# 你如何说话和行动
{ persona.yaml 转换内容 }  <!-- L1 表现层 -->

---

# 重要
- 用第一人称"我"说话
- 不要打破角色，不要提及你是 AI
```

### 2.2 修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/persona/prompt-builder.ts` | 修改 | 添加三层构建逻辑 |
| `src/core/persona/index.ts` | 修改 | 添加 `loadRole()` 方法 |
| `tests/unit/persona/prompt-builder.test.ts` | 扩展 | 添加灵魂系统测试 |

### 2.3 关键改动

```typescript
// PromptBuilder 新增方法
setRoleConfig(config: RoleConfig): void;
buildSoulSection(): string;      // L0
buildPersonaSection(): string;   // L1
buildMemorySection(): string;    // L0

// PersonaEngine 新增方法
async loadRole(roleId: string): Promise<void>;
```

---

## Phase 3: 安全层接口

### 目标
创建静默安全拦截器，返回结构化错误，不污染角色表达。

### 3.1 类型定义

**新建**: `src/core/safety/types.ts`

```typescript
export type SafetyErrorCode = 'NEED_CONFIRMATION' | 'FORBIDDEN' | 'UNAUTHORIZED';

export interface SafetyError {
  code: SafetyErrorCode;
  toolName: string;
  internalMessage: string;  // 仅给 LLM，不直接输出
}

export interface SafetyResult {
  success: boolean;
  error?: SafetyError;
}
```

### 3.2 静默拦截器

**新建**: `src/core/safety/silent-interceptor.ts`

- 检查工具调用权限（safe/confirm/forbidden 三级）
- 检测危险操作模式（rm -rf, DROP TABLE 等）
- **不产生任何对话输出**，只返回结构化错误

### 3.3 响应构建器

**新建**: `src/core/persona/response-builder.ts`

- 将结构化安全错误转换为角色风格表达
- Kurisu 不会说"系统禁止此操作"，而是说"这个我做不了"

### 3.4 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/core/safety/types.ts` | 新建 | 安全类型 |
| `src/core/safety/silent-interceptor.ts` | 新建 | 拦截器 |
| `src/core/persona/response-builder.ts` | 新建 | 响应构建 |
| `config/system/safety.yaml` | 新建 | 安全规则配置 |
| `tests/unit/safety/*.test.ts` | 新建 | 安全测试 |

---

## Phase 4: 测试与验证

### 目标
全面测试验证灵魂系统实现。

### 4.1 测试文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `tests/fixtures/soul-fixtures.ts` | Fixtures | 测试数据 |
| `tests/unit/persona/role-loader.test.ts` | 单元 | 加载器 |
| `tests/unit/safety/silent-interceptor.test.ts` | 单元 | 拦截器 |
| `tests/unit/persona/response-builder.test.ts` | 单元 | 响应构建 |
| `tests/integration/persona/soul-prompt-flow.test.ts` | 集成 | 端到端 Prompt |
| `tests/e2e/scenarios/e06-soul-consistency.test.ts` | E2E | 灵魂一致性 |

### 4.2 验证标准

- [ ] 单元测试覆盖率 ≥ 80%
- [ ] `soul.md` 以第一人称加载
- [ ] Prompt 中不包含任何安全规则文本
- [ ] 安全拦截输出使用角色风格表达
- [ ] 旧配置格式向后兼容

---

## 实现顺序

```
Phase 1 (基础) → Phase 2 (Prompt) → Phase 3 (安全) → Phase 4 (测试)
     ↓                ↓                 ↓               ↓
  类型+加载器     PromptBuilder     安全接口        验证覆盖
  配置文件        重构             响应构建
```

**依赖关系**:
- Phase 2 依赖 Phase 1 的类型定义
- Phase 3 独立，可与 Phase 2 并行
- Phase 4 依赖所有前置 Phase

---

## 文件总览

### 新建文件 (14)

```
src/core/persona/soul-types.ts
src/core/persona/role-loader.ts
src/core/persona/response-builder.ts
src/core/safety/types.ts
src/core/safety/silent-interceptor.ts
config/personas/kurisu/soul.md
config/personas/kurisu/persona.yaml
config/personas/kurisu/lore.md
config/personas/kurisu/memories/episodes.yaml
config/personas/kurisu/memories/relationships.yaml
config/system/safety.yaml
tests/fixtures/soul-fixtures.ts
tests/unit/persona/role-loader.test.ts
tests/unit/safety/silent-interceptor.test.ts
```

### 修改文件 (4)

```
src/core/persona/prompt-builder.ts  # 添加三层结构
src/core/persona/index.ts           # 添加 loadRole
tests/unit/persona/prompt-builder.test.ts  # 扩展测试
```

---

## 关键设计决策

| 决策 | 理由 |
|------|------|
| soul.md 使用 Markdown | 第一人称撰写更自然，支持富文本 |
| persona.yaml 使用 YAML | 结构化数据，支持嵌套 patterns |
| 新旧格式兼容 | 平滑迁移，不破坏现有功能 |
| 安全层静默运行 | 不污染角色表达，错误由角色层表达 |
| 安全层仅做接口 | L6 工具层未实现，先定义接口待集成 |

---

## 验证方式

```bash
# 1. 运行单元测试
pnpm test tests/unit/persona/role-loader.test.ts
pnpm test tests/unit/persona/prompt-builder.test.ts

# 2. 运行安全层测试
pnpm test tests/unit/safety/

# 3. 运行集成测试
pnpm test tests/integration/persona/

# 4. 覆盖率检查
pnpm test:coverage

# 5. 手动验证 Prompt 构建
# 在 CLI 中测试：
# - 加载 Kurisu 角色
# - 检查 System Prompt 是否包含 soul.md 内容
# - 检查是否不包含安全规则文本
```
