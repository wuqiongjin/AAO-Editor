# 159 · 倒流区撞 y 的 BPM 数值纵向错开

Type: grilling（重开 issue 105「压字不做避让」；落地 = feature）
Status: open（2026-09-25 已拍板，待实现）
Blocked by: —

## 来源

用户 2026-09-25：倒流区不同层叠在同一时间轴 y 时，BPM 数字互相覆盖（beat 5 盖住 beat 3），无法看出有几条 BPM。样例：

```
[
{"beat":0,"type":"BPM","bpm":120},
{"beat":3,"type":"BPM","bpm":-178},
{"beat":4,"type":"BPM","bpm":178},
{"beat":5,"type":"BPM","bpm":178}
]
```

## 症状

`positionOfBeat(3)` 与 `positionOfBeat(5)` 在该 BPM 序列下时间轴秒数相同 → 沟槽 **BPM 数值** 画在同一 y，后画者盖住先画者。轨道内 **BPM 横线** 同位是倒流保真（issue 104/105），不是算错 beat。

## 根因

issue 105 已知边界：「折返带内多层 BPM 数值可能落在同一 y 上互相压字。本票不做避让/错位」。`renderBpmLabels` 逐条 `layoutGutterLabel(..., 'centered')`，无聚类。

## 定案（用户 2026-09-25）

grill：Q2=B / Q7=A。

1. **只处理沟槽 BPM 数值**。横线、网格、滑条折返仍允许同位。
2. **文字盒在画布 y 上相交**的收成一组；组内沿沟槽 **纵向错开**（间距按字号），组中心仍对准该时间轴 y。
3. 组内顺序 = **beat 升序**（作者轴）。上例 −178（beat 3）与 178（beat 5）分成两颗可读的字。
4. **就地编辑 / 命中盒跟字走**（`bpmLabelBox` / `hitBpmLabel` 用错开后的 y）。点哪颗编哪条。
5. 算法对 **任何** 撞 y 生效（不限倒流；同拍多条 BPM 同样错开）。正/负换色、末条负警示（issue 142）不变。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/visual/gutterLabels.ts` | 纯函数：按文字盒相交聚类 + 组内 beat 升序算错开 y（绘制与命中共用） |
| `src/visual/render.ts` `renderBpmLabels` | 走聚类布局，不再每条死居中于线 |
| `src/chart/editing/CanvasGesture.ts` | `hitBpmLabel` 用同一套错开盒 |
| `.scratch/basic-editor/issues/105-倒流区渲染与视觉.md` | 已知边界「压字不做避让」作废，改指向本票 |

不改 ADR-0010 倒流几何；这是沟槽标注布局，不是时间轴定义。

## 锁测

- `tests/unit/visual/render/GutterLabels.test.ts`：用用户样例（beat 3/−178 与 beat 5/178）断言两枚 layout.y 间距 ≥ 字号、组中心仍在共用线 y；文字盒不再相交；`bpmLabelBox` 与 layout 同 y。不撞 y 的 BPM（beat 0、beat 4）仍居中于各自的线。
- `CanvasGesture` / 就地编辑命中：点错开后的上盒 → beat 3，下盒 → beat 5（或按错开方向与 beat 序一致）。
- 横线仍可同位：不在本票改 `renderBpmLines`。像素叠字 Playwright 非必须（布局纯函数已锁）；页面验收：导入该 JSON，左沟槽能同时读到 −178 与 178。

## Comments

- 2026-09-25 grill：Q2=B 重开 105 压字边界；Q7=A 相交文字盒成组、纵向错开、beat 升序、命中跟字。
