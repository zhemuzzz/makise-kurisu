#!/bin/bash
# GLM MCP 诊断脚本
# 目的：测试 GLM Web Search MCP 在不同场景下的行为

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "GLM Web Search MCP 诊断工具"
echo "=========================================="
echo ""

# 检查环境变量
if [ -z "$ZHIPU_API_KEY" ]; then
    echo -e "${RED}错误: ZHIPU_API_KEY 环境变量未设置${NC}"
    echo "请在 .env 文件中设置 ZHIPU_API_KEY"
    exit 1
fi

echo -e "${GREEN}✓ ZHIPU_API_KEY 已设置${NC}"
echo "  Key 长度: ${#ZHIPU_API_KEY} 字符"
echo ""

MCP_URL="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp"

# 测试函数
test_mcp_method() {
    local method=$1
    local params=$2
    local desc=$3

    echo -e "${YELLOW}测试: ${desc}${NC}"
    echo "  Method: ${method}"

    local request_data=$(cat <<EOF
{"jsonrpc":"2.0","id":1,"method":"${method}","params":${params}}
EOF
)

    local response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
        -X POST "${MCP_URL}" \
        -H "Content-Type: application/json" \
        -H "Accept: application/json, text/event-stream" \
        -H "Authorization: Bearer ${ZHIPU_API_KEY}" \
        -d "${request_data}" \
        2>/dev/null)

    local http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d':' -f2)
    local body=$(echo "$response" | grep -v "HTTP_CODE:")

    if [ "$http_code" = "200" ]; then
        echo -e "  ${GREEN}✓ HTTP 200${NC}"
        echo "  Response: $(echo "$body" | head -c 200)..."

        # 检查是否有错误
        if echo "$body" | grep -q '"error"'; then
            local error_msg=$(echo "$body" | grep -o '"error":[^}]*' | head -c 100)
            echo -e "  ${RED}错误: ${error_msg}${NC}"
        fi
    else
        echo -e "  ${RED}✗ HTTP ${http_code}${NC}"
        echo "  Response: $(echo "$body" | head -c 200)"
    fi
    echo ""
}

# 测试1: initialize
echo "=== 测试 1: MCP initialize ==="
test_mcp_method "initialize" '{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}' "初始化 MCP 连接"

# 测试2: tools/list
echo "=== 测试 2: MCP tools/list ==="
test_mcp_method "tools/list" '{}' "获取可用工具列表"

# 测试3: tools/call (实际搜索)
echo "=== 测试 3: MCP tools/call (实际搜索) ==="
test_mcp_method "tools/call" '{"name":"webSearchPrime","arguments":{"query":"今天天气"}}' "执行搜索"

# 测试4: 无 Bearer 前缀
echo "=== 测试 4: 无 Bearer 前缀 ==="
echo -e "${YELLOW}测试: 无 Bearer 前缀的 Authorization${NC}"
response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST "${MCP_URL}" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: ${ZHIPU_API_KEY}" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"webSearchPrime","arguments":{"query":"test"}}}' \
    2>/dev/null)
http_code=$(echo "$response" | grep "HTTP_CODE:" | cut -d':' -f2)
body=$(echo "$response" | grep -v "HTTP_CODE:")
echo "  HTTP Status: ${http_code}"
echo "  Response: $(echo "$body" | head -c 200)"
echo ""

# 测试5: GLM Chat API (验证 API Key 是否有效)
echo "=== 测试 5: GLM Chat API (验证 API Key) ==="
echo -e "${YELLOW}测试: 调用 GLM Chat API 验证 API Key 有效性${NC}"
chat_response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST "https://open.bigmodel.cn/api/paas/v4/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ZHIPU_API_KEY}" \
    -d '{"model":"glm-4-flash","messages":[{"role":"user","content":"hi"}],"max_tokens":10}' \
    2>/dev/null)
chat_http_code=$(echo "$chat_response" | grep "HTTP_CODE:" | cut -d':' -f2)
chat_body=$(echo "$chat_response" | grep -v "HTTP_CODE:")

if [ "$chat_http_code" = "200" ]; then
    echo -e "  ${GREEN}✓ GLM Chat API 正常工作${NC}"
    echo "  这证明 API Key 是有效的"
else
    echo -e "  ${RED}✗ GLM Chat API 失败 (HTTP ${chat_http_code})${NC}"
    echo "  Response: $(echo "$chat_body" | head -c 200)"
fi
echo ""

# 总结
echo "=========================================="
echo "诊断总结"
echo "=========================================="
echo ""
echo "问题描述："
echo "  - 当使用 Claude Code 模型时，GLM Web Search MCP 正常工作"
echo "  - 当使用 GLM-5 模型时，GLM Web Search MCP 的 tools/call 返回 401"
echo "  - 但 GitHub MCP 和 DeepWiki MCP 在 GLM-5 模型下正常工作"
echo ""
echo "关键差异："
echo "  - GitHub/DeepWiki: HTTP MCP，无需认证"
echo "  - GLM Web Search: HTTP MCP，需要 Bearer Token 认证"
echo ""
echo "可能原因："
echo "  1. GLM-5 模型的 MCP 客户端可能不正确地传递 Authorization header"
echo "  2. GLM MCP 服务的 tools/call 端点可能有额外的认证要求"
echo "  3. GLM 账户可能需要额外订阅才能使用 Web Search MCP"
echo ""
echo "建议："
echo "  1. 联系智谱 AI 技术支持确认 MCP 的 tools/call 是否需要额外配置"
echo "  2. 检查智谱 AI 控制台是否有 MCP 相关的服务订阅状态"
echo "  3. 临时方案：使用 Claude Code 模型时使用 GLM Web Search，或使用其他搜索方案"
