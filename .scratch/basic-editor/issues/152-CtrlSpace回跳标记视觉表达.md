# 152 · Ctrl+Space 回跳标记视觉表达

Type: feature
Status: resolved
Blocked by: —

## 来源
用户 2026-09-23 反馈：Ctrl+Space 的回跳播放标记像难以理解的箭头；关联 [17](./17-播放预览交互重做.md) 与 [65](./65-Slide临时锚点与幽灵hover.md)。

## 定案
- 领域语义仍是临时起点标记，不入谱面代码，也不是判定线；界面称“播放起点”。
- 双击轨道左侧设置/替换；画布旗标单击不执行动作；双击旗标/标记线删除。右侧卡片中的同款缩小旗帜点击后跳回并播放，行为等同当前回跳快捷键。
- 视觉采用用户提供的 SVG 旗帜（渐变、外发光、`J`），横线独立绘制且旗杆在横线处结束，不画贯穿谱面的长线。
- 已设置状态只显示 `播放起点 @ XX.XX 秒`；未设置显示 `双击轨道左侧设置播放起点`。
- tooltip 放在右侧卡片缩小旗帜上，说明跳转播放并动态显示 `jumpToMarker` 当前绑定；未绑定时显示“未设置”。

## 修法
`renderPlaybackMarker` 绘制横线；`FinalVirtualCanvas` 叠加共享 SVG 旗帜并处理双击删除；右侧卡片复用同一 SVG 接入既有回跳播放协调，移除播放起点选中态。

## 锁测
- `PlaybackMarker.test.ts` 锁定横线与不贯穿轨道的几何范围；共享 SVG 作为视觉资源复用。
- `CanvasGesture.test.ts` / `GestureSession.test.ts` 锁定旗标单击无动作、无音符选区；保留快捷键注册回归。
- DOM tooltip、Canvas 可辨识度和双击联动由开发服手工验收补充。
- **评审后补的锁（2026-09-25 四轮）**：`tests/static/PlaybackMarkerWiring.test.ts` 静态断言共享 SVG、`jumpToMarker` 接线与不再做拍→秒换算；`PlaybackMarker.test.ts` 增补「起点存秒 / 不跟拍 / 尺寸与线宽不随缩放」；`CanvasGesture.test.ts` 增补「命中与绘制同界（装饰带不误命中）/ 容差固定像素」。

## Answer
- 2026-09-25 二轮修正：画布旗帜缩至约 32×35px（仅比卡片图标大一档）；标记横线终点改为轨道外壳外沿；替换标记时重建 SVG 图层并清除原生选择/拖拽状态，避免旧视觉残留。
- 2026-09-25 三轮修正：卡片改显示播放秒数；画布旗帜默认约 40×43px，尺寸、线宽和命中阈值均不随画布缩放，只随拍位和滚动移动。
- 性能判断：单个共享 SVG 只在画布 DOM 层合成，发光滤镜不会按音符数量复制；原 Canvas 旗标也只是少量线/字绘制，二者都不是本功能的性能瓶颈。资源放在 `src/assets/playback-marker/flag.svg`，由画布与右侧卡片共享。
- 2026-09-25 已实现：状态卡片、卡片旗帜跳转播放、画布旗标双击删除、动态 tooltip、共享 SVG 旗帜及无选区状态均已收口。
- 验证：focused tests 102/102、非性能测试 1468/1468 通过；开发服务器 `http://localhost:5173/` 返回 200。
- **2026-09-25 四轮（代码评审后修正，用户逐条拍板）**：
  1. **起点改存秒（时间轴锚定）**：用户定案「marker 与播放时间绑定，不需要管节拍」。理由是布局轴本身就是秒 —— 存拍要在放置（`y→拍` 倒流区多值取解）与显示/回跳两端各绕一次 BPM 换算，存秒则全消失，且负秒区不可达。新增 `ChartGeometry.secondsToVirtualY` / `Coords.secondsToVirtualY`，`markerBeat → markerSeconds` 全链路更名（含 `PlaybackProvider`、`FinalVirtualCanvasHandle.getMarkerSeconds`）。
  2. **放置区间 `[0, 谱面长度]`（END 线之前）**，越界双击**不放置**（不静默夹取）；**不再吸附拍网格**。
  3. **BPM 改动后标记钉在同一秒**，不跟拍走（时间锚，非谱面锚）——已写进 ADR-0004 §4 与 CONTEXT.md。
  4. **回跳复用 `seek()`**：继承 duration 夹取与 issue 75 的滚动条同源写入（旧实现回跳后滚动条不跟画布）；`play().then` 抽成唯一的 `startPlayback()`，`togglePlay` 与 `jumpToMarker` 共用。
  5. **命中与绘制同界**：`hitPlaybackMarkerAt` 由 `trackBgX` 收到 `trackStartX`（装饰带不再误命中），并改读秒。
  6. **尺寸真源唯一**：`playbackMarker.ts` 导出 `PLAYBACK_MARKER_LAYOUT / _CLIP_PATH / _CARD_WIDTH|HEIGHT / _HIT_TOLERANCE_PX`，卡片与画布、CSS、单测全部引用它；clip-path 提为模块级常量（渲染循环不再逐帧拼字符串）。
  7. **hover 可发现性**：悬停同时作用于旗帜本体（`filter: brightness + drop-shadow`）与横线（近白色 + 线宽 2→3），命中层 `cursor: pointer`，且**横线命中带也触发 hover**（与旗帜 DOM 取「或」，避免互相打断）。
  8. **顺手重构另开 chore 票**：共享 `makeRenderCtx` fixture（12 个测试文件手写 ctx），与本票语义无关，不混进来。
  9. **卡片秒数改与播放条同口径**（用户 2026-09-26 提：`77.58 秒` 读不出「第几分」）：改用 `TimeFormat.formatTimePrecise` → `播放起点 @ 01:17.5`，与播放条时间码同一函数，不再自己 `toFixed(2)`；i18n 参数 `seconds → time`。锁在 `PlaybackMarkerWiring.test.ts`（含 `not.toMatch(/toFixed/)`）。

## Comments
- 2026-09-25 用户反馈：画布旗帜过大、横线进入轨道、第二次放置后出现蓝色异常视觉；二轮已按上述口径修正。
- 2026-09-25 用户定案：采用状态卡片；只显示 `播放起点 @ XXX 拍`；右侧使用同款缩小 SVG 旗帜作为跳转入口；画布旗标单击无动作；tooltip 跟随快捷键配置；采用用户提供的渐变发光 `J` 构图；用户可见术语用“播放起点”。
- 2026-09-25 用户定案：状态卡片改显示秒数；画布旗帜不跟随画布缩放，默认尺寸再略微放大。
