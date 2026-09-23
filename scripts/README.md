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
| `fetch-bestdori-community.mjs` | 社区帖 `postId` | `--search <关键字>` | `GET /api/post/details` | custom / bandori |

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
| `verify-slide-band-order.mjs` | issue 115 / ADR-0009：滑条带体与参考截图像素 IoU 复核（需 esbuild + 本地 PNG） |

一次性 Playwright 探针历史上在迭代后已删除；需要浏览器实测时优先 vitest / 手工清单，或按 issue 说明临时写脚本（不必长期留在本目录）。
