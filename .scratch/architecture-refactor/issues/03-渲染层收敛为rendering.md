# 03-渲染层收敛为rendering

Type: chore
Status: open
Blocked by: 02

## 来源与目标

- **来源**：谱面渲染与视效代码目前被切分在两个平级地方：
  1. `src/visual/`（包含 Canvas 渲染管线 `render.ts`、图层缓存 `staticLayerCache.ts`、`noteLayerCache.ts`、几何计算 `slideBandGeometry.ts`、命中测试 `hitTest.ts` 等）；
  2. `src/chart/rendering/`（包含背景图层 `backgroundSkin.ts`、音符图标字形 `NoteIconGlyph.tsx`、皮肤预览 `NoteSkinPreview.tsx` 等）。
  这种割裂导致未来的“完整谱面静态长图导出”与“谱面动态视频预览”难以清晰复用底层的音符与带体绘制基元。
- **目标**：
  1. 将 `src/visual/` 与 `src/chart/rendering/` 合并收敛为顶层的统一渲染基元域 `src/rendering/`。
  2. 将纯几何与状态渲染基元（Primitive Renderers）提炼为无状态/纯函数式绘制逻辑，使工作台 Canvas、静态全谱离屏 Canvas、动态视频预览帧驱动能共同调用同一份绘制实现。
  3. 彻底将 `src/chart/` 纯化为“谱面数据结构（Note, BPM, Code）+ 几何与时间计算（Timeline, Coordinates）+ 编辑算法与手势（Editing, Gesture）”。

## 现状与重构落点

1. **统一渲染目录结构**：
   - 建立 `src/rendering/`：
     - `primitives/`：单键、滑键、方向键、BPM 线、节拍线、滑条带体（Band）、判定线绘制纯函数。
     - `pipeline/`：图层缓存、瓦片划分、重绘脏标记。
     - `skin/`：音符皮肤注册表（`gen/noteSkinRegistry.gen.ts`）、皮肤取样与背景皮肤管理。
     - `hitTest/`：音符与滑条子部分的几何命中判定。
2. **迁移与清理**：
   - 清理 `src/chart/rendering/`，将其移入 `src/rendering/` 对应子目录。
   - `src/visual/` 代码整体迁入 `src/rendering/`，移除废弃的平级引用。
   - 更新所有涉及 Canvas 渲染的单测和回归断言。

## 锁测要求

- 渲染与几何测试全部绿灯：
  - `tests/unit/visual/render/*.test.ts`
  - `tests/unit/visual/cache/*.test.ts`
  - `tests/unit/visual/hitTest/*.test.ts`
  - `tests/unit/visual/skin/*.test.ts`
  - `tests/perf/RendererPerf.test.ts`
  - `tests/perf/PlaybackFrameBaseline.test.ts`

## Comments
