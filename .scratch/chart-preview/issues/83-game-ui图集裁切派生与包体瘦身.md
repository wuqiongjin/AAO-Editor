# 83 · game-ui 图集裁切派生与包体瘦身

Type: chore
Status: resolved（2026-11-22 本地实现完成 + 锁测全绿；快照仓 payload 由用户操作，见 Comments）
Blocked by: —（与票 82 共用同一批派生件，建议同批落地，避免图集切两遍）

## 来源

用户 2026-11-22 提两点：① `game-ui` 下的图片资源可能没有有效利用，平白增加安装包体积；② 能否借「重新整改这些图片」修掉 SS 的白底。

② 的结论已由票 82 否掉 —— 白不是背景，是官方画上去的盘面与贴纸边，抠图只会偏离实机。本票**只处理体积**，不改任何画面像素。

## 现状（实测 2026-11-22）

`public/assets/game-ui/` 共 **12 张 PNG / 1,347 KB**，全部被代码或原型引用，**没有孤岛文件**；也没有任何构建期图片加工（Vite 只把 `public/` 原样拷进 `dist/`）。浪费在**大图集的空白像素**：

| 文件 | 体积 | 尺寸 | 实际用量 | 像素利用率 |
| --- | --- | --- | --- | --- |
| `atlas/MenuAtlas.png` | 630.9 KB | 2048² | 6 格（星徽三态 + 盘/字母/缎带），40,567 px | **0.97%** |
| `stageskin/normal/RhythmGameUI.png` | 134.7 KB | 1024² | 3 格（`barA` 661×22 / `pause` 63×60 / 结算 `medal` 29×30） | **1.8%** |
| `stageskin/normal/tex_parSet_fever.png` | 32.8 KB | 512² | 1 格（四芒星 110×100） | **2.1%** |
| `judgeskin/skin00/judge.png` | 28.1 KB | 512×256 | 5/8 格 | 58%（正常） |
| `result/stamp-ap.png` + `stamp-fc.png` | 380.1 KB | 各 1028×187 | 整张 | 100%（见下节待测项） |
| `hud/*` 三件 + `result/mark-*` + `max-combo` | 140.7 KB | — | 整张 | 100% |

- **无损重压无效**：用 zlib level 9 把 12 张全部重编码，结果都比现有文件更大（现有已是调色板 / 低熵编码）。唯一杠杆是「少存像素」。

## 收益（实测 / 估算）

- `MenuAtlas` 6 格打包成一张 **200×310 / 15.5 KB**（单文件拆开合计 14.9 KB）⇒ 省 **约 615 KB**。
- `RhythmGameUI` 3 格、`fever` 1 格同理 ⇒ 再省约 155 KB。
- 合计：`game-ui` 1,347 KB → **约 550 KB**（剩余大头是 `stamp-ap/fc` 的 380 KB）。

## 硬约束（落地前必须满足）

1. **快照仓 payload 不能留原图**。`public/` 全量进 `dist/`，而 `scripts/assets-sync.mjs` 是整根 `rmSync` + 覆盖、没有 exclude 机制（`ROOTS` 第 3 项）。若 payload 里仍有 `MenuAtlas.png`，取件后它照样进安装包与 `/app/`，派生件只是白做。⇒ 原图移到快照仓**非 payload** 目录供再生成，payload 只放派生小图。
2. **派生必须可复现**：裁切脚本 + 「原图坐标 → 派生件」对照表要入仓，否则丢掉「这是官方原像素」的可追溯性，违背票 52 / 72 / 73 的「只切官方零件、不伪造」口径。
3. **不做有损转码**换体积（实测无损重压已无空间，有损会伤字边与渐变）。

## 实现口径（待定项已标出）

- 派生清单：`MenuAtlas` 6 格 → 票 82 的 `rank-{disc,letter,ribbon}` + `badge-{ap,fc,clear}`；`RhythmGameUI` → `barA` / `pause` / `medal`；`fever` → 四芒星。`judge.png` 可不动（5/8 已是正常利用率）。
- **脚本位置待定**：脚本入仓（如 `scripts/derive-game-ui.mjs`），产物由**快照仓侧**生成（用户 2026-11-22：派生物最终要到快照仓，放本地没有意义）。
- **`stamp-ap/fc` 待量**：380 KB 是剩余大头，是否降采样取决于实际绘制宽度（`endingFrame.wordLayer(wPx)` 缓存按目标宽建 canvas）。先量 `wPx` 与 1028 的比值，再决定要不要出小号件；比值接近 1 就不动。

## 锁测

- 体积门禁（静态脚本 / CI）：断言 `public/assets/game-ui` 下**不存在超过阈值的大图集**，或断言 `MenuAtlas.png` 不在产物里；覆盖单测拿不到的「产物体积」。
- 静态断言：`simHud.HUD_SPRITES` / `endingFrame` 的切图常量与派生坐标**同源**，不允许两处各写一套。
- 像素回归：派生前后对同一帧做逐像素比对（`composite_now.png` 一类基线），证明「只换了存放形式、画面零变化」。
- `tests/static/AssetsSync.test.ts`：取件根与派生件清单一致（取件后派生件不能凭空消失）。

## Comments

2026-11-22：体积数据与像素利用率均为本轮现场实测（解码 `MenuAtlas.png` 逐格统计 alpha / 亮白像素 + zlib 重编码对照）。裁切样本见 `.cache/_preview/rank-src/`。

2026-11-22（实现）：派生脚本 `scripts/derive-game-ui.mjs` 入仓（自带最小 PNG 编解码、无第三方依赖；裁切表是坐标的唯一事实源，支持 `--from` / `--out`）。实际产出 **11 张 / 22.6 KB**（源图集三张 798.4 KB）：

| 派生件 | 源坐标 | 尺寸 | 体积 |
| --- | --- | --- | --- |
| `result/rank-disc.png` | MenuAtlas `1080,1286` | 140×132 | 5.3 KB |
| `result/rank-letter-ss.png` | `1303,969` | 86×82 | 3.5 KB |
| `result/rank-ribbon.png` | `1375,855` | 190×35 | 1.7 KB |
| `result/badge-ap.png` | `116,218` | 57×55 | 1.9 KB |
| `result/badge-fc.png` | `60,257` | 57×55 | 1.6 KB |
| `result/badge-clear.png` | `275,230` | 47×45 | 1.0 KB |
| `result/score-medal.png` | RhythmGameUI `7,421` | 29×30 | 0.5 KB |
| `hud/score-fill.png` | `1,393` | 661×22 | 3.4 KB |
| `hud/pause.png` | `828,319` | 64×64 | 0.9 KB |
| `hud/star-flow.png` | fever `0,266` | 110×100 | 0.9 KB |
| `result/star-particle.png` | `153,278` | 79×76 | 2.2 KB |

代码面：`endingAssets` 9→14 槽（`menu` / `rhythmGameUI` 退役）、`simAssets` 的 `rhythmGameUI`→`scoreFill`、`fever`→`starFlow` 并拆出 `pauseBtn`、`HUD_SPRITES` 三格改整图取景（`(0,0)` 起）、`prepareSimRendering` 的预热判据改 `scoreFill`、原型 `hudProto.js` 同步。**画面像素零变化**（派生是无损裁切，源矩形尺寸不变）。

**快照仓待办（用户操作）**：① 三张原图（`atlas/MenuAtlas.png`、`stageskin/normal/RhythmGameUI.png`、`stageskin/normal/tex_parSet_fever.png`）从 payload 移出，放到快照仓的非 payload 目录；② 在构建阶段跑 `node scripts/derive-game-ui.mjs --from <原图目录> --out <payload 根>` 生成 11 张派生件；③ payload 里只留派生件 —— 否则 `assets-sync` 整根覆盖后原图照样进 `dist/`，本轮优化归零。

`stamp-ap/fc`（380 KB）本轮**不动**：要按 `wordLayer(wPx)` 的实际目标宽再决定要不要出小号件，属后票。

2026-11-22（命名收敛 + pause 修正，用户拍板）：借 payload 未落地的窗口一次改完，避免快照仓上线后再两边同步。

- `result/rank-letter.png` → **`result/rank-letter-ss.png`**：大号字母只有 SS 一档切片（其余 9 档纯字），旧名看似全档通用；字段同步 `rankLetter` → `rankLetterSs`。
- `result/medal.png` → **`result/score-medal.png`**：`badge-*`（顶栏星徽）/ `mark-*`（白卡角标）已带区域前缀，只有它没有；字段同步 `medal` → `scoreMedal`，常量 `MEDAL` → `SCORE_MEDAL`。
- `hud/star-particle.png` → **`result/star-particle.png`**：它是结尾中央章的粒子母图，归结算段，先前错放在打歌 HUD 下。
- `hud/pause.png` 取景 `[828,318,63,60]` → **`[828,319,64,64]`**：实测原图集包围盒是 x 828..891 / y 319..382 = 64×64，旧框**漏掉下方 5 行圆角边与右侧 1 列**，且 63×60 拉到 82×82 有 5% 纵向拉伸。`simHud.HUD_SPRITES.pause`、`hudProto.SPR.pause`、两处锁测同步。
- 验证：`npx tsc -b` 干净；`tests/static` 104 文件 / 803 例绿；`tests/unit/preview/video` 22 文件绿；派生件重生成 11 张 / 22.8 KB，`pause.png` 首尾行均有像素（上下圆角完整）。

2026-11-22（评审修正，`AssetsSync.test.ts` 7 → 12 例）：把本票锁测里空着的那几条补上 ——

1. **取件根覆盖对照表里的每个落点**：`assets-sync.mjs` 的 ROOTS 含 `public/assets/game-ui`，对照表里的路径必须都在这根之下，否则拉回来就没了。
2. **产物里不得再有整张图集**：断言 `public/assets/game-ui` 下不存在 `MenuAtlas / RhythmGameUI / tex_parSet_fever`（目录未取件时跳过，兼容 CI 未跑 `assets:sync`）。
3. **尺寸同源**：绘制侧常量（`RANK_DISC` / `RANK_LETTER` / `RANK_RIBBON` / `SCORE_MEDAL` / `barA` / `pause` / `star`）与派生件 IHDR 实际像素逐一比对。这条把「两处各写一套」钉成"改一处没跟上就红"，不改绘制代码 —— `naturalWidth` 在 node 单测里读不到，且现有锁测已认定尺寸表放在绘制侧。

2026-11-23（生成器不入主仓）：按 `tests/static/AssetsSync.test.ts` 头注的 release-pipeline 02 口径——「**主仓不存资源产物、也不带产出它们的工具**」——`scripts/derive-game-ui.mjs` **不进主仓**。它现在也跑不了（原图只在 `.cache/`，已被忽略），留在主仓等于一把锁在别人家的钥匙。生成器随快照仓、与三张原图放一起；主仓只保留 `docs/research/gbp-ui-assets.md` §12 的坐标对照表作唯一事实源。`AssetsSync.test.ts` 的三条锁测改为**读该表**（不再读脚本源码），新增一条「对照表尺寸 == 派生件 IHDR 实际像素」。代码与 ADR 里指向 `scripts/derive-game-ui.mjs` 的注释同步改为指向 §12。
