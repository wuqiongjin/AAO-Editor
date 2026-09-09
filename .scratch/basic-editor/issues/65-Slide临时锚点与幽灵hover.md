# 65 · Slide 的临时锚点与幽灵 hover（含拖拽幽灵结点选款）

Type: task
Status: resolved（2026-09-09 实现落地，浏览器验收待用户）
Blocked by:

## 来源

issue 55/56 验收后用户复报的遗留问题 #1 / #6 / #7 / #8（2026-09-09）。四件事同一根因族：**"滑条/结点的图标该用哪一款、在哪些时刻出现"没有一份共享口径**。关联 [55](./55-工具栏工具交互机制整改与重构.md)（ADR-0008 §4 两击直放）、[56](./56-谱面画布音符选中状态整改.md)（hover 层级）、[57](./57-编辑交互缺陷修复-选中残留-滑条锚点-Esc分级-历史去重.md)（锚点取消边界）、ADR-0002 §4（预览表）。

## 四项症状与根因

### ① 拖拽中间结点时，幽灵画成端点（单键）款

`renderSlideGhost()`（拖拽/镜像/粘贴的滑条幽灵）**对所有 connection 一律用 `slideEndpointFor`**，中间结点该用的 `slideAmongFor`（`note_slide_among`）没用上 → 拖一个三结点滑条的中间结点，幽灵里两端和中间长得一样。
实绘 `renderSlideBody` 与选中描边 `collectSelectionOutlines` 都已走 `slideNodeIconConfig(…, isFirst, isLast)`（端点=端帽款、中间=among 款），**只有幽灵这条路径漏了** → 违反 ADR-0002 §4 的既有不变式"幽灵 = 画布实绘同形"（`GhostPreview.test.ts` 锁的就是它，滑键缺顶部箭头那次反馈同族）。

### ② 第一击挂了锚点后再起手框选，锚点不消失

`slideBuffer` 只在「Esc ②档 / 第二击同位或横向 / 非法落点单击 / 切离 slide 工具」时清。用户在**已挂锚点**的状态下拉出框选（= 改走 §4 框选组合），画布上那颗临时端点仍留着，看起来像"框选之外还挂着一条待连接的起点"。

### ③ 临时锚点画的是青色同心圆靶标，不是端点音符

`renderSlideBuffer()` 画三层青色圆（`rgba(0,229,255,…)` + 高光点）。锚点在语义上**就是滑条的起点端点**，用户要求：**改为 Slide 端点音符的图标**（与最终成条后那颗端点同一枚 sprite）。

### ④ Slide 工具态完全没有 hover 幽灵

`renderToolPreview()` 只分派 键型 / 粘贴 / 镜像 三族，`armedTool === 'slide'` 落到函数尾部什么都不画 → 拿滑条工具移动光标没有任何落点反馈（其它放置工具都有）。

## 定案（本轮实现口径）

> ①②③④ 的**诉求**来自用户 2026-09-09 的第 1/6/7/8 条；具体口径（共用哪份选款函数、锚点取消的边界、非法段不画带子）由本轮拍板，待验收。

1. **结点选款收敛为一份**：端点 = `slideEndpointFor`、中间 = `slideAmongFor`，`flick`/`skill` 覆盖照旧。`renderSlideGhost` 改用 `slideNodeIconConfig`（提到模块内共享），拖拽 / 镜像 / 粘贴幽灵与实绘、描边四处同口径。
2. **框选起手 = 立刻取消临时锚点**（与 ADR-0008 §2 原则 6"点了画布 = 注意力已转移"同族；框选一旦启动，两击路径作废、改走 §4 组合）。落点：`handleMouseMove` 里跨过 4px 阈值、进入框选（非音符拖拽）的那一刻清 `slideBuffer`。
   - 拖拽音符（指针态 / Shift+按住）**不**清锚点——那是移动语义，与两击无关。
3. **临时锚点 = 纯端点图标**：`renderSlideBuffer` 的青色靶标整体删除，改画与成条后同一枚端点精灵。本轮**不加**任何附加装饰（待连接光环 / 呼吸动画 / 降透明度）——用户只说"改为端点音符的图标"，附加标记属自造，若验收时希望仍可分辨"这是待连接的起点"，再加一档轻量标记即可。
4. **Slide 幽灵 hover 两档**：
   - **未第一击**：光标吸附位画**端点音符的幽灵**（真实 sprite、α 0.35，与其它放置工具一致）。
   - **已第一击**：端点幽灵 **+** 锚点→当前落点之间的**连接带（段）幽灵**，实时预览即将成形的绿条形态（含斜向段）。
   - **非法段不画带子**（② 的横向禁令 / 同位取消）：当前落点与锚点 `beat+subBeat` 相同（同位或同拍不同轨）→ 只画端点幽灵，不画带子。
   - hover 描边（issue 56）与幽灵照常叠加，不互斥。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/visual/render.ts` | `slideNodeIconConfig` 共享给 `renderSlideGhost`（修 ①）；`renderSlideBuffer` 改端点图标（③）；`renderToolPreview` 新增 `slide` 分支：端点幽灵 + 合法段带子幽灵（④，带子复用 `renderSlideGhost` 的两结点形态或独立 `renderSegmentGhost`） |
| `src/chart/components/canvas/FinalVirtualCanvas.tsx` | 进入框选手势时 `setSlideBuffer(null)`（②） |
| `docs/adr/0002-快捷键系统与自定义配置.md` §4 | 预览表补「Slide 工具态 · 悬停 / 已挂锚点」两行 + 幽灵外观补一句"滑条幽灵的结点选款 = 实绘同款（端点/中间）" |
| `docs/adr/0008-工具交互机制.md` §4 | 两击直放的锚点取消边界补一句"起手框选 = 立即取消锚点" |
| `tests/unit/GhostPreview.test.ts` | 行锁：滑条幽灵中间结点用 among 款、端点用端帽款；slide 态 hover 有幽灵；非法段不画带子 |

## 验收

- 三结点滑条拖中间结点：幽灵里中间那颗 = among 图标，两端 = 端帽图标（与松手后实绘一致）。
- 挂上锚点 → 拉框选：锚点立即消失；框选组合照常工作；单纯拖音符不影响锚点。
- 挂上锚点后画布上看不到青色靶标，看到的是一枚滑条端点图标。
- 未第一击：光标扫过轨道时端点幽灵跟随（吸附网格、α0.35）；第一击后：端点幽灵 + 绿色带子实时成形，斜段成形正确；移到与锚点同拍的位置（横向/同位）→ 带子消失、只剩端点。
- 回归：键型/粘贴/镜像幽灵不变；Esc 四档链、56 的 hover 层级不变。

## Comments

- 2026-09-09 实现，四项同批：
  - **① 结点选款收敛**：`renderSlideGhost` 改走 `slideNodeIconConfig(rc, conn, isFirst, isLast)`——该函数
    此前已被实绘 `renderSlideBody` 与描边 `collectSelectionOutlines` 共用，幽灵是唯一的漏网路径。
    未新增第二个选款函数（避免"两份口径"以另一种形式复现）。
  - **② 起手框选取消锚点**：`handlePointerMove` 跨过 `DRAG_THRESHOLD_PX` 之后、`dragRef` 分支之后清
    `slideBuffer`（拖音符 = 移动语义，不清）。
  - **③ 锚点改端点图标**：`renderSlideBuffer` 的青色同心圆整体删除，改画 `slideNodeIconConfig(…, true, true)`
    一枚端点精灵，尺寸/`spriteScale`（随 `noteSize`）与实绘端点完全一致，无光环、无透明度。
  - **④ Slide 态 hover 幽灵**：`renderToolPreview` 新增 `slide` 分支——落点端点款幽灵（α 0.35，与其它放置工具同档）；
    已挂锚点时再画锚点→落点的**连接带**，为此把 `renderSlideGhost` 的画法段抽出 `renderSegmentBand(ctx, c, rc, from, to)`
    复用（同一 clip + 同一 `slideBand` 精灵 + 同一宽度口径）。落点与锚点同拍（横向段/同位）→ 不画带子，
    与 `slideSecondClickOps` 的取消分支一致。
- 渲染层序随之调整：`renderChart` 里 `renderSlideBuffer` 移到 `renderToolPreview` **之后**——锚点是"已定下的实绘端点"，
  应压在第一击后的段幽灵之上（与真实滑条"先带后结点"的合成顺序同构），否则 35% 的段带会把锚点染淡。
- 顺带收敛：`renderSlideBody` 里那 30 行连接带几何与 `renderSegmentBand` 逐句相同 → 实绘改调同一函数（多一个 `alpha`
  入参承接 `slideOpacity`），幽灵继承调用方 `globalAlpha`。自此"滑条带子"只有一处画法。
- 锁测：`tests/unit/GhostPreview.test.ts` 重构出 `scene()` 夹具（可注入 slideBuffer / dragGhost），新增 5 例
  ——未第一击只有端点、已第一击 = 带子 + 端点、非法段不画带子、锚点 = 端点精灵、
  三结点拖拽幽灵"两端端帽 + 中间 among"（并前置断言默认皮肤确实区分两款，防止假锁）。
- 文档：ADR-0002 §4 预览表补「滑条工具态 · 悬停（未挂锚点）/（已挂锚点）」两行 + 一句"滑条幽灵结点选款 = 实绘同款"；
  ADR-0008 §4 两击直放补"锚点的取消边界"（含起手框选，且明确拖拽音符不清）。
- 2026-09-09 补充两处实现细节（验收时留意）：
  - **层序**：`renderChart` 里 `renderSlideBuffer` 移到 `renderToolPreview` **之后**——锚点是"已定下的实绘端点"，
    须压在第一击后的 35% 段幽灵之上，否则段带会把锚点染淡（与真实滑条"先带后结点"的合成顺序同构）。
  - **`renderSlideGhost` 跳过 `hidden` 结点**：`renderSlideBody` 本来就不画重合衔接点的图标，幽灵侧此前全画
    → 与"幽灵 = 实绘同形"不一致，本票顺手补齐。
  - **连接带只有一处画法**：`renderSegmentBand`（新增 `alpha` 入参，实绘传 `slideOpacity`、幽灵继承调用方
    `globalAlpha`）；`renderSlideBody` 里原来那 30 行几何已删。
