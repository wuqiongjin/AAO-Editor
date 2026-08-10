#!/usr/bin/env bash
# =============================================================================
# 启动开发服务器（云原生/容器环境）
# 用法：bash scripts/dev.sh          （或用 npm run dev）
#       bash scripts/dev.sh --no-hmr （或 DISABLE_HMR=1 npm run dev / npm run dev:cloud）
#
# 背景：容器/代理环境下刷新页面偶发"无限转圈"，多因 HMR WebSocket 被代理拦截、
#       或 inotify/文件描述符不足导致请求挂起。此脚本已统一处理：
#   - 提高文件描述符限制
#   - 让 Vite 绑定 0.0.0.0 并允许任意 Host（见 vite.config.ts）
#   - 可选 --no-hmr 彻底关闭热更新，保证刷新永远可用
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ulimit -Sn 10000 2>/dev/null || true

NO_HMR=0
if [ "${1:-}" = "--no-hmr" ]; then
  NO_HMR=1
fi

# CNB 云环境的对外访问网址：绕开 VSCode 端口转发隧道，避免刷新无限转圈
PROXY_URL="${CNB_VSCODE_PROXY_URI:-}"
if [ -n "$PROXY_URL" ]; then
  PUBLIC_URL="${PROXY_URL//\{\{port\}\}/5173}"
  echo "==> 对外访问地址（CNB 代理，绕开 VSCode 转发隧道）："
  echo "    $PUBLIC_URL"
fi

echo "==> 启动 Vite 开发服务器（host: 0.0.0.0, port: 5173）"
if [ "$NO_HMR" = "1" ]; then
  echo "    已关闭 HMR（--no-hmr），刷新页面将始终可用，不会无限转圈"
  DISABLE_HMR=1 exec npm run dev
else
  echo "    提示：若刷新后无限转圈，用 scripts/dev.sh --no-hmr 或 DISABLE_HMR=1 npm run dev"
  exec npm run dev
fi