# 77 · Hidden 结点两处缺陷：拖拽占位 / 参与切割

Type: bug
Status: resolved（2026-09-10 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-10 清单 #8 / #9（同一组 Hidden 缺陷）。

## #8 拖音符到 hidden 结点所在位置被拒

**症状**：Slide 中间结点 `hidden` 后不可见、不可选中、不可 hover（issue 56 A6），但拖拽时仍占着位置 →
拖任何音符到那个 beat/lane 都回弹。

**根因**：`planDragMove` ② 占位表（`src/chart/editing/NoteDragging.ts:230-233`）遍历 `connections` 建 `occ`，
**没有跳过 `hidden`** → 落点撞上不可见结点 → `fail('collision')`。
（对照：`hitTest.findItemAt`:62、`computeItemsInBox`:150、`render`:349 三处都已跳过 hidden。）

**修法**：建 `occ` 时跳过 `conn.hidden`。放到该位置后 hidden 结点本身不受影响（它仍在原 connections 里）。

## #9 hidden 结点参与"拆滑条"，把一条 Slide 切成两截（且可能切出非法端点）

**症状**：Slide = `[A, H(hidden), B]` 时，点击 / hover / 删除作用在**与 H 相连的段**上 → 被切成两截；
删除工具删这条 Slide 也变成"切两段"而不是整条删掉。

**根因**：`removeSelection` / `splitSlide`（`src/chart/editing/SelectionEditing.ts:47-107`）按 connIndex 一刀切，
hidden 中间结点被当成普通分界点；且切完后 `materializeSegment` 会把 **hidden 结点留在新区段的首/尾** →
违反 ADR-0001 §1.2「首尾结点不得 hidden」（`ChartConverter` 校验会报「首/尾结点不得 hidden: true」）→ 产出非法谱面。

**定案（本轮实现口径，待验收）**：hidden 结点对"段"的语义**透明** —— `[A,H,B]` 视作一整条 A→B 段；
作用在该段上的删除 = 删整条（不切），点击/覆盖也不以 H 为分界。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/editing/NoteDragging.ts` | ② 占位表跳过 `hidden` 结点（#8） |
| `src/chart/editing/SelectionEditing.ts` | `splitSlide` / `removeSelection`：段下标先做一次"忽略 hidden"的投影；删除整段 = 整条消失（#9） |
| `src/visual/hitTest.ts` | slideRegion 判据同步：hidden 两侧视为同一段（connIndex 归一），与删除口径同源 |
| `src/chart/editing/NoteReplacementRules.ts` | 方向键拆条 `splitSlideAtNode` 同样不为 hidden 结点分界 |

## 锁测

- `tests/unit/NoteDragging.test.ts`：拖单键到 hidden 中间结点位置 = `ok`（现为 collision 回弹）。
- `tests/unit/SelectionEditing.test.ts`：删 `[A,H,B]` 的任一段 = 整条消失（不是两截）；
  切分结果不含首/尾 `hidden`，并断言 `validateChartCode(新谱)` 无错（防非法产物）。
- `tests/unit/RendererHitTest.test.ts`：hidden 两侧段命中归一为同一 `slideRegion`。

## Comments

- 2026-09-10 实现：
  - #8 `NoteDragging.planDragMove` ② 占位表跳过 `c.hidden`（与 hitTest / computeItemsInBox /
    渲染三处同口径）；hidden 结点本身照旧留在原 `connections` 里。
  - #9 `SelectionEditing.splitSlide` 含 hidden 时改走新增的 `splitSlideHiddenAware`：
    ① region 下标先归一到**可见链**上的分界（`[A,H,B]` 的两个 region 都归到 j=0）；
    ② 可见结点 ≤ 2（只有一段）时删这段 = **删整条**（用户定案）；
    ③ 被删段内的 hidden 随段消失，`materializeSegmentSafe` 再收口一次，保证任何段的首/尾都不是 hidden
    （否则 `validateChartCode` 会判"首/尾结点不得 hidden: true"）。
    无 hidden 的滑条**完全走旧路径**（既有行为与锁测零变动）。
  - #9 另一半（放置/覆盖）：`NoteReplacementRules.findNoteIndexAt` 跳过 hidden 结点 ——
    hidden 所在位置 = 空位，于是方向键不会以 hidden 为支点拆条、单键也不会被 hidden 挡住（与 #8 同口径）。
- 锁测：新增 `tests/unit/HiddenNode.test.ts`（8 例，跨模块集中锁）：拖单键到 hidden 位置 ok +
  hidden 仍在（回归：拖到可见结点仍回弹）／`[A,H,B]` 删任一段 = 整条消失／`[A,H,B,C]` 删 H→B 段
  = A 单键 + B→C（附 `validateChartCode` 全谱合法断言）／移除 hidden 本身段保持连接／
  `findNoteIndexAt` 跳过 hidden／方向键放到 hidden 位置不拆条／无 hidden 的 4 结点拆条语义不变。
  tsc 0 / 795 测试全绿。
- **2026-09-10 二轮（用户复报："选中段时 hover 仍把 Slide 切成两半"，附截图）**：
  上一轮只改了**删除/放置**的口径，命中与渲染仍按"相邻两结点的子块"算 ——
  `[A, hidden, B]` 被拆成 A→H 与 H→B 两个 region，hover 到哪个子块就只亮哪个子块。
  新增 `src/chart/editing/SlideSegments.ts`（`slideSpans` / `spanOfRegion` / `spanConnIndices`）
  作为"**逻辑段**"的唯一口径（两端都是可见结点、跨过中间 hidden），四处接入：
  - `hitTest.findItemAt`：段内任一子块命中 → 返回**段起点**下标（不再返回子块下标）；
  - `hitTest.computeItemsInBox`：整段（含 hidden）全部结点在框内才入选，且只用段起点下标；
  - `render.collectSelectionOutlines`：按段遍历，**逐子块各描一条平行四边形**，但选中/hover/预览
    判据共用段起点 → 整段一起亮、一起灭（hover 不再只亮半段）；
  - `SelectionEditing`：`copySelection` / `mirrorSelection` 对段取整段结点（含 hidden），
    不再只取"两邻结点"（原先会漏掉段尾、把 hidden 一起复制/翻转）。
  删条 `splitSlideHiddenAware` 无需改动（它按 visible 链归一分界，段起点下标本就可映射）。
  锁测：`SelectionVisual`（hover 跨 hidden 的整段 → 2 条子块描边，修复前只有 1 条；无 hidden 仍 1 条）、
  `RendererHitTest`（两个子块命中归一到段起点；整段入框只产生一条 region）、
  `HiddenNode`（段复制含 hidden、整段镜像）。tsc 0 / 824 测试全绿。
- **已知边界（未改，留档）**：无 hidden 的 **2 结点**滑条删段，仍是"切成两个独立音符"
  （ADR-0001 §1.2 的"2 结点滑条整条删除"目前只用于方向键覆盖路径）。本次只在"含 hidden 且可见结点 ≤2"
  时按"整条删除"处理，未统一两条口径 —— 若要统一，需单独评估对既有锁测的影响。
