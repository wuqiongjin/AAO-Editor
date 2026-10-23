# 02 · Pages 发布流水线（构建与托管解耦）

Type: feature
Status: open
Blocked by: 01

## 来源

map 2026-10-23 实现口径：GitHub Actions 产出单一 `site-dist/`（文档在根、demo 在 `/demo/`），托管只做最后一步。

## 做什么

新增 `.github/workflows/deploy-site.yml`：

- 触发：`push: branches: [main]` + `workflow_dispatch`（**不监听 PR**）。
- 权限：`contents: read` / `pages: write` / `id-token: write`；`concurrency: { group: pages, cancel-in-progress: false }`。
- job `build`：`actions/checkout` → `setup-node@22`（cache npm）→ `npm ci` → **`bash scripts/ci/ci-assets.sh`**（`secrets.ASSETS_SOURCE`）→ `npm run build`（app，`base: './'` 不动）→ `cd docs-site && npm ci && npm run build` → 合并到 `site-dist/` → `actions/upload-pages-artifact`。
- job `deploy`：`needs: build`，`environment: github-pages`，`actions/deploy-pages`。
- **不跑测试、不跑 assets:check**：门禁在 CNB 与 `ci.yml`；本 workflow 只负责发布，不构成 ADR-0022 §8 的「双边 CI」。

合并顺序要小心：app 产物落 `site-dist/demo/`，docs 产物落 `site-dist/` 根；两边目录都叫 `dist`，用独立暂存目录避免互相覆盖。

一次性手工前置：仓 Settings → Pages → Source = **GitHub Actions**。

## 迁移口径

`deploy` 是唯一与托管绑定的 job。迁 Cloudflare Pages = 把 deploy 换成 `wrangler pages deploy site-dist`，build 一字不改；内容侧只改 `DOCS_BASE`（`/AAO-Editor/` → `/`）。

## 锁测

1. 静态锁：`tests/static/ReleasePipeline.test.ts` 的 `PIPELINE_FILES` 是否纳入本文件——本文件不在发版链路，倾向不纳入；若纳入，需同时满足既有的「链路无 Bestdori 引用」断言。
2. 手工验收：首次部署后 `curl -s -o /dev/null -w "%{http_code}"` 首页与 `/demo/` 均为 200。
3. 反向验收：故意让素材取件失败（临时用错 secret 的空分支），workflow 必须红，不能静默发出空态站。
