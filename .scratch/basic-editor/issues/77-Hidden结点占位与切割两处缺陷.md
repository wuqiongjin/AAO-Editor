# 77 · Hidden 结点两处缺陷：拖拽占位 / 参与切割

Type: bug
Status: open
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
