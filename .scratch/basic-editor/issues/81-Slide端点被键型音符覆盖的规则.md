# 81 · Slide 端点被键型音符覆盖时的规则（「只加标记」导致样式叠加 + 单键覆盖不到）

Type: grilling（要拍板语义：会改 ADR-0001 §1.2 端点列）
Status: resolved（2026-09-10 拍板 + 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-10 复报（三条，同一处规则）：

> 1. Slide 端点如果是 滑键音符/技能键，此时无法用普通音符来覆盖它了。（对于非 Slide 节点是可以的）。希望对齐非 Slide 节点的表现。
> 2. Slide 端点如果是 技能键音符，此时用滑键音符覆盖它时，则样式会变成技能键音符 + 滑键头上的装饰。（正常应该直接被替换为滑键音符的）
> 3. Slide 端点如果是 滑键音符，此时用技能键覆盖它时，样式也会变成技能键音符 + 滑键头上的装饰。（正常应该是完全变成技能键的样式，当前还残留这滑键音符头上的装饰）

## 症状与根因

根因在 `src/chart/editing/NoteReplacementRules.ts` 的 `handleSlideNoteReplacement`（:156-212）——
端点分支一律「只加标记、不清标记」（ADR-0001 §1.2 原表：flick 与 skill 可并存）：

| 放置 | 端点现状 | 当前结果 | 期望（用户） |
| --- | --- | --- | --- |
| 单键 | 端点带 flick / skill | 忽略，无效果 | 应能覆盖（对齐非 Slide 节点：单键覆盖滑键 → 变成单键） |
| 滑键 | 端点带 skill（尾） | 加 `flick:true` → skill 精灵 + flick 装饰箭头 | 直接变成滑键（清掉 skill） |
| 技能键 | 端点带 flick（尾） | 加 `skill:true` → skill 精灵 + flick 装饰箭头 | 完全变成技能键（清掉 flick） |

渲染侧（`src/visual/render.ts:229` `slideNodeIconConfig` + :672-680 补 flick 装饰）使
`flick && skill` 并存的端点画成「技能键底图 + 滑键箭头」，即用户看到的叠加样式。

中间结点（非端点）不受本次影响：单键/滑键/技能键一律忽略，维持 ADR-0001 §1.2。

## 定案（用户 2026-09-10 拍板 = 方案 A）

端点被键型音符覆盖 = **替换该端点的标记**，与「非 Slide 音符互相覆盖」（ADR-0001 §1.1）同口径 ——
后放的键型胜出、**清掉另一个标记**；端点**保留在滑条上**（不拆条、不脱离）：

| 放置 | 头端点 | 尾端点 |
| --- | --- | --- |
| 单键 | 清空 flick/skill（退化为普通端点） | 同左 |
| 滑键 | **无效果**（ADR-0001 §5：滑键不可作滑条起点） | 改 `flick:true`、清 `skill` |
| 技能键 | 改 `skill:true`、清 `flick` | 同左 |

- 中间结点一律忽略（维持 §1.2）；
- **标记无变化视为无操作**（端点已是同一键型时不写历史快照，避免每次空点一个撤销步）。

## Comments

- 2026-09-10 实现：`handleSlideNoteReplacement` 的 Single / flick / skill 三分支合并为一条
  「端点覆盖」路径，新增 `overrideEndpointMark`（唯一实现）：中间结点返回 null、
  头端点放 flick 返回 null（ADR §5）、其余按新键型重写标记（`delete` 掉另一个标记，
  不写 `false`），标记无变化返回 null → 调用方按「忽略」处理、不写历史。
- ADR-0001 §1.2 端点列改写为「覆盖替换」并加注（旧「只加不清、可并存」口径作废）；§5 未动
  （「滑键不可作滑条起点」仍成立）。
- 锁测：`tests/unit/NoteReplacementRules.test.ts` 新增 10 例（单键清 flick/skill、无标记端点忽略、
  滑键↔技能键互清、同标记忽略、头端点不接 flick、中间结点三工具全忽略、结构不变、产物过
  `validateChartCode`）；原「单键放滑条任意结点忽略」用例改为**中间结点**（端点语义已变）。
  tsc 0 / 覆盖规则 + 粘贴覆盖两套单测全绿。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/editing/NoteReplacementRules.ts` | `handleSlideNoteReplacement` 端点三分支（Single / flick / skill）按定案改写：覆盖 = 替换标记（A/B）或拆出独立音符（C） |
| `docs/adr/0001-音符覆盖与滑条规则.md` §1.2 / §5 | 端点列补「覆盖 = 替换（清掉另一个标记）」；§5「只加不清、可并存」限定到中间结点；方案 B 时改 §5 起点条款 |

## 锁测

`tests/unit/NoteReplacementRules.test.ts` 新增 `滑条端点覆盖（issue 81）` 一组 10 例：

1. 单键覆盖带 flick 的尾端点 → 标记清空、端点位置与滑条结构不变；
2. 单键覆盖带 skill 的头端点 → 标记清空；
3. 单键覆盖**无标记**端点 → `shouldReplace = false`（不写历史）；
4. 滑键覆盖带 skill 的尾端点 → `flick:true` 且 `skill` 为 undefined（**修复前会残留 skill = 叠加样式**）；
5. 技能键覆盖带 flick 的尾端点 → `skill:true` 且 `flick` 为 undefined；
6. 端点已是同一键型 → 忽略；
7. 滑键覆盖**头**端点 → 忽略（ADR §5）；
8. 中间结点：single / flick / skill **三工具全忽略**、标记不动；
9. 覆盖只改标记，不动 `beat/lane` 与结点数；
10. 产物过 `validateChartCode`（flick 不在起点）。

回归锁：原「单键放滑条任意结点忽略」改为**中间结点**版本（端点语义已按定案改变）。
