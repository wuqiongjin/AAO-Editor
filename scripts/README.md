# Scripts

开发期工具脚本（不入运行时）。Bestdori 拉取约定见 [docs/research/bestdori-api.md](../docs/research/bestdori-api.md)。

## 日常

| 脚本 | 作用 |
| --- | --- |
| `dev.sh` | 启动 Vite 开发服务器（**唯一推荐入口**，见根目录 `AGENTS.md`） |
| `docs-dev.sh` | 启动 `docs-site/` VitePress 文档站（默认端口 4300、`DOCS_BASE=/`、云环境对外 URL） |
| `setup.sh` | 初次环境安装（`npm run setup`） |

`lib/dev-server.sh`：`dev.sh` / `docs-dev.sh` 共用的端口解析与占用清理（source 引入，不直接运行；改杀端口策略只改这一处）。

## Bestdori 谱面 / 音频

官方曲与社区谱**入口不同**（API 与 id 语义不同），共用 `lib/bestdori-*.mjs`：

| 脚本 | 对象 | 搜索 | 拉取谱面 | 音频（`--audio`） |
| --- | --- | --- | --- | --- |
| `fetch-bestdori-official.mjs` | 曲库 `songId` + 难度 | `--search <曲名>` | `GET /api/charts/...` | 官方 BGM |
| `fetch-bestdori-community.mjs` | 社区帖 `postId` | `--search` / `--username` | `GET /api/post/details` | custom / bandori |
| `fetch-stress-test-charts.mjs` | **issue 154 固定语料** → `docs/resource/StressTestChart/` | 内置谱师列表 | 官方 SPECIAL 全量 + 社区按谱师分目录（仅 chart 数组） | — |
| `replay-bestdori-chart-editor-io.mjs` | **issue 155** 官网制谱器 Apply/Copy/持久化逻辑重放 | — | 对照 `CommunityChartsNew` 内 `sanitizeAll` | — |

按谱师取谱（`post/list` 的 `username` 字段，未文档化，实测见
[bestdori-api.md §2.1](../docs/research/bestdori-api.md)）：

```bash
# 只列清单（postId / 难度 / level / 时间）
node scripts/fetch-bestdori-community.mjs --username Envy09 --limit all
node scripts/fetch-bestdori-community.mjs --username Envy09 --search GYARI --json

# 等级 / 难度过滤（客户端过滤：Bestdori 无服务端字段，见 bestdori-api.md §2.2）
node scripts/fetch-bestdori-community.mjs --username Envy09 --min-level 30 --diff special
node scripts/fetch-bestdori-community.mjs --min-level 39 --limit 5 --scan-limit 600

# 批量下载谱面本体：--download-dir 显式开启（并发 + 磁盘缓存 + index.json）
node scripts/fetch-bestdori-community.mjs --username Envy09 --limit all \
  --download-dir .cache/charts-Envy09
```

**批量抓取**：并发池、磁盘缓存、`index.json` manifest 在 `lib/bestdori-cache.mjs`。
`fetch-bestdori-community.mjs --download-dir` 下载当前列表结果；issue 154 大批量固定语料用 `fetch-stress-test-charts.mjs`。

缓存语义：谱面本体发布后不可再编辑（`/api/post/edit` 的 body 无 `chart` 字段），按字节缓存安全；
但 level / diff / rating / tags / likes 可被作者事后修改，缓存里这些是抓取时刻的快照，要最新用 `--refresh`。

示例：

```bash
# 不知道 id：先搜（表头含帖 id / 作者 / 发布时间 / 难度 / level / 点赞等）
node scripts/fetch-bestdori-community.mjs --search Henceforth --limit 10
node scripts/fetch-bestdori-official.mjs --search hekiten --json

# 再拉谱 + 音频
node scripts/fetch-bestdori-community.mjs 150030 -o chart.json --audio
node scripts/fetch-bestdori-official.mjs 515 expert -o chart.json --audio
```

未加 `--audio` 的拉取模式：`fetch-bestdori-community.mjs` 仍只向 stdout 输出谱面 JSON（便于管道）。搜索模式默认表格走 stdout、进度走 stderr；加 `--json` 可机器可读。

## 运行时资源包（不在本仓 · 取件）

二进制与生成物（注册表 `*.gen.ts`）由**外部快照仓库**提供；本仓只取件 —— 不产出、不记账（无清单 / 无哈希表）。

| 脚本 | 作用 |
| --- | --- |
| `assets-sync.mjs` | **取件**：拉取快照 → 把产物拷回工作区（缺才拉、按根整取）。`npm run assets:sync` / `npm run assets:check`；`setup.sh` 与 `dev.sh` 都调它 |

来源地址不直写明文（编码在脚本常量里）；要换来源用环境变量或参数：
`ASSETS_SOURCE=<本地目录|git 地址> npm run assets:sync`（或 `--from <…>`）。

取回的产物（都在 `.gitignore` 里）：`public/assets/skins/`、`public/assets/sim/`、
`src/assets/audio/keysounds/`、`src/rendering/skin/gen/`、`src/audio/gen/`。
仿真场的 URL 约定见 `src/preview/video/sim/simAssets.ts`；口径与决策见
`.scratch/release-pipeline/issues/02-素材迁出与内部镜像同步.md`。

## CI / 发布（ADR-0022 · release-pipeline 07 / 09）

CI 脚本住 `scripts/ci/`（门禁与发版链路共用，入口文件 `.cnb.yml` / `.github/workflows/ci.yml` / `.github/workflows/release.yml`）：

| 脚本 | 作用 |
| --- | --- |
| `ci/ci-assets.sh` | 素材取件（CI 用）：`ASSETS_SOURCE`（secret 注入）> 内置默认源（CNB 地址 + `CNB_TOKEN` 自动拼凭据——内置 token 仅限当前仓，外部素材源必须走 `ASSETS_SOURCE`） |
| `ci/ci-gate.sh` | 质量门禁：`npm ci` → 取素材 → `npm test` → `npm run build` → `npm run assets:check`（`lint` / `test:types` 存量债清一项收一项）。三处共用：CNB 门禁 job、GitHub PR 门禁（`ci.yml`）、GitHub 发版门禁（release.yml `gate` job） |
| `ci/ci-mirror-github.sh` | CNB → GitHub 代码镜像：**非 force** 推 `main` + tags，分叉即失败（PR 回流纪律见 ADR-0022 §2） |
| `ci/ci-mirror-installers.mjs` | 国内下载副本（cron）：GitHub latest release → CNB release，并改写 `latest*.yml` 为匿名 generic feed；幂等（缺谁补谁，yml 未改写则补） |

GitHub 侧门禁（ADR-0022 §9）：`ci.yml` 只在 `pull_request → main` 上跑（镜像 push 不触发，不与 CNB 双边重复跑），必过检查名 `gate`；`main` 分支规则与 `v*` tag 规则、PAT bypass 名单、Actions 权限收紧见 ADR-0022 §9 与票 09「人工步骤」。

发版路径（`v*` tag push / 手动 dispatch）另有兜底：release.yml 的 `gate` job 先跑同一套三件套（ubuntu 单平台）才进三平台矩阵——tag 规则保留「PAT + 管理员」均可建 tag（用户 2026-10-20 拍板 B：直推灵活性要保留），直推的 tag 没过 CNB 门禁，由这一关兜底：跑不过门禁的 tag 发不出正式 Release。代价是常态发版门禁跑两次（CNB + GitHub 各一次），拍板时接受。

发版流程：CNB 上 `npm version` + 打 `v*` tag → 门禁 → 镜像到 GitHub → GitHub Actions 三平台矩阵构建并发布正式 Release（`latest*.yml` 随包，updater 立即可见）。secret 清单见票 07「人工步骤」。

版本发行说明的单一来源是仓库根的 `RELEASE_NOTES.md`（**发版前更新、随发布提交**；`package.json` 的 `build.releaseInfo.releaseNotesFile` 指向它）：electron-builder 读它写进 `latest.yml` 的 `releaseNotes`（产品内「重启更新」弹窗展示，ADR-0021 §2），workflow 的 `notes` job 再把它拼进 GitHub Release 正文。未签名告知由 workflow 自动加，不写进该文件。

## 验收 / 取证（非 CI 默认）

| 脚本 | 作用 |
| --- | --- |
| `verify-slide-band-order.mjs` | issue 115 / ADR-0009：滑条带体与参考截图像像素 IoU 复核（需 esbuild + 本地 PNG） |
| `preview-shot.mjs` | 静态预览像素验收：建工程 → 贴样例谱 → 预览页抓面板原生位图（`toDataURL`）+ 工作台对照；打印舞台盒与面板宽（`VIEWPORT` / `DSF` 可改视口，票 10 用 `VIEWPORT=1490x748`）（需 playwright + dev server） |
| `measure-export-limits.mjs` | 导出链路与尺寸实测（chart-preview 06）：画布单边 / 面积上限与超限行为、3 / 5 分钟谱宽图导出的耗时与峰值内存、仿真场单帧成本、WebCodecs 编码可用性与吞吐、MediaRecorder 对照（需 playwright + dev server；`--only=` 分节、`--json=` 落盘）。**一次性探针、不在 CI**：留着是当 `docs/research/chart-preview-export-limits.md` 那组数字的复算 / 复验入口（换机器 / 换 Chromium 版本 / 改编码参数后重跑可比）；它 import 的是 `/src/...` 绝对路径，模块搬家后会跑不起来，到时删掉即可 |
| `sim-shot.mjs` | 仿真场像素验收（chart-preview 05）：建工程 → 贴样例谱 → 预览页切「动态预览」→ 抓**场地 canvas 原生位图**（暂停 / 播放中 / seek 中段 / seek 末段）+ 页面截图，打印场地比例与位图尺寸；素材缺席时打印 04 的空态与获取命令（同需 playwright + dev server） |
| `verify-backflow-band-fill.mjs` | issue 45：倒流区带体填充的位图验收（单测锁测的**替代证据**——记录型 ctx 不光栅化，nonzero 抵消只在光栅阶段显形）：载入 dzilas 150030 → 动态预览 → 暂停态 seek 到倒流区内若干秒（默认 5.0/8.0/11.0/12.5）→ 抓 `.pv-field__canvas` 位图，用 node 侧**真实 `drawSimFrameAt`** 算出的期望四边形逐条采样中线（带体色族）；`--label` + 另一个 worktree 的 dev server 可做修前 / 修后 A/B（需 esbuild + playwright + dev server；谱面在本地语料 `docs/resource/`，可用参数覆盖） |
| `verify-band-material.mjs` | issue 46：动态预览带体材质 / 叠亮的位图验收（零外部语料——脚本内造两条同轨错时竖滑条）：动态预览 seek 到 1.5s → 抓 `.pv-field__canvas` → 按体色反算 α，断言单层半透明、双层重叠更亮、亮缘比中线亮（需 playwright + dev server） |

一次性 Playwright 探针历史上在迭代后已删除；需要浏览器实测时优先 vitest / 手工清单，或按 issue 说明临时写脚本（不必长期留在本目录）。
