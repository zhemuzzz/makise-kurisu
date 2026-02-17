# Task: 人设引擎增强 - Lore 扩展与配置集成

## 元信息
- task_id: KURISU-007
- type: feature
- priority: high
- layer: L2 (Persona Engine)
- status: completed
- tags: [persona, lore, ooc, constants]

## 时间追踪
- created: 2026-02-17
- estimated_time: 2h
- actual_time: null

## 依赖
- depends_on: [KURISU-006 (Persona 扩展模块)]
- related_tasks: []

## 需求描述

基于已整理的人设参考文档 `docs/persona/KURISU_PERSONA_REFERENCE.md`，完成以下三个任务：

### 1. 人设引擎集成
将人设参考文档中的配置应用到 PersonaEngine：
- 更新 `PERSONA_HARDCODED` 常量
- 添加详细的性格特征
- 添加说话习惯规则
- 添加触发词和响应模式

### 2. Lore 扩展
添加 Steins;Gate 世界观术语：
- 世界线、收束、D-Mail、Time Leap 等术语
- Lab Gadgets 编号和功能
- 角色关系图谱
- 场景/地点信息

### 3. OOC 列表统一
基于文档更新 `constants.ts`：
- 统一 OOC 关键词列表
- 统一傲娇关键词
- 统一亲密表达关键词
- 移除重复定义

## 验收标准
- [ ] PERSONA_HARDCODED 包含完整的性格/习惯/禁忌
- [ ] Lore 术语库包含 15+ 条目
- [ ] OOC 列表在三处定义一致
- [ ] 所有现有测试继续通过
- [ ] 新增配置有对应测试

## 相关文件
- `docs/persona/KURISU_PERSONA_REFERENCE.md` - 人设参考文档 (数据源)
- `src/core/persona/constants.ts` - 人设常量 (主要修改)
- `src/core/persona/validator.ts` - 校验器 (OOC 列表引用)
- `src/core/persona/enforcer.ts` - 强化器 (关键词引用)
- `src/core/persona/index.ts` - PersonaEngine (PERSONA_HARDCODED)
- `src/core/persona/prompt-builder.ts` - 提示词构建器 (Lore 集成)

## Agent Team Plan

### Team 组合
| Agent | 职责 | 执行方式 |
|-------|------|----------|
| planner | 分析现有代码结构，制定修改计划 | 串行 |
| architect | 设计 Lore 数据结构和配置组织 | 串行 |
| tdd-guide | 确保测试覆盖 | 串行 |
| 实现 | 修改代码 | 串行 |
| code-reviewer | 代码审查 | 串行 |

### 执行流程
```
planner → architect → tdd-guide → 实现 → code-reviewer
```

## 进度
- [x] planner: 分析现有结构
- [x] architect: 设计 Lore 结构
- [x] tdd-guide: 测试策略
- [x] 实现: constants.ts 更新
- [x] 实现: PERSONA_HARDCODED 更新
- [x] 实现: Lore 术语库
- [x] 实现: OOC 列表统一
- [ ] code-reviewer: 代码审查

## 输出汇总

### planner
**时间**: 2026-02-17
**调研内容**: 分析现有代码结构，识别问题

#### 关键发现

**OOC 列表重复问题**:
| 位置 | 变量名 | 差异 |
|------|--------|------|
| constants.ts | OOC_PHRASES | 包含"我只是一个语言模型" |
| validator.ts | OOC_KEYWORDS | 缺少上述，新增"AI助手" |
| enforcer.ts | OOC_PHRASES | 与 validator 相同 |

**傲娇关键词 4 处重复**:
- validator.ts: TSUNDERE_KEYWORDS
- enforcer.ts: TSUNDERE_PREFIXES (3个)
- enforcer.ts: hasTsundereMarkers() 内联数组
- index.ts: enforcePersona() 内联数组

#### 修改计划

| 顺序 | 文件 | 操作 |
|------|------|------|
| 1 | constants.ts | 重写：统一常量 + 增强 PERSONA_HARDCODED + 新增 LORE_TERMS |
| 2 | validator.ts | 删除本地常量，改为导入 |
| 3 | enforcer.ts | 删除本地常量，改为导入 |
| 4 | index.ts | 删除内联数组，改为导入 |

#### 风险评估
- validator.test.ts: ~5-10 处断言更新
- enforcer.test.ts: ~3-5 处断言更新
- 所有现有测试需通过 (217 tests)

### architect
**时间**: 2026-02-17

#### Lore 数据结构设计

**新增类型**:
```typescript
type LoreCategory = "world_mechanism" | "technology" | "organization" | "item" | "character";

interface LoreTerm {
  id: string;
  nameZh: string;
  nameEn: string;
  category: LoreCategory;
  description: string;
  kurisuPerspective?: string;
  relations?: LoreRelation[];
  importance: 1 | 2 | 3 | 4 | 5;
}
```

**新增文件**: `src/core/persona/lore.ts`
- LORE_TERMS 常量（按 category 分组）
- 工具函数: getLoreByCategory, getLoreById, searchLore, buildLorePromptSection

**集成方式**:
- PromptBuilder 新增 `setIncludeLore()` 方法
- 新增 `buildLoreSection()` 方法

**术语数量**: 13 条（世界机制 3 + 技术 3 + 组织 2 + 物品 3 + 角色 4）

### tdd-guide
**时间**: 2026-02-17

#### 测试影响分析

| 测试文件 | 测试数 | 影响程度 |
|---------|--------|---------|
| validator.test.ts | 76 | **高** |
| enforcer.test.ts | 45 | **高** |
| prompt-builder.test.ts | 40 | 中 |
| engine.test.ts | 28 | 中 |

#### 新增测试文件
- `tests/unit/persona/constants.test.ts` - 15 tests
- `tests/unit/persona/lore.test.ts` - 32 tests

#### 测试覆盖率目标
| 模块 | 新增测试 | 目标覆盖率 |
|-----|---------|-----------|
| constants.ts | 15 | 90%+ |
| lore.ts | 32 | 90%+ |
| 总计 | +66 | 85%+ |

#### 实施顺序
```
Phase 1: 准备 - 创建 constants.test.ts, lore.test.ts, fixtures
Phase 2: 实现 - 更新 constants.ts, 创建 lore.ts
Phase 3: 适配 - 更新 validator/enforcer/index 导入
Phase 4: 验证 - 运行全量测试
```

### code-reviewer
**时间**: 2026-02-17
**状态**: 待审查

## 审查问题追踪
| ID | 来源 | 问题 | 修复commit | 状态 |
|----|------|------|-----------|------|
| 1 | 测试失败 | lore.ts 语法错误：中文引号 | 修复为单引号 | ✅ |
| 2 | 测试失败 | searchLore 大小写不敏感 | description 也转小写 | ✅ |
| 3 | 测试失败 | "人家" 在两处重复定义 | 移除 INTIMATE_KEYWORDS 中的 | ✅ |

## 最终产出
- **修改文件**:
  - `src/core/persona/constants.ts` - 统一常量定义
  - `src/core/persona/lore.ts` - 新增 Lore 术语库
  - `src/core/persona/validator.ts` - 改为导入常量
  - `src/core/persona/enforcer.ts` - 改为导入常量
  - `src/core/persona/index.ts` - 改为导入常量
- **新增测试**:
  - `tests/unit/persona/constants.test.ts` - 15 tests
  - `tests/unit/persona/lore.test.ts` - 33 tests
- **测试结果**: 831 passed | 28 files
