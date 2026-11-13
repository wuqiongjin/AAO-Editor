# 220 · Slide 结点拖拽跨越邻居与自动重排

Type: grilling
Status: resolved
Blocked by: —

## 来源

用户提出特性诉求：在包含同拍结点的 Slide（如 `[4/L2, 6/L0, 6/L3]`）中，当前只能向上拖动末端点 `6/L3`，而无法向上拖动中间结点 `6/L0`；而 Bestdori 支持拖动任意结点跨越邻居，并在拖动后自动重排组合成合法的滑条形态。

## 现状与关系判断

1. **与 219 号渲染缺陷的关系**：
   - **视觉误导**：219 修复前，`6/L0` 被错误画成单键端点外观，用户误以为它是端点故尝试向上拖长，却因它是中间结点而被时序边界拦截；219 修复后，`6/L0` 恢复为 tick 外观，`6/L3` 恢复为端点外观，视觉与底层身份对齐。
   - **机制解耦**：219 仅影响 Canvas 选款；拖拽拦截发生在 `NoteDragging.ts` 的 `planDragMove`。因此**修复 219 并不能提供此特性**，必须专门适配。
2. **当前编辑内核限制**：
   - 现行 Issue 202 定案 Q2 锁定了「弱序单调约束（`prev.beat <= curBeat <= next.beat`），保序防倒流」；
   - `6/L0` 的 `next` 是 `6/L3`，其拍位上限被硬性锚在 beat 6，向高拍拖动（`dBeat > 0`）直接判定为 `out-of-bounds` 回弹。

## 定案（用户 2026-11-07 拍板）

1. **Q1（跨越时序与自动重排）**：**全结点开放时序跨越 + 稳定重排**。端点与中间结点均可自由向前/向后拖动跨越任何可见邻居（受 `[0, chartEndBeat]` 谱面起止约束与同拍同轨碰撞约束）。落点计算与提交后，`connections` 自动按 `beat` 升序稳定重排（同拍结点按原相对数组序稳定排列，对齐 Issue 115 与 `displayConnections`）。
2. **Q2（端点属性保留 · Bestdori 同构）**：每个 `ConnectionNote` 对象**完整保留自身的属性**（`flick`、`skill` 等），不进行任何人为转移或剥除。
   - 被拖动的中间结点升为尾端点时，若原本没有 `flick` 就不带 `flick`；
   - 原尾端点降为中间结点时，谱面数据中完整保留其 `flick: true`；在画布渲染中依据既有 Issue 145 / `slideNodeIconConfig` 规则，仅端点才渲染滑键图标，中间结点渲染为普通 Tick。
3. **Q3（SP 曲线段在拓扑跨越时的保真规则 · 对齐 Bestdori）**：
   - **绝不删除任何 `hidden` 采样点，SP 绿条绝不退化为普通直线绿条**；
   - 拖拽端点/结点时，若该结点相邻一段曲线，该段内的 `hidden` 点随端点拉伸（`remapFreeSpanHidden`）；
   - 全部点（可见点 + 隐藏采样点）统一按 `beat` 升序稳定重排。跨越的可见结点直接按时序穿插进入采样点序列中（如 Bestdori 分支 1、2、3 表现）；
   - 若发生可见结点拓扑改变，清空 `spanParams` 转化为自由段（Free Span），保留全部拉伸后的 `hidden` 点集，使之完全等价于 Bestdori 曲线导入形态。
4. **Q4（幽灵带体预览）**：**实时所见即所得**。在每一帧的 `planDragMove` 中直接输出重排后的幽灵带体，拖拽中动态展示重排后的连线与端点/Tick 状态。

## 实现落点

1. `src/chart/editing/NoteDragging.ts`：
   - 放宽时序约束，移除原 `nearestVisible` 弱序单调拦截；
   - 对受动段的 `hidden` 点做拉伸处理（`remapFreeSpanHidden`）；
   - 对包含可见点与 `hidden` 点的完整 `connections` 列表统一按 `beat` 升序稳定排序（同拍保持原相对数组顺序）；
   - 建立全量结点的原下标 -> 重排后新下标映射 `connIdxRemap`，保证选区 `items`、碰撞 `claimed` / `occ` 精准跟踪新下标；
   - 若发生可见结点时序颠倒，将 `spanParams` 置为 `undefined`（转为自由点集段），绝对不丢弃任何 `hidden` 点。
2. `tests/unit/chart/editing/NoteDragging.test.ts`：
   - 针对用户提供的 Bestdori 分支 1（B > C）、分支 2（C < B）、分支 3（C < A）编写精确浮点回归测试；
   - 覆盖用户原始诉求（中间结点跨越尾端点）、反向跨越、端点跨越、同拍同轨碰撞、边界越界等。

## 锁测与验证

- `tests/unit/chart/editing/NoteDragging.test.ts` 92 项单测全部通过（包含 Bestdori 分支 1、2、3 精确到 1e-9 的逐点断言）；
- `npx tsc -b` 零类型错误；
- `npx eslint` 零警告与错误；
- 全量单元测试套件 `npm test`（401 文件 / 4409 项用例）全绿通过。

## Answer

**resolved**。已按照用户拍板的语义对齐 Bestdori 实现 Slide 结点拖拽跨越邻居与自动重排功能：
1. **放宽时序限制**：端点与中间结点均可自由纵向拖动跨越可见邻居；
2. **稳定自动重排**：跨越后 `connections` 数组全量结点（可见点 + hidden 点）按 `beat` 升序稳定重排，同拍保序，选区条目与幽灵实时跟踪；
3. **属性保真**：对齐 Bestdori，各结点对象完整保留自身的 `flick` / `skill` 属性；
4. **SP 绿条绝对保真**：受动段 hidden 点随端点拉伸（`remapFreeSpanHidden`），绝不丢弃任何 hidden 采样点，绿条恒定保持为 SP 曲线形态；跨越后转为自由点集段，与 Bestdori 导入形态完全同构。
