#!/bin/bash
# 构建 Kurisu 沙箱镜像
# 用于 confirm 级工具的安全执行环境

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

IMAGE_NAME="kurisu-sandbox:latest"

echo "Building sandbox image: $IMAGE_NAME"
docker build -f "$PROJECT_DIR/Dockerfile.sandbox" -t "$IMAGE_NAME" "$PROJECT_DIR"
echo "✓ Sandbox image built: $IMAGE_NAME"
