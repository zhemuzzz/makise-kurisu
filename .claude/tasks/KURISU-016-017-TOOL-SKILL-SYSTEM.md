# KURISU-016+017: 工具执行层 + Skill System

> **优先级**: P0
> **状态**: 计划中
> **创建**: 2026-02-22
> **目标**: 让 Kurisu 能自主搜索、使用工具，达到"想用什么就能用什么"

---

## 一、目标体验

```
用户: "帮我查一下今天东京的天气"
Kurisu: 等一下...
       [使用 web_search 工具]
       东京今天 18°C，多云。出门带件外套。

用户: "这个文件里有什么内容"
Kurisu: 查一下。
       [使用 file_read 工具]
       这个文件是你的配置文件，里面有...

用户: "帮我运行这个脚本"
Kurisu: 你确定要运行？可能会修改文件。
用户: "确认"
Kurisu: [在沙箱中执行]
       执行完了。输出是这样...
```

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Kurisu L6+L7 工具层                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  L7 Skill System (统一插件层)                               │
│  ├── Knowledge Skill (知识注入)                             │
│  ├── Tool Skill (MCP 工具绑定)                              │
│  └── Hybrid Skill (知识 + 工具)                             │
│  ├── SkillRegistry (技能注册表)                             │
│  └── IntentMatcher (意图匹配)                               │
│                                                             │
│  ↓ (可用工具列表)                                            │
│                                                             │
│  L6 Tool Execution Layer                                   │
│  ├── PermissionChecker (三级权限)                           │
│  │   ├── safe: 直接执行                                     │
│  │   ├── confirm: 用户审批后执行                            │
│  │   └── deny: 拒绝                                         │
│  ├── MCPBridge (MCP 客户端池)                               │
│  ├── DockerSandbox (沙箱执行)                               │
│  ├── ApprovalManager (审批状态管理)                         │
│  └── PersonaWrapper (人设化包装)                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 LangGraph 工作流改造

**现有流程**:
```
START → context_build → route → generate → validate → enforce → END
```

**新增流程** (ReAct 循环):
```
START → context_build → route → skill_activate → generate
                                          ↑          ↓
                                          │    [有工具调用?]
                                          │          ↓
                                          │    tool_call
                                          │          ↓
                                          │    [需要审批?]
                                          │     ↓      ↓
                                          │  [等审批]  [执行]
                                          │     ↓      ↓
                                          └─────┴──────┘
                                                    ↓
                                              validate → enforce → END
```

### 2.3 权限分级

| 级别 | 工具示例 | 执行方式 | 用户交互 |
|------|---------|---------|----------|
| **safe** | web_search, file_read, fetch, time | 直接执行 | 无 |
| **confirm** | shell, file_write, browser | 沙箱执行 | 发消息等待用户回复 |
| **deny** | 不在允许列表 | 拒绝 | 返回错误给 LLM |

### 2.4 审批 UX

```
Kurisu: 你让我执行 `rm -rf /data`，这会删除数据。确定要继续吗？
        回复「确认」继续，回复「取消」放弃。

用户: 确认
Kurisu: 好，执行了。
        [沙箱中执行]

用户: 取消
Kurisu: 好吧，取消了。
```

---

## 三、文件结构

```
src/
├── tools/                      # L6 工具执行层 (新建)
│   ├── types.ts               # ToolDef, ToolResult, PermissionLevel
│   ├── registry.ts            # ToolRegistry
│   ├── permission.ts          # PermissionChecker
│   ├── mcp-bridge.ts          # MCP 客户端连接池
│   ├── sandbox.ts             # Docker 沙箱执行器
│   ├── approval.ts            # ApprovalManager (审批状态)
│   ├── persona-wrapper.ts     # 工具输出人设化包装
│   ├── executor.ts            # ToolExecutor (主入口)
│   └── index.ts
│
├── skills/                     # L7 Skill System (新建)
│   ├── types.ts               # SkillConfig, TriggerRule
│   ├── registry.ts            # SkillRegistry
│   ├── loader.ts              # skill.yaml + mcp.json 解析
│   ├── intent-matcher.ts      # 意图匹配
│   ├── knowledge-injector.ts  # 知识注入到 Prompt
│   └── index.ts
│
├── agents/                     # L4 Agent 编排 (修改)
│   ├── types.ts               # 添加工具相关状态字段
│   ├── state.ts               # 添加工具相关 channels
│   ├── workflow.ts            # 添加 skill_activate, tool_call 节点
│   ├── routers/
│   │   └── tool-router.ts     # 工具调用路由
│   └── nodes/
│       ├── skill-activate.ts  # Skill 激活节点 (新建)
│       ├── tool-call.ts       # 工具调用节点 (新建)
│       └── generate.ts        # 修改: 支持 tools 参数
│
├── config/models/
│   └── types.ts               # 添加 ToolDefinition, ToolCall 类型
│
└── core/persona/
    └── index.ts               # 添加 wrapToolOutput() 方法

config/
├── skills/                     # 内置 Skills (新建)
│   ├── web-search/
│   │   ├── skill.yaml         # 知识 + 触发词
│   │   └── mcp.json           # 绑定 MCP fetch server
│   ├── file-tools/
│   │   ├── skill.yaml
│   │   └── mcp.json           # 绑定 MCP filesystem server
│   └── time/
│       ├── skill.yaml
│       └── mcp.json           # 绑定 MCP time server
│
└── system/
    ├── sandbox.yaml           # Docker 沙箱配置 (新建)
    └── tools.yaml             # 工具权限配置 (新建)
```

---

## 四、核心类型定义

### 4.1 工具类型 (src/tools/types.ts)

```typescript
/** 工具定义 */
export interface ToolDef {
  readonly name: string;              // 工具名，如 "web_search"
  readonly description: string;       // 描述，给 LLM 看
  readonly inputSchema: JSONSchema;   // 输入参数 Schema
  readonly permission: PermissionLevel;
  readonly source: ToolSource;
}

/** 权限级别 */
export type PermissionLevel = 'safe' | 'confirm' | 'deny';

/** 工具来源 */
export interface ToolSource {
  readonly type: 'mcp' | 'native' | 'http';
  readonly serverName?: string;       // MCP server 名称
  readonly endpoint?: string;         // HTTP endpoint
}

/** 工具调用请求 */
export interface ToolCall {
  readonly id: string;                // 调用 ID
  readonly name: string;              // 工具名
  readonly arguments: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResult {
  readonly callId: string;
  readonly toolName: string;
  readonly success: boolean;
  readonly output: unknown;
  readonly error?: string;
  readonly latency: number;
  readonly approvalRequired?: boolean;
  readonly approvalStatus?: 'pending' | 'approved' | 'rejected';
}
```

### 4.2 Skill 类型 (src/skills/types.ts)

```typescript
/** Skill 配置 */
export interface SkillConfig {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: 'knowledge' | 'tool' | 'hybrid';

  /** 触发规则 */
  readonly trigger: {
    readonly keywords?: string[];
    readonly intent?: string[];
  };

  /** 知识注入 (激活时加入 System Prompt) */
  readonly context?: string;

  /** Few-Shot 示例 */
  readonly examples?: Array<{
    readonly user: string;
    readonly assistant: string;
  }>;

  /** 绑定的 MCP 工具 */
  readonly tools?: {
    readonly mcpConfig: string;  // mcp.json 路径
  };
}

/** Skill 实例 (运行时) */
export interface SkillInstance {
  readonly config: SkillConfig;
  readonly toolDefs: ToolDef[];      // 可用工具定义
  readonly mcpClient?: MCPClient;    // MCP 连接
}
```

### 4.3 Agent 状态扩展 (src/agents/types.ts)

```typescript
export interface AgentState {
  // ... 现有字段 ...

  // === 工具相关 (新增) ===
  /** 激活的 Skills */
  readonly activeSkills: readonly string[];

  /** 可用工具定义 (来自激活的 Skills) */
  readonly availableTools: readonly ToolDef[];

  /** 待执行的工具调用 (LLM 返回的) */
  readonly pendingToolCalls: readonly ToolCall[];

  /** 工具执行结果 */
  readonly toolResults: readonly ToolResult[];

  /** 工具调用迭代次数 (防止无限循环) */
  readonly toolCallIteration: number;

  /** 审批状态 */
  readonly approvalState: ApprovalState | null;
}

export interface ApprovalState {
  readonly toolCall: ToolCall;
  readonly message: string;        // 发送给用户的审批消息
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly createdAt: number;
}
```

---

## 五、实现分阶段

### Phase 1: 基础设施 (3-4 天)

**目标**: 建立工具类型系统 + LangGraph 工作流改造

| 任务 | 文件 | 说明 |
|------|------|------|
| 1.1 工具类型定义 | `src/tools/types.ts` | ToolDef, ToolResult, PermissionLevel |
| 1.2 Skill 类型定义 | `src/skills/types.ts` | SkillConfig, TriggerRule |
| 1.3 扩展 AgentState | `src/agents/types.ts` | 添加工具相关字段 |
| 1.4 扩展 StateChannels | `src/agents/state.ts` | 添加工具相关 channels |
| 1.5 创建 skill_activate 节点 | `src/agents/nodes/skill-activate.ts` | Skill 激活 |
| 1.6 修改 workflow | `src/agents/workflow.ts` | 添加 skill_activate 节点 |

**验证**: 单元测试通过

### Phase 2: MCP 集成 (3-4 天)

**目标**: 连接 MCP Servers，实现工具调用

| 任务 | 文件 | 说明 |
|------|------|------|
| 2.1 安装 MCP SDK | `package.json` | `@modelcontextprotocol/sdk` |
| 2.2 MCPBridge 实现 | `src/tools/mcp-bridge.ts` | MCP 客户端池 |
| 2.3 ToolRegistry 实现 | `src/tools/registry.ts` | 工具注册表 |
| 2.4 PermissionChecker 实现 | `src/tools/permission.ts` | 权限检查 |
| 2.5 ToolExecutor 实现 | `src/tools/executor.ts` | 工具执行入口 |
| 2.6 创建 tool_call 节点 | `src/agents/nodes/tool-call.ts` | 工具调用节点 |
| 2.7 修改 generate 节点 | `src/agents/nodes/generate.ts` | 支持 tools 参数 |
| 2.8 修改 workflow | `src/agents/workflow.ts` | 添加 ReAct 循环 |

**验证**: 能调用 MCP fetch 工具获取网页

### Phase 3: Docker 沙箱 (2-3 天) ✅ 完成 (2026-02-22)

**目标**: confirm 级工具在沙箱中执行

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 3.1 Dockerfile.sandbox | `Dockerfile.sandbox` | 沙箱镜像 | ✅ |
| 3.2 SandboxExecutor 实现 | `src/tools/sandbox.ts` | Docker 执行器 | ✅ |
| 3.3 沙箱配置 | `config/system/sandbox.yaml` | 资源限制配置 | ✅ |
| 3.4 单元测试 | `tests/tools/sandbox.test.ts` | 10 tests | ✅ |
| 3.5 ToolRegistry 集成 | `src/tools/registry.ts` | execute 方法支持沙箱 | ✅ |

**验证**: ✅ shell 命令在沙箱中执行（架构就绪，需 Docker 环境）

### Phase 4: 审批流程 (2 天) ✅ 完成 (2026-02-22)

**目标**: confirm 级工具需要用户审批

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 4.1 ApprovalManager 实现 | `src/tools/approval.ts` | 审批状态管理 | ✅ |
| 4.2 修改 tool_call 节点 | `src/agents/nodes/tool-call.ts` | 检查审批状态 | ✅ |
| 4.3 类型扩展 | `src/agents/types.ts`, `src/gateway/types.ts` | AgentResult/StreamResult 添加审批字段 | ✅ |
| 4.4 Gateway 集成 | `src/gateway/index.ts` | ApprovalManager 依赖注入 | ✅ |
| 4.5 Orchestrator 暴露审批 | `src/agents/orchestrator.ts` | process() 返回审批状态 | ✅ |
| 4.6 TelegramChannel 审批 | `src/gateway/channels/telegram.ts` | checkApprovalReply + executeApprovedTool | ✅ |
| 4.7 QQChannel 审批 | `src/gateway/channels/qq.ts` | checkApprovalReply + executeApprovedTool | ✅ |

**验证**: ✅ shell 命令等待用户确认，所有 298 tests 通过

### Phase 5: Skill System (2-3 天) ✅ 完成 (2026-02-22)

**目标**: Skill 加载 + 知识注入

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 5.1 SkillLoader 实现 | `src/skills/loader.ts` | 加载 skill.yaml | ✅ |
| 5.2 SkillRegistry 实现 | `src/skills/registry.ts` | Skill 注册表 | ✅ |
| 5.3 IntentMatcher 实现 | `src/skills/intent-matcher.ts` | 意图匹配 | ✅ |
| 5.4 KnowledgeInjector 实现 | `src/skills/knowledge-injector.ts` | 知识注入 | ✅ |
| 5.5 内置 Skills | `config/skills/` | web-search, file-tools, time | ✅ |
| 5.6 单元测试 | `tests/skills/*.test.ts` | 40 tests | ✅ |

**验证**: ✅ 40 tests 通过，Skill 加载/匹配/注入正常工作

### Phase 6: 人设包装 + 测试 (2 天) ✅ 完成 (2026-02-23)

**目标**: 工具输出人设化 + 完整测试

| 任务 | 文件 | 说明 | 状态 |
|------|------|------|------|
| 6.1 PersonaWrapper 实现 | `src/tools/persona-wrapper.ts` | 工具输出包装 | ✅ |
| 6.2 修改 PersonaEngine | `src/core/persona/index.ts` | 添加 wrapToolOutput() | ✅ |
| 6.3 单元测试 | `tests/tools/persona-wrapper.test.ts` | 16 tests | ✅ |
| 6.4 集成测试 | `tests/integration/tools/tool-chain.test.ts` | 17 tests | ✅ |
| 6.5 E2E 测试 | `tests/e2e/` | 复用现有 E2E | ✅ |

**验证**: ✅ 1046 tests 通过（新增 33 tests），PersonaWrapper 正常工作

---

## 六、依赖

### 6.1 新增 NPM 包

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "dockerode": "^4.0.0"
  },
  "devDependencies": {
    "@types/dockerode": "^3.3.0"
  }
}
```

### 6.2 Docker 镜像

```dockerfile
# Dockerfile.sandbox
FROM alpine:3.19

RUN apk add --no-cache \
    curl \
    bash \
    jq

WORKDIR /workspace

# 安全限制
RUN adduser -D -u 1000 sandbox
USER sandbox
```

---

## 七、配置文件

### 7.1 工具权限配置 (config/system/tools.yaml)

```yaml
# 工具权限配置
permissions:
  # safe 级 - 直接执行
  safe:
    - web_search
    - fetch
    - file_read
    - time
    - screenshot

  # confirm 级 - 需要审批
  confirm:
    - shell
    - file_write
    - file_delete
    - browser

  # deny 级 - 始终拒绝
  deny: []

# 沙箱配置
sandbox:
  enabled: true
  image: kurisu-sandbox:latest
  timeout: 30s
  memory: 512m
  cpu: 0.5
```

### 7.2 内置 Skill 示例 (config/skills/web-search/skill.yaml)

```yaml
id: web-search
name: 网页搜索
version: "1.0"
type: hybrid

trigger:
  keywords:
    - 搜索
    - 查一下
    - 找一下
    - 搜一下
    - 天气
    - 新闻
  intent:
    - search
    - lookup

context: |
  用户需要从网上获取信息。使用搜索工具查找，然后简洁地总结结果。

examples:
  - user: "查一下今天东京的天气"
    assistant: "查一下。等一会儿。"
    # [调用 web_search 工具]
    # "...找到了。东京今天 18°C，多云。"

tools:
  mcpConfig: ./mcp.json
```

### 7.3 MCP 配置示例 (config/skills/web-search/mcp.json)

```json
{
  "mcpServers": {
    "fetch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    }
  }
}
```

---

## 八、关键实现细节

### 8.1 MCP 客户端连接

```typescript
// src/tools/mcp-bridge.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class MCPBridge {
  private clients: Map<string, Client> = new Map();

  async connect(serverName: string, config: MCPServerConfig): Promise<Client> {
    if (this.clients.has(serverName)) {
      return this.clients.get(serverName)!;
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });

    const client = new Client({ name: 'kurisu', version: '1.0.0' });
    await client.connect(transport);

    this.clients.set(serverName, client);
    return client;
  }

  async listTools(serverName: string): Promise<ToolDef[]> {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`MCP server not connected: ${serverName}`);

    const result = await client.request(
      { method: 'tools/list', params: {} },
      ListToolsResultSchema
    );

    return result.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      permission: 'safe' as const,
      source: { type: 'mcp', serverName },
    }));
  }

  async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    const client = this.clients.get(serverName);
    if (!client) throw new Error(`MCP server not connected: ${serverName}`);

    const result = await client.request(
      { method: 'tools/call', params: { name: toolName, arguments: args } },
      CallToolResultSchema
    );

    return result.content;
  }
}
```

### 8.2 Docker 沙箱执行

```typescript
// src/tools/sandbox.ts
import Docker from 'dockerode';

export class SandboxExecutor {
  private docker: Docker;
  private config: SandboxConfig;

  async execute(command: string, options: ExecuteOptions): Promise<SandboxResult> {
    const container = await this.docker.createContainer({
      Image: this.config.image,
      Cmd: ['sh', '-c', command],
      WorkingDir: '/workspace',
      HostConfig: {
        Memory: this.config.memoryLimit,
        CpuQuota: this.config.cpuLimit * 100000,
        NetworkMode: 'none',  // 隔离网络
        ReadonlyRootfs: true,
      },
      User: 'sandbox',
    });

    await container.start();
    const result = await container.wait();

    const logs = await container.logs({ stdout: true, stderr: true });
    await container.remove();

    return {
      exitCode: result.StatusCode,
      output: logs.toString(),
    };
  }
}
```

### 8.3 审批流程

```typescript
// src/tools/approval.ts
export class ApprovalManager {
  private pendingApprovals: Map<string, ApprovalState> = new Map();

  createApproval(sessionId: string, toolCall: ToolCall): ApprovalState {
    const approval: ApprovalState = {
      toolCall,
      message: `你让我执行 \`${toolCall.name}\`，这可能会修改文件。确定要继续吗？\n回复「确认」继续，回复「取消」放弃。`,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.pendingApprovals.set(sessionId, approval);
    return approval;
  }

  handleReply(sessionId: string, reply: string): 'approved' | 'rejected' | 'invalid' {
    const approval = this.pendingApprovals.get(sessionId);
    if (!approval) return 'invalid';

    if (reply.includes('确认') || reply.toLowerCase().includes('yes')) {
      approval.status = 'approved';
      this.pendingApprovals.delete(sessionId);
      return 'approved';
    }

    if (reply.includes('取消') || reply.includes('放弃') || reply.toLowerCase().includes('no')) {
      approval.status = 'rejected';
      this.pendingApprovals.delete(sessionId);
      return 'rejected';
    }

    return 'invalid';
  }
}
```

### 8.4 ReAct 工作流路由

```typescript
// src/agents/routers/tool-router.ts
export function toolCallRouter(state: AgentState): string {
  // 有审批等待中
  if (state.approvalState?.status === 'pending') {
    return 'wait_approval';
  }

  // 有待执行的工具调用
  if (state.pendingToolCalls.length > 0 && state.toolCallIteration < 5) {
    return 'tool_call';
  }

  // 工具调用完成，回到 generate
  if (state.toolResults.length > 0) {
    return 'generate';
  }

  // 没有工具调用，继续正常流程
  return 'validate';
}
```

---

## 九、测试计划

### 9.1 单元测试

| 模块 | 测试文件 | 测试用例 |
|------|---------|---------|
| ToolRegistry | `tools/registry.test.ts` | 注册/查询工具 |
| PermissionChecker | `tools/permission.test.ts` | safe/confirm/deny 判断 |
| MCPBridge | `tools/mcp-bridge.test.ts` | 连接/调用/断开 |
| SandboxExecutor | `tools/sandbox.test.ts` | 执行/超时/资源限制 |
| ApprovalManager | `tools/approval.test.ts` | 创建/处理审批 |
| SkillRegistry | `skills/registry.test.ts` | 加载/匹配/激活 |

### 9.2 集成测试

| 场景 | 测试文件 | 说明 |
|------|---------|------|
| 完整工具调用链 | `integration/tool-chain.test.ts` | 意图 → Skill → 工具 → 结果 |
| 审批流程 | `integration/approval.test.ts` | confirm → 等待 → 确认 → 执行 |
| 沙箱执行 | `integration/sandbox.test.ts` | shell 命令在容器中执行 |

### 9.3 E2E 测试

| 场景 | 平台 | 说明 |
|------|------|------|
| 天气查询 | CLI | web_search 工具调用 |
| 文件读取 | CLI | file_read 工具调用 |
| Shell 执行审批 | Telegram/QQ | confirm 级工具审批流程 |

---

## 十、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| MCP SDK 不稳定 | 工具调用失败 | 使用官方稳定版，添加重试机制 |
| Docker 沙箱逃逸 | 安全问题 | 使用官方最佳实践，限制网络/权限 |
| 工具调用死循环 | 性能问题 | toolCallIteration 上限 5 次 |
| 审批超时 | 用户体验 | 30s 超时后自动取消 |
| Prompt Injection | 安全问题 | 工具结果结构化包装 |

---

## 十一、验收标准

- [ ] 能通过 MCP 调用 web_search/fetch 工具
- [ ] confirm 级工具在 Docker 沙箱中执行
- [ ] 审批流程正常工作（发消息等待回复）
- [ ] Skill 激活和知识注入正常
- [ ] 工具输出经过人设化包装
- [ ] 单元测试 80%+ 覆盖率
- [ ] 集成测试和 E2E 测试通过

---

## 十二、时间估算

| 阶段 | 天数 | 累计 |
|------|------|------|
| Phase 1: 基础设施 | 3-4 天 | 4 天 |
| Phase 2: MCP 集成 | 3-4 天 | 8 天 |
| Phase 3: Docker 沙箱 | 2-3 天 | 10 天 |
| Phase 4: 审批流程 | 2 天 | 12 天 |
| Phase 5: Skill System | 2-3 天 | 15 天 |
| Phase 6: 人设包装 + 测试 | 2 天 | 17 天 |

**总计**: 约 2.5-3 周

---

## 十三、后续扩展

- **Phase 7**: Skill Store CLI (`kurisu skill install xxx`)
- **Phase 8**: 工具自进化（自主搜索安装 MCP Server）
- **Phase 9**: 工具使用学习（记住用户偏好）
