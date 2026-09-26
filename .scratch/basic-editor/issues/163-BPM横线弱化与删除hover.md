# 163 · BPM 横线弱化（不跟整拍白）+ 删除工具 hover

Type: grilling
Status: resolved
Blocked by: —

重开：issue 51 第二轮 Q5=B（BPM 标线 = 主题整拍色）、issue 56 C5（删除态 BPM 不 hover）。网格 / 节拍线 / BPM 数值配色不在本票。

## 来源

用户 2026-09-26 #2。grill：Q2=A / Q3=A / Q4=A / Q5=A / Q6=B / Q7=A / Q8=推荐 / Q10=B。

## 症状

默认多彩下 BPM 横线 = 整拍白 `#ffffff`，且 `2.5×scale` 更粗，黑底极抢眼，和节拍线难分。认线其实靠沟槽数字。删除工具单击能删 BPM（issue 71），但指上去无危险色（56 C5 仍按「单击无效果」）。

## 根因

`renderBpmLines` 走 `gridThemeBpmColor`（= beat 层）。`collectSelectionOutlines` BPM 分支只认右键按住做 hover，删除 `armedTool` 故意跳过。

## 定案（用户 2026-09-26）

1. **只改 BPM 横线**，不改网格；不新开设置。
2. **常显留下、弱于整拍**：实线；线宽 ≤ 整拍（约 `max(1, 1×scale)`，废除 `2.5×scale`）；alpha 明显低于整拍 0.8。
3. **四主题各一条网格五档里没有的弱紫/蓝紫色相**（比倒流数字更暗、饱和度更低）。不要灰、不要整拍白、不要 1/2 青。
4. **正/负横线同色**；识别倒流靠数字。**末条非法负 BPM** 横线仍警示色。
5. **不可选中**不变。普通工具仍无 hover。**删除工具命中 BPM → 危险色**（与单击能删对齐）；框选删除预览仍红；右键按住仍红。
6. 沟槽数字仍走 `gridThemeBpmColor` / 倒流色。不改 ADR-0010。

## 本轮实现口径（待验收）

色值可按实机微调，方向先锁：

| 主题 | 常显横线（建议） | 不要撞 |
| --- | --- | --- |
| vivid | `#6e65a8` α≈0.5 | 整拍白、倒流 `#e79dff`、1/16 `#d67f9f` |
| mono | `#7a72b5` α≈0.5 | 灰阶网格、倒流 `#f0a3d4` |
| amber | `#5a6a9e` α≈0.5 | 琥珀整拍、倒流 `#c2aaff` |
| cyan | `#8a5a9a` α≈0.5 | 青整拍、倒流 `#ff9abd` |

beat 0 删除仍是重置为 120：hover 同样给危险色。音符代码点线仍无 hover（本票不做对称）。

## 实现落点

| 位置 | 改动 |
| --- | --- |
| `src/visual/gridStyle.ts` | 新增 `gridBpmLineColor`；`gridThemeBpmColor` 只服务数字 |
| `src/visual/render.ts` `renderBpmLines` | 常显走专用色+新线宽/α；末条非法负仍警示 |
| `src/visual/render.ts` `collectSelectionOutlines` | 删除态 + hover BPM → danger；指针等仍 0 条 |
| ADR-0008 / issue 56 C5 注释 | 删除 BPM hover 与「能删」对齐 |
| `CONTEXT.md` | 已补「BPM 横线」词条 |

## 锁测

- `GridStyle.test.ts`：`gridBpmLineColor` ≠ beat 色、≠ `gridBpmNegativeColor`；`gridThemeBpmColor` 仍 = beat（数字）。
- `BackflowRender.test.ts`：合法正/负横线 stroke = 线色不是 beat 白；末条非法负仍警示。
- `SelectionVisual.test.ts`：反转「删除态 BPM 不 hover」→ 删除+hover = 1 条 danger；`armedTool` 非 delete 仍 0。右键按住 / 删除框选预览回归保持绿。

## Comments

- 2026-09-26 grill 存档：Q3 补充「别靠纯白横线认 BPM」；Q6 否灰（网格已偏灰）；Q9 纠正「不能选中」；Q10=B 修 56 C5 与 71 的合同打架。
- 2026-09-26 已实现：`gridBpmLineColor` + 细线 α0.5；删除/右键 hover 走 `findBpmLineAt`；末条非法负横线仍警示。
