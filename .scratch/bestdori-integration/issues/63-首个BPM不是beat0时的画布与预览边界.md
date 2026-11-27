# 63 · 首个 BPM 不是 beat 0 时的画布与预览边界

Type: grilling
Status: resolved
Blocked by: —

## 来源与诉求

issue 62 把时间原点改成「首条 BPM（最小 beat）」后，用户 2026-11-27 验收反馈两点：

1. 首个 BPM 的 beat 为负数时，首个 BPM 到 START 线（beat 0）之间的区域无法放置音符；START 线不应固定在 beat 0，而应是谱面的真正开始线。
2. 首个 BPM ≠ beat 0 时，BPM 数字显示不完整（贴画布底边被裁掉）。

要求先分析同类问题、不改代码。分析结论与本票拍板见下。

## 症状（可复现）

- `[{ type:'BPM', beat:-4, bpm:120 }, …]`：START 线画在 beat 0（真正开始之上）；`[-4, 0)` 不能放置/拖拽、没有网格线；开头音符不渲染、不能选中。
- `[{ type:'BPM', beat:1, bpm:120 }, …]`：START 线在 beat 0（时间 0 之前，布局 pos < 0）实际画不出来；首条 BPM 的 BPM 数字底部被画布裁掉。
- 预览 / 视频导出：负拍但时间 ≥ 0 的开头音符不渲染、不铺带、不键音，且被当成「开播即过线」提前计入 combo；应改为按真实（正）时刻渲染与计数。真正时间 < 0 的音符则按 P1 在开局计入（这是预期行为）。

## 根因

时间原点已从 beat 0 改为「首条 BPM（最小 beat）」，但画布、编辑器、预览仍把 beat 0 当「开始」边界。残留分 7 类：

1. **START 线**：`src/rendering/render.ts` 的 `renderBoundLines` 硬编码 `drawLine(0, …)`。
2. **放置/拖拽下界**：`src/chart/geometry/ChartGeometry.ts` 的 `laneBeatFromCanvas` 对 `beat < 0` 返回 null。
3. **网格**：`src/rendering/render.ts` 的 `visibleBeatRanges` 把区间下限钳到 0，`renderGridBeatLines` 再跳过 `beat < 0`。
4. **音符可见/命中**：`ChartGeometry.ensureNoteIndex`、`render.ts` 键型绘制、`hitTest.ts`、`NoteEditing.isCanvasHiddenConn` 都把负拍当隐藏/不可点；`noteLayerCache.ts` 的失效区间也 `Math.max(0, beat)`。
5. **BPM 数字锚点**：`gutterLabels.ts` 的 `bpmLabelAnchorY` 只在 `beat === 0` 上移半字高，`layoutBpmLabelYs` 只对 `minBeat === 0` 特殊处理；同一锚点被 `bpmInlineInputBox`（就地编辑框）、`renderBpmGhost`、`CanvasGesture` 的命中盒复用。
6. **音频与预览**：`AudioTiming.buildKeyEvents` / `maxNoteEndSeconds`、`preview/video/sim/simField.ts` 用 `beat < 0` 跳过；combo 又按拍计入。
7. **校验与注释**：`ChartConverter.checkBackflowBoundaries` ① 仍按「beat 0 处为负 → 拒」；`ChartGeometry`、`useChartViewSession`、`PlaybackScrollModel`、`WorkspacePage`、ADR-0005 §7 多处仍写「beat 0 在判定线 / 归零到 beat 0」（行为实际已是秒 0，注释失真）。

## 已拍板（2026-11-27，用户逐项确认）

- **Q1=A · START 线 = 首条 BPM 的 beat（时间 0）**。它以上才可放置；首条 BPM 为正时 `[0, 首BPM)` 属负秒，也不可放置。
- **Q2=A · 首条 BPM 之前的音符（时间 < 0）不进画布**：布局上 pos < 0（判定线以下），只保留在谱面代码里改，画面表现与 Sonolus 一致（不可见）；不引入负滚动。它们仍计入 combo 与音符数（见 P1）。
- **Q3=OK · 负拍但时间 ≥ 0 的音符按正常音符处理**：渲染、选中、拖拽、键音、预览/视频都要出来。
- **Q4=A · 校验改为「首条 BPM（时间原点）为负 → 拒」**：非首条的 beat 0 负值按普通倒流区放行；「末条 BPM 必须为正」（Bestdori OOM）不动。**对象视图的单条校验（`validateChartCode({ fragment: true })`）必须跳过这条**——那里只有被编辑的这一条 BPM，任何值都"看起来是首条"；不跳过会把「把中途 BPM 改成负值」的合法编辑误拒（ADR-0010 结论 8）。导入、完整代码编辑器 Apply、`applyChartCodeText` 仍按整谱判。首条 BPM 取稳定排序后最小 beat 上的**生效值**（同 beat 取数组序最后一条，与 `indexOfFirstBpm` 同口径）；同一音符只报一条错（①优先，②不重复报）。
- **Q5=推荐 · BPM 数字只把「开始线那一条」按旧 beat 0 规则上移半字高**，不对所有贴底数字做钳制（保持滚动 1:1 钉线）。
- **P1（2026-11-27 用户确认）· 首条 BPM 之前的音符计入 combo 与音符数**：Sonolus 演示模式开局时，combo 已经把起始点之前的音符统计进去，combo 起始值不是 0。故 `simField.hitTimes`、`countChartNotes`、`countNotesUpToBeat` 继续包含它们；只有**渲染 / 键音 / 画布选区**排除。
- **P2（2026-11-27 用户确认）· 不加额外警示**：负 BPM 的数值本身已换色（issue 105），已有警示作用；不为「首条 BPM 为负」新增专门警示。
- **P3（2026-11-27 用户确认 A）· 编辑面不拦首条 BPM 负值**：对象视图（`applyNoteCode`）与画布就地编辑允许把整谱首条 BPM 改成负值，负值数字换色即警示；导入、完整代码编辑器 Apply、`applyChartCodeText` 仍按整谱拒绝。与 ADR-0010「编辑面不拦、Apply/导入才校验」的既有口径一致（末条负 BPM 现在也是如此）。

## 边界口径（实现时按此，不再改）

- **画布可见性**：时间 < 0（首条 BPM 之前）不渲染、不可选中/拖拽、不键音；时间 ≥ 0 的负拍音符全部正常。
- **计分/统计**：首条 BPM 之前的音符**计入** combo 与音符数；t=0 时 combo 已包含它们。
- **拍域过滤**：`beat < startBeat` 只做便宜过滤；最终可见性以 `pos < 0` 兜底（倒流区里两者不等价）。
- **校验面**：导入 / 完整代码编辑器 Apply / `applyChartCodeText` 拒绝首条 BPM 为负；对象视图单条校验与画布就地编辑**不拦**（只靠负值换色提示）。

## 实现落点

- `src/chart/geometry/ChartGeometry.ts`：新增 `startBeat`（首条 BPM 的 beat；无 BPM 回 0；取 `timeline` 首段）；`laneBeatFromCanvas` 下界改 `beat < startBeat`；`ensureNoteIndex` 的负拍过滤改 `beat < startBeat`；类注释「beat 0 在判定线」改「时间原点（首条 BPM）」。
  - **边界口径**：`beat < startBeat` 只是拍域的便宜过滤；最终可见性以 **`pos < 0`（时间 < 0）兜底**。倒流区里两者不等价（beat ≥ startBeat 也可能时间 < 0），不要把 `beat < startBeat` 当成「时间 < 0」的等价物。
- `src/rendering/render.ts`：START 线画在 `startBeat`；`visibleBeatRanges` 下限改 `startBeat`；`renderGridBeatLines` 跳过条件 `beat < startBeat`，**子拍 `preciseBeat` 也要判**；键型绘制过滤改 `startBeat`；BPM 数字锚点传 `startBeat`。
- `src/rendering/hitTest/hitTest.ts`：负拍过滤改 `startBeat`（最终仍由 pos < 0 排除）。
- `src/rendering/pipeline/noteLayerCache.ts`：失效区间下限改 `startBeat`（不再 clamp 0）。
- `src/rendering/gutterLabels.ts`：`bpmLabelAnchorY` / `layoutBpmLabelYs` / `bpmInlineInputBox` 接受 `startBeat`；**`layoutBpmGutter` 也要透传**（`renderBpmLabels` 与 `CanvasGesture` 都经它）；开始线那一条（同位组按 `minBeat === startBeat`）按旧 beat 0 规则上移半字高。
- `src/rendering/render.ts` 的 `renderBpmGhost`、`src/chart/editing/CanvasGesture.ts` 的 BPM 命中盒：传 `startBeat`。
- `src/chart/editing/NoteEditing.ts`：`isCanvasHiddenConn` **只保留 `hidden`**，负拍/首条之前不再由它判定（画布可见性由 pos < 0 兜底），避免把 `startBeat` 穿进 `SlideSegments` / `NoteDragging` / `NoteReplacementRules` 等纯编辑函数；实现时逐点核对拖拽/拆分/粘贴 lane 夹取的行为变化。
- `src/audio/AudioTiming.ts`：`buildKeyEvents` / `maxNoteEndSeconds` 的 `beat < 0` 改 `time < 0`（时间 < 0 不键音、不撑时长）。
- `src/preview/video/sim/simField.ts`：渲染/铺带/元素的负拍过滤改 `time < 0`；**`hitTimes` 继续包含首条 BPM 之前的音符**（它们的时刻 ≤ 0，t=0 时已计入 combo），不改计分口径。
- `countChartNotes` / `countNotesUpToBeat` / `ChartStats`：**不改**——首条 BPM 之前的音符本就计入音符数与 combo，保持。
- `src/chart/editing/NoteCodeOps.ts` / `BpmInput`：**不加**「首条 BPM 为负」校验（P3）——对象视图与画布就地编辑只靠负值换色提示；不要在这里补整谱校验。
- `src/chart/editing/ChartConverter.ts`：`checkBackflowBoundaries` ① 改为「首条 BPM（稳定排序最小 beat 上的生效值，`indexOfFirstBpm` 同口径）为负 → 拒」，对象视图的单条校验（`fragment: true`）跳过；替换 i18n 文案（如 `validate.firstBpmNegative`，expected `> 0`），删除不再使用的 `validate.bpm0Negative` 并更新引用。
- `src/chart/editing/ToolActionMatrix.ts`：`snapPos` 的注释「beat≥0」改「beat ≥ startBeat」（注释）。
- 文档：ADR-0014 §2 的「beat < 0」改「时间 < 0（首条 BPM 之前）」，并按 P1 写明 combo 口径；ADR-0010 结论 7 ① 改「首条 BPM」；ADR-0005 §7、`useChartViewSession` / `PlaybackScrollModel` / `WorkspacePage` 的「归零到 beat 0」改「时间原点」；`BpmTail` 注释的「beat 0 为负」同步；CONTEXT「负 beat 击打物」改「首条 BPM 之前的击打物」。
- 静态预览 / 视频共用同一几何与 `simField`，随上述改动生效，不另写一套。

## 锁测

- `tests/unit/chart/geometry/ChartGeometry.test.ts`：`startBeat`（无 BPM = 0、负首拍、正首拍）；`laneBeatFromCanvas` 在 `[startBeat, 0)` 可落点、`< startBeat` 拒绝。
- `tests/unit/rendering/render/BoundLines.test.ts`：START 线画在 `startBeat`（负首拍 / 正首拍各一）。
- `tests/unit/rendering/render/GridDetail.test.ts`（或 `GridStyle.test.ts`）：负首拍时网格覆盖 `[startBeat, 0)`，含子拍。
- `tests/unit/rendering/hitTest/RendererHitTest.test.ts`：负拍但时间 ≥ 0 的音符/滑条结点可命中；时间 < 0 的不可命中。
- `tests/unit/rendering/render/GutterLabels.test.ts`：开始线 BPM 数字上移半字高（首条 BPM 不在 beat 0）；`BpmStartScrollProbe` / `BpmBeat0ScrollSweep` 的旧 beat 0 断言同步。
- `tests/unit/audio/AudioTiming.test.ts`：负首拍时负拍但时间 ≥ 0 的音符有键音、计入 `maxNoteEndSeconds`；时间 < 0 不键音。
- `tests/unit/preview/video/SimField.test.ts`：负首拍时开头音符渲染、铺带；负秒音符不渲染/不铺带，但 `hitTimes` 仍包含它们（t=0 时 combo 已非 0）。
- `tests/unit/chart/editing/NoteEditing.test.ts`（或 `ChartStats` 相关）：首条 BPM 之前的音符计入 `countChartNotes` 与 combo 读数；不因画布不可见而被扣掉。
- `tests/unit/chart/code/ChartCodeValidation.test.ts`：首条 BPM 为负 → 拒；beat 0 负值但非首条 → 放行；末条负值仍拒；**对象视图的单条校验（`fragment: true`）把中途 BPM 改成负值 → 放行**；同 beat 多条取数组序最后一条判首条。
- `tests/unit/project/OfficialImport.test.ts` / `CommunityImport.test.ts`：首条 BPM 为负整笔拒绝（导入级确认）。
- `tests/unit/chart/editing/SelectionEditing.test.ts` / `SlideSegments` / `NoteDragging.test.ts`：负拍但时间 ≥ 0 的滑条结点可选中/拖拽/拆分；`isCanvasHiddenConn` 改动后的行为锁。
- `tests/unit/rendering/cache/*`：负首拍时编辑负拍音符能正确打脏瓦片。
- `tests/unit/chart/editing/ToolActionMatrix.test.ts`：放置/粘贴下界 = `startBeat`（负首拍可放到负拍；首条之前拒绝）。
- `tests/unit/chart/code/NoteCodeOps.test.ts`：对象视图把**整谱首条 BPM** 改成负值 → 允许回写（P3，编辑面不拦）。
- `tests/unit/chart/editing/BpmInput.test.ts`：画布就地编辑接受负值（P3，若已有则保持）。

## Comments

### 2026-11-27 分析

- 两个症状同根因：时间原点变更后，画布/预览仍以 beat 0 为开始边界。
- 参考 issue 62（首条 BPM 即时间原点、负秒外推）与用户 Q2a 实测（Sonolus 玩家从 0s 开始，负秒音符不可见且扣血）。
- 本票只做画布/预览/校验边界收口，不改 issue 62 已完成的导入/编辑器 BPM 保底。

### 2026-11-27 自检

- 修订 1：**Q4 漏了对象视图的单条校验**。`checkBackflowBoundaries` 的 `fragment: true` 分支必须跳过「首条 BPM 为负」，否则对象视图把中途 BPM 改成负值会被误拒（ADR-0010 结论 8）。已补进拍板与锁测；并注明"片段"= 对象视图单条校验，不是片段收藏/粘贴。
- 修订 2：**`beat < startBeat` ≠ 时间 < 0**。倒流区里 beat 在 startBeat 之后也可能时间为负；已写明最终可见性由 `pos < 0` 兜底。
- 修订 3：**`isCanvasHiddenConn` 不能留"实现时定"**。已定为只保留 `hidden`，可见性交给 pos < 0，并列出需要核对的编辑调用点与锁测。
- 修订 4：**BPM 数字透传漏了 `layoutBpmGutter`**（`renderBpmLabels` / `CanvasGesture` 都经它）；已补。
- 修订 5：P1 / P2 已由用户确认——**首条 BPM 之前的音符计入 combo 与音符数**（Sonolus 演示模式开局 combo 已非 0），只有渲染/键音/选区排除；**不加额外警示**（负 BPM 数值本身已换色）。
- 修订 6：Type 从 `bug` 改为 `grilling`——本票经过用户拍板且会改 ADR-0010 / ADR-0014，按 tracker 的定案票归类。
- 修订 7：P3 已确认 A——对象视图与画布就地编辑**不拦**首条 BPM 负值（负值换色即警示）；导入 / 完整代码 Apply / `applyChartCodeText` 仍按整谱拒绝。

### 2026-11-27 实现

按「实现落点」全部落地（不改计数口径）：

- **几何**：`ChartGeometry.startBeat`（timeline 首段的 beatStart；无 BPM 回 0）；**可见性 / 命中 / 落点统一走时间判据** `isBeforeOrigin(beat)`（= 布局坐标 < 0，与 `pos < 0` 同源）。实现时把 ticket 里的 `beat < startBeat` 便宜过滤统一收敛到时间判据：P3 允许把首条 BPM 改成负值，那时正秒全部落在 `startBeat` **之前**，按拍位过滤会把整个可见区滤空；正常谱面下两者完全等价（票面「拍域过滤…最终以 pos < 0 兜底」的落点）。`laneBeatFromCanvas` 用 `posOfVirtualY < 0` 判下界；`ensureNoteIndex` 按 `positionOfBeat < 0` 过滤。
- **画布**：START 线画在 `startBeat`；网格可见区间、`renderGridBeatLines`（含子拍）、键型主体 + flick 挂饰、`hitTest`、`noteLayerCache` 失效区间全部改为**时间判据**（同上的偏差说明）；`gutterLabels` 的 `bpmLabelAnchorY` / `layoutBpmLabelYs` / `layoutBpmGutter` / `bpmInlineInputBox` 接受 `startBeat`，开始线那一条按旧 beat 0 规则上移半字高（`CanvasGesture` / `FinalVirtualCanvas` 同源透传）。
- **编辑**：`NoteEditing.isCanvasHiddenConn` 只保留 `hidden`（负拍是正常可见结点，可见性由 `pos < 0` 兜底）；`planDragMove` 增加可选 `startBeat` 下界（`GestureSession` 从 geometry 注入）。
- **音频 / 预览**：`AudioTiming.buildKeyEvents` / `maxNoteEndSeconds`、`simField` 元素 / 铺带全部改按**时间 < 0** 过滤；`hitTimes`、`countChartNotes`、`countNotesUpToBeat` 继续包含首条 BPM 之前的击打物（P1）。
- **校验**：`checkBackflowBoundaries` ① 改「首条 BPM（稳定排序最小 beat 的生效值）为负 → 拒」，`fragment: true` 跳过 ① ②；i18n `validate.bpm0Negative` → `validate.firstBpmNegative`。
- **文档**：ADR-0014 §1/§2/§4/后果、ADR-0010 结论 7 ①、ADR-0005 §7、`CONTEXT.md` 术语「首条 BPM 之前的击打物」、`useChartViewSession` / `PlaybackScrollModel` / `WorkspacePage` / `BpmTail` / `ToolActionMatrix` 注释同步。
- **锁测**：`ChartGeometry`（startBeat / 负首拍落点 / 正首拍 / **首条 BPM 为负时按时间判可见区**）、`BoundLines`（START 在 startBeat）、`GridDetail`（`[startBeat, 0)` 含子拍）、`RendererHitTest`（负拍可点 / 首条之前不可 / 倒流区负秒在画布下方点不中）、`GutterLabels`（开始线数字上移）、`AudioTiming`、`SimField`（渲染 / 铺带 / hitTimes）、`NotePlayheadStats`（P1 计数）、`NegativeBpm` / `OfficialImport` / `CommunityImport`（校验口径）、`SelectionEditing` / `SlideSegments` / `NoteDragging`（负拍结点可编辑）、`PlaybackRewindEditDirtyTiles`（负首拍瓦片失效）、`CanvasGesture`（放置下界）、`NoteCodeOps`（P3 允许回写）。
- 全量 `vitest`：478 文件 / 5519 用例通过；`tsc -b` 通过。
