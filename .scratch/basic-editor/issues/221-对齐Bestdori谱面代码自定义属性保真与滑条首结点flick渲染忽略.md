# 221 · 对齐 Bestdori 谱面代码自定义属性保真与滑条首结点 flick 渲染忽略

Type: bug
Status: resolved（2026-11-08 两轮闭环落地，tsc 0 报错，全量 401 文件 / 4430 用例全绿通过）
Blocked by: —

## 来源

用户 2026-11-07 调查反馈 Bestdori 行为差异：
1. 每个音符/结点可携带自定义字段，当前软件会自动过滤删掉；
2. 滑条起始端点携带 `flick` 属性在实机/Bestdori 应被忽略，当前软件会画出红键和箭头；（第一轮已修复并通过验证）
3. 音符携带其它类型独有字段（如 Single 携带 direction/width），Bestdori 在数据层保留且仅按自身 type 解析，当前软件在对象视图回写时会抹除。
（注：第 4 点无 `type` 的 `{}` 确认维持 issue 156 既有「报错拒绝」设计，不学 Bestdori 静默丢弃）。

用户 2026-11-08 反馈：
- 滑条起始端点忽略 flick 渲染与音效已修复生效；
- 但通过「音符代码」工具修改音符代码后，自定义属性（第 1 点）与跨类型字段（第 3 点）仍然被过滤丢弃，没有生效。

## 症状

1. **对象视图自定义字段/跨类型字段丢失**：在画布上点击音符打开「音符代码」弹窗，在 JSON 中添加自定义字段（如 `"custom": 123`）或跨类型属性（如 Single 带 `"direction": "Left", "width": 2`），点击「应用」后弹窗关闭。再次点击该音符打开代码时，所添加的额外字段完全消失；
2. **完整谱面代码视图只改属性亦被吞**：在顶栏「谱面代码」弹窗中仅向音符添加自定义属性或跨类型属性而不修改 beat/lane，应用后虽然 fidelity 记录了文本，但在内存 notes 历史栈中同样被丢弃。

## 根因

1. **第一轮已解决**：
   - `render.ts`、`simField.ts`、`AudioTiming.ts` 端点判定混淆：仅 `isLast` 才生效 flick，首结点忽略；
   - `NoteCodeOps.ts`：滑条结点初值与回写补齐了 `conn.source` 与 extra 属性提取。
2. **第二轮深层根因：`src/chart/editing/NotesEqual.ts` 与 `pushHistoryIfChanged`**：
   - 当用户在音符代码工具中仅增加/修改额外属性（未改动 `beat`、`lane`、`flick`、`skill` 等基础字段）并点击「应用」时，`applyNoteCode` 确实成功构造了带 `.source` 的新音符 `r.notes`，并经 `handleNotesChange` 传入 `commitNotes(prev, r.notes)`。
   - `commitNotes` 内部调用 `pushHistoryIfChanged(state.history, r.notes, notesEqual, NOTES_HISTORY_CAP)`。
   - `NotesEqual.ts`（issue 57 bug4 原用于放置音符的去重防抖）**完全没有比对 `source`（以及 `charge`）**！
   - 结果：`notesEqual(oldNotes, r.notes)` 返回 `true`，`pushHistoryIfChanged` 误判为「快照无变动的重复提交」，**直接返回旧 `state`，将带有额外属性的新音符数组静默丢弃**！
   - 再次打开音符代码时，读到的仍然是旧快照，表现为「额外属性被自动过滤删掉」。
3. **`NoteCodeOps.ts` 整条音符回写的 `subBeat` 继承**：
   - 整条音符回写时经 `convertChartCodeToNotes` 重建，未像滑条结点一样继承原音符的 `subBeat`。

## 修法

1. **改造 `NotesEqual.ts`**：
   - 新增 `sourceEqual(a?: ChartSourceObject, b?: ChartSourceObject): boolean`（按值比较对象字段，支持 `undefined` 与空对象等价或键值深度对比）；
   - 在 `noteEqual` 中对所有音符类型（`Single`、`LDirectional`、`RDirectional`、`Slide`、`Long`、`BPM`、`System`、`Opaque`）以及滑条结点 `connEqual` 中加入 `sourceEqual(a.source, b.source)` 与 `!!a.charge === !!b.charge` 比较；
   - 确保当且仅当音符内容（包括自定义字段/跨类型字段）完全相同时才去重，有属性变化时正常压栈。
2. **增强 `NoteCodeOps.ts`**：
   - 整条音符在回写（`applyNoteCode`）时，若 `converted.beat === note.beat` 且原音符有 `subBeat`，保留原 `subBeat`；
3. **补充锁测**：
   - `NotesEqual.test.ts`：断言带有不同 `source`（包括有无、键值不同、跨类型字段）或不同 `charge` 的音符在 `noteEqual` 中判定为不等；断言仅修改自定义属性时 `pushHistoryIfChanged` 必须正常压栈；
   - `NoteCodeOps.test.ts`：单测模拟「通过 `applyNoteCode` 修改单音符/滑条结点的代码增加自定义属性/跨类型字段，再经过 `commitNotes` 提交」，断言新快照成功进入 `history` 且下次 `buildNoteCode` 可完整读出这些字段；断言整条音符保留 `subBeat`。

## 进展

- 2026-11-08（第一轮）：遵循 TDD 闭环落地：
  1. `render.ts`：`slideNodeIconConfig` 仅在 `isLast && conn.flick` 时应用 flick 款，首端点与中间结点均忽略 flick，`renderSlideBody` 箭头装饰同口径收口至仅 `i === ends.last`；`simField.ts` 与 `AudioTiming.ts` 同步忽略首端点 flick。
  2. `NoteCodeOps.ts`：`buildNoteCode` 结点头部叠加 `conn.source`，`applyNoteCode` 从编辑代码中提取非已知白名单键注入 `next.source`（剥除 `type`），无多余键时清理 `source`。
  3. 锁测：改写并新增 `NoteMarkPriority.test.ts`、`SlideNodeIcon.test.ts`、`SlideFlickDecorator.test.ts`、`AudioTiming.test.ts`、`NoteCodeOps.test.ts`、`ChartCodeSourceFidelity.test.ts`。全仓 `tsc -b` 零报错，`npm test` 401 个测试文件 / 4420 条用例全绿通过。
- 2026-11-08（第二轮）：深入排查为何音符代码工具修改音符代码后额外属性仍然丢失，锁定根因为 `NotesEqual.ts` 忽略 `source` 导致 `pushHistoryIfChanged` 历史去重吞掉新快照。实施改造与锁测：
  1. `NotesEqual.ts`：新增 `sourceEqual` 值比较与 `charge` 比较，并在 `connEqual` 与 `noteEqual`（涵盖所有音符类型）中完整接线。
  2. `NoteCodeOps.ts`：整条音符回写保留相同 beat 的 `subBeat`。
  3. 锁测：扩充 `NotesEqual.test.ts` 与 `NoteCodeOps.test.ts` 端到端断言，验证单音符与滑条结点通过音符代码工具加入自定义属性与跨类型属性（如 `direction` / `width`）后经 `commitNotes` 成功记录快照，并在下次打开时完整读出。全量 `npx tsc -b` 零报错，全仓 `npm test` 401 个测试文件 / 4430 条用例全绿通过。
