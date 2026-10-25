#!/usr/bin/env bash
# =============================================================================
# 启动开发服务器（云原生/容器环境）
# 用法：bash scripts/dev.sh
#       DEV_PORT=5174 bash scripts/dev.sh
#       bash scripts/dev.sh --port=5174
#
# 背景：容器/代理环境下刷新页面偶发"无限转圈"，多因 inotify/文件描述符不足
#       或 HMR WebSocket 被代理拦截。此脚本统一处理：
#   - 提高文件描述符限制
#   - 让 Vite 绑定 0.0.0.0 并允许任意 Host（见 vite.config.ts）
#   - 默认端口 5173，可通过 DEV_PORT 环境变量或 --port 参数覆盖
#   - 若端口被占用，自动杀掉占用进程后继续启动
#
# 端口解析 / 占用清理与 docs-dev.sh 共用 scripts/lib/dev-server.sh，改策略只改一处。
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "$0")"
cd "$SCRIPT_DIR/.."

ulimit -Sn 10000 2>/dev/null || true

# shellcheck source=scripts/lib/dev-server.sh
source "$SCRIPT_DIR/lib/dev-server.sh"
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      print_help "$SELF"
      exit 0
      ;;
  esac
done

# ---------- 运行时资源包预检（产物不在本仓：缺失会被键音注册表的 ?inline 静态导入卡死） ----------
if ! node scripts/assets-sync.mjs --check >/dev/null 2>&1; then
  echo "==> 运行时资源包缺失，尝试取件…"
  if ! node scripts/assets-sync.mjs; then
    echo "" >&2
    echo "ERROR: 产物缺失且取件失败，无法启动 dev。" >&2
    echo "       修复口径见 scripts/assets-sync.mjs 文件头（ASSETS_SOURCE / --from 可指定来源）。" >&2
    exit 1
  fi
fi

# ---------- 解析端口（--port CLI > DEV_PORT > 5173；实现见 lib/dev-server.sh） ----------
parse_dev_port DEV_PORT 5173 "$@"
export DEV_PORT="$PORT"

# ---------- 清理占用端口的进程（杀不掉只提示，让 Vite 报原错误） ----------
kill_port "$PORT"

# ---------- 打印对外访问地址 ----------
# CNB 云环境的对外访问网址：绕开 VSCode 端口转发隧道，避免刷新无限转圈
PROXY_URL="${CNB_VSCODE_PROXY_URI:-}"
if [ -n "$PROXY_URL" ]; then
  PUBLIC_URL="${PROXY_URL//\{\{port\}\}/$PORT}"
  echo "==> 对外访问地址（CNB 代理，绕开 VSCode 转发隧道，端口 ${PORT}）："
  echo "    $PUBLIC_URL"
fi

echo "==> 启动 Vite 开发服务器（host: 0.0.0.0, port: ${PORT}）"
exec npm run dev
