# 147 · 滑键带 `skill` 时不该变成技能键样式

Type: bug
Status: resolved（2026-09-22 实现 + 锁测，**用户页面验收通过**）
Blocked by: —

## 来源

用户 2026-09-22 #2：「滑键音符，如果携带了 `"skill": true` 属性，不应该被替换为 skill 音符的样式。→ 只有**普通的单键音符**携带 `"skill": true` 属性时，才会变成 skill 音符的样式」。

## 代码侧事实（2026-09-22 盘点）

已经是 **flick 优先**（= 用户要的口径）的地方：

- 单键选款 `singleIconConfig`（`src/visual/render.ts:243-250`）：`flick → skill → tapVirtual → tap`。
- 幽灵预览 `renderSpriteGhost`（`render.ts:1041-1045`）：同顺序。
- 键音 `AudioTiming.ts:113`：`note.flick ? 'flick' : note.skill ? 'skill' : 'tap'`，同为 flick 优先。
- 落点/拖拽/粘贴的工具判定 `keyToolIdOf`（`NoteReplacementRules.ts:59-63`）：同顺序。

**skill 盖住 flick** 的地方只有两处，都不是「普通单键」：

- 滑条**端点**同时带 flick + skill：`slideNodeIconConfig`（`render.ts:258-266`）spread 顺序让 skill 胜出；正常交互路径不会并存（issue 81 定「覆盖＝清另一个标记」），只有经谱面代码手工改才会如此。中间结点已由 issue 145 #3 收为「不渲染标记」。
- 用**技能工具**覆盖已存在的滑键：`handleSingleAndDirectionalReplacement`（`NoteReplacementRules.ts:364-374 / 408-418`）产物为 `{ type:'Single', skill:true, flick:false }` —— 这是 ADR-0001 §1.1「后放者胜出」的覆盖语义，不是「标记叠加」。

方向键（`LDirectional`/`RDirectional`）带 `skill` 时画布走 `dirGroup`，完全不看 `skill`/`flick`；`NoteInfoPanel` 对单键只显示「单键音符 + 滑键」两行，也不区分 skill。

## 用户回答（2026-09-22）

- **Q1 = ① + ④**（普通单键 `flick`+`skill` 并存；滑条端点同算），并明确口径：**「只要是音符同时有这两个属性，就会出这个问题」** —— 即统一收成「flick 胜 skill」。
- **Q2（数据口径）**：沿用 issue 145 #3 —— 数据原样保留、导出原样，只收「怎么画」。

## 定案与实现

定案 = **flick 与 skill 并存的唯一优先级：flick 胜出**（不分单键 / 滑条端点）。

代码改动（`src/visual/render.ts`）：

1. `slideNodeIconConfig`（**真正的偏差点**）：端点同时带两个标记时，原 spread 顺序 `...(flick), ...(skill)` 让 skill 盖住 flick，与单键相反 → 改成与 `singleIconConfig` 同优先级（先判 flick 再判 skill）。修复前针对它的用例是红的。
2. `singleIconConfig`（**现状已符合**）：导出以便单测（照 issue 145 对 `slideNodeIconConfig` 的做法），本轮只是把这条口径写进测试锁住 —— 修复前后它都是绿的，锁的是「不许漂」。
3. `renderNoteGhost` 里重写过一遍的标记判定链（flick/skill/虚拍）**并入** `singleIconConfig` —— 幽灵与实绘共用一份优先级，杜绝下一次漂移（ADR-0002 §4「幽灵 = 画布实绘同形」）。

数据 / 命中 / 选中 / 键音 / 导出一概不动；方向键走 `dirGroup`，本来就不看这两个标记（现状锁死）。

## 锁测

- 新增 `tests/unit/visual/render/NoteMarkPriority.test.ts`（9 例，沿用 `SlideNodeIcon.test.ts` 的最小 icons 替身）：
  - 单键四档 → tap / skill / flick / **flick+skill → flick**（第 4 条即用户定案；修复前后都绿）；
  - 色觉辅助虚拍款优先级不回退（`renderNoteGhost` 并入后仍正确）；
  - **端点 flick+skill → flick**（修复点，回退源码实测 1 红）；
  - 端点单标记（flick → flick、skill → skill，issue 81 / 145 回归）、中间结点双标记 → 普通中间结点款（issue 145 #3 回归）。
- 键音 `AudioTiming`（`:113` / `:126`）本来就是 flick 优先，未改动、无需新断言。
- 手工验收：谱面代码给一个单键同时写 `flick`+`skill` → 画布是滑键（本体 + 顶部箭头）；给滑条尾端点同时写两个标记 → 同样是滑键外观。**2026-09-22 用户页面验收通过**：两处验收项 + 「导出代码里两个标记都还在」均已确认。

## Comments

- 2026-09-22 用户报；同为 issue 145 #3（Slide 中间结点不渲染 flick/skill）的邻域，修在同一片选款代码上，实现时注意别互相踩。
- 2026-09-22 定位结论：**①（普通单键）在代码里其实已经是 flick 优先**，用户看到的应当是 ④（滑条端点）那条通路被当成了「滑键」；两点一起收进同一张票（用户 Q1 选 ①+④）。
- 2026-09-22 实现（单点修改 `src/visual/render.ts`）：端点优先级改 flick 胜出 + 幽灵选款并入 `singleIconConfig`。`tsc -b` 0 / lint 无新增 / 1431+9 测试通过（唯一红是 `RendererPerf` 那条历史遗留，见 146 票末，与本票无关）。
