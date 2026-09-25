# 160 · Slide 端点（及可见结点）画在所有段之上

Type: grilling（修订 issue 85「整条滑条按放置序叠」；落地 = feature）
Status: open（2026-09-25 已拍板，待实现）
Blocked by: —

## 来源

用户 2026-09-25：「Slide 的端点（普通 / flick / skill）会被下一条 Slide 的段盖住。段可以按先后覆盖，端点图层是否应在段上面？（Bestdori 是这样的）」

## 症状

单条 internally 已是先段后结点（自己的端点不会被自己的段盖）。跨条时 `renderNotes` 对每条调用原子的 `renderSlideBody`（段+结点+flick 挂件一次画完），后放置滑条的 **段** 画在先放置滑条的 **端点** 上面。

## 根因

issue 85 定案 4：「整条 Slide（段 + 结点）都降级 / Slide↔Slide 后放置者整条在上」。那是为了键型压过滑条；把「整条」做成绘制原子后，端点无法越过别条的段。

命中层其实已经是 `slideNode` > `slideRegion`（后放的段点不赢先放的端点）。用户看到的是 **绘制** 盖住端点图标，不是点不到。

## 定案（用户 2026-09-25）

grill：Q3=B。

1. **绘制两轮**：先按放置序画完 **所有** 滑条/长条的段；再按放置序画 **所有可见结点**（端点 + 中间结点；hidden 仍不画）。flick 端点挂件跟结点轮。
2. **段 ↔ 段** 仍后放置者在上；**结点 ↔ 结点** 仍后放置者在上。
3. **键型音符仍在全体滑条之上**（issue 85 ① 不动）。BPM 横线仍在音符层之下。
4. **命中跟绘制**：保持 `note` > `slideNode` > `slideRegion`；同级后放置者。先放端点 vs 后放段 → 命中端点（现 rank 已如此，加回归锁）。
5. **性能**：同一次精灵/带体，只把循环拆成两轮，不另开层、不改瓦片粒度。

实现后在 issue 85 票末注明「整条原子叠」被本票取代；`visibleNotes` 仍滑条组在前、键型在后。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/visual/render.ts` | `renderNotes`：滑条不要一条 `renderSlideBody` 画完；拆「全谱 `renderSpanBands`」→「全谱结点 + flick 挂件」→ 再画键型。同时点击线仍在最前 |
| `tests/static/SlideFlickDecorator.test.ts` | 若 `renderSlideBody` 拆函数，断言改挂到结点轮里仍调用 `renderDecorator` |

## 锁测

- `tests/unit/visual/hitTest/RendererHitTest.test.ts`：后放滑条的段压在先放滑条 **端点** 上 → `findItemAt` 仍 `{ kind:'slideNode', noteIndex: 先放 }`；两条段重叠仍后放 `slideRegion`；同条结点 > 段；键型 > 任何滑条部分（85 回归）。
- `tests/static/`：`render.ts` 源码结构锁「所有 `renderSpanBands` 出现在滑条结点 `spriteIcon.render` 之前」（或抽 `renderAllSlideBands` / `renderAllSlideNodes` 两函数顺序）。`SlideFlickDecorator` 不得因拆函数红。
- 像素级「端点墨迹不被带盖住」DOM 测不稳 → 页面验收：两条交叉 Slide，先放的头/尾（含 flick/skill）图标完整露在后放连接带之上。

## Comments

- 2026-09-25 grill：Q3=B；用户问性能 → 绘制次数不变，仅拆循环。
