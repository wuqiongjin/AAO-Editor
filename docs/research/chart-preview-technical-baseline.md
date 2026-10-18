# 谱面预览：形态调研与现有能力盘点（2026-09-30）

> 对应 effort `chart-preview` / 票 01。只记**可复核的事实**与**外部实现对照**，不做决策（决策走 ADR / 票内定案）。
> 相关：[bestdori-chart-editor-io.md](./bestdori-chart-editor-io.md)（同一份 bundle 的读写口径）、[ADR-0004 播放预览交互](../adr/0004-播放预览交互.md)、[ADR-0006 画布动态渲染面与判定线贴底](../adr/0006-画布动态渲染面与判定线贴底.md)。

## 0. 结论速览

| 问题 | 事实 |
| --- | --- |
| 仓库现在有预览代码吗 | **没有**（`src/preview/` 不存在；全仓无 `MediaRecorder` / `captureStream` / WebCodecs） |
| 动态预览要从零造吗 | **不必**：自动回放的时钟、滚动、键音、判定线贴底渲染都已经在跑（§2.2），缺的是"只读预览壳 + 固定尺寸帧驱动 + 导出" |
| 静态预览的"分栏"有现成支持吗 | 渲染器本身支持"任意 pos 窗口出帧"（`RenderTarget` + `renderTile` 先例），**没有**分栏布局 / 面板懒绘制这一层 |
| 单张长图可行吗 | **分栏折行图可行；单条超高长图受浏览器画布上限约束**（§3.3：3 分钟谱 79,200 px ＞ 单边 65,535 px） |
| 视频导出有现成通道吗 | 无。落盘只有"JSON 文本另存为" + 两处字节 IPC（§2.4）；编解码零代码 |
| 素材够做"像游戏一样"吗 | **不够**：运行时只有 12 套音符皮肤，没有场地 / 背景 / 判定素材，且 Bestdori 归档有"不接入运行时"边界（§2.5） |

## 1. Bestdori 的两种预览（bundle 反编译）

复算（与 `bestdori-chart-editor-io.md` §2 同一份产物，sha256 前缀一致）：

```bash
curl -sL 'https://bestdori.com/community/charts/new' | grep -oE 'CommunityChartsNew\.[a-f0-9]+\.js|app\.[a-f0-9]+\.js' | sort -u
sha256sum .cache/bestdori-bundles/CommunityChartsNew.b534f9a9.js   # face219f2ca5…7394e4
grep -o '773b1675\|691780a2' .cache/bestdori-bundles/CommunityChartsNew.b534f9a9.js
```

两个组件同属 `/tool/chartsimulator`（外层 `MyChartSimulatorDisplay`）：`MySongChart`（静态预览，Vue scope `773b1675`）+ `MySongSimulator`（动态模拟器，scope `691780a2`）。

### 1.1 静态预览 = 折行长图（时间竖切 → 面板横排 → 横向滚动 → 懒绘制）

计算方法（`computed` 原样）：

```
laneWidth      = 10 × chartZoom × scaling                 // scaling = devicePixelRatio × styleGraphicsQuality
panelWidth     = 13 × laneWidth                           // 面板宽（含左右留白）
panelHeight    = 容器 clientHeight × scaling
heightPerSecond= 150 × chartVertical × chartZoom × scaling // 纵向密度，默认 150 px/秒
panels         = ceil(maxTime × heightPerSecond / panelHeight)
```

- **面板 = 一段时间窗**：面板 `k` 覆盖秒区间 `[k·D, (k+1)·D)`，`D = panelHeight / heightPerSecond`（默认量级 ≈ 3.6 秒）。
- **排布**：面板按序号**横向**排开（`<canvas style="left: k × panelWidth/scaling">`），容器横向滚动；`viewMin = container.scrollLeft`、`viewMax = viewMin + clientWidth` → `minPanel/maxPanel` → `dirtyCanvasIndexes` **只画尚未渲染过的可见面板**（每面板一张 canvas，`canvasRenderedArray` 记账）。
- **面板内时间向上**：元素 y = `(panelEndTime − time) × heightPerSecond`——与游戏同向（判定线在底、谱面在下，时间往上长）。
- **可定制项（17 项，全落 `tool/chartsimulator/*`）**：`chartZoom` / `chartVertical` / `chartCombo` / `chartFever` / `chartBPM` / `chartTime` / `chartBeat` / `chartSkill` / `styleNoteSize` / `styleLongAlpha` / `styleDualLine` / `styleOffBeat` / `styleMirror` / `styleLaneType` / `styleNoteType` / `styleDirectionalFlickType` / `styleGraphicsQuality`。
- **hover 读数**：`drawHover()` 画一条横穿轨道的白线，左沟槽给 `SS.ss`（分内时间，`formatTimeAccurate` = `(t%60).toFixed(2)`），右沟槽给"到该处的 combo 数"。
- **没有导出**：bundle 内 `toBlob` 0 处、`toDataURL` 1 处（hover 光标用途）；无图片/视频落盘路径。

### 1.2 动态预览 = 实时模拟器（游戏仿真场的现成参照），同样没有导出

**画面模型**（`MySongSimulator` 的 `computed` + `drawCanvas` 原样）：

```
设计面        1334 × 750（游戏原生比例）；canvas = stage × (devicePixelRatio × styleGraphicsQuality)
laneWidth     154 × W/1334          laneHeight 0.82 × H
坐标          原点 (W/2, 0)；y=1 即场地判定线；音符/带体都画在 setTransform(laneWidth·A, 0, 0, laneHeight·A, W/2, 0) 里
接近模型      A = 0.05 + 0.95 × 1.1^(50·(t_now − t_note)/T)，T = (12 − simNoteSpeed)/2 秒（**Bestdori 自己**封在档位 1..11 → 5.5s..0.5s；它的 `my-numeric-input` 是 min 1 / max 11 / small .1 / large .5。本项目按**现代游戏**取 1..12；映射本体见 CONTEXT「接近模型」—— 票 24 只接了上面这一支 + 0.1s 地板，票 48（2026-10-18）起换成游戏分段映射 `n ≤ 11 → (12 − n)/2`、`n > 11 → (16 − n)/10`（12 档 = 0.4s，与游戏同速））
音符          官方 per-lane 精灵：drawImage(sprite[lane·d], lane·d − a/2, 1 − s/2, a, s)，a = 1.35 × styleNoteSize
带体          相邻结点 (lane, A) 两点构成的四边形填充；颜色从 longNoteLine.png 中心像素采样
同时点击线    simultaneous_line.png 精灵
```

- **伪透视**：轨道是竖直平行的（没有梯形变换），"透视感"来自 A 同时缩放 x 与 y（越远越靠中、越小）+ 场地图自带梯形美术。
- **场地/背景是 DOM `<img>`**（`fieldskin/skin00_rip/bg_line_rhythm.png`、`game_play_line.png`；`bgskin/skin00_rip/liveBG_normal.png`），音符画在一张 canvas 上（`width=1868 height=1050` ↔ CSS `934 × 525`）。
- **特效全程序化自绘**：lane 闪 = 线性渐变（白 0.5 → 0）+ 按轨道 shear；tap 特效 = 圆 / 环 / 光柱 / 槽，按类型配色（tap 青、flick 粉、skill 黄、方向键紫 / 橙）；HUD 的 digits / combo / particles 是 **Bestdori 自绘的三张 sprite**（`/res/sprites/{digits,combo,particles}.png`）。
- **HUD 只有 combo**（画在 `0.85W, 0.4375H` 一带）；**没有判定文字、没有分数**——`isPerfectLoaded` 一族全是**音效**加载（`/sound/tapseskin/*_rip/perfect.mp3`），不是判定素材。
- 选项（`tool/chartsimulator/*`）：`simNoteSpeed` / `simNoteSE` / `simNoteSEVolume` / `simTapEffect` / `simLaneEffect` / `styleNoteSize` / `styleLongAlpha` / `styleDualLine` / `styleOffBeat` / `styleMirror` / `styleLaneType` / `styleNoteType` / `styleDirectionalFlickType` / `styleBackgroundType` / `styleGraphicsQuality`。
- 播放条：播放/暂停 + 时间码 + 进度 + 下拉。
- **全 bundle 0 处** `MediaRecorder` / `captureStream` / `VideoEncoder` / `AudioEncoder` / `toBlob`；`mp4` 只出现在曲目 MV / 剧集资源 URL（`app.d390adb1.js`）。

→ 对照含义：Bestdori 的"静态预览"实质就是**折行长图 + 横向滚动 + 懒绘制**（不是一次画一张巨图）；它的"视频"是**实时模拟器、不带导出**。视频导出在本项目里属"无人可对标"的新能力；而"游戏仿真场"这一档有现成参照可搬模型（素材只需新增 `fieldskin` / `bgskin` 两类，判定资源用不上）。

## 2. 我方现有能力盘点（可复用面）

### 2.1 渲染：离屏出帧的地基已就位

- 入口：`createRenderTarget({ canvas, surface, dpr })`（`src/rendering/RenderTarget.ts`）、`frameFor(target, view)`、`target.renderFrame(view)`（`src/rendering/render.ts`）。文件头注释明写"工作台画布是 target 之一；**离屏导出 / 未来预览各建自己的 target**"。
- 一帧的全部输入 = `FrameView`（`src/rendering/types.ts`）：`geometry` / `viewport(scrollX, scrollY, scale)` / `notes` / `beatDisplay` / `display` / `noteIcons` / `background` / `markerSeconds` …；`surface` + `dpr` 由 target 补。
- **帧里没有 `seconds`**，只有 `viewport.scrollY`（虚拟 px）；`src/playback/PlaybackScrollModel.ts` 提供 `scrollYForSeconds(seconds) = chartEndVirtualY − seconds × virtualPxPerSecond`。
- 渲染域 **零 React**、不读 CSS 布局（surface 由调用方注入）。DOM 触点仅：3 处 `document.createElement('canvas')`（两层缓存的默认位图工厂，可注入替身）、`new Image()`（SP 带剖面 / 音符图集）。
- **"任意片段出帧"已有先例**：`src/rendering/pipeline/noteLayerCache.ts` 的 `renderTile` 按 pos 区间画独立位图。

### 2.2 播放：自动回放已经完整

- 秒的唯一真相源 = `src/audio/AudioEngine.ts`（双时钟：有音频走 `ctx.currentTime`，无音频走 `performance.now` 合成时间线）。
- RAF 驱动 = `src/playback/usePlaybackCoordinator.ts`：逐帧 `getSeconds()` → `scrollTargetForSeconds` → 滚动宿主 + 画布 `setScrollY()`；写 React HUD 节流 80ms。
- 视口会话 = `src/playback/useChartViewSession.ts`，头注写明"工作台页与**将来的预览页** consume 同一 interface"。
- 键音 = `AudioTiming.buildKeyEvents` + `AudioEngine.tick()` 预调度（2s lookahead，rAF + 0.2s 定时器双驱动）。
- 判定线贴底 / 动态渲染面 = ADR-0006（`surface.h` 即判定线；`ChartGeometry.effectiveScale` 钳制轨道不变形）。

### 2.3 页面与作用域：预览页的形状已被预留

- `src/layouts/pageScope.ts`：「二级：谱面。**只留形状、不做**——**预览类页面才需要它**，等真有第二个消费者再实现」。
- 当前应用导航 6 页（`projects` / `workspace` / `audio` / `assets` / `shortcuts` / `settings`），切页快捷键 ⇧⌘0..5（`src/layouts/pageNav.ts`）。

### 2.4 落盘通道

- `window.electronAPI`（`electron/preload.js`）：`projectStore{get,put,list,delete}`、`chartCodeExport.saveAs`（**只收 string**，写 utf8，filter 写死 JSON）、`dataRoot{get,change,claim}`、`backgroundSkin{get,put,clear}`（收 `Uint8Array`）、`windowChrome.sync`、`i18n.setLanguage`。
- 浏览器降级先例：`src/project/exportChartCode.ts` 的 `downloadJson()`（`Blob` + `<a download>`）。
- **没有**二进制（图片 / 视频）另存通道。

### 2.5 素材边界

- 运行时只有 **12 套音符皮肤**（`public/assets/skins/skin00–06` + `directionalflickskin00–04`）。
- Bestdori 归档脚本（`scripts/fetch-bestdori-skins.mjs`）四类：音符皮肤 / 方向滑键 / 击打音效 / `reference-only/judgeskin`——**没有** fieldskin（`bg_line_rhythm`、`game_play_line`）、bgskin（`liveBG_*`）。
- `docs/resource/bestdori/README.md`：归档"不接入任何运行时代码"；判定资源"仅参考，保留给未来谱面预览 Auto 自动打歌的判定显示用"（issue 29 登记）。

→ 要做"像游戏一样"的场地观感，**素材来源与授权边界要先解决**（新增归档类别 + 运行时接入评审）。

## 3. 两种形态的落点与约束

### 3.1 静态分栏（面板模型）

一份面板 = 一次 `renderFrame(view)`，其中 `surface = {w: panelW, h: panelH}`、`scrollY` 由面板序号推出、`scale`（经 `fitScale` 钳制）同时决定密度与音符大小。

- 布局密度：`virtualPxPerSecond = 2 × BEAT_HEIGHT(220) × verticalRatio` = **440 px/秒**（`verticalRatio=1`）；Bestdori 默认 **150 px/秒**。
- 画面上密度 = `virtualPxPerSecond × es`（`es = min(scale, fitScale)`，`fitScale = surface.w / (7×30 + 2×12)`）。
- 对齐 Bestdori 观感的一组取值：面板 130 × 537 CSS px、`es ≈ 0.3` → 每面板 `537 / 0.3 = 1,790` 虚拟 px ≈ **4.1 秒**（Bestdori 默认 ≈ 3.6 秒同档）；轨道宽 210 虚拟 px × 0.3 = 63 CSS px，面板内居中。
- 注意：`es` 缩小同时缩小音符（`LANE_WIDTH=30` → 9 px/轨）；`MAX_CACHE_ES = 3` 只管上限，不管下限。

### 3.2 动态视频（帧驱动）

```
for (t = 0; t < durationSeconds; t += 1 / fps) {
  view.viewport.scrollY = scrollYForSeconds(t);
  target.renderFrame(view);   // 与工作台播放同一套渲染（含倒流区、SP 带、皮肤）
}
```

风险点：

1. **首帧素材未就绪**：音符图集（`CanvasSpriteIcon.ensureImagesLoaded`）与 SP 带剖面（`STRIP_STYLE_CACHE`，未就绪时是硬编码兜底剖面）→ 导出前必须预热并等待。
2. **播放期瓦片走异步队列**：`rc.playing` 为真时 miss 瓦片按预算渐进出（issue 101），单帧可能缺块 → 导出帧应置 `playing: false` 或先 flush。
3. **高倍直渲**：`es > MAX_CACHE_ES(3)` 时音符层不走瓦片、每帧全量重画（1080p 满轨 `es ≈ 7`）→ 每帧成本待实测。
4. **离线音轨**：BGM + 键音要合成一条音轨，需要 `AudioBuffer` 接缝——当前 `AudioEngine` 的 `buffer` / `sampleCache` 全为 private、无 getter；`src/audio/probeAudioDuration.ts` 已用 `OfflineAudioContext`，但只回 `duration`。

### 3.3 尺寸上限算术（长图/导出为什么必须分栏）

- 密度 440 px/s：3 分钟谱内容高 **79,200 px**，5 分钟 **132,000 px**。
- 浏览器画布上限（Chromium 基线，Electron 38 = Chromium 140）：单边 **65,535 px**、面积 **2^28 = 268,435,456 px²**（**待实测复核**）。
- 折行网格（面板 130 × 537、`es ≈ 0.3`）：3 分钟谱 ≈ **45 面板**，排成一行 = 5,850 × 537 ≈ **3.1M px²**，单图余量充足（dpr 2 下 ≈ 12.6M px²，仍安全）。
- 单条长图要放进 65,535 px：3 分钟谱需把密度压到 **≤ 364 px/s**，5 分钟 **≤ 218 px/s**（均低于 440）——观感与"分栏"不是一回事。

### 3.4 缓存与内存预算（导出时的既有硬约束）

- 音符层瓦片：`TILE_PX=512`、`MAX_TILES=64`、`BYTES_BUDGET=64MB`、`TILE_DPR_CAP=1.5`、`MAX_CACHE_ES=3`（`src/rendering/pipeline/noteLayerCache.ts`）。
- 静态层：屏幕层 + 1 条条带（`surface.h + 2×max(256, 0.5×surface.h)`），**从不分配整谱位图**。
- 若每个面板各建 `RenderTarget`（各带两层缓存），内存按面板数叠加 → 面板池 / 单 target 代画是值得收敛的点（**待设计**）。

## 4. 待实测（实现前必须拿真数）

1. **画布上限**：Electron 38（Chromium 140）真实单边 / 面积上限与分配失败行为（`getImageData` / `toBlob` 何时抛）。
2. **单帧成本**：真实 canvas（非 stub）下 1080p 满轨（`es ≈ 7` 直渲路径）密集谱的 `renderFrame` 每帧耗时 → 决定"离线逐帧"能否 ≥ 实时吞吐。
3. **编码可用性**：Electron 38 上 `VideoEncoder.isConfigSupported({codec: 'avc1.…' / 'vp09.…'})`、`AudioEncoder`（Opus / AAC）、封装库需求（`mp4-muxer` / `webm-muxer` 是否要引依赖）。
4. **实时录制对照**：`canvas.captureStream()` + `MediaRecorder` 的实际画质 / 掉帧 / 耗时（导出 ≈ 播一遍）。
5. **面板懒绘制峰值内存**与首屏延迟（dpr × 可见面板数）。

## 5. 指向

- effort：`.scratch/chart-preview/map.md`、票 `.scratch/chart-preview/issues/01-谱面预览.md`
- 触发的架构题（尚未定案）：`src/preview/` 域落地、预览页的页面作用域（`chartId` 二级）、视频导出的落盘通道（preload / main 扩展）、是否落《静态导出与视频预览架构约定》ADR。
