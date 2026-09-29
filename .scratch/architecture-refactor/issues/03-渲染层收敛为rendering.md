# 03-渲染层收敛为rendering

Type: chore
Status: open
Blocked by: 02

> **2026-09-29 复核修订**：本票 2026-09-26 开出后未开工。期间 `src/chart/rendering/` 新增了皮肤预设缩略图一族（票 42），`src/visual/` 与 `src/chart/rendering/` 的互相 import 比出票时更密。本版重写文件清单与锁测；**并下调目标 2 的野心**：本票只做搬运与单向化，"提炼纯函数式绘制基元"改为按需延后（见「范围修正」）。

## 来源与目标

- **来源**：谱面渲染与视效代码被切在两处，且**互相 import**：
  1. `src/visual/`：Canvas 渲染管线、图层缓存、几何、命中测试、皮肤取样；
  2. `src/chart/rendering/`：背景图层、音符字形、皮肤预览 / 预设缩略图。
  割裂让未来的"完整谱面静态长图导出"与"动态视频预览"难以复用同一份绘制基元。
- **目标**：
  1. `src/visual/` + `src/chart/rendering/` 合并为顶层 `src/rendering/`；
  2. 消除两目录互相 import，依赖单向：`rendering → chart`（数据/几何）而不是双向；
  3. `src/chart/` 收敛为"谱面数据结构 + 几何与时间计算 + 编辑算法与手势"。

## 范围修正（2026-09-29）

- 原目标 2"把绘制提炼为无状态纯函数、供三种驱动共用"**不在本票做**：目前没有静态导出 / 视频预览的真实调用方，先提炼会按猜测设计接口（YAGNI）。本票只保证目录合并后**基元入口唯一**（`src/rendering/index.ts`），等 04 或相关特性真开工时再按需拆分 `render.ts`。
- 原目标 3 的"彻底纯化 `src/chart/`"由 02 票（Editor 迁出）+ 本票（rendering 合并）共同达成，不单独再拆 `chart/editing`、`chart/geometry`。

## 现状核对（2026-09-29）

### 两目录清单

`src/visual/`（02 票搬走 `AssetsPage.tsx` 后剩 15 个文件）：

```
render.ts  coords.ts  hitTest.ts  types.ts  index.ts（barrel）
staticLayerCache.ts  noteLayerCache.ts  noteMetrics.ts
gridStyle.ts  gutterLabels.ts  playbackMarker.ts  selectionStyle.ts  slideBandGeometry.ts
noteSkin.ts  gen/noteSkinRegistry.gen.ts（脚本生成，入库）
```

`src/chart/rendering/`（9 个文件）：

```
backgroundSkin.ts  useBackgroundSkin.ts
noteGlyph.ts  NoteIconGlyph.tsx
noteSkinPreviewDraw.ts  noteSkinPreviewLayout.ts  NoteSkinPreview.tsx
noteSkinPresetThumbnail.ts  NoteSkinPresetThumbnail.tsx
```

### 互相 import 的实证（合并的直接理由）

- `src/chart/rendering/{noteGlyph,NoteIconGlyph,noteSkinPresetThumbnail,NoteSkinPresetThumbnail,noteSkinPreviewDraw,noteSkinPreviewLayout,NoteSkinPreview}` → `src/visual/*`
- `src/visual/AssetsPage.tsx` → `src/chart/rendering/{NoteSkinPreview,NoteSkinPresetThumbnail,backgroundSkin,useBackgroundSkin}`（02 票把该页搬去 `pages/assets/`，但反向依赖要等本票消净）
- 平级下两个"渲染的家"没有边界，新人无法判断新文件放哪边。

### 生产侧消费者（迁移后需单向）

`src/chart/components/canvas/FinalVirtualCanvas.tsx`、`src/chart/config/AppSettings.ts`（吃 `gen/noteSkinRegistry.gen`）、`src/chart/editing/{CanvasGesture,GestureSession}.ts`、`src/pages/workspace/Toolbar.tsx`（02 后路径）、`src/playback/PlaybackMarkerCard.tsx`。

### 生成脚本耦合

`scripts/build-note-skins.mjs` 里 `REGISTRY_OUT = 'src/visual/gen/noteSkinRegistry.gen.ts'`（第 28 行）——迁移必须同步改，否则下一次生成会写丢。

## 目标结构

```
src/rendering/
  index.ts                 ← src/visual/index.ts 的 barrel（对外唯一入口，原导出面不动）
  render.ts  types.ts      ← 绘制管线主体（本票不拆）
  coords.ts  gridStyle.ts  gutterLabels.ts  playbackMarker.ts  selectionStyle.ts  slideBandGeometry.ts
  primitives/              ← noteGlyph.ts  NoteIconGlyph.tsx  noteMetrics.ts
  pipeline/                ← staticLayerCache.ts  noteLayerCache.ts
  skin/                    ← noteSkin.ts  gen/  backgroundSkin.ts  useBackgroundSkin.ts
                              NoteSkinPreview.tsx  noteSkinPreviewDraw.ts  noteSkinPreviewLayout.ts
                              NoteSkinPresetThumbnail.tsx  noteSkinPresetThumbnail.ts
  hitTest/                 ← hitTest.ts
```

- 顶层散文件（`render/coords/...`）**保持原样**，不要为了"好看"再分桶；只在 `primitives / pipeline / skin / hitTest` 四处归位。
- `src/visual/`、`src/chart/rendering/` 两个目录连名字一起消失。

## 重构落点

1. `git mv` 上表全部文件 + `index.ts`/`gen/`；`src/rendering/` 内互相引用改相对路径。
2. 全仓 import 改指 `src/rendering/...`（生产侧 6 处 + 测试侧见下）。
3. `scripts/build-note-skins.mjs` 的 `REGISTRY_OUT` 改新路径；`scripts/measure-note-bounce.mjs` 注释里的 `src/visual/noteLayerCache.ts` 同步改（注释也在教人做事）。
4. `tests/unit/visual/` 整目录 → `tests/unit/rendering/`（README：unit 子目录镜像 `src/` 领域）。
5. 收尾断言：`src/rendering/` 不得 import `src/chart/` 之外的 UI 层；`src/chart/rendering/`、`src/visual/` 不再存在。

## 锁测要求

**净值网**：迁移前后 `npm test`（164 文件 / 1919 用例）与 `npx tsc -b` 全绿；除路径 / import 外无 diff。

必须同步修改的测试（2026-09-29 逐条 grep 所得）：

- **整目录迁移**：`tests/unit/visual/**` 27 个文件 → `tests/unit/rendering/**`（`cache/` `hitTest/` `render/` `skin/` 四个子目录保留结构）。
- **import 路径类**：`tests/perf/{RendererPerf,PlaybackFrameBaseline,InteractionPerf,HighZoomBackflowSpCost,SpBandRasterClip}.test.ts`、`tests/unit/chart/editing/{CanvasGesture,GestureSession}.test.ts`、`tests/unit/chart/geometry/BackflowGeometry.test.ts`、`tests/unit/visual/skin/NoteSkinPresetThumbnail.test.ts`（读 `src/visual/AssetsPage.tsx` 文本，02 后已改指 `src/pages/assets/AssetsPage.tsx`）。
- **字面路径类**：`tests/static/{SlideFlickDecorator,SlideNodeOverBands,SpBandRasterClip}.test.ts`（断言渲染接线事实，只改路径常量）。
- **生成物看守**：`tests/unit/visual/skin/NoteSkin.test.ts` 一族依赖 `gen/noteSkinRegistry.gen`——迁移后跑一次 `node scripts/build-note-skins.mjs` 确认生成路径与新位置一致、`git diff` 无内容变化。

## Comments
