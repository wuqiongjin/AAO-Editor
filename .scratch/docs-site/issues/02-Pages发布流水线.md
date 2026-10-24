# 02 · Pages 发布流水线（构建与托管解耦）

Type: feature
Status: resolved
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

## Comments

### 2026-10-24 实现

**结构**

- `.github/workflows/deploy-site.yml`：触发 `push: branches: [main]` + `workflow_dispatch`（不听 PR）；权限 `contents: read` / `pages: write` / `id-token: write`；`concurrency: { group: pages, cancel-in-progress: false }`。
- `build` job 八步：checkout → setup-node@v4（node 22 + cache npm）→ `npm ci` → `bash scripts/ci/ci-assets.sh`（`secrets.ASSETS_SOURCE`）→ `npm run build`（app，`base: './'` 不动）→ `cd docs-site && npm ci && npm run build` → 合并 `site-dist/` → `actions/upload-pages-artifact@v3`。`deploy` job：`needs: build`、`environment: github-pages`、`actions/deploy-pages@v4`，只此一个 job 与托管绑定。
- 合并口径（票面警告的落地）：先 docs 后 app，`cp -a docs-site/.vitepress/dist/. site-dist/` + `cp -a dist/. site-dist/demo/`——两个去向不相交，不共用暂存根，不会互相覆盖。
- `.gitignore` 补 `/site-dist/`：票面未列，但本地复现合并步骤必然落这个目录，属必要卫生（由锁测一并锁住）。
- `tests/static/DocsSiteDeploy.test.ts`（10 条静态锁）：触发面 / 权限 / 并发组 / build job 接线 / 合并落点（含 `mv dist site-dist` 类负锁）/ 门禁边界（不跑 test、assets:check、ci-gate）/ 取素材无 `continue-on-error`（锁测 3 的静态兜底，对齐 ci.yml 同口径）/ PIPELINE_FILES 不含本文件（锁测 1 的拍定负锁）/ deploy job 只调托管动作无 `run:` / .gitignore。断言走 YAML 剥注释口径（对齐 ReleasePipeline 的 `bashCode`）；两条负锁做过变异验证（注入 `continue-on-error: true`、把本文件塞进 PIPELINE_FILES，均转红）。
- 锁测 1 拍定：**不纳入** `PIPELINE_FILES`——该扫描锁的是「发版与 Bestdori 在线状态解耦」，本 workflow 只构建发布站点、不在发版链路；决定以负锁形式落在新测试里，后人改纳入必须先过该测试既有的 Bestdori 断言。

**本地验收（不 push main 的完整验证路径，回答用户提问）**

- 复现 build job：`npm run build`（app，3.13s）→ `cd docs-site && npm run build`（2.59s）→ 按 workflow 同款命令合并。取件步骤与 release.yml 逐字相同、本地素材已在位，跳过重复取件。
- 按 GitHub Pages 项目站路径托管验证（site-dist 挂到 `/AAO-Editor/` 下起静态服务）：`/`、`/demo/`、`/guide/`、`/en/`、404.html、favicon 全 200；页面内引用资源（docs 侧 `/AAO-Editor/assets/*`、demo 侧 `/AAO-Editor/demo/assets/*`）全 200——base 接线两边都对。
- 锁测 3 反向验收本地坐实：六个素材根目录临时移开（模拟 CI 全新检出）+ 坏 `ASSETS_SOURCE` → `ci-assets.sh` 退出码 1、报错清晰指路；素材目录事后已还原。
- 全量 `npm test`：320 文件 / 3584 用例全绿；新增测试文件 eslint 0 问题、`tsc -p tsconfig.test.json` 对本文件 0 错误（存量错误均在未改动文件，与本次无关）。

**不 push main 的三种测试办法**

1. `workflow_dispatch` 支持从任意分支手动触发（Actions 页 → 选 workflow → Run workflow → 分支下拉选特性分支），不必合并 main。注意 deploy job 会真实发布到 Pages 站点——只想验构建可在 build job 结束后取消，或本地先跑通再 dispatch。
2. 本地复现 build job（本轮已做）：构建 + 合并 + 按 `/AAO-Editor/` 项目路径静态托管 + curl，覆盖除三个 GitHub Pages 动作（upload-pages-artifact / deploy-pages / environment）外的全部步骤。
3. 锁测 2 的「首次部署后 curl 200」属真实发布验收：需一次性前置（Settings → Pages → Source = GitHub Actions）+ main 经镜像落到 GitHub 后才能做。

**偏差 / 待办**

- setup-node 的 `cache: npm` 只按根 lockfile 出一个 key，docs-site 的 `npm ci` 复用同一份 `~/.npm`（初稿注释写「缓存 key 各自算」不符事实，已改准）。
- Actions artifact 部署不跑 Jekyll，未加 `.nojekyll`（branch 部署才需要）。

