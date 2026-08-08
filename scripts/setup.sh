#!/usr/bin/env bash
# =============================================================================
# 环境初始化脚本（适用于云原生/容器构建环境）
# 用法：bash scripts/setup.sh     （或用 npm run setup）
# 说明：每次在全新/重建的环境中执行一次，用于安装依赖并修复容器内常见问题
#       （inotify/文件描述符限制不足会导致 Vite 刷新后无限转圈/请求挂起）。
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> [1/3] 提升文件描述符与 inotify 限制（容器内默认过小易导致请求挂起）"
ulimit -Sn 10000 2>/dev/null || echo "    (无法修改 ulimit，跳过)"
if [ "$(id -u)" = "0" ]; then
  sysctl -w fs.inotify.max_user_watches=524288 2>/dev/null || true
  sysctl -w fs.inotify.max_user_instances=8192 2>/dev/null || true
  sysctl -w fs.inotify.max_queued_events=16384 2>/dev/null || true
else
  echo "    (非 root，跳过 sysctl inotify 调整)"
fi

echo "==> [2/3] 安装依赖"
if command -v npm >/dev/null 2>&1; then
  if [ -f package-lock.json ]; then
    npm ci || npm install
  else
    npm install
  fi
else
  echo "ERROR: 未检测到 npm，请先安装 Node.js/npm" >&2
  exit 1
fi

echo "==> [3/3] 环境就绪"
echo ""
echo "  启动开发服务器："
echo "    npm run dev                  # 常规模式（启用 HMR）"
echo "    DISABLE_HMR=1 npm run dev    # 若刷新后仍无限转圈，关闭 HMR（最稳妥）"
echo "    npm run dev:cloud            # 相当于上面的 DISABLE_HMR=1"
echo ""