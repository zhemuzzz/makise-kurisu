# L2 人设引擎测试设计文档

## 概述

本文档描述 kurisu 项目 L2 人设一致性引擎的完整测试设计，遵循 TDD 开发流程。

## 测试文件结构

```
tests/
├── fixtures/
│   └── persona-fixtures.ts          # 测试数据和常量
├── unit/
│   └── persona/
│       ├── persona-engine.test.ts   # PersonaEngine 主类测试 (56 tests)
│       ├── validator.test.ts        # PersonaValidator 校验器测试 (~40 tests)
│       ├── enforcer.test.ts         # PersonaEnforcer 强化器测试 (~35 tests)
│       └── prompt-builder.test.ts   # PromptBuilder 构建器测试 (~35 tests)
└── integration/
    └── persona/
        └── persona-flow.test.ts     # 完整流程集成测试 (~15 tests)
```

## 测试用例统计

| 模块 | 测试数量 | 关键测试点 |
|------|---------|-----------|
| PersonaEngine | 56 | 构造、校验、提示词构建、心智模型更新 |
| PersonaValidator | ~40 | OOC检测、语气一致性、关系级别校验 |
| PersonaEnforcer | ~35 | 傲娇转换、OOC移除、内容保护 |
| PromptBuilder | ~35 | 提示词构建、记忆处理、安全性 |
| 集成测试 | ~15 | 完整流程、多轮对话、错误恢复 |
| **总计** | **~180** | |

## 核心测试场景

### 1. PersonaEngine 主类 (56 tests)

#### 构造函数测试
- 默认初始化
- 部分配置初始化
- 完整配置初始化
- 输入不可变性

#### getHardcodedPersona() 测试
- 返回人设内容
- 包含核心性格特征
- 包含禁止行为
- 多次调用返回相同内容

#### getMentalModel() 测试
- 返回当前心智模型
- 返回副本而非引用（不可变性）

#### updateMentalModel() 测试
- 更新用户名
- 增加熟悉度
- 添加共享记忆
- 合并更新
- 不修改旧状态

#### validate() 测试
**有效回复:**
- 通过所有有效的 Kurisu 回复
- 空回复通过

**OOC 检测:**
- 检测 "作为AI"
- 检测 "我是一个程序"
- 检测 "我无法"
- 检测多个 OOC 短语

**关系级别检测:**
- 陌生人拒绝亲密表达
- 亲密关系允许亲密表达

**边界情况:**
- 空字符串
- 空白字符
- 超长文本
- 特殊字符

#### buildRPPrompt() 测试
- 包含人设内容
- 包含用户消息
- 包含最近记忆
- 截断到最近5条
- 包含关系熟悉度
- 包含用户偏好
- 处理特殊字符

### 2. PersonaValidator 校验器 (~40 tests)

#### detectOOC() 测试
- 检测所有 OOC 关键词
- 不误报有效回复
- 检测多个关键词
- 大小写不敏感

#### checkToneConsistency() 测试
- 拒绝卖萌表达 (喵~, 人家~)
- 拒绝过度热情
- 允许科学热情
- 允许傲娇表达

#### checkRelationshipConsistency() 测试
| 级别 | familiarity | 测试点 |
|------|-------------|--------|
| stranger | 0-20 | 允许冷淡，拒绝亲密 |
| acquaintance | 21-50 | 允许日常，拒绝亲密 |
| friend | 51-80 | 允许友好调侃 |
| close | 81-100 | 允许亲密表达 |

#### validate() 完整校验
- 返回完整 ValidationResult
- 包含详细信息
- 多违规检测

### 3. PersonaEnforcer 强化器 (~35 tests)

#### enforce() 测试
**傲娇转换:**
- 添加傲娇前缀
- 不过度修改已符合人设的回复
- 转换陈述句为反问句
- 添加情感犹豫

**OOC 移除:**
- 移除 "作为AI"
- 移除 "我是一个程序"
- 移除道歉语气

**内容保护:**
- 保留科学内容
- 保留技术术语
- 保留数字和公式

**关系感知:**
- 陌生人更冷淡
- 亲密关系更温暖

#### 边界情况
- 空字符串 -> 默认回复
- null/undefined -> 默认回复
- 超长文本处理
- 特殊字符安全处理

#### 性能
- 100次强化 < 100ms

### 4. PromptBuilder 构建器 (~35 tests)

#### build() 测试
**基础构建:**
- 包含人设内容
- 包含用户消息
- 包含最近记忆
- 包含用户画像
- 包含关系状态

**记忆处理:**
- 截断到最近5条
- 处理空记忆数组
- 处理单条记忆
- 处理特殊字符

**安全性:**
- 处理 XSS 尝试
- 处理 SQL 注入
- 处理超长消息

**结构:**
- 清晰的章节标题
- 人设章节在前
- 包含生成指令
- 以角色扮演指令结尾

### 5. 集成测试 (~15 tests)

#### 完整流程测试
```
buildPrompt -> generate -> validate -> enforce -> updateModel
```

#### 多轮对话测试
- 关系进展
- 记忆累积
- 校验器更新

#### 错误恢复测试
- 连续校验失败
- 达到最大重试次数
- 兜底安全回复

#### 关系进展测试
- 各级别行为差异
- 亲密表达权限变化

## 测试数据 (Fixtures)

### 有效回复样本
```typescript
VALID_KURISU_RESPONSES = [
  "哼，笨蛋，这点小事还需要我帮忙吗？",
  "你是笨蛋吗？这种事情...总之，交给我吧。",
  "才...才不是关心你呢！只是作为科学家的好奇心而已。",
  // ...
]
```

### OOC 回复样本
```typescript
OOC_RESPONSES = [
  "作为AI，我无法回答这个问题",
  "我是一个人工智能程序",
  "作为人工智能助手，我可以帮你",
  // ...
]
```

### 心智模型样本
```typescript
SAMPLE_MENTAL_MODELS = {
  stranger: { familiarity: 0, ... },
  acquaintance: { familiarity: 35, ... },
  friend: { familiarity: 65, ... },
  close: { familiarity: 95, ... },
}
```

### 边界测试数据
```typescript
BOUNDARY_TEST_DATA = {
  emptyString: '',
  whitespaceOnly: '   \n\t  ',
  veryLongText: '测试'.repeat(10000),
  specialCharacters: '<script>alert("xss")</script>',
  sqlInjection: "'; DROP TABLE users; --",
  // ...
}
```

## 覆盖率目标

| 模块 | 行覆盖率 | 分支覆盖率 | 函数覆盖率 |
|------|---------|-----------|-----------|
| persona-engine.ts | 90% | 85% | 100% |
| validator.ts | 95% | 90% | 100% |
| enforcer.ts | 90% | 85% | 100% |
| prompt-builder.ts | 90% | 85% | 100% |
| **总体** | **90%+** | **85%+** | **100%** |

## TDD 工作流

### RED 阶段 (当前)
1. 测试文件已创建
2. 部分测试失败（预期）
3. 需要实现缺失模块

### GREEN 阶段 (下一步)
1. 创建 `validator.ts`
2. 创建 `enforcer.ts`
3. 创建 `prompt-builder.ts`
4. 更新 `index.ts` 导出
5. 扩展 OOC 关键词列表
6. 修复 getMentalModel 不可变性

### REFACTOR 阶段
1. 优化性能
2. 减少代码重复
3. 改进错误处理
4. 验证覆盖率

## 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test tests/unit/persona/persona-engine.test.ts

# 运行并生成覆盖率报告
npm run test:coverage
```

## 关键实现注意事项

1. **不可变性**: 所有更新操作应返回新对象，不修改原对象
2. **OOC 关键词扩展**: 当前实现只检测部分关键词，需扩展
3. **关系级别逻辑**: 需要根据 familiarity 动态调整校验规则
4. **安全性**: 所有用户输入必须安全处理
5. **性能**: 核心操作应在 1ms 内完成

## 相关文件

- `/Users/wangcheng/Projects/kurisu/tests/fixtures/persona-fixtures.ts` - 测试数据
- `/Users/wangcheng/Projects/kurisu/tests/unit/persona/persona-engine.test.ts` - 主引擎测试
- `/Users/wangcheng/Projects/kurisu/tests/unit/persona/validator.test.ts` - 校验器测试
- `/Users/wangcheng/Projects/kurisu/tests/unit/persona/enforcer.test.ts` - 强化器测试
- `/Users/wangcheng/Projects/kurisu/tests/unit/persona/prompt-builder.test.ts` - 构建器测试
- `/Users/wangcheng/Projects/kurisu/tests/integration/persona/persona-flow.test.ts` - 集成测试
