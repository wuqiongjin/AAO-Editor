# 221 · 对齐 Bestdori 谱面代码自定义属性保真与滑条首结点 flick 渲染忽略

Type: bug
Status: resolved（2026-11-08 落地，tsc 0 报错，全量 401 文件 / 4420 用例全绿）
Blocked by: —

## 来源

用户 2026-11-07 调查反馈 Bestdori 行为差异：
1. 每个音符/结点可携带自定义字段，当前软件会自动过滤删掉；
2. 滑条起始端点携带 `flick` 属性在实机/Bestdori 应被忽略，当前软件会画出红键和箭头；
3. 音符携带其它类型独有字段（如 Single 携带 direction/width），Bestdori 在数据层保留且仅按自身 type 解析，当前软件在对象视图回写时会抹除。
（注：第 4 点无 `type` 的 `{}` 确认维持 issue 156 既有「报错拒绝」设计，不学 Bestdori 静默丢弃）。

## 症状

1. **对象视图自定义字段丢失**：在画布上选中滑条结点或单音符打开代码弹窗，塞入额外自定义属性（如 `foo: "bar"`）或其它类型属性（如 Single 带 `direction: "Left"`），点击应用后属性被过滤丢弃，重新打开或导出均不再保留；
2. **滑条起始端点误渲染 flick**：滑条首个结点（起笔点）即使带了 `flick: true`，在 BanG Dream 实机与 Bestdori 中仅作为普通点击/按住起点，但当前编辑器画布渲染将其画成了红色滑键并补了滑键箭头装饰，与视频仿真场（`simField.ts`）口径产生视觉不一致。

## 根因

1. **`src/chart/editing/NoteCodeOps.ts` 白名单硬编码**：
   - `buildNoteCode` 构造结点头部时只提取了 `{ beat, lane, type: 'Single', hidden?, flick?, skill? }`，完全忽略了 `conn.source`，初值就丢失了自定义属性；
   - `applyNoteCode` 回写结节时仅解构 `beat/lane/hidden/flick/skill` 写回 `ConnectionNote`，未将编辑代码中的多余键收集入 `next.source`；
2. **`src/rendering/render.ts` 端点判定混淆**：
   - `slideNodeIconConfig`（第 300 行）定义 `const isEndpoint = isFirst || isLast;`，并对任意满足 `isEndpoint && conn.flick` 的结点换用 flick 精灵；
   - 第 788 行墨迹箭头装饰同样使用 `i === ends.first || i === ends.last` 补画箭头；
   - 实际上只有 `isLast`（尾结点）才具有滑键判定与滑键视觉，首结点应仅按普通端点呈现。

## 修法

1. **数据保真对齐（`NoteCodeOps.ts`）**：
   - `buildNoteCode` 构造滑条结点投影时，将 `conn.source` 叠加到初值上；
   - `applyNoteCode` 回写时，通过 `sourceIfExtra(c, KNOWN_CONN)` 将非标准键保留到 `next.source` 中；
2. **渲染口径对齐（`render.ts`）**：
   - `slideNodeIconConfig` 仅在 `isLast && conn.flick` 时才应用 flick 精灵（`isFirst` 带 flick 保持普通端点）；
   - 箭头装饰绘制处将 `i === ends.first || i === ends.last` 改为仅 `i === ends.last` 绘制 flick 装饰；
   - 与 `src/preview/video/sim/simField.ts:305` 的 `conn.flick && isEnd` 保持同一口径。

## 锁测

- `tests/unit/chart/code/NoteCodeOps.test.ts`：
  - 测试滑条结点初值投影带出 `conn.source` 中的自定义属性；
  - 测试回写滑条结点时保留自定义键与跨类型键（进入 `source`）；
- `tests/unit/rendering/`（或对应渲染单测）：
  - 断言 `slideNodeIconConfig` 在 `isFirst=true, isLast=false, conn.flick=true` 时返回 `slideEndpointFor`，不返回 `flickFor`；在 `isLast=true, conn.flick=true` 时才返回 `flickFor`；
- 全量回归网 `npm test` 与 `npx tsc -b` 保持全绿。

## 进展

- 2026-11-08：遵循 TDD 闭环落地：
  1. `render.ts`：`slideNodeIconConfig` 仅在 `isLast && conn.flick` 时应用 flick 款，首端点与中间结点均忽略 flick，`renderSlideBody` 箭头装饰同口径收口至仅 `i === ends.last`；`simField.ts` 与 `AudioTiming.ts` 同步忽略首端点 flick。
  2. `NoteCodeOps.ts`：`buildNoteCode` 结点头部叠加 `conn.source`，`applyNoteCode` 从编辑代码中提取非已知白名单键注入 `next.source`（剥除 `type`），无多余键时清理 `source`。
  3. 锁测：改写并新增 `NoteMarkPriority.test.ts`、`SlideNodeIcon.test.ts`、`SlideFlickDecorator.test.ts`、`AudioTiming.test.ts`、`NoteCodeOps.test.ts`、`ChartCodeSourceFidelity.test.ts`。全仓 `tsc -b` 零报错，`npm test` 401 个测试文件 / 4420 条用例全绿通过。
