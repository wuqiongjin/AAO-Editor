# 219 · Slide 同拍多结点端点误判

Type: bug
Status: resolved（2026-11-07 实现 + 锁测，tsc 0 / 18 测全绿）
Blocked by: —

## 来源

用户报障：Slide 尾部存在同拍多结点（如 beat 4→6/L3→6/L0，或 4→6/L0→6/L3）时，端点图标渲染在中间结点而非最终端点。

## 症状

- `[4/L2, 6/L3, 6/L0]`：预期端点为 `6/L0`，现状误画在 `6/L3`；
- `[4/L2, 6/L0, 6/L3]`：预期端点为 `6/L3`，现状误画在 `6/L0`；
- 真实尾端被画成绿色中间 tick，倒数第二结点被画成单键端点款（flick 箭头与选中外框亦随之错位）。

## 根因

`src/chart/editing/SlideSegments.ts` 的 `visibleEnds(conns)` 手写循环使用了严格大于号：
`if (last < 0 || conn.beat > conns[last]!.beat) last = i;`
当遇到同拍终点组（多个结点的 beat 全等于最大 beat）时，遍历到后续同拍结点因 `conn.beat > conns[last].beat` 为假，`last` 永远停留在同拍组的第一个结点；而带体铺带（`renderSpanBands`）、同时点击线（`renderSimultaneousClickLines`）、动态预览（`simField.ts`）与缩略图（`thumbnail.ts`）全部按 ADR-0009 权威显示投影 `displayConnections(conns)` 将同拍组保留为数组序（走序）并以最后一项为端点，唯独 `visibleEnds` 逻辑漂移，导致 `renderSlideBody`、`renderSlideGhost` 与 `collectSelectionOutlines` 选款错位。

## 修法

`visibleEnds` 必须严格与 `displayConnections` 首尾同源（消灭双重逻辑）：
直接取 `displayConnections(conns).src` 的首尾项（`isDisplayIdentity` 快路径下首为 0、尾为 `n - 1`，全 hidden 为 -1，保证热路径零分配）。

## 锁测

- `tests/unit/chart/editing/SlideSegments.test.ts`：新增同拍多结点用例（`[4/2, 6/3, 6/0]` 与 `[4/2, 6/0, 6/3]` 端点均断言为原数组最后一项，非单调同拍组亦断言为投影首尾）。

## 进展

- 2026-11-07：遵循 TDD 闭环修完。`visibleEnds` 严格与 `displayConnections` 首尾同源：`isDisplayIdentity` 快路径下（点序单调 + 首尾可见）直接返回 `{ first: 0, last: n - 1 }` 保证热路径零分配；非恒等路径直接取 `displayConnections(conns).src` 首尾项；全 hidden / 空 connections 返回 `{ first: -1, last: -1 }`。已锁测 18 条全部通过，`tsc -p tsconfig.app.json` 零类型报错。
