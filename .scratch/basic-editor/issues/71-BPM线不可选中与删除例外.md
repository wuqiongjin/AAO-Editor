# 71 · BPM 线不再可被选中（仅「删除工具 / 右键」两条通路可作用）

Type: grilling（语义变更，修订 ADR-0008 §2 框选矩阵 + issue 56 Q8）
Status: open（定案已拍板 2026-09-10，待实现）
Blocked by:

## 来源

用户 2026-09-10 清单 #1。原话：

> bpm线到底能否被选中？感觉还是不要让它能被选中了。因为它本身不是音符，选中没有任何意义。
> 只要能让"删除工具"/右键点击对它起作用即可。其余的框选、左键等方式都无法选中它。

## 症状 / 现状（代码事实）

- 左键单击 BPM 线**已经不选中**（issue 56 Q14=A，见 `ToolActionMatrix.clickOps` 注释），BPM 也不参与**鼠标 hover**。
- 但**框选仍能选中 BPM**：`computeItemsInBox` 的 BPM 分支（`src/visual/hitTest.ts:166-173`）按「X+Y 完整覆盖整条线」判据入选；
  指针行（`FinalVirtualCanvas.applyBoxAction`:363-367，`resolveBoxPlan(armedTool)==='select'`）与 bpm 工具行
  （`ToolActionMatrix.boxSelectOps`:222）都把它建进选区。
- 后果：复制 / 剪切 / 批量替换 / 选中集合导出（issue 60）会带上 BPM 线。

## 定案（用户 2026-09-10 拍板）

- BPM 不是音符 → **框选 / 左键 / Shift 加选 / Ctrl+A 一律不选它**；
- 保留两条通路：① 删除工具单击该线；② 右键点击删除（均走 `findBpmLineAt`）；
- **删除工具的「框选批量删除」仍可删 BPM 线**（用户选 A）：框选批量删除是"批量执行"不是"选中"，
  实现上把 BPM 收进删除集但**不进选区**；
- 由此**作废**用户原提的「BPM 已选中时 Shift 左键取消选中」诉求（不会选中，自然无需取消）。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/visual/hitTest.ts` | `computeItemsInBox` 去掉 BPM 分支（或加 `includeBpm` 参数默认 false，delete 路径显式传 true） |
| `src/chart/editing/ToolActionMatrix.ts` | `boxSelectOps`：bpm 行改回无效果；delete 行按 BPM 整线判据并入删除集（新抽纯函数，与 `computeItemsInBox` 同源，便于单测） |
| `src/visual/render.ts` | issue 67 的框选预览：非删除态不再预览 BPM 线（删除态仍转红） |
| `docs/adr/0008-工具交互机制.md` §2 框选矩阵 | BPM 格由「按覆盖判据入选」改为「不入选」，注明 delete 框选例外 |
| `CONTEXT.md` | 词条同步（BPM 三条通路 = 右键删除 / 删除工具 / 沟槽数字就地编辑） |

## 锁测

- `tests/unit/RendererHitTest.test.ts`：框住整条 BPM → `computeItemsInBox` **不含**它（现有「整线覆盖即入选」用例反转）。
- `tests/unit/ToolActionMatrix.test.ts`：bpm 工具框选 = 无效果；delete 工具框选含 BPM = BPM 被删（例外档）。
- `tests/unit/SelectionVisual.test.ts`：非删除态框选**不**预览 BPM；删除态仍转红（issue 67 口径）。
- 回归：复制/剪切/导出选中集合不再携带 BPM（`SelectionEditing.test.ts` 补一例）。

## Comments

- 2026-09-10 用户拍板 A（删除框选仍可删 BPM）。原「待拍板」两档中 B 档（框选也删不掉）作废。
