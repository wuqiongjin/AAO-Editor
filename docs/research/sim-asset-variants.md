# 仿真场素材种类盘点（背景 / 轨道）

> 调研日期 2026-10-11 · 目的：评估「动态预览的背景、轨道素材应该有更多种类」的可取范围与成本。
> 结论只服务决策；票内引用本文，不复制数据。

## 1. 现状（应用侧）

`src/preview/video/sim/simAssets.ts` 把包与文件名**全部写死**：

```text
bgskin/<server>/skin00_rip/liveBG_normal.png
fieldskin/<server>/skin00_rip/bg_line_rhythm.png
fieldskin/<server>/skin00_rip/game_play_line.png
```

- 唯一的选择维度 = 服务器探测 `jp → en → tw → cn → kr`（命中与否只看 `field` 是否加载成功）。
- `SIM_SKIN_PACK = 'skin00_rip'` 与三个文件名是常量，**没有包注册表、没有设置字段、没有 UI**。
- 镜像仓 `update.sh` 也只 `--package skin00`；`tools/stage-sim-assets.mjs` 只摆 `skin00_rip`。
- 本地已取到但未被引用的图：`liveBG_fever.png`、`game_play_line_skill_adjust_effect.png`。

## 2. 上游可选范围（Bestdori `jp` 实测）

目录协议：`https://bestdori.com/api/explorer/jp/assets/_info.json`（615 KB）；
包清单 `.../assets/ingameskin/<category>/<pack>.json`；
文件 `https://bestdori.com/assets/jp/ingameskin/<category>/<pack>_rip/<filename>`。

### fieldskin（轨道 / 场地图）：**33 个叶子包**

`skin00`–`skin14`（15 个编号包）+ 主题包
`collabo23_summer_g` `habahiro` `skin_april2019` `skin_april2021` `skin_april_2024` `skin_bike`
`skin_cafe` `skin_coin` `skin_collabo24_autumn_i` `skin_collabo25_autumn_s` `skin_delta`
`skin_gbp2020` `skin_maid` `skin_miku` `skin_persona` `skin_satan` `skin_stage` `skin_witch`

每包固定 5 个文件：`.sprites` / `bg_line_rhythm.png` / `game_play_line.png` /
`game_play_line_skill_adjust_effect.png` / `*.bundle`（`.bundle` 现有脚本按策略跳过）。

### bgskin（表演背景）：45 个条目 ≈ **25 个真包 + ~19 个 `*preview` 变体**

真包（括号内 = PNG 数）：
`habahiro(4)` `skin00(3)` `skin02(3)` `skin03(4)` `skin_5th(4)` `skin_april2019(4)`
`skin_april2021(4)` `skin_april_2024(4)` `skin_bike(4)` `skin_cafe(4)` `skin_coin(4)`
`skin_collabo23_summer_g(4)` `skin_collabo23_winter_d(11)` `skin_collabo24_autumn_i(4)`
`skin_collabo25_autumn_s(4)` `skin_delta(11)` `skin_gbp2020(23)` `skin_maid(6)` `skin_miku(27)`
`skin_persona(29)` `skin_satan(43)` `skin_stage(4)` `skin_teamlivefestival(13)` `skin_witch(4)`
`skinpractice(2)`

**主背景图命名不统一**（影响"硬编码文件名"能不能继续用）：

| 命名 | 出现的包 |
| --- | --- |
| `liveBG_normal.png`（+ `liveBG_fever.png`） | `skin00` `skin02` `skin03` |
| `liveBG.png`（+ `liveBG_fever.png`） | 其余主题包 |
| `liveBG_layer1/2.png` 附加层 | `skin02` `skin03` |
| 无 `liveBG*` 命名 | `skinpractice`（1 张）、`skin_teamlivefestival` |

大包（`skin_satan` 41 / `skin_persona` 27 / `skin_miku` 25 / `skin_gbp2020` 21 张 PNG）多出来的是
`equalizer*`（均衡器频谱，8×2 帧）、`light_*`、`speaker*_left/right` —— **逐帧特效层**，
静态单图背景模型用不上，取件时应过滤。

### 名称可配对性（背景 ↔ 轨道）

同名成对的有 20 个（`skin00` `skin02` `skin03` `habahiro` `skin_april2019` `skin_april2021`
`skin_april_2024` `skin_bike` `skin_cafe` `skin_coin` `skin_collabo24_autumn_i`
`skin_collabo25_autumn_s` `skin_delta` `skin_gbp2020` `skin_maid` `skin_miku` `skin_persona`
`skin_satan` `skin_stage` `skin_witch`）。
不配对：轨道独有 `skin01` `skin04`–`skin14` `collabo23_summer_g`；背景独有 `skin_5th`
`skin_collabo23_winter_d` `skin_teamlivefestival` `skinpractice`。

## 3. 尺寸与体积（实测 HTTP HEAD + PNG IHDR）

| 文件 | 像素 | 体积 |
| --- | --- | --- |
| `bg_line_rhythm.png`（场地图） | 1160×610（各包一致） | 30–48 KB |
| `game_play_line.png`（判定线） | 1800×38 | ≈2 KB |
| `liveBG*.png`（表演背景） | 2048×1024（各包一致） | 280–523 KB |

粗算（只取用得上的文件，跳过 `.bundle` / 特效层 / `*preview`）：

- 轨道全量 33 包 ≈ **≤2 MB**（场地图 ~40 KB + 判定线 2 KB）；
- 背景全量 25 包：**只取主图 ≈ 10 MB**，含 `liveBG_fever` ≈ **20 MB**。

安装包侧这些 PNG 走 `public/assets/**` → `dist/assets/**` → Electron 打包 `dist/**/*`，
即**体积直接进安装包**。这是"全量 vs 策展"的核心代价。

## 4. 与现有「谱面背景皮肤」的关系（别混）

`settings.visual.backgroundSkin` 是**画布**的单张本地图（IndexedDB `bangdream.assets` /
Electron `<数据根>/assets/background-skin.bin`），带 `opacity` / `fit` / `scope`；
它**既不进仿真场，也不进静态预览面板**（`panelPainter.ts` 明确不画）。
ADR-0003 已定"不做预置背景包（后续可扩）"。

## 5. 待拍板（不在本文结论里）

- 取件范围：轨道 / 背景全量 vs 策展子集；特效层（`liveBG_fever` / equalizer）取不取；
- 选择模型：背景与轨道**各自独立**选择 vs **成对整包**选择；
- 用户可见命名与选择器形态（`skin07` 这类编号包怎么让人认出来 —— 缩略图 vs 文字列表）；
- 注册表形态：镜像仓生成 `*.gen.ts`（照 `noteSkinRegistry.gen.ts`）vs 应用侧清单。
