# 邦邦 UI 素材清单（chart-preview 票 50–52 用）

> 2026-10-26 整理。游戏素材**仅供本地研究**：不入 git、不再分发；`public/assets/` 已被 `.gitignore` 忽略。
> 目录：`public/assets/game-ui/`；用户上传原件放在 `.cache/media/`（未入库）。

## 1. 官方撕图（Bestdori）

| 文件 | 规格 | 内容 | 来源 |
| --- | --- | --- | --- |
| `judgeskin/skin00/judge.png` | 512×256 · 28 KB | 判定五档 + AUTO + FAST / SLOW 图集 | `https://bestdori.com/assets/jp/ingameskin/judgeskin/skin00_rip/assets-star-forassetbundle-startapp-ingameskin-judgeskin-skin00-judge.png` |
| `judgeskin/skin00/judge.asset` | 1.8 KB | 8 格切图坐标（见 §5） | 同上 `…-judge.asset` |
| `stageskin/normal/RhythmGameUI.png` | 1024² · 138 KB | live HUD 图集（COMBO / FEVER / 按钮 / 数字 / 装饰）——**不含 ALL PERFECT 字样** | `https://bestdori.com/assets/tw/ingameskin/stageskin/normal_rip/RhythmGameUI.png`（**只有 tw 服撕了**；jp / en / cn / kr 同路径返站点 HTML） |
| `stageskin/normal/UICommon.png` | 1024² · 16 KB | 通用形状 / 按钮 | 同上目录 |
| `stageskin/normal/tex_parSet_fever.png` | 512² · 34 KB | 粒子图集：点状五角星、实心星、四芒星、圆环、音符（黑底加色） | 同上目录 |
| `stageskin/normal/atlas.asset` | 6 KB | 29 格 nine-slice / 图标坐标（button_* / label_square_white / bg_jacket_frame_rank_* 等）；**坐标与 `RhythmGameUI.png` 对不上，未验证** | `https://bestdori.com/assets/tw/ingameskin/stageskin/normal_rip/.asset` |

背景（仿真场同一份，取件仓产物）：`public/assets/sim/bgskin/jp/skin00_rip/liveBG_normal.png`。

## 2. 用户提供

| 文件 | 规格 | 说明 |
| --- | --- | --- |
| `result/all-perfect.png` | 1028×187 · 243 KB · RGBA | **ALL PERFECT! 字样**（白描边、字内网点、缺口闪电 + 右下小星）。章与结算卡共用；与 `结尾中央徽章.mov` 里的是同一套素材 |
| `.cache/media/结算画面(无FAST-SLOW).png` | 2388×1668 · 5.9 MB | 结算页高清截图（无 FAST / SLOW 版） |
| `.cache/media/Opening.mov` | 1920×1342 · 120 fps · 8.28 s · 21 MB | 进 live 前的曲目信息片头（曲目「ヒカリへ」） |
| `.cache/media/结尾中央徽章.mov` | 1920×1342 · 60 fps · 5.87 s · 17 MB | ALL PERFECT 中央章演出 |

## 3. 派生素材（不是官方原件）

| 文件 | 规格 | 抠法 / 限制 |
| --- | --- | --- |
| `derived/star-64.png` | 64×64 · 11 KB | 顶栏最左星徽，从 `结算画面(无FAST-SLOW).png` 按「离白距离」转 alpha 抠出；源只有 64 px，放大会软。4K 截图可重抠 |

## 4. 没拿到的

- **中央巨大五角星**（章里压在字样上的那颗）：视频 1.8–2.2 s 正好压住彩虹字样、白描边压白描边，亮度/色度键都会把字的笔画吸进来；分析员结论「不能干净抠」。
- **游戏字体**（结算数字、顶栏标题、MAX COMBO）：没有；目前只能用 web 字体。
- **MAX COMBO 专用图**：没有独立图；游戏里是深灰形状 + 白字 + 白底框，文字与卡内其它文字同源。
- **ALL PERFECT 在官方撕图里没有**：`ingameskin` 七个分类（bgskin / fieldskin / judgeskin / noteskin / stagelight / stageskin / tapeffect）全部清单扫描无 perfect / combo 字样；`stageskin` 的 `.bundle` 只是预载表 JSON，不是 Unity 包。

## 5. 判定图集坐标（`judge.asset` 原样）

| sprite | x | y | w | h |
| --- | --- | --- | --- | --- |
| judge_perfect | 0 | 177 | 287 | 79 |
| judge_great | 0 | 105 | 225 | 70 |
| judge_good | 227 | 105 | 219 | 70 |
| judge_bad | 168 | 33 | 148 | 70 |
| judge_miss | 0 | 33 | 166 | 70 |
| judge_auto | 289 | 177 | 205 | 79 |
| judge_fast | 318 | 73 | 143 | 30 |
| judge_slow | 318 | 41 | 143 | 30 |

## 6. 相关文档

- 录屏/截图事实与两段 .mov 的逐帧分析：`docs/research/gbp-live-recording-BV1BDapzbEdX.md`（§3 判定字、§7 素材、§8 用户补料）。
- 游戏 vs 本仓的既有对照：`docs/research/gbp-live-cinematic.md`。
