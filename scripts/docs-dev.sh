#!/usr/bin/env bash
# =============================================================================
# 启动文档站 VitePress 开发服务器（云原生 / 容器环境）
# 用法：bash scripts/docs-dev.sh
#       DOCS_DEV_PORT=4301 bash scripts/docs-dev.sh
#       bash scripts/docs-dev.sh --port=4301
#
# 与根目录 app 的 scripts/dev.sh 分工：
#   - app 默认 5173；文档站默认 4300，避免同机双开抢端口
#   - 云环境请用脚本打印的 CNB 对外 URL，勿依赖 VSCode 端口转发隧道
#   - 开发预览默认 DOCS_BASE=/（根路径），与 GitHub Pages 的 /AAO-Editor/ 构建目标分离
#
# 端口解析 / 占用清理与 dev.sh 共用 scripts/lib/dev-server.sh，改策略只改一处。
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "$0")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs-site"
cd "$DOCS_DIR"

ulimit -Sn 10000 2>/dev/null || true

# ---------- 依赖 ----------
if [ ! -d node_modules/vitepress ]; then
  echo "==> docs-site 依赖未安装，执行 npm ci…"
  npm ci
fi

# ---------- 解析端口（--port CLI > DOCS_DEV_PORT > 4300；实现见 lib/dev-server.sh） ----------
# shellcheck source=scripts/lib/dev-server.sh
source "$REPO_ROOT/scripts/lib/dev-server.sh"
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      print_help "$SELF"
      exit 0
      ;;
  esac
done
parse_dev_port DOCS_DEV_PORT 4300 "$@"
export DOCS_DEV_PORT="$PORT"

# 开发预览走根路径；显式设了 DOCS_BASE 则尊重用户（例如模拟 Pages 子路径）
export DOCS_BASE="${DOCS_BASE:-/}"

# ---------- 清理占用端口的进程（杀不掉只提示，让 VitePress 报原错误） ----------
kill_port "$PORT"

PROXY_URL="${CNB_VSCODE_PROXY_URI:-}"
if [ -n "$PROXY_URL" ]; then
  PUBLIC_URL="${PROXY_URL//\{\{port\}\}/$PORT}"
  echo "==> 对外访问地址（CNB 代理，端口 ${PORT}）："
  echo "    $PUBLIC_URL"
  echo "    （勿用 localhost / VSCode 转发隧道访问，刷新可能无限转圈）"
else
  echo "==> 本机访问：http://127.0.0.1:${PORT}/"
fi

echo "==> DOCS_BASE=${DOCS_BASE}（开发预览路径前缀）"
echo "==> 启动 VitePress（host: 0.0.0.0, port: ${PORT}）"
exec npm run dev
