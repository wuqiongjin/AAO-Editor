# 82 · hover 判定范围偏大（离音符很远就亮起选中态 hover）

Type: bug
Status: resolved（2026-09-10 拍板 + 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-10 复报：

> 2. 当前 hover 的判定范围有点偏大，我希望稍微调小一点。如图所示，当前距离这个音符很远的位置，都能触发这个选中态的 hover。

## 症状

鼠标离音符还有一段距离（尤其**纵向**）时，音符已经亮起 hover 描边。

## 根因

`src/visual/hitTest.ts:48-49` 用**圆**判定，半径取图标**半宽** + 4px 余量：

```ts
const noteRadius = (NOTE_ICON_SIZE * ns / 2) * scale + 4 * scale; // = 18·ns·scale + 4·scale
```

而音符实际墨迹是 **36 × 21.6 设计 px**（`render.ts:23 NOTE_ICON_SIZE=36`、`:28 NOTE_HEIGHT_SCALE=0.6`），
即纵向半高只有 **10.8**，判定圆半径却有 **22** —— **纵向判定范围是墨迹的 2 倍**（轨道宽才 30）。
用户感觉"很远"主要来自这个纵向溢出。

## 修法

判定盒改为**与渲染墨迹同形**（随 `noteSize` 与 `viewport.scale` 缩放）+ 极小余量：
纵向半高由 22 → 约 12.8，横向半宽由 22 → 约 20。形状与 `collectSelectionOutlines` 用于描边的
`shape:'rect'` 同源，做到「亮起来的那圈 = 能 hover 的那圈」。

- 新增常量 `HIT_ICON_W/H`（复用 render 的 `NOTE_ICON_SIZE` / `NOTE_HEIGHT_SCALE`，消除 hitTest 里的两份硬编码副本）与 `HIT_PADDING`；
- 滑条结点、方向键（issue 62 整组）同样换用新判定盒；
- 7 处调用同口径（`FinalVirtualCanvas.hitDeps`），改一处即全覆盖。

## 定案（用户 2026-09-10 拍板 = 方案 A 墨迹矩形 + 2px 余量）

判定盒 = 音符实际墨迹（36 × 21.6 设计 px，随 `noteSize` × `viewport.scale` 缩放）**外扩 2px**，
scale=1 / noteSize=1 下：半宽 20、半高 12.8（旧：半径 22 的圆）。
（选中描边矩形用的是皮肤**实测墨迹** `cfg.out`，与本常量可能差几 px，量级一致即可。）

**余量刻意不随 noteSize 收缩**：noteSize 极小时墨迹只有几 px，按比例缩余量会点不中；
固定 2 设计 px 保证一个最小可点击区。

## Comments

- 2026-09-10 实现（评审后修订）：图标尺寸常量下沉到**叶子模块 `src/visual/noteMetrics.ts`**
  （render.ts re-export、hitTest.ts 直接 import），消除"渲染与命中各写一份"的漂移温床 ——
  这正是本 issue 的根因形态。hitTest 另新增 `HIT_PADDING = 2` 与 `hitHalfSize()` / `inHitBox()`，
  `findItemAt` 的滑条结点与键型音符两处由「圆 `dx²+dy² ≤ r²`」改为「墨迹矩形 + 余量」；
  新增 `NOTE_HEIGHT_SCALE` / `SLIDE_HEIGHT_SCALE` 常量（与 render.ts 同值，hitTest 零 import 依赖惯例不变）。
  连接带（slideRegion）的平行四边形判定与 BPM 整线判定未动。
- 覆盖范围：7 处命中调用同走 `FinalVirtualCanvas.hitDeps` → hover / 点选 / 工具点击 / 拖拽候选 /
  右键删除 / BPM 整线 / Ctrl+B 一次全生效。
- 锁测：`tests/unit/RendererHitTest.test.ts` 新增 7 例，tsc 0 / 853 测试全绿。

## 锁测

`tests/unit/RendererHitTest.test.ts` 新增：

1. 音符正上方 `半高 + 余量 + 1px` → **不命中**（修复前会命中）；
2. 音符中心 / 墨迹矩形内 → 命中（回归锁）；
3. 命中盒随 `noteSize` 缩放（0.5 / 2 两档，与渲染同比例）；
4. 方向键整组（issue 62）三格仍各格命中；
5. 滑条结点 / 段（issue 77 逻辑段）行为不变。
