# 调研：负 BPM 片段粘贴的时间轴影响

- 日期：2026-11-07
- 基线：`origin/fix/basic-editor/macOS-210-213` @ `e5861b9c`
- 路径口径：片段域路径按当前主仓库结构（`src/patterns/`）记录，行号取自实测基线
- 性质：调研笔记与实测记录，**不是决策**；决策以 `docs/adr/` 与票为准
- 关联票：`.scratch/basic-editor/issues/217-片段粘贴BPM不相容的事后提示.md`

> §4 / §5 记录两个已排除方案及其否决依据；落地结论见 §6 与关联票。

## 1. 复现输入与方法

用户提供的分享信封片段（`schemaVersion: 1`）：两条 `Slide`，`connections` 从 `beat 1097.25` 到 `1098`（跨度 0.75 拍，13 个连接点，首尾可见，其余 `hidden`）；`bpmContext = { startBpm: -120, events: [{ deltaBeat: 0.75, bpm: 120 }] }`。即：片段整段处于 −120 BPM，最后一拍写回 +120。

目标谱面：`BPM(0,120)` + 若干 `Single`（7.5 / 8 / 8.5 / 8.75 / 9 / 10 拍，lane 0 或 3），锚点 `beat 8`，`withBpm: true`，`beatDisplay: 4`，`chartEndBeat` 不限。

方法：直接跑真实的 `clickOps({ tool:'paste', pastePattern })`（`src/chart/editing/ToolActionMatrix.ts:223-243`）→ 取 `setNotes.notes`，再用 `getBpmEvents` / `beatToSeconds` / `secondsSolutionsOf` / `buildKeyEvents` / `ChartGeometry` 求值。复现脚本为临时脚本，未入库。

## 2. 复现结果（实测）

| 项 | 放置前 | 放置后 |
| --- | --- | --- |
| BPM 线 | `0:120` | `0:120, 8:-120, 8.75:120` |
| `effectiveBpmAt(9 / 12 / 100)` | 120 | **120**（BPM 配置确实恢复） |
| `t(7.5)` | 3.7500s | 3.7500s |
| `t(8)` | 4.0000s | 4.0000s |
| `t(8.25)` | 4.1250s | 3.8750s（−0.2500s） |
| `t(8.5)` | 4.2500s | 3.7500s（−0.5000s） |
| `t(8.75 / 9 / 10 / 12)` | 4.375 / 4.5 / 5.0 / 6.0s | 3.625 / 3.75 / 4.25 / 5.25s（**恒 −0.7500s**） |
| `chartEndBeat`（60s 谱） | 120 | 121.5 |
| `beatOfSeconds(3.75)` | 7.5 | 9（最大 beat 解） |

`3.75s` 有三解：`beat 7.5 / 8.5 / 9`；`3.625s` 有 `7.25 / 8.75` 两解。`buildKeyEvents` 在 `3.625s` 出两枚同轨滑条端点、`3.75s` 出三枚同轨 tap、`4s` 出两枚滑条端点 —— 同一秒同轨多个可击打元素，且击打顺序相对 beat 顺序反转。

既有音符落点：`Single(8,0)`、`Single(8.75,3)` 被 `removeOverlappedNotes` 删除；`Single(8.5,3)` 保留；`Single(7.5,3)`、`(9,3)`、`(10,3)` 保留。

## 3. 根因链条

1. **载荷只存局部速度语境**：`src/patterns/capture.ts:48-57` 收 `(minBeat, maxBeat]` 内事件，记 `deltaBeat = note.beat - minBeat`；`startBpm` 是起点生效值。不记录该段的净时间贡献，也不检查尾部是否自平衡。
2. **粘贴只写这几条线**：`src/patterns/paste.ts:41-67` 写 `startBpm`（同速不写）+ `origin + event.deltaBeat` 的事件；不补恢复线、不看后方、不平移既有音符。落点全交给 `pasteChartNotes`（`src/chart/editing/NoteReplacementRules.ts:599-668`），后者只做 beat 轴平移、lane 夹取、同坐标覆盖。
3. **时间轴是从 beat 0 起的带符号积分**（ADR-0010 结论 3；`src/audio/AudioTiming.ts:17-39`、`src/chart/geometry/BpmTimeline.ts:48-67`）：`t(beat) = Σ Δbeat × 60/bpm`。本例 0.75 拍 @−120 倒扣 0.375s，而正常应正走 0.375s，净亏 **0.75s**。末尾写回 +120 只恢复**斜率**，不恢复**积分读数**，故 `beat ≥ 8.75` 的所有音符恒早 0.75s。等幅 `±B` 的一对必然净亏 `2·Δbeat·60/B`，数学上无法靠「末尾写回」补回。
4. **不是负 BPM 独有**：正 BPM 片段 `120→180→120`（跨度 1.5 拍）贴进 120 BPM 谱面，实测 `beat 9.5 / 10 / 18` 的响铃时刻同样**恒 −0.1250s**。判据应是「净偏移 Δt ≠ 0」，而不是「有没有负值」。
5. **既有防线只查「末条 BPM 为负」**：`src/chart/editing/BpmTail.ts:23-28`（画布警示）与 `src/chart/editing/ChartConverter.ts:434-481`（导入拒收）本例都不触发；`render.ts:1311-1327` 的幽灵预览只按预览几何画片段自身，主 `c` 仍是旧几何（`render.ts:1885`），既有音符与后半张谱面的位移落子前不可见；`clickOps` 的 paste 行与 `applyOps` 都没有事后提示通道（`rejected: 'past-end'` 同样静默）。破坏完全无提示。
6. **ADR-0023 §2 的模型不完整**：该节只推演「尾部留负值 → 后续整段倒流」，并称「目标后文本来就有 BPM 事件时负值天然被收住」——对斜率成立，对时间偏移不成立。

## 4. 时间守恒（保时）验证 —— 已否决，仅存档

曾提出的方案：写入片段后，把 `beat ≥ 片段结束拍` 的所有音符与 BPM/System/Opaque 整体 `+N` 拍。本例 `N = 2 × 0.75 × 120/120 = 1.5`。实测 `t_after(b + 1.5)`：

| 原拍号 b | 贴之前 | 当前行为 `t_after(b)` | 保时 `t_after(b+1.5)` | 是否回到原时刻 |
| --- | --- | --- | --- | --- |
| 8.75 | 4.3750 | 3.6250 | 4.3750 | 是 |
| 9 | 4.5000 | 3.7500 | 4.5000 | 是 |
| 10 | 5.0000 | 4.2500 | 5.0000 | 是 |
| 12 | 6.0000 | 5.2500 | 6.0000 | 是 |
| 100 | 50.0000 | 49.2500 | 50.0000 | 是 |

代价：片段后多出 1.5 拍 / 0.75 秒无音符空档、拍号不再整小节对齐；`N` 必须按各段速度算，不能写死。

**两条否决依据**：

- 它把「粘贴」变成一次单击改写后面所有音符的 `beat`（谱师写进谱面代码的数据本身），画面位置虽不变但导出代码半张全变，比「后面偏 0.75 秒」更隐蔽；用户明确判断「擅自改动后面所有音符大概率有问题」，并指出不相容时的常规做法是「不带 BPM 粘贴」或「带 BPM 后谱师自己手动改兼容」。
- 它只在**片段末条 BPM = 目标谱面原生效 BPM** 时成立。实测：目标 180 BPM、片段末条 120 时，对每个 b 解出的 N 分别为 `10 / 10.833 / 16.167` —— **不存在统一平移量**，斜率不匹配无法靠平移补救。

## 5. 预览性能调查 —— 位移影子方案已否决，仅存档

### 现状（只换 `ghostCoords`）——没有问题

`renderToolPreview` 的 paste 分支（`render.ts:1311-1329`）每帧成本：`buildPatternPastePayload`（O(片段) + 一次 `effectiveBpmAt` 全谱 O(n)）、`shiftGroupToAnchor` O(片段)、`previewGeometry`（`rc.notes.filter` 全谱 O(n) + O(B log B) 排序 + `new ChartGeometry` O(B)）、`makeCoords` **O(1)**（`src/rendering/coords.ts:31-68`）、O(片段) 个精灵。`ChartGeometry` 构造只遍历 BPM 事件（平均约 8 条/谱，见 `chart-compatibility-stress-test.md:53-57`），不遍历音符。瓦片层与静态层零失效。5000 音符下 hover 帧基线约 **0.3ms**（`tests/perf/RendererPerf.test.ts:556-601`）。

### 按字面「整帧重画」——有三重放大

1. `noteLayerCache` 失效判据含 `bpmEventsEqual`（**内容比较**，`src/rendering/pipeline/noteLayerCache.ts:661-697`、`:683-690`）；幽灵 BPM 的 beat 随吸附拍变化 → 多数 hover 帧 `tiles.clear()` + `fullInvalidated` 全量同步重建可见瓦片。
2. `staticLayerCache` 同样按 `bpmEvents` 失效（`src/rendering/pipeline/staticLayerCache.ts:76-112`）→ 网格每帧重画。
3. 可见音符排序索引是 `ChartGeometry` 实例字段（`ChartGeometry.ts:362-398`，O(n log n)）；预览几何每帧 `new` → 主 `c.getVisibleNotes()`（`render.ts:1888`）与每块瓦片的 `rc.geometry.visibleNotes(...)`（`noteLayerCache.ts:597`）都重建索引。

叠加「一次 mousemove = 一帧 `renderChart`」（`FinalVirtualCanvas.tsx:1069 → 552 → 686`；无 rAF 合帧）与播放期 rAF 帧链，60–120Hz 下容易吃掉 16ms 预算。现有 perf 测试 `InteractionPerf.test.ts:204-216` 已锁「BPM/geometry 内容变化 → 全量重建可见瓦片」。

### 方案对照（曾考虑）

| 方案 | 做法 | 每帧开销 | 瓦片/静态层失效 | 视觉保真 |
| --- | --- | --- | --- | --- |
| A | 主 `rc.geometry` 不动；保留 `previewGeometry`/`ghostCoords`，把「落子后会位移的现有**可见**音符」按 `ghostCoords` 额外画一层 α≈0.35 半透明影子（`dragGhost` 同款，`render.ts:1347-1357`） | O(可见音符) + O(B) | **0 / 0** | 高 |
| B | 同 A，影子限定在可见 pos 窗口（`viewportBounds`，`ChartGeometry.ts:291-302`），另加提示线 | O(视口可见数) | 0 / 0 | 中高 |
| C（仅降级档） | 去掉 `ghostCoords`，只画 BPM 幽灵 + 提示线 | O(1)~O(B) | 0 / 0 | 低，会回归 issue 186 的折返预览 |

**禁止项**（若将来要做预览）：不得把幽灵 BPM 写进一份临时 `notes` 数组来驱动预览 —— `AudioEngine.setChart`（`src/audio/AudioEngine.ts:402-408`，`WorkspacePage.tsx:328-332` 300ms 防抖）按 `notes` 引用触发，会每帧全谱 `buildKeyEvents` 并牵动 React/历史栈。

> 用户最终选择「事后 toast」而非预览提示，因此本节的方案均不落地；结论保留供以后若要做预览时参考。toast 只是一次性 DOM 提示，不进渲染帧循环，零性能风险。

## 6. 结论（2026-11-07 用户定案）

- 「结束为正就不影响后面」不成立：BPM 是时间轴的导数，恢复斜率不恢复积分读数；后面每个音符的**响铃时刻**整体早 0.75s，BPM 配置与拍号都没变。该性质对正 BPM 变化同样成立（−0.125s，§3.4），判据应统一按净偏移。
- **不代偿**：粘贴不改动任何既有音符的 `beat`，不自动补偿、不补恢复线、不腾位。BPM 是全谱性的，不相容时由谱师决定（不带 BPM 粘贴，或带 BPM 后自己手动改兼容）；编辑器擅自改写后面所有音符有害。§4 的保时方案据此否决。
- **只告知**：落子成功后若不相容，弹一条短 toast（`tone: 'warn'`，带净偏移秒数，提示 Ctrl+Z 可撤销）。不放在胶囊（30px 单行模式标签放不下长文案），不做预览重画（§5 方案否决）。
- 撤销天然满足：整份 `ChartNote[]` 快照 + 一次手势一个 `setNotes`；落点已有音符按既有覆盖规则处理，用户可见且可撤。
- `ADR-0008 §2.1`（不腾位）**不用改**；只需在 `ADR-0023 §2` 补「不相容只提示、不代偿」、`ADR-0010` 补记局部 BPM 的净偏移与「末条为负」错误态的区别，性质为补注而非推翻定案。
