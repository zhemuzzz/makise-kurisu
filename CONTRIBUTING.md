# 开发规范

## 核心原则

1. **先跑通最小闭环，再堆功能**
2. **所有模块接口抽象，强依赖注入，禁止硬编码**
3. **TypeScript 严格类型，禁止 any**
4. **核心模块先写测试，再写业务代码**
5. **敏感信息禁止硬编码，禁止提交 Git**

## 代码规范

### 文件组织

- 高内聚，低耦合
- 200-400 行典型，800 行上限
- 按功能/领域组织，不按类型

### 不可变性

```typescript
// ❌ 错误：修改原对象
function update(user: User, name: string) {
  user.name = name;
  return user;
}

// ✅ 正确：返回新对象
function update(user: User, name: string): User {
  return { ...user, name };
}
```

### 错误处理

- 每一层都显式处理错误
- UI 层提供用户友好的错误信息
- 服务端记录详细的错误上下文
- 永远不要静默吞掉错误

### 输入验证

- 在系统边界验证所有用户输入
- 使用 schema-based 验证
- 快速失败，提供清晰的错误信息
- 永远不要信任外部数据

## 测试规范

### 最低覆盖率：80%

### 测试类型（全部必需）

1. **单元测试** - 单个函数、工具、组件
2. **集成测试** - API 端点、数据库操作
3. **E2E 测试** - 关键用户流程

### TDD 工作流

1. 先写测试 (RED)
2. 运行测试 - 应该失败
3. 写最小实现 (GREEN)
4. 运行测试 - 应该通过
5. 重构 (IMPROVE)
6. 验证覆盖率 (80%+)

## Git 工作流

### 提交格式

```
<type>: <description>

<optional body>
```

类型：feat, fix, refactor, docs, test, chore, perf, ci

### 功能开发流程

1. 使用 planner agent 创建实现计划
2. 使用 tdd-guide agent 进行 TDD 开发
3. 使用 code-reviewer agent 进行代码审查
4. 提交前确保所有测试通过

## 安全清单

提交前必须检查：

- [ ] 无硬编码密钥（API key、密码、token）
- [ ] 所有用户输入已验证
- [ ] SQL 注入防护（参数化查询）
- [ ] XSS 防护（HTML 转义）
- [ ] CSRF 保护已启用
- [ ] 认证/授权已验证
- [ ] 错误信息不泄露敏感数据

## 项目结构

```
kurisu/
├── src/
│   ├── core/        # 人设引擎、模型配置化
│   ├── agents/      # Agent 实现
│   ├── memory/      # 记忆系统
│   ├── gateway/     # 交互网关
│   └── config/      # 配置管理
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
└── .claude/         # Claude Code 配置
```

## 可用命令

| 命令 | 用途 |
|------|------|
| `/plan` | 创建实现计划 |
| `/tdd` | TDD 开发工作流 |
| `/code-review` | 代码审查 |
| `/verify` | 验证构建和测试 |
| `/test-coverage` | 检查测试覆盖率 |

## 依赖管理

- 定期更新依赖
- 审查新依赖的安全性
- 锁定版本号（package-lock.json）
- 移除未使用的依赖
