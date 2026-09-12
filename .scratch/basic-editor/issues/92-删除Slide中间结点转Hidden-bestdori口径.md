# 92 · 删除 Slide 中间结点 → 原位转 hidden（bestdori 口径的 Hidden 创造方法）

Type: feature
Status: resolved（2026-09-12 实现 + 锁测，待你在页面验收）
Blocked by:
Blocked by:

## 来源

用户 2026-09-12 提出语义：删除 Slide 中间结点应先把它转为 hidden、对含 hidden 的段再删一次才真删 —— 让用户不写代码也能创造 Hidden 结点（bestdori 行为），并为 issue 09（SP 绿条）铺路。

## 现状基线（客观）

- 删 Slide 中间结点 = **直接移除**该结点、相邻结点保持连接（`SelectionEditing.ts` `splitSlide` 的 `nodeRemove.has(idx) → continue`；ADR-0001 §6.2 现行条文同此）。
- hidden 目前只能来自谱面代码导入（`ChartConverter.ts:189`）与滑条组合时的标记保留（`SlideCombination.ts:70`），**没有任何人工创造入口**。

## 定案（用户 2026-09-12，bestdori 口径两段式删除）

1. 删 Slide **中间结点**（删除工具/右键/框选批量，slideNode 命中非端点）→ 该结点**原位转 hidden**：仅设 `hidden:true`，beat/lane/subBeat 与 flick/skill 标记原样保留（实现口径，待验收；hidden 在渲染/命中/计数中本就不可见，保留字段最少惊讶且 undo 可逆）。
2. 对**含 hidden 的段**再执行删除 → 清掉段内 hidden、两端直连 —— **issue 80 已实现，不变**，即本语义的第二步。
3. 删端点维持 issue 80 口径（端点 + 相连段含 hidden 一起走）；`[A,B]` 仅两结点无"中间结点"，删任一端仍走端点路径。
4. 一次删除 = 一个 undo 步（转 hidden 可整步撤销）。

未来其它 hidden 创造方法（用户题外话）一律汇入本语义；issue 09 SP 绿条 = 含 hidden 结点的绿条 + 结点缓动，设计时把"hidden 来源多样"当前提（已在 09 留评论）。

## 修法

- `SelectionEditing.ts`：`nodeRemove` 对滑条**中间**结点改为 hidden 化（不再移除）—— `splitSlide`（无 hidden 路径）与 `splitSlideHiddenAware` 两条路径都要改；hidden 化后该滑条自然落入既有 hidden 口径（段透明、删段清 hidden）。
- ADR-0001 §6.2 修订：「删中间结点 → 仅移除该结点」→「删中间结点 → 原位转 hidden；删段含 hidden = 只清段内 hidden（issue 80）」。
- 计数（issue 84 按非 hidden 结点计）、渲染（hidden 不画图标）、`validateChartCode`（首/尾 hidden 非法）均无需改动，口径自动一致。

## 锁测

`tests/unit/HiddenNode.test.ts` 新增：

- `[A,B,C]` 删中间 B → `[A,H(B),C]`（位置保留、其余字段原样）；`[A,B,C,D]` 删 B、C → 两个 hidden；
- `[A,H,B,C]` 删可见中间 B → `[A,H1,H2,C]`（hidden 化不误删既有 hidden）；
- `[A,B]` 删端点 → 退化单键（不变）；删段含 hidden → 清 hidden（issue 80 用例保持绿）；
- 产物均过 `validateChartCode`（首/尾 hidden 仍被拦截）；undo 一步回退到删除前。

## Comments

- 2026-09-12 实现 + 锁测（tsc 0；HiddenNode/SelectionEditing/ToolActionMatrix 119 测全绿）：
  - `SelectionEditing.ts` `removeSelection`：slideNode 命中**中间可见结点** → `nodeToHidden`（原位仅设 hidden:true，
    beat/lane/subBeat/flick/skill 保留）；端点与已 hidden 结点维持移除口径；slideRegion 路径不动。
    拆分前对 connections 副本应用 hidden 化 → 自然落入既有 hidden 口径（段透明 / 删段清 hidden / 段首尾收口）。
  - 剪切单个中间结点 = 复制 + §6.2 删除 → 原位转 hidden（ADR-0001 §6.3 组合语义自洽），锁测同步改写。
  - ADR-0001 §6.2「删中间结点」条目已按定案改写。
  - 锁测：HiddenNode.test.ts 新增 issue 92 组 5 例（单删/批量/两段式全流程/[A,B] 端点不变/标记保留）；
    旧「删中间可见结点」「剪切单个结点」两条按新定案改写（票内锁测段的语义修订）。
  - undo 为一次历史步（removeSelection 纯函数、调用方单步入栈），待页面验收。
