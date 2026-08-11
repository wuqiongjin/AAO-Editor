#!/usr/bin/env bash
# =============================================================================
# 启动开发服务器（云原生/容器环境）
# 用法：bash scripts/dev.sh
#
# 背景：容器/代理环境下刷新页面偶发"无限转圈"，多因 inotify/文件描述符不足
#       或 HMR WebSocket 被代理拦截。此脚本统一处理：
#   - 提高文件描述符限制
#   - 让 Vite 绑定 0.0.0.0 并允许任意 Host（见 vite.config.ts）
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ulimit -Sn 10000 2>/dev/null || true

# CNB 云环境的对外访问网址：绕开 VSCode 端口转发隧道，避免刷新无限转圈
PROXY_URL="${CNB_VSCODE_PROXY_URI:-}"
if [ -n "$PROXY_URL" ]; then
  PUBLIC_URL="${PROXY_URL//\{\{port\}\}/5173}"
  echo "==> 对外访问地址（CNB 代理，绕开 VSCode 转发隧道）："
  echo "    $PUBLIC_URL"
fi

echo "==> 启动 Vite 开发服务器（host: 0.0.0.0, port: 5173）"
exec npm run dev