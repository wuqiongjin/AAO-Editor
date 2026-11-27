# 82 · 结算 SCORE RANK 徽章分层入场

Type: feature
Status: resolved（2026-11-22 已实现 + 锁测全绿；待用户导出成片验收分层观感）
Blocked by: —

## 来源

用户 2026-11-22 报：动态预览里，结算画面进入时 SS 徽章淡入，**能明显看到一块突兀的白色**；怀疑它带了白色背景。

## 现状与实测（2026-11-22）

- 徽章是**三件拼装**，全部从 `atlas/MenuAtlas.png` 硬切：盘 `[1080,1286,140,132]` / 字母 `[1303,969,86,82]` / 缎带 `[1375,855,190,35]`（`simHud.HUD_SPRITES`），绘制在 `endingFrame.drawRankBadge`（`1696-1740`）。
- **没有脏底、没有白框**：三件矩形四角 `alpha` 全为 0。白量全在素材本身 ——
  - 盘内芯实心奶白 **7,123 px**（占其矩形 38.5%，`alpha=255`，圆心 `254,252,252`）；
  - SS 贴纸白描边 **1,920 px**（27.2%，`alpha>8` 包围盒顶满 86×82，四周无可扣背景）；
  - 缎带白字 546 px。
- 入场是**整组共用一个 `ctx.globalAlpha`**（`endingFrame.ts:1709`），窗口 `rankInAt 20 / rankInDur 20`（`endingSpec.ts:282-283`）落在 q 轴约 0.806–0.992 s，约 **186 ms**。金色放射纹是细线（覆盖率低），低 alpha 时先糊掉；白盘面 / 白描边是面 ⇒ 观感是「先冒出一块白，金环后到」。
- 用户 2026-11-22 核对官方实机：**终态同样是 SS 奶白边压住盘心**。⇒ 终态无缺陷，素材不需要抠。

## 定案（用户 2026-11-22 逐项拍板）

1. 走**路线 A**：素材零改动，只改入场时序；终态逐像素不变。
2. **分层三件**：盘 / 字母 / 缎带各自独立 PNG、各自 alpha，不再从 `MenuAtlas` 切。
3. 顶栏星徽三态（`ap`/`fc`/`clear`，`endingFrame.ts:140-144`）**一并切成独立图**，`MenuAtlas.png` 彻底不进包体。
4. 派生件落位 `public/assets/game-ui/result/rank-{disc,letter,ribbon}.png` 与 `result/badge-{ap,fc,clear}.png`；必须进快照仓 payload（口径同票 83）。
5. **已否决**：抠盘内芯 / 抠 SS 白边（会偏离实机；白边是贴纸设计本体，不是脏背景）。

## 实现口径（本轮实现口径，待验收）

| 层 | 起点 | 时长 | 曲线 |
| --- | --- | --- | --- |
| 盘 | 0 | ~90 ms | ease-out + `0.86 → 1.0`（过冲 1.02） |
| 字母 | +90 ms | ~130 ms | `1.28 → 1.0` 放大落位 |
| 缎带 | +150 ms | ~120 ms | y `+6px → 0` 上浮 |

- 全部仍落在既有 `rankInAt / rankInDur` 窗口内，**不改结算总时长**，也不动 `drawSettlement` 的 `q` 轴口径。
- 终态合成顺序与尺寸不变：字母宽 = 盘宽 × `rankLetterScale 0.6`，缎带宽 `ribbonW 10.4167%W`，离盘下沿 `ribbonBelow 4px`。

## 实现落点

- `src/preview/video/ending/endingSpec.ts`：每层 delay / dur / scale 新键（沿用 `ENDING_SPEC` + 可写宽化版）。
- `src/preview/video/ending/endingAssets.ts`：`menu` 单槽退役，换 `rankDisc` / `rankLetter` / `ribbon` / `badgeAp` / `badgeFc` / `badgeClear` 六槽（9 → 14），逐件独立降级。
- `src/preview/video/ending/endingFrame.ts`：`drawRankBadge` 拆三层分别设 `globalAlpha` / `scale`；`BADGE_SPRITES` 退役（改整图绘制，无切图）。
- `src/preview/video/sim/simHud.ts`：`HUD_SPRITES.rankDisc / rankLetter / ribbon` 退役，避免「图集坐标」与「独立图」两套来源并存。
- `public/proto/hudProto.js`：原型保持与生产同名同值。
- 文档：`docs/research/gbp-ui-assets.md` 记「原图集坐标 → 派生件」映射，保住官方原像素的可追溯性。

## 锁测

- `tests/unit/preview/video/EndingFrame.test.ts`：三层各自 `globalAlpha` 与目的矩形；**终态（alpha=1）与旧实现位置/尺寸逐项一致**，防止「分层」顺手改了排版。
- `tests/static/EndingWiring.test.ts`：槽位 9 → 14、六个新 URL、缺件逐项降级（缺某件只那一层不画，不整组作废）。
- 静态断言：`MenuAtlas` 不再出现在 `endingAssets` 与绘制侧的引用里。
- 像素对照（单测覆盖不到 canvas 时序）：原型结算场景在 `rankP ≈ 0.35` 抓帧，与 `.cache/_preview/rank-src/ab_a35_with_plate.png` 作基线；改后应仍能看出「盘先到、字母后落」的先后。

## Comments

2026-11-22：三件已按官方像素裁到 `.cache/_preview/rank-src/`（`disc.png` / `letter.png` / `ribbon.png`，附 `*_checker` / `*_whitemask` / `composite_now` / `ab_*` 对照）。用户核对官方实机后确认终态就是「SS 奶白边压盘」，遂放弃抠图路线，转路线 A。

2026-11-22（实现）：`endingSpec` 加 9 个键（三层 in/out 区间 + 两个起始缩放 + 缎带上浮），窗口口径仍是 `rankInAt / rankInDur`（%q），总时长不变；`endingFrame.rankBadgeProgressAt` 把窗口进度折成三层各自 alpha / 缩放，`drawRankBadge` 三层分别设 `globalAlpha` 并各自 `drawImage`（源矩形一律 `(0,0)`）。`endingAssets` 由 9 槽扩到 **14 槽**（`menu` 退役，新增三态星徽 + 徽章三件 + Score 行圆星章），逐件并发兜底；`simHud.HUD_SPRITES` 的 `rankDisc / rankLetter / ribbon / medal` 退役。原型 `hudProto.js` 同步新素材键。

锁测：`EndingFrame.test.ts` 新增「窗口前段只有圆盘、字母 / 缎带还在路上」用例（20% 帧只画盘、100% 帧三层齐），并断言终态尺寸仍是 156 / 93.6 / 200（分层不得顺手改排版）；`EndingWiring.test.ts` 改 14 槽 + 派生件 URL + `rankBadgeProgressAt` 接线。验证：`npx tsc -b` 干净，全量 `vitest run` 见票 83 同批记录。

2026-11-22（用户验收 OK）：入场白块问题已消失，观感达标。

2026-11-22（命名收敛，见票 83 Comments）：字母层派生件改名 `result/rank-letter-ss.png`，`EndingAssets` 字段 `rankLetter` → `rankLetterSs`；本票正文里的 `rank-{disc,letter,ribbon}` 是当时口径，实际落位以 `scripts/derive-game-ui.mjs` 裁切表为准。

2026-11-22（评审修正）：补 `rankDiscOvershoot: 0.02` 与 `discScaleAt()` —— 前 70% 用 `easeOutCubic` 冲到 1.02、后 30% 二次平滑落回 1。原实现走 `smooth()`（smoothstep，两端都缓）且单调到 1，票面口径表的「ease-out + 过冲 1.02」两条都没落地。锁测补：三层各自 `globalAlpha`（中段三个值互不相同）、过冲峰值（35% 帧盘宽 > 156）、终态回到 156。

**未对齐项（保留并记录）**：三层时间轴仍是实现值（字母 +52 ms、缎带 +102 ms），票面表写的是 +90 / +150 ms。用户已验收当前节奏，硬对齐会改观感，故不动数字。
