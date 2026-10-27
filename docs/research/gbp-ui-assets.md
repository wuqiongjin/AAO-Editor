# 邦邦 UI 素材清单（chart-preview 票 50–52 用）

> 2026-10-26 整理。游戏素材**仅供本地研究**：不入 git、不再分发；`public/assets/` 已被 `.gitignore` 忽略。
> 目录：`public/assets/game-ui/`；用户上传原件放在 `.cache/media/`（未入库）。

## 1. 官方撕图（Bestdori）

| 文件 | 规格 | 内容 | 来源 |
| --- | --- | --- | --- |
| `judgeskin/skin00/judge.png` | 512×256 · 28 KB | 判定五档 + AUTO + FAST / SLOW 图集 | `https://bestdori.com/assets/jp/ingameskin/judgeskin/skin00_rip/assets-star-forassetbundle-startapp-ingameskin-judgeskin-skin00-judge.png` |
| `judgeskin/skin00/judge.asset` | 1.8 KB | 8 格切图坐标（见 §5） | 同上 `…-judge.asset` |
| `stageskin/normal/RhythmGameUI.png` | 1024² · 138 KB | live HUD 图集（COMBO / FEVER / 按钮 / 数字 / 装饰）——**不含 ALL PERFECT 字样**，也**不含顶栏星徽**（星徽在 §1.1 的 `MenuAtlas.png` 里，见 §3）。2026-10-27 起结尾段已不再引用此图 | `https://bestdori.com/assets/tw/ingameskin/stageskin/normal_rip/RhythmGameUI.png`（**只有 tw 服撕了**；jp / en / cn / kr 同路径返站点 HTML） |
| `stageskin/normal/UICommon.png` | 512×256 · 16 KB | 通用形状 / 按钮 / 九宫格 | 同上目录 |
| `stageskin/normal/tex_parSet_fever.png` | 512² · 34 KB | 粒子图集：点状五角星、实心星、四芒星、圆环、音符（黑底加色） | 同上目录 |
| `stageskin/normal/UICommon.asset` | 6 KB | `UICommon.png` 的 29 格 sprite 表（`icon_header_star` / `label_square_white` / `label_r10_white` / `bg_base_r12` / `fill` / `button_*` / `bg_jacket_frame_rank_*` 等，含九宫格边距）。**它只属于 UICommon，不是 `RhythmGameUI.png` 的切图表** | `https://bestdori.com/assets/tw/ingameskin/stageskin/normal_rip/.asset` |

背景（仿真场同一份，取件仓产物）：`public/assets/sim/bgskin/jp/skin00_rip/liveBG_normal.png`。

### 1.1 韩服（KR）独有的 `MenuAtlas.png`（2026-10-27 发现）

`https://bestdori.com/assets/kr/ingameskin/stageskin/normal_rip/MenuAtlas.png`（2048² · 646 KB）。
jp / en / tw / cn 的 `stageskin` 里**没有这个文件**（KR 的 normal / challenge / versus 三个包同名、**md5 相同**：`e73b969b…`），
所以它是韩服客户端那份「菜单 + 结算」图集。两件真件**用户 2026-10-27 认可**（"韩服资源可以使用，这是真的资源"），已裁好接入生产：

| 落位 | 图集坐标 | 尺寸 | 内容 |
| --- | --- | --- | --- |
| `result/mark-fc.png` | 527,737 | 221×40 | `FULL COMBO⚡`：粉紫渐变 + 白描边 + O 内星 + 末尾闪电（与 AP 章同一套设计语言，颜色是粉）。**只做结算小标**，不是中央章 |
| `result/max-combo.png` | 940,718 | 112×59 | `MAX / COMBO` 两行白字（= 结算白卡上半深灰带那两行） |

**同图集里还有**（未接）：`COMPLETE!` / `SCORE RANK` / `MULTI SCORE RANK` / `NEW RECORD!` / `MISSION CLEAR` / 难度圆徽（EASY·NORMAL·HARD·EXPERT）/ 顶栏星徽四态（见 §3）。
**ALL PERFECT 字样不在此图集内**（AP 章 2021-07 上线，KR 图集更旧）。

## 2. 用户提供

| 文件 | 规格 | 说明 |
| --- | --- | --- |
| `result/stamp-ap.png` | 1028×187 · 243 KB · RGBA | **ALL PERFECT! 中央章字样**（白描边、字内网点、缺口闪电 + 右下小星），用户自抠，与 `结尾中央徽章.mov` 同一套素材。2026-10-27 由 `all-perfect.png` 改名 |
| `.cache/media/结算画面(无FAST-SLOW).png` | 2388×1668 · 5.9 MB | 结算页高清截图（无 FAST / SLOW 版） |
| `.cache/media/Opening.mov` | 1920×1342 · 120 fps · 8.28 s · 21 MB | 进 live 前的曲目信息片头（曲目「ヒカリへ」） |
| `.cache/media/结尾中央徽章.mov` | 1920×1342 · 60 fps · 5.87 s · 17 MB | ALL PERFECT 中央章演出 |

### 2.1 AP / FC 是**两套**材质（2026-10-27 用户拍板）

结算画面那两枚角标比中央章**小**（高 5%H vs 章宽 62.2%W），实机也是两套不同的图 —— 大图缩下去会糊、小图放大会糊，
所以素材表按槽位分开，**互不顶替**（缺哪套哪处走纯字，`endingFrame` 的两个取图函数各管一处）：

| 槽位 | 用途 | 文件 | 状态 |
| --- | --- | --- | --- |
| `stampAp` | 中央章 AP（大） | `result/stamp-ap.png` 1028×187 | ✅ |
| `stampFc` | 中央章 FC（大） | `result/stamp-fc.png` | ⛔ **暂缺**（等用户截图抠图） |
| `markAp` | 结算白卡 AP 角标（小） | `result/mark-ap.png` | ⛔ **暂缺**（同上） |
| `markFc` | 结算白卡 FC 角标（小） | `result/mark-fc.png` 221×40 | ✅（§1.1） |

## 3. 顶栏星徽三态（2026-10-27 用户指认，改到 `atlas/MenuAtlas.png`）

`MenuAtlas.png` **左上角**有同一套四颗星（灰 → 金 → 粉 → 虹彩），就是结算顶栏星徽的四种形态；
**不预裁文件，运行时按图集切图**（坐标写在 `src/preview/video/ending/endingFrame.ts` 的 `BADGE_SPRITES`）：

| stamp | 颜色 | 图集坐标（含 3px 发射光） | 实心部分 |
| --- | --- | --- | --- |
| `ap` | 虹彩（青→紫→粉） | 116,218 57×55 | 119,221 51×49 |
| `fc` | 粉 | 60,257 57×55 | 63,260 51×49 |
| `clear` | 金 | 275,230 47×45 | 278,233 41×39 |
| （未接） | 灰（未通关） | 224,239 38×37 | 同左 |

三格尺寸不同 ⇒ 绘制按 `starSize / 57` 的**同一比例尺**、同中心对齐，保留三颗的相对大小（各自缩到同高会把金星放大一圈）。
导出弹窗目前只有 ALL PERFECT 一档（形态档 2026-10-27 暂时撤下），所以灰星没有入口。

**已废弃两件**（都切错了，别再翻回来）：
- `derived/star-64.png`（`UICommon.png` 的 `icon_header_star` 裁件）—— 那是**星石（货币）图标**。
- `RhythmGameUI.png` 的 `250,217 / 289,289 / 350,296` 三格 —— 2026-10-27 核过，切出来分别是半颗粉角、一个「《」按钮、一块灰角，**不是星**。

## 4. 没拿到的

- **中央巨大五角星**（章里压在字样上的那颗）：视频 1.8–2.2 s 正好压住彩虹字样、白描边压白描边，亮度/色度键都会把字的笔画吸进来；分析员结论「不能干净抠」。
- **游戏字体**（结算数字、顶栏标题、MAX COMBO）：没有；目前只能用 web 字体。
- **MAX COMBO**：当前服图集里没有独立图（九宫格 + 文字）；**韩服 `MenuAtlas.png` 里有真件**（`940,718`，112×59 两行白字，见 §1.1），已接生产。
- **ALL PERFECT 字样**：官方撕图至今没有任何来源。用户手上有自抠的 `result/stamp-ap.png`（1028×187，中央章用）——
  结算那枚**小号** AP 角标仍缺（用户 2026-10-27：后续截图再抠）。
- **FULL COMBO 的中央章大图**：缺（`MenuAtlas` 只有结算那份 221×40 的小图，见 §2.1）。
- **ALL PERFECT / FULL COMBO 字样在官方撕图里没有**（2026-10-27 **穷举复核**）：`ingameskin` 七个分类下全部 **171 个包**的文件清单逐个拉取扫描，命中 `perfect|combo|result|stamp|clear` 的只有
  `bgskin/skin_teamlivefestival/ComboStage.png` 与 `…/PerfectStage.png`（技能型舞台底图，不是字样）。三个 `stageskin` 包的 `RhythmGameUI.png` md5 完全相同。
  同风格的词标只有 `FEVER!` / `ALL READY!!` / `FEVER CHANCE!` / `VS` / `COMBO`。结算白卡与 AP·FC 章属 startapp 里未被撕的那一支。
  唯一剩下的真路径 = 游戏资源 CDN（`https://d2ktlshvcuasnf.cloudfront.net/Release/{版本}_{64位hash}/Android/{asset}`），那串 hash 只能抓包拿。
- **`SE_RHYTHM_ALLPERFECT` 不存在**：`ALLPERFECT` / `ALL_PERFECT` / `PERFECT` / `FULL_COMBO` / `AP` 五种命名在 `sound/common_rip` 下全部返站点 HTML（= 404）。

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

## 6. 音频候选（票 31 / 52）

`sound/common` 共 39 个文件，**没有 AP 专用音**。已取到 `public/assets/game-ui/audio/`
（时长 2026-10-27 按 mp3 帧数实测，取代早先按 128 kbps CBR 折算的估值 —— `GAYA` 的 9.44 s 就是这么错的）：

| 文件 | 时长 | 用途（2026-10-27 用户定案） |
| --- | --- | --- |
| `SE_RHYTHM_GAYA.mp3` | 7.11 s | **开场人潮**：开场段第 0 秒起播，收在开场段末尾淡出（7.11 s > 5.0 s，故截断 + 0.8 s 淡出） |
| `SE_RHYTHM_CLEAR_VO.mp3` | 3.47 s | **结尾章固定的人声层**（三种形态都出） |
| `SE_RHYTHM_CLEAR.mp3` | 2.51 s | **结尾章伴奏层**：普通 Clear |
| `SE_RHYTHM_FULLCOMBO.mp3` | 1.23 s | **结尾章伴奏层**：FC / AP |
| `SE_UI_STUMP.mp3` | 0.52 s | **不是章音效**：用户 2026-10-27 指认 = 游戏里发表情包（stamp）的特效音 |
| `SE_RHYTHM_CUTIN_AUDIENCE.mp3` | 4.52 s | 参考：技能切镜观众声 |
| `SE_RESULT_SCORERANK.mp3` | 0.57 s | 参考：结算评级音 |

接线：`src/preview/video/sfx.ts`（cue 表）→ `renderAudioTrack` 按秒调度（走 `se` 增益，不另开音量设置）。

直连注意：**必须带 `_rip`**（`/assets/jp/sound/common_rip/<名>.mp3`）；不带 `_rip` 会拿到 14 KB 的站点 HTML。

## 7. 相关文档

- 录屏/截图事实与两段 .mov 的逐帧分析：`docs/research/gbp-live-recording-BV1BDapzbEdX.md`（§3 判定字、§7 素材、§8 用户补料）。
- 游戏 vs 本仓的既有对照：`docs/research/gbp-live-cinematic.md`。
