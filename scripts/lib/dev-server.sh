#!/usr/bin/env bash
# =============================================================================
# dev.sh / docs-dev.sh 共用的开发服务器启动辅助（source 引入，不直接运行）。
#
# 港口解析与「杀占用进程」逻辑曾经两份平行实现且已漂移（docs-dev.sh 丢了
# 「仍被占用」复检），收来这里：改策略只改一处。
#
# 用法：
#   source scripts/lib/dev-server.sh
#   parse_dev_port DEV_PORT 5173 "$@"   # 结果写入全局 PORT；端口无效时 return 2
#   kill_port "$PORT"
#   print_help "$0"                     # 打印脚本头部注释块（帮助文本随注释走）
# =============================================================================

# parse_dev_port <ENV_NAME> <DEFAULT_PORT> [args...]
#   端口优先级：--port CLI 参数 > 环境变量 > 默认值，结果写入全局 PORT。
#   -h/--help 由调用方自行处理（本函数原样跳过）。
#   端口不是 1-65535 的整数时报错并 return 2（调用方在 set -e 下随之退出）。
parse_dev_port() {
  local env_name="$1"
  local default_port="$2"
  shift 2

  PORT="${!env_name:-$default_port}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --port=*)
        PORT="${1#--port=}"
        shift
        ;;
      --port)
        shift
        PORT="${1:-}"
        if [ $# -gt 0 ]; then
          shift
        fi
        ;;
      *)
        shift
        ;;
    esac
  done

  if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
    echo "==> 端口 '$PORT' 无效，必须是 1-65535 之间的整数" >&2
    return 2
  fi
}

# kill_port <port>
#   杀掉占用该端口的进程（lsof → ss → fuser 逐级兜底），先 TERM 再 KILL。
#   不强制退出：杀不掉（如系统进程）只提示，让 dev server 报原来的错，方便排查。
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

  # 过滤掉当前 shell 自身，避免自杀
  local my_pid=$$
  local victim=""
  local pid
  for pid in $pids; do
    if [ "$pid" = "$my_pid" ]; then
      continue
    fi
    victim="$victim $pid"
  done
  if [ -z "$victim" ]; then
    return 0
  fi

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

  # 再确认一次，还占着就提示但不退出（让 dev server 报原错误）
  if command -v lsof >/dev/null 2>&1 && lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "==> 端口 ${port} 仍被占用（可能为系统进程，无权杀），请手动检查。"
  fi
}

# print_help <script-path>
#   打印脚本头部注释块：第 2 行到第二个 `# ====` 分隔线（含）。
#   帮助文本跟着注释走，头部增删行不用同步 sed 行号（docs-dev.sh 曾因
#   硬编码行号把 `set -euo pipefail` 打进帮助输出）。
print_help() {
  awk 'NR == 1 { next } /^# =+$/ { print; if (n++) exit; next } { print }' "$1"
}
