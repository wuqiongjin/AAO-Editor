# 130 · 拖动方向键覆盖：`length` 与 `flick`/`skill` 的归属

Type: grilling（要拍板「拖动 = 移动口径」语义；改 ADR-0001 §1.1 边界 + §1.2.1/§1.2.2 + CONTEXT 词条）
Status: resolved（2026-09-20 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-19 报两点（原文用「宽度」，词汇表口径为 **`length`**，1..3 = 占用轨道数；`width` 仅存在于谱面代码层，是同一量的别名）：

1. 左方向键拖动覆盖左方向键 → 是「替换」不是「叠加」（`length=1` 拖到 `length=2` 上得到 1，不是 3）。这语义合理吗？
2. 方向键覆盖滑条结点（端点 / 中间结点）→ 变成 `length=1` 的方向键。这个肯定是 BUG，方向键 `length` 不该变。

## 症状与判定

| # | 操作 | 现状 | 判定 |
| --- | --- | --- | --- |
| 1 | 拖方向键 → 键音符（含同类型方向键） | 目标被消耗，被拖件原样落地（`length` 随件走，不叠加） | 非缺陷（符合移动口径） |
| 2 | 拖方向键 → 滑条端点 / 中间结点 | 拆条产出的独立方向键恒 `length=1`，且不带 `flick`/`skill` | 缺陷 |

两点互斥：想让 #2 修好（`length` 保留）就得承认 #1 的「不叠加」是对的；想让 #1 变成叠加（ADR §1.1 的 `length+1`）就得接受 #2 的「归 1」是正确的放置产物。不能两个都改。

## 根因

- **移动口径那半**：`src/chart/editing/NoteDragging.ts:351-357` —— 落点撞键音符 `if (t.isKey) { covered.add(t.orig); continue; }`，被拖件经 `moved.get(i)` 原样落地，属性随件走。
- **放置口径那半**：issue 76 起「键音符 → 滑条结点」交回放置规则 → `splitSlideAtNode`，其独立方向键是硬编码的 `src/chart/editing/NoteReplacementRules.ts:288`：`{ beat, lane, subBeat, type: directionalType, length: 1 }` —— 不带 `flick`/`skill`。
- **路径分叉**：粘贴路径有事后补偿（`NoteReplacementRules.ts:644-653`，把 `length>1` 回填），拖拽路径没有 → 同一规则两种产物。
- **无锁测**：`tests/unit/NoteDragging.test.ts:52` 那条方向键拖到滑条结点的用例构造的就是 `length: 1`，覆盖不到丢失；`:218` 注释反倒写着「方向键 length 不叠加」（锁的是 #1 的现状，正确）。

## 定案（用户 2026-09-19）

1. **拖动 = 移动口径**：`length` 是被拖件自身的属性，随件走，永不因落点改变。规约一句：**拖过去的东西原样落地**。
   - #1 现状正确，不改成 ADR §1.1 的 `length+1` / 归 1。
   - 方向键增宽仍是工具点击的职责（拿方向键工具点同类型方向键 → `+1`、到 3 归 1），拖动不负责增宽。
2. **方向键拖到滑条结点拆条** → 产物继承来源件的 `length` 和 `flick`/`skill`（Q3=B）。带标记的方向键只能从导入谱面代码进来，丢了＝静默数据损坏（往返导出对不上）。
3. **两条路径合成一份**（Q4=A）：`splitSlideAtNode` 接收来源键音符的属性构造 `independentNote`；删掉 `pasteChartNotes` 里那段事后 `findIndex` 回填。粘贴 / 拖拽 / 未来新入口自动同源。
4. **不推翻 issue 76**：拆条照旧发生（结构规则），只是拆出来的方向键带来源件身份。
5. **多轨占用不纳入「是否覆盖」判定**（Q2 确认维持现状）：落点碰撞仍按锚点轨 `lane` 判（`posKey`）；两根方向键部分重叠（A 占轨 3,4 / B 占轨 4,5）并存，非缺陷，不在本票改。
6. 粘贴在 §1.1 上的既有 `length+1` 行为（issue 16 定案）不变 —— 本票只统一「滑条结点产物」这一段。

> 附带收益：幽灵画的是 `moved.get(i)`（`NoteDragging.ts:419`），保留 `length` 后预览天然诚实，不必改幽灵渲染。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/editing/NoteReplacementRules.ts` | `splitSlideAtNode` 增加「来源键音符」入参（`length` + `flick` + `skill`），`independentNote` 由它构造；缺省（工具点击路径）恒 `length=1`、无标记 → 放置行为不变 |
| `src/chart/editing/NoteReplacementRules.ts` | `handleSlideNoteReplacement` / `handleNoteReplacement` 贯通该入参；删除 `pasteChartNotes` 的 `length` 回填段（:644-653） |
| `src/chart/editing/NoteDragging.ts` | 拖拽侧传入被拖键音符（`moved.get(i)`）作为来源；`keyToolIdOf` 仍只决定类型，不再吞掉属性 |
| `docs/adr/0001-音符覆盖与滑条规则.md` | §1.1 注「拖动 = 移动口径，不适用 `length+1`」；§1.2.1/§1.2.2 补「产物继承来源方向键 `length`/`flick`/`skill`」 |
| `CONTEXT.md` | 「覆盖」表新增「拖动口径」词条 |

## 锁测

全部为纯逻辑，单测可完整覆盖（无需 Playwright / 静态源码断言）：

- `tests/unit/NoteDragging.test.ts`（新增，`planDragMove`）：
  - 拖 `LDirectional{length:3}` 到滑条中间结点 → 拆成两段 + 独立方向键 `length:3`；
  - 拖 `length:2` 到滑条端点 → `length:2`（端点拆端，另一端按标记退化）；
  - 拖 `LDirectional{length:2, flick:true}` → 产物 `flick:true`；
  - 现有 `:52` 那条 `length:1` 用例保留作回归（断言不变）。
- `tests/unit/NoteDragging.test.ts:218`「键↔键替换、方向键 length 不叠加」—— 断言不变（本票不改这条语义，它现在是护栏不是待改项）。
- `tests/unit/NoteReplacementRules.test.ts`：工具点击路径（`:221`/`:229`/`:245`/`:261`）产物仍 `length=1` 无标记（回归不放松）；新增一条「传入来源件 → 继承 `length`/`flick`」。
- `tests/unit/PasteOverwrite.test.ts`：`:110-136` 粘贴方向键到滑条结点拆条 → 断言不变（统一实现后产物等价）；新增「粘贴 `length:2` 带 `skill` → 产物 `skill:true`」。

## Comments

- 2026-09-19 grill Round 1（用户）：Q1=A（移动口径，`length` 随被拖件走）；Q2=OK（多轨重叠判定维持现状，不改）。
- 2026-09-19 grill Round 2（用户）：Q3=B（`length` + `flick` + `skill` 都继承）；Q4=A（拖拽 / 粘贴合成一份）；Q5=OK（票号 130，129 已被另一分支占用）。
- 术语校正：用户说的「宽度」＝ `length`；「Slide 的节点」＝ 滑条结点（端点 / 中间结点）。票内一律用 `length`。
- 2026-09-20 实现（TDD：先红 10 条、后绿）：
  - `splitSlideAtNode` / `handleSlideNoteReplacement` / `handleNoteReplacement` 末尾加可选 `source?: ChartNote`，
    `independentNote` 由 `source` 构造（`length` / `flick` / `skill`）；**不传 = 工具点击**，恒 `length=1` 无标记（放置口径不变）。
  - `NoteDragging.ts`：`placements` 的 value 增加 `src`（= 被拖件 `moved.get(i)`），probe 与提交两处 `handleNoteReplacement` 一并传。
  - `pasteChartNotes`：删掉「方向键 length>1 事后 findIndex 回填」那段（:644-653），改为把 `note` 作为 `source` 传入 → 两条路径同源。
  - **连带行为变更（此前无测试看守，已补锁测）**：删掉那段回填后，粘贴 `length>1` 方向键到 §1.1 的
    **替换类目标**（单键 / 滑键 / 技能键 / **异类型**方向键）一律落 `length=1`（放置口径，ADR §1.1）。
    此前那段回填顺带把这些落点也保成了来源的 length。§1.1 的「同类型 length+1」行为不变（`PasteOverwrite.test.ts:77`）。
  - 锁测：`NoteDragging.test.ts` +5（length=3 中间 / length=2 首端点 / length=2 尾端点 / flick 继承 / length=1 回归）；
    `NoteReplacementRules.test.ts` +5（source 继承 ×3、端点拆端继承、工具点击回归）；
    `PasteOverwrite.test.ts` +3（拆条 length=3、拆条 skill、粘贴到单键 length=1）。
  - `tsc -b` 全绿；`npx vitest run` 69 文件 / 1288 用例全绿。
- 2026-09-20 code-review 后补（两轴并行评审）：
  - **补护栏用例**：定案 1「拖动不叠加」此前零覆盖（既有用例拖的是 Single↔Single），
    新增 `拖 length=1 到 length=2 同类型 → 仍 1` 与 `拖 length=2 到 length=1 同类型 → 仍 2`。
  - **中间结点用例改用 5 结点滑条**：原用例是 3 结点，两侧各剩 1 结点直接退化为单键，
    没测到锁测承诺的「拆成两段」。
  - `length: srcDir?.length ?? 1`：来源件缺 length（畸形数据）时兜底，不产出 `length: undefined`。
  - `keyToolIdOf` 从 `NoteDragging` 迁到 `NoteReplacementRules` 并导出 —— 拖拽与粘贴的
    「音符 → 工具 id」映射此前各写一份，现在两条路径共用；`placements` 不再另存 `toolId`（由 `src` 现算）。
  - **不采纳**：flick+skill 双标记继承（评审认为与 issue 81 的互斥口径冲突）。理由 = 移动口径是
    「原样落地」，与拖到空位的行为一致；强制清标记会偏离"身份保留"，且双标记方向键只能由导入产生。
