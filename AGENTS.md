# AGENTS.md

This file configures how agents should work in this repository.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` + `docs/research/` at the repo root. See `docs/agents/domain.md`.

## Development server

- 启动开发服务器一律用 `bash scripts/dev.sh`，不要手动 `npx vite` / `npm run dev` / `npm run dev:cloud`。
  dev.sh 统一处理了文件描述符上限和对外地址打印。
- 访问地址（给用户 / OpenPreview / curl 验证时使用）：
  - 若设置了 `CNB_VSCODE_PROXY_URI`（云环境，形如 `https://<workspace-id>-{{port}}.cnb.run`）：
    对外访问地址 = 将 `{{port}}` 替换为 `5173`（dev.sh 启动时会打印）。
    **一律使用这个对外 URL 访问页面**，不要用 `127.0.0.1` / `localhost` 走 VSCode 端口转发——转发隧道可能假死，且无法感知，表现为"刷新后无限转圈"。
  - 若未设置 `CNB_VSCODE_PROXY_URI`（本地 / 普通远程开发）：Vite 绑定 `0.0.0.0:5173`，直接访问 `http://localhost:5173/`。
- 启动后先 `curl -s -o /dev/null -w "%{http_code}" <访问地址>` 确认服务就绪，再把地址提供给用户。

## 文档站（`docs-site/` · VitePress）

- 启动开发服务器一律用 `bash scripts/docs-dev.sh`（或根目录 `npm run docs:dev`），不要只在 `docs-site/` 里裸跑 `npm run dev`（默认会占 5173 且不会打印云环境对外 URL）。
- 要看 `/demo/`（浏览器演示版）用 **`bash scripts/docs-dev.sh --demo`**：它按 `deploy-site.yml` 的 build job 逐句相同的命令构建两边、合并成单一 `site-dist/`，再按项目站路径静态托管（该模式下 `DOCS_BASE` 默认 `/AAO-Editor/`）。加 `--skip-build` 可复用已有 `site-dist/` 只重启服务。
  默认模式（不加 `--demo`）是纯 VitePress 开发服务器，**服务不到 demo**——那是 app 的另一份产物，`/demo/` 在那儿只会被 SPA 兜底接住、渲染成 VitePress 自己的 404。默认不开它是有意的：写文档不该被 app 那套工具链（依赖 + 素材取件 + 7MB 构建）绑架。
- 默认端口 **4300**（`DOCS_DEV_PORT` 或 `bash scripts/docs-dev.sh --port=…` 可改）；开发预览默认 `DOCS_BASE=/`。
- 云环境访问地址规则与 app 相同：有 `CNB_VSCODE_PROXY_URI` 时把 `{{port}}` 换成 **4300**（或你设的端口）。
- 刷新后若无限转圈，用 `DISABLE_HMR=1 bash scripts/docs-dev.sh`（关 HMR 重启）。不要在 `docs-site/` 里裸跑 `npm run dev:cloud`——它同样是 VitePress 默认 5173、同样不打印云环境对外 URL，正是首条要避免的形式。
