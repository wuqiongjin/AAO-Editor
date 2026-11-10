# 229 · Ctrl+左键整条选中与框选整条选中的拖动表现不一致

Type: bug
Status: resolved
Blocked by: —

## 来源

用户 2026-11-10 验收反馈 #3；2026-11-11 校正重点：**问题不是「拖段要不要捏形」，而是两种「把整条滑条选中的方式」在拖动时表现不一样**。同日用户拍板「229 按照这个方案来」⇒ 按本票修法实现。

## 症状

- **框选整条滑条** → Shift+拖（含拖段）＝整条刚体平移（既有正确行为，拖段不捏形，用户明确确认）。
- **Ctrl+左键点滑条端点** → 选区外观同样是整条滑条（含段），但 Shift+拖 → 只动 / 捏形光标命中的那个结点或段，不整体平移。

即：两个看起来一样的「整条选中态」，内部选区表示不同，导致拖动行为分叉。Ctrl+左键整条选中是 ADR-0001 §6.1 / `pointerClickSelection` 的既定能力（用户决定保留）。

## 根因

差异在**选区的内部表示**，不在渲染 / 视觉：
- 框选走 `computeItemsInBox`（`hitTest.ts:256`）：滑条按结点 / 段逐条入框 → 选区 = 多个 `slideNode` + `slideRegion` 条目（`hitTest.ts:278,293`）。于是 `selectedItems.length >= 2`，且 `findItemAt(cursor)` 返回的 `slideNode`/`slideRegion` 与其中某条 `sameSelectionItem` 相等。
- Ctrl+左键走 `pointerClickSelection(ctrl=true)`（`ToolActionMatrix.ts:79`）：选区 = **单条 `{kind:'note', noteIndex}`**（ADR-0001 §6.1 整条互斥，清掉同条子部分）。

`resolvePressIntent`（`CanvasGesture.ts:254-259`）组拖条件 = `hit ∈ selectedItems`（`sameSelectionItem` 要 `kind` 完全相同，`ToolActionMatrix.ts:63`）**且** `selectedItems.length >= 2`，否则 `source = [hit]` 单拖命中项。框选态两条都满足 → 组拖 → 整条平移；Ctrl+左键态 ① `length >= 2` 不成立、② `'note'` 与光标命中的 `'slideNode'`/`'slideRegion'` 永不相等 ⇒ 退化成只拖光标子件。

拖拽引擎本身**支持**整条刚体平移：`planDragMove` 收到 `{kind:'note'}` 会建 `{kind:'whole'}` 计划（`NoteDragging.ts:238-240`，「整条滑条与粘贴同口径：可见包围盒共用一个 dLane，贴墙刚体停下」），`draggableFromItems` 也放行 `note`+滑条（:684）⇒ 这是 `resolvePressIntent` 的**仲裁缺口**，不是缺能力，无需改 `planDragMove`。

## 修法（定案 用户 2026-11-11；已实现）

让 Ctrl+左键的整条选中态与框选态走同一条拖动路径：选区中存在覆盖 `hit.noteIndex` 的 `{kind:'note'}` 时，`source` 取整片选区交给 `planDragMove` 的 `whole` 刚体平移，而不是只取 `[hit]`；拖段不进捏形分支（与框选态一致）。量化锚点仍取光标命中的结点 / 段（与框选态同口径，不拿滑条首结点拍位）。保留「未整条选中时」的单结点移动 / 单段捏形。

落地：`src/chart/editing/CanvasGesture.ts` 的 `resolvePressIntent` 新增 `coveredByWholeNote` 判定（`hit.kind !== 'note'` 且选区含同 `noteIndex` 的 `{kind:'note'}`），并入组拖条件 `group`；`source = group ? input.selectedItems : [hit]`；`anchor` 在 `coveredByWholeNote` 时取 `hit`。**未改** `planDragMove` / `pointerClickSelection` / 选区结构（ADR-0001 §6.1 整条互斥不动）。

## 锁测（已落地）

- `tests/unit/chart/editing/CanvasGesture.test.ts` 的 `resolvePressIntent` 组新增 4 例：
  1. 对照①框选态（多条 `slideNode`+`slideRegion`）→ 组拖整体平移（回归基线，锁住既有正确行为）；
  2. 对照② Ctrl+左键态（单条 `{kind:'note'}`）+ 按在结点 → `anchor.items` = 整条 `note`、`anchorBeat` = 光标结点拍位（修复前会退化单拖而变红）；
  3. 对照③ Ctrl+左键态 + 按在段 → 整体平移、`items` 不含 `slideRegion`（不进捏形分支）；
  4. 守卫：单键单条选中（`hit.kind === 'note'`）→ 仍单拖命中项，不被整条规则误伤。
- **回归**：`planDragMove` 的 `whole` 计划用例与既有 77 条 `CanvasGesture` 用例全部保持不动并通过。
- **手工验收（2026-11-11 用户全部通过）**：框选 / Ctrl+左键两种整条选中态，拖端点与拖段都整体平移、表现一致；未整条选中时单拖结点 / 单段捏形仍正常；含 hidden 曲线采样点的滑条整体平移形状不散架。

## Comments

- 2026-11-11 用户**界面手工验收全部通过**（框选 / Ctrl+左键两种整条选中态拖端点、拖段都整体平移且表现一致；未整条选中时单结点移动 / 单段捏形未被误伤；含 hidden 曲线采样点的滑条整体平移不散架）。本票收尾并提交。
- 2026-11-11 收尾澄清：Ctrl+左键走 `whole`、框选走 `nodes` 是 `planDragMove` 两条不同的内部计划，普通滑条与正常缓动曲线段产物一致；差异只落在「捏形鼓包贴 0/6 轨墙再往墙外拖」时隐藏采样点的夹取 / 重烘焙（框选态既有老行为，非本票引入）。肉眼可见的「整条一起平移」两种选法已一致，不扩范围、不另开票。

## Answer

**resolved（2026-11-11）**。按用户拍板方案落地 `resolvePressIntent` 仲裁补全，Ctrl+左键整条选中态与框选态统一走 `whole` 刚体平移。
- `npx vitest run`（/worktree 阶段全量）：**408 文件 / 4511 用例全绿**；其中 `CanvasGesture.test.ts` 81/81（原 77 + 新增 4）。转回 `/workspace` 补 227 后最终全量：**410 文件 / 4525 用例全绿**。
- `npx tsc -b`：**0 错误**。
- worktree 环境补记：`node_modules` 与 gitignored 取件产物（`gen/` 注册表、keysounds、skins、sim）在 worktree 中原本缺失，已就地补齐（全部为 `.gitignore` 忽略项，不进版本库、不影响 `/workspace`）。
- 手工验收：2026-11-11 用户全部通过；本票随 227 修复一并提交（2026-11-11）。
