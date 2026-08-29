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
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ulimit -Sn 10000 2>/dev/null || true

# ---------- 解析端口 ----------
# 优先级：--port CLI 参数 > DEV_PORT 环境变量 > 默认 5173
PORT="${DEV_PORT:-5173}"
for arg in "$@"; do
  case "$arg" in
    --port=*) PORT="${arg#--port=}" ;;
    --port)   shift; PORT="${1:-}" ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done
# 兜底参数：--port 后面跟的值
if [ "${1:-}" = "--port" ]; then
  PORT="${2:-5173}"
fi
# 端口必须是正整数
if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "==> 端口 '$PORT' 无效，必须是 1-65535 之间的整数" >&2
  exit 2
fi
export DEV_PORT="$PORT"

# ---------- 清理占用端口的进程 ----------
# 不强制退出 —— 若杀不掉或端口被系统进程占用，会让 Vite 报原来的错，方便排查。
kill_port() {
  local port="$1"
  local pids=""
  # lsof 是最稳的方式（macOS / Linux 都能用）
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  # 兜底：ss / fuser
  if [ -z "$pids" ] && command -v ss >/dev/null 2>&1; then
    pids="$(ss -ltnp "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  fi
  if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${port}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)"
  fi

  # 过滤掉当前 shell / grep 自身，避免自杀
  local my_pid=$$
  local victim=""
  for pid in $pids; do
    [ "$pid" = "$my_pid" ] && continue
    victim="$victim $pid"
  done
  [ -z "$victim" ] && return 0

  echo "==> 检测到端口 ${port} 被占用，尝试终止占用进程：$victim"
  # 先温柔，再强制
  for pid in $victim; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  for pid in $victim; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  sleep 0.3

  # 再确认一次，还占着就提示但不退出（让 Vite 报原错误）
  if command -v lsof >/dev/null 2>&1 && lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "==> 端口 ${port} 仍被占用（可能为系统进程，无权杀），请手动检查。"
  fi
}

kill_port "$PORT"

# ---------- 打印对外访问地址 ----------
# CNB 云环境的对外访问网址：绕开 VSCode 端口转发隧道，避免刷新无限转圈
# 注：sprite-locator 的源文件已搬到 tools/sprite-locator.html，但 vite.config.ts 里的
#     dev 中间件会把公开 URL `/sprite-locator.html` 重写到源文件，所以这里 URL 不变。
PROXY_URL="${CNB_VSCODE_PROXY_URI:-}"
if [ -n "$PROXY_URL" ]; then
  PUBLIC_URL="${PROXY_URL//\{\{port\}\}/$PORT}"
  echo "==> 对外访问地址（CNB 代理，绕开 VSCode 转发隧道，端口 ${PORT}）："
  echo "    $PUBLIC_URL"
  echo "    ${PUBLIC_URL%/}/sprite-locator.html  （精灵图定位工具，独立入口，不随主应用发布）"
fi

echo "==> 启动 Vite 开发服务器（host: 0.0.0.0, port: ${PORT}）"
exec npm run dev
