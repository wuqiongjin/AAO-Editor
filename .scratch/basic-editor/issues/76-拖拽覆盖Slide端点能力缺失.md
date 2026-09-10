# 76 · 拖拽覆盖能力缺失：键音符拖到 Slide 端点上应复用「放置」规则

Type: bug（语义已定：拖拽覆盖 = 放置覆盖，ADR-0001 §1.2 既有规则）
Status: open（定案已拍板 2026-09-10，待实现）
Blocked by:

## 来源

用户 2026-09-10 清单 #6 重新验证后的修正版。原描述（"键↔键也盖不了 / Slide 端点能盖别人"）作废 ——
用户实测：**非 Slide 音符之间的拖拽覆盖正常；Slide 拖动覆盖到其它音符也正常**。
真正的问题只有一条：**其它音符拖到 Slide 的端点上时，缺失"放置时本来就允许"的覆盖行为。**

## 症状（三条，均为"放置允许、拖拽回弹"）

| 拖拽件 | 落点 | 放置时（允许） | 拖拽时（现状，`planDragMove` :251/:273） |
| --- | --- | --- | --- |
| 技能键 skill | Slide 起始 / 结束端点 | 该端点加 `skill` | 回弹 |
| 滑键 flick | Slide **结束**端点 | 该端点加 `flick` | 回弹 |
| 方向滑键 | Slide 起始 / 中间 / 结束端点 | 按 ADR-0001 §1.2 拆条（`splitSlideAtNode`） | 回弹 |

## 根因

`src/chart/editing/NoteDragging.ts` ③ 落点裁决（:242-275）只认两张牌：
`t.isKey`（→ §1.1 替换）与 `t.endpoint && 拖拽件也是滑条端点`（→ §3 接合），
**没有把"拖拽件是键音符、落点是滑条结点"这一格交给放置规则**（:251 键→滑条结点直接 `fail('collision')`、:273 其它一律回弹）。

## 定案（用户 2026-09-10）

**拖拽落点的键↔滑条覆盖，直接复用放置规则**（`handleNoteReplacement` → ADR-0001 §1.2 表），不再自造一张表：

- 单键 → 任意滑条结点：放置规则 = 忽略 → 拖拽同样**回弹/无事发生**（保持现状，不算缺陷）；
- skill → 起始/结束端点：端点加 `skill`，**拖拽件自身被消耗**（与放置一致：技能键不落地）；
- flick → 结束端点：端点加 `flick`，拖拽件被消耗；
- 方向滑键 → 起始/中间/结束端点：走 `splitSlideAtNode` 拆条；
- 拖拽件是滑条（整条 / 端点）时的既有行为**不改**（用户确认正常）。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/editing/NoteDragging.ts` | ③ 裁决表：键音符落点命中滑条结点时改调 `handleNoteReplacement(notes, conn.beat, conn.lane, conn.subBeat, 工具 id)`，按结果替换/拆条/消耗；`DragMoveResult` 需能表达"拖拽件被消耗"（幽灵与选区重映射随之更新） |
| `src/chart/editing/NoteReplacementRules.ts` | 复用既有 `handleNoteReplacement` / `splitSlideAtNode`（不新写规则） |
| `docs/adr/0008-工具交互机制.md` §6 | 裁决表补"键音符 → 滑条结点 = 放置规则"一行（原「回弹」改写） |
| `docs/adr/0001-音符覆盖与滑条规则.md` §6 | 注明"拖拽移动的落点覆盖与放置同源" |

## 锁测

`tests/unit/NoteDragging.test.ts` 按新表逐格加锁（照 §6 表"逐行单测锁"惯例）：

- skill 拖到 Slide 首 / 尾 → 端点得 `skill`、音符不落地、无越界；
- flick 拖到 Slide 尾 → 得 `flick`；拖到首 / 中间 → 回弹；
- 方向键拖到 Slide 中间结点 → `splitSlideAtNode` 拆成两段（结果与放置路径逐字一致，可直接对比
  `handleNoteReplacement` 的输出）；
- 单键拖到 Slide 结点 → 回弹（回归不放松）；
- 组拖（多选）时任一成员走覆盖分支 → 幽灵/选区重映射正确。
