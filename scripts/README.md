# Scripts

开发期工具脚本（不入运行时）。Bestdori 拉取约定见 [docs/research/bestdori-api.md](../docs/research/bestdori-api.md)。

## 日常

| 脚本 | 作用 |
| --- | --- |
| `dev.sh` | 启动 Vite 开发服务器（**唯一推荐入口**，见根目录 `AGENTS.md`） |
| `setup.sh` | 初次环境安装（`npm run setup`） |

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

## Bestdori 素材归档（皮肤 / 键音）

| 脚本 | 作用 |
| --- | --- |
| `fetch-bestdori-skins.mjs` | 拉取 jp 等服皮肤、键音等到 `docs/resource/bestdori/`（gitignore） |
| `fetch-target-note-skins.mjs` | 按目标列表补拉音符皮肤（依赖上者框架） |
| `build-note-skins.mjs` | 归档 → `public/assets/skins/` + 生成 `noteSkinRegistry.gen.ts` |
| `build-key-sounds.mjs` | 归档 → 键音包注册表 |
| `note-skin-overrides.json` | `build-note-skins.mjs` 的手工覆写配置 |

## 验收 / 取证（非 CI 默认）

| 脚本 | 作用 |
| --- | --- |
| `verify-slide-band-order.mjs` | issue 115 / ADR-0009：滑条带体与参考截图像像素 IoU 复核（需 esbuild + 本地 PNG） |
| `preview-shot.mjs` | 静态预览像素验收：建工程 → 贴样例谱 → 预览页抓面板原生位图（`toDataURL`）+ 工作台对照；打印舞台盒与面板宽（`VIEWPORT` / `DSF` 可改视口，票 10 用 `VIEWPORT=1490x748`）（需 playwright + dev server） |

一次性 Playwright 探针历史上在迭代后已删除；需要浏览器实测时优先 vitest / 手工清单，或按 issue 说明临时写脚本（不必长期留在本目录）。
