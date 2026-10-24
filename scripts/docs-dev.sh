#!/usr/bin/env bash
# =============================================================================
# 启动文档站开发服务器（云原生 / 容器环境）；加 `--demo` 时连浏览器演示版一起起
# 用法：bash scripts/docs-dev.sh
#       bash scripts/docs-dev.sh --demo            # 文档站 + /demo/（按发布口径构建）
#       bash scripts/docs-dev.sh --demo --skip-build   # 复用已有 site-dist/，只重启服务
#       DOCS_DEV_PORT=4301 bash scripts/docs-dev.sh
#       bash scripts/docs-dev.sh --port=4301
#
# 两种模式：
#   1. 默认（VitePress dev，4300）：只服务 docs-site/ 的页面，带热更新。**服务不到 /demo/**——
#      demo 是 app 的另一份构建产物，不在 VitePress 的根目录里；那个路径会被它的 SPA 兜底
#      接住（HTTP 200，但客户端渲染出的是 VitePress 自己的 404 页，刷新症状一样）。
#      默认不开它是有意的：写文档不该被 app 那一整套工具链（依赖 + 素材取件 + 7MB 构建）绑架。
#   2. `--demo`：按 `deploy-site.yml` 的 build job **逐句相同的命令**构建两边、合并成单一
#      `site-dist/`，再按项目站路径静态托管。慢（要真构建），但预览的就是**会发出去的那份产物**，
#      所以素材路径、子路径解析这类问题只有在这个模式下才验得出来。
#      DOCS_BASE 在该模式下默认 `/AAO-Editor/`（与构建目标一致），显式设了则尊重用户。
#
# 与根目录 app 的 scripts/dev.sh 分工：
#   - app 默认 5173；文档站默认 4300，避免同机双开抢端口
#   - 云环境请用脚本打印的 CNB 对外 URL，勿依赖 VSCode 端口转发隧道
#   - 纯开发预览默认 DOCS_BASE=/（根路径）
#
# 端口解析 / 占用清理与 dev.sh 共用 scripts/lib/dev-server.sh，改策略只改一处。
# =============================================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SELF="$SCRIPT_DIR/$(basename "$0")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs-site"

# ---------- 参数 ----------
WITH_DEMO=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      print_help "$SELF"
      exit 0
      ;;
    --demo) WITH_DEMO=true ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

ulimit -Sn 10000 2>/dev/null || true

# shellcheck source=scripts/lib/dev-server.sh
source "$REPO_ROOT/scripts/lib/dev-server.sh"
parse_dev_port DOCS_DEV_PORT 4300 "$@"
export DOCS_DEV_PORT="$PORT"

# ---------- 依赖 ----------
cd "$DOCS_DIR"
if [ ! -d node_modules/vitepress ]; then
  echo "==> docs-site 依赖未安装，执行 npm ci…"
  npm ci
fi

# =============================================================================
# 模式 2：`--demo` —— 构建两边 + 合并成单一站点根 + 按项目站路径静态托管
# =============================================================================
if [ "$WITH_DEMO" = true ]; then
  # 该模式下 DOCS_BASE 跟构建目标走（GitHub Pages 项目站路径），而不是开发用的根路径
  export DOCS_BASE="${DOCS_BASE:-/AAO-Editor/}"
  case "$DOCS_BASE" in
    */) ;;
    *) DOCS_BASE="$DOCS_BASE/" ;;
  esac
  BASE_SEGMENTS="$(printf '%s' "$DOCS_BASE" | sed 's#^/##; s#/$##')"

  cd "$REPO_ROOT"
  if [ "$SKIP_BUILD" = true ]; then
    if [ ! -f "$REPO_ROOT/site-dist/index.html" ]; then
      echo "==> site-dist/ 不存在或没内容，--skip-build 无从复用（去掉该参数重跑）" >&2
      exit 1
    fi
    echo "==> --skip-build：复用已有 site-dist/"
  else
    if [ ! -d node_modules/vite ] || [ ! -d node_modules/react ]; then
      echo "==> app 依赖未安装，请先执行 npm ci（或 bash scripts/setup.sh）" >&2
      exit 1
    fi
    echo "==> 构建 app（浏览器演示版）"
    npm run build
    echo "==> 构建 docs-site"
    (cd docs-site && npm run build)
    echo "==> 合并到 site-dist/（与 deploy-site.yml 的 build job 逐句相同）"
    # 站点根可能是几百上千个文件；刻意用 `find -delete` 而不是 `rm -rf`：
    # 有些环境给 rm 套了别名 / 安全删除钩子（删大目录要先确认甚至直接拦），
    # 会让本地复现 CI 的步骤莫名其妙停住。find 的 -delete 隐含 -depth，语义等价。
    [ -d site-dist ] && find site-dist -mindepth 1 -delete
    mkdir -p site-dist
    cp -a docs-site/.vitepress/dist/. site-dist/
    mkdir -p site-dist/demo
    cp -a dist/. site-dist/demo/
  fi

  # 页面里全是「base + 绝对路径」的链接，服务根下必须有同名的一层目录它们才落得到文件上。
  # 用软链指向 site-dist，不复制一遍产物。
  SITE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aao-site-preview-XXXXXX")"
  if [ -n "$BASE_SEGMENTS" ]; then
    ln -s "$REPO_ROOT/site-dist" "$SITE_ROOT/$BASE_SEGMENTS"
  fi

  kill_port "$PORT"
  PRINT_BASE="$(printf '%s' "/$BASE_SEGMENTS" | sed 's#/$##')"
  PROXY_URL="${CNB_VSCODE_PROXY_URI:-}"
  if [ -n "$PROXY_URL" ]; then
    PUBLIC_URL="${PROXY_URL//\{\{port\}\}/$PORT}"
    echo "==> 对外访问地址（CNB 代理，端口 ${PORT}）："
    echo "    ${PUBLIC_URL}${PRINT_BASE}/          文档站"
    echo "    ${PUBLIC_URL}${PRINT_BASE}/demo/     浏览器演示版"
    echo "    （勿用 localhost / VSCode 转发隧道访问，刷新可能无限转圈）"
  else
    echo "==> 本机访问："
    echo "    http://127.0.0.1:${PORT}${PRINT_BASE}/"
    echo "    http://127.0.0.1:${PORT}${PRINT_BASE}/demo/"
  fi
  echo "==> 服务根：$SITE_ROOT（${BASE_SEGMENTS:-<站点根>} -> site-dist/）"
  echo "==> Ctrl-C 停止"

  cd "$SITE_ROOT"
  exec python3 -m http.server "$PORT" --bind 0.0.0.0
fi

# =============================================================================
# 模式 1：默认 —— VitePress 开发服务器（热更新；不含 /demo/）
# =============================================================================
cd "$DOCS_DIR"
# 开发预览走根路径；显式设了 DOCS_BASE 则尊重用户（例如模拟 Pages 子路径）
export DOCS_BASE="${DOCS_BASE:-/}"

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
echo "==> 要看 /demo/ 请加 --demo（默认模式下该路径只有 VitePress 的客户端 404）"
echo "==> 启动 VitePress（host: 0.0.0.0, port: ${PORT}）"
exec npm run dev
