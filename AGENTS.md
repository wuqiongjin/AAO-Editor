# AGENTS.md

This file configures how agents should work in this repository.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Development server

- 启动开发服务器一律用 `bash scripts/dev.sh`，不要手动 `npx vite` / `npm run dev` / `npm run dev:cloud`。
  dev.sh 统一处理了文件描述符上限、HMR 开关和对外地址打印；需要关闭 HMR（云环境避免刷新无限转圈）时用 `bash scripts/dev.sh --no-hmr`。
- 访问地址（给用户 / OpenPreview / curl 验证时使用）：
  - 若设置了 `CNB_VSCODE_PROXY_URI`（云环境，形如 `https://<workspace-id>-{{port}}.cnb.run`）：
    对外访问地址 = 将 `{{port}}` 替换为 `5173`（dev.sh 启动时会打印）。
    **一律使用这个对外 URL 访问页面**，不要用 `127.0.0.1` / `localhost` 走 VSCode 端口转发——转发隧道可能假死，且无法感知，表现为"刷新后无限转圈"。
  - 若未设置 `CNB_VSCODE_PROXY_URI`（本地 / 普通远程开发）：Vite 绑定 `0.0.0.0:5173`，直接访问 `http://localhost:5173/`。
- 启动后先 `curl -s -o /dev/null -w "%{http_code}" <访问地址>` 确认服务就绪，再把地址提供给用户。
