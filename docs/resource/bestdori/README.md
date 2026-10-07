# Bestdori 资源归档（issue29 前置准备）

> **清单策略**（2026-08-25 修订）：完整 `manifest.json`（全部文件的元数据）和 `failures.json` 是 `scripts/fetch-bestdori-skins.mjs` 跑出来的**生成产物**，不进入 git。仓库仅保留 `manifest.example.json` / `failures.example.json` 作为 schema 样本；跑完脚本后请把两个完整 json 上传到 release 渠道（其它贡献者从 release 拉到本地，配合 `docs/resource/bestdori/jp/...` 二进制镜像消费）。

本目录是 [Bestdori](https://bestdori.com)（BanG Dream! 少女乐团派对）公开资源的**本地研究归档**，由 `scripts/fetch-bestdori-skins.mjs` 自动发现、下载并校验生成。归档目的是为 issue29（素材页面-键音素材包与皮肤）的后续皮肤映射工作、以及 chart-preview 仿真场（票 05）提供原始资料。**本目录内容不接入发行构建**：只有 dev 中间件（`vite.config.ts` 的 `/__bestdori-assets/` 前缀，仅 `serve` 阶段）在开发期直读；`public/assets/`、`dist/` 与安装包都不含这些文件。

## 资源分类

| 类别枚举 | 目录 | 来源（Bestdori assetPath） | 内容 |
| --- | --- | --- | --- |
| `rhythm-note-skin` | `<server>/rhythm-note-skins/` | `ingameskin/noteskin/skin*` 等普通包 | 普通音符皮肤：`RhythmGameSprites.png`、`longNoteLine.png`、`longNoteLine2.png`、`simultaneous_line.png`、`.sprites` |
| `directional-flick-skin` | `<server>/directional-flick-skins/` | `ingameskin/noteskin/directionalflickskin*` | 方向滑键皮肤：`DirectionalFlickSprites.png`、`FlickNoteLine_l/r.png`、`.sprites`；与普通音符皮肤组合使用 |
| `rhythm-note-se` | `<server>/rhythm-note-se/` | `sound/tapseskin/*` + `sound/common` | 击打音效（tap/flick/good/great/perfect 等）、方向滑键音效、技能键音效（`SE_RHYTHM_TAP_SKILL.mp3`）；独立音效类别，不与视觉皮肤绑定 |
| `fieldskin` | `<server>/fieldskin/` | `ingameskin/fieldskin/*` | 仿真场场地素材：`bg_line_rhythm.png`（轨道场地）、`game_play_line.png`（**场地判定线**，勿与 ADR-0004 的「判定线」混称）、`game_play_line_skill_adjust_effect.png`、`.sprites`；每包约 4 个文件（`.bundle` 按策略跳过） |
| `bgskin` | `<server>/bgskin/` | `ingameskin/bgskin/*` | 仿真场背景素材：`liveBG_normal.png`、`liveBG_fever.png` 为主；活动包另含 `equalizer*` / `speaker*` / `light_*` 等；`*preview` 包只有 `previewBG.png` |
| `reference-only/judgeskin` | `<server>/reference-only/judgeskin/` | `ingameskin/judgeskin/*` | 判定结果文字资源参考样本。**不是 issue29 音符皮肤候选项，不接入音符渲染器，也不是仿真场素材**（Bestdori 模拟器没有判定文字，HUD 只有 combo）；保留给未来「谱面预览 Auto 自动打歌」的判定结果显示用（2026-08-24 grill 登记）。 |

命名约定：

- 每个资源包按 Bestdori 原目录名加 `_rip` 后缀存放（如 `skin00_rip/`），与 Bestdori 解包路径一致。
- 包名以 `sample`（noteskin）或 `preview`（bgskin，如 `skin_mikupreview`）结尾的是 Bestdori 图鉴用的**预览包**（展示皮肤在谱面中的实际观感），manifest 中 `packageKind: "sample"` 标记；正式游戏资源为 `"main"`。
- manifest 中每条记录都保留 Bestdori 原始 `assetPath` 与来源 URL，整理本地目录不会丢失出处。

## 使用方法

```bash
# 预览待下载清单（不写任何文件）
node scripts/fetch-bestdori-skins.mjs --dry-run

# 全量归档默认 JP 服务器
node scripts/fetch-bestdori-skins.mjs --server jp --output docs/resource/bestdori

# 其他服务器（同一脚本可重复归档）
node scripts/fetch-bestdori-skins.mjs --server en --output docs/resource/bestdori

# 只补仿真场素材（chart-preview 04 的场地 / 背景；等价 npm 别名：npm run fetch:preview-assets）
node scripts/fetch-bestdori-skins.mjs --category fieldskin,bgskin
```

**仿真场素材的开发期直读**：跑过上面最后一条命令后，dev（`bash scripts/dev.sh`）会由 Vite 中间件把归档目录挂在
`/__bestdori-assets/<server>/<类别>/<包>_rip/<文件>`（如 `/__bestdori-assets/jp/fieldskin/skin00_rip/bg_line_rhythm.png`）。
**没跑过归档脚本的机器上没有这条通道的内容**：仿真场给空态并提示上面这条获取命令（预览页其余部分照常可用）；生产构建没有中间件。

脚本行为：

- **按清单下载**：先读 `_info.json` 目录树，再逐包读文件清单 JSON，不猜测文件名（正确处理 habahiro 多图、活动皮肤缺 `longNoteLine2.png` 等情况）。
- **校验**：HTTP 状态、Content-Type 与扩展名一致性、PNG 魔数、SHA-256；HTTP 200 的 HTML SPA 回退页一律判失败。
- **断点重跑**：已存在且哈希与 manifest 一致的文件自动跳过；源上消失的条目从 manifest 移除并提示。
- **失败不静默**：网络错误、清单缺失、类型不匹配全部写入 `failures.json`（含按策略跳过的 `.bundle` 记录），并以非零退出码结束。

## 文件说明

| 文件/目录 | 说明 | 入库 |
| --- | --- | --- |
| `manifest.example.json` | 原始四类各 ~12 条 schema 样本（新增两类的记录 schema 相同） | ✅ 入库 |
| `failures.example.json` | 原始四类各 3 条 schema 样本 | ✅ 入库 |
| `manifest.json` | 成功下载文件的完整元数据（SHA-256；文件总数随类别扩充） | ❌ 生成产物，`.gitignore` 忽略，走 release |
| `failures.json` | 失败 / 缺失 / 类型不匹配完整记录 | ❌ 生成产物，`.gitignore` 忽略，走 release |
| `<server>/…` | 各服务器资源镜像（大型二进制） | ❌ `.gitignore` 已忽略 |

## 版权与使用边界

- 所有资源版权归 © BanG Dream! Project（Craft Egg / Bushiroad）及相关权利方所有；本归档仅用于**本地研究与开发参考**（自用谱面编辑器的素材对照），不得再分发或商用。
- 归档与发行物分离：本目录内容**不复制进** `public/assets/`（含 `public/assets/skins/`）、`src/assets/audio/` 等运行时资源目录，也不进 `dist/` 与安装包；仿真场的开发期直读只走 dev 中间件（`/__bestdori-assets/`）——这不改变"不得再分发 / 仅供本地研究"的边界，打包 / 运行时拉取方案留后票（ADR-0016 §6）。
- `reference-only/judgeskin/` 仅用于确认判定资源形态，禁止作为可选皮肤实现；保留用途：未来谱面预览 Auto 自动打歌的判定显示素材（2026-08-24 grill 登记）。