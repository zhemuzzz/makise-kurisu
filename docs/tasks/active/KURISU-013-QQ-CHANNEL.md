# KURISU-013 QQ Channel 接入

> **任务类型**: Feature Implementation
> **优先级**: P0
> **状态**: 进行中
> **创建日期**: 2026-02-20

---

## 目标

接入 QQ 平台，使用 **NapCat + OneBot11** 协议，Polling 模式，无需 Tunnel。

## 技术方案

### NapCat + OneBot11

| 项目 | 说明 |
|------|------|
| 协议 | OneBot11 (原 CQHTTP) |
| 实现 | NapCat (基于 NTQQ) |
| 模式 | Polling (HTTP 拉取事件) |
| 优势 | 无需公网 URL，无需 Tunnel |

### 架构

```
QQ 用户发消息
    ↓
NapCat (QQ 客户端 + OneBot11 服务)
    ↓
QQChannel.pollEvents() (HTTP Polling)
    ↓
转换为 InboundMessage
    ↓
Gateway.processStream()
    ↓
QQChannel.sendMessage() (HTTP POST)
    ↓
QQ 用户收到回复
```

### 消息格式 (OneBot11)

**接收事件 (通过 get_latest_events)**:
```json
{
  "time": 1700000000,
  "self_id": 123456,
  "post_type": "message",
  "message_type": "private",
  "sub_type": "friend",
  "user_id": 654321,
  "message_id": "abc123",
  "message": [
    { "type": "text", "data": { "text": "你好" } }
  ],
  "raw_message": "你好"
}
```

**发送消息 (send_message)**:
```json
{
  "action": "send_message",
  "params": {
    "message_type": "private",
    "user_id": 654321,
    "message": [
      { "type": "text", "data": { "text": "回复内容" } }
    ]
  }
}
```

---

## 实现步骤

### Phase 1: QQChannel 实现

- [x] 创建任务文档
- [ ] 实现 QQChannel 类
  - [ ] OneBot11 类型定义
  - [ ] pollEvents() Polling 循环
  - [ ] handleRequest() 事件处理
  - [ ] sendMessage() 发送回复
  - [ ] verifySignature() (OneBot11 access_token 验证)

### Phase 2: 测试

- [ ] 单元测试
  - [ ] 事件解析测试
  - [ ] 消息发送测试
  - [ ] Polling 逻辑测试
- [ ] 集成测试

### Phase 3: 部署配置

- [ ] docker-compose.yml 添加 napcat profile
- [ ] 环境变量配置
- [ ] 启动脚本

### Phase 4: 端到端验证

- [ ] QQ 发消息 → 收到 Kurisu 回复
- [ ] 多用户会话隔离
- [ ] 错误处理

---

## 配置

### 环境变量

```bash
# NapCat OneBot11 HTTP API 地址
NAPCAT_HTTP_URL=http://napcat:3001

# OneBot11 access_token (可选)
NAPCAT_ACCESS_TOKEN=your_token

# Polling 间隔 (毫秒)
QQ_POLL_INTERVAL=1000
```

### docker-compose.yml

```yaml
services:
  kurisu:
    # ... existing config
    environment:
      - NAPCAT_HTTP_URL=http://napcat:3001
      - NAPCAT_ACCESS_TOKEN=${NAPCAT_ACCESS_TOKEN:-}

  napcat:
    image: mlikiowa/napcat-docker:latest
    profiles:
      - qq
    ports:
      - "3001:3001"
      - "6099:6099"  # WebUI
    volumes:
      - ./data/napcat:/app/napcat/config
    environment:
      - NAPCAT_GID=${NAPCAT_GID:-}
```

---

## 参考资源

- [OneBot11 标准](https://11.onebot.dev/)
- [NapCat 文档](https://napneu.github.io/napcat/)
- [NapCat Docker](https://github.com/NapNeko/NapCatQQ)
