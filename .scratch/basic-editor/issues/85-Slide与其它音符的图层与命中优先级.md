# 85 · Slide 与其它音符的图层 / 命中优先级（其它音符应高一级）

Type: bug
Status: resolved（2026-09-10 拍板 + 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-10 复报：

> 5. Slide 与其它音符的图层问题。当其它音符与 Slide 的「段」发生重叠时，此时优先让其它音符的图层更高一级。
>    （也就是点击这个位置时，优先会选中其他音符，hover 效果也是）。
>    如果是 Slide 与 Slide 的重叠图层的话，按照放置的先后顺序。

## 症状与根因

现状**没有 layer 字段**，绘制顺序与命中优先级各说各话：

- **绘制**：`ChartGeometry.visibleNotes`（:303-323）把点音符（Single/方向键/BPM，按 beat 升序）**排在
  滑条/长条之前** → 滑条**恒在单键与方向键之上**，Slide 的半透明连接带会盖住压在它下面的音符。
- **命中**：`src/visual/hitTest.ts` `findItemAt`（:53）按 `notes` 数组下标**首个命中即返回**
  → 与「后画的在上、后放的在上」相反。

## 定案口径（用户 2026-09-10）

1. **键型音符（单键 / 滑键 / 技能键 / 方向键）比 Slide 高一级** —— 绘制在上、点击与 hover 优先命中；
2. **Slide ↔ Slide 按放置先后顺序**（推荐口径：后放置者在上，与绘制顺序一致）；
3. BPM 线依旧最底（issue 59 定案，不动）。
4. **拍板补充（2026-09-10）：整条 Slide（段 + 结点）都降级** —— 凡是其它音符与 Slide 任何部分重叠，
   点击 / hover 一律优先其它音符；规则最简单且命中与绘制严格同序。
5. 顺带统一的口径：**同类重叠（键型↔键型、滑条↔滑条）取后放置者**（下标更大 = 画在上层）。
   此前键型↔键型是"下标小的赢"，与绘制顺序相反。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/geometry/ChartGeometry.ts` `visibleNotes`（:303-323） | 输出顺序改为 **滑条/长条在前、点音符在后**（键型音符画在上层）；BPM 仍在点音符组（由 `renderBpmLines` 单独画，不受影响） |
| `src/visual/hitTest.ts` `findItemAt`（:53-105） | 收集全部候选后按 **rank 择优**：`note`(键型) > `slideNode` > `slideRegion`；同 rank 取**下标更大者**（= 后放置 = 上层）。倒序遍历即可自然实现 |
| `src/visual/render.ts` | 无需改（跟随 `visibleNotes` 顺序）；滑条内部「先带后结点」顺序不变 |

> 风险点：`visibleNotes` 的顺序同时被 `renderNotes`、`renderSimultaneousClickLines` 与瓦片缓存消费，
> 改序后需确认同时点击线（issue 39 #3）不受影响（它画在音符层最前，与顺序无关）。

## Comments

- 2026-09-10 实现：`ChartGeometry.visibleNotes` 输出顺序改为**滑条/长条在前、点音符在后**
  （BPM 仍在点音符组，由 `renderBpmLines` 单独画在音符层之下，不受影响）；
  `findItemAt` 的循环体抽成 `hitOne(i)`，外层改**倒序遍历 + `hitRank` 择优**
  （`note` 2 > `slideNode` 1 > `slideRegion` 0）。滑条内部「结点优先于段」不变；
  连接带平行四边形、BPM 整线判定均未动。
- 2026-09-10 评审修订：**同级**候选的取舍改用**绘制序键** `drawOrderKey` ——
  键型音符按"拍位"（`visibleNotes` 的点音符是 **beat 升序**排列，只比下标会与绘制不同序：
  下标大 ≠ 拍位大），滑条按"下标"（`spans` 按下标追加）；倒序遍历下序键严格更大才替换，
  相等保留先遇到的（= 后放置者）。至此"命中与绘制严格同序"才成立。
- 顺序的其它消费者已核对无影响：`renderSimultaneousClickLines` 按 beat 分组（与顺序无关）、
  `noteLayerCache` 只按集合取用、`RendererPerf` 的二分 vs 全量扫描对比用 Set（顺序无关）。
- 性能：`findItemAt` 5000 音符 0.746ms/次（护栏 4ms），`hover 交互帧` 0.23ms/帧 —— 全量扫描未退化。
- 锁测：`tests/unit/RendererHitTest.test.ts` 新增 7 例；tsc 0 / 866 测试全绿。

## 锁测

`tests/unit/RendererHitTest.test.ts` 新增：

1. 单键与滑条段在同一点重叠 → `findItemAt` 返回 `{kind:'note', noteIndex: 单键下标}`（修复前返回 slideRegion）；
2. 两条滑条重叠 → 返回**下标更大**那条（放置更晚）；
3. 滑条**结点**与同条滑条的段重叠 → 仍是 `slideNode`（结点 > 段，回归锁）；
4. 无重叠时各类命中结果不变（回归锁）。

`tests/unit/RendererPerf.test.ts` / `ChartGeometry.test.ts`：补一条「`visibleNotes` 输出里
滑条一律排在点音符之前」的顺序断言（防止后续改回）。

- 2026-09-25：键型 > 滑条、段↔段后放置者在上 **仍有效**。「整条（段+结点）原子按放置序叠」被 [issue 160](./160-Slide端点画在所有段之上.md) 取代：全谱段先于全谱可见结点。
