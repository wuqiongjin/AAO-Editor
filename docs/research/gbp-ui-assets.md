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
导出弹窗现暴露 AP / FC / CLEAR 三档（2026-11-09 用户验收补上 CLEAR 入口），灰星（未通关）仍没有入口。

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
| `SE_RHYTHM_GAYA.mp3` | 7.11 s | **开场人潮**：开场段第 0 秒起播，收在开场段末尾淡出（7.11 s > 6.75 s，故截断 + 0.8 s 淡出） |
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

## 8. 2026-11-08 只读复核：AUTO 与打歌 HUD 顶栏的素材边界

> 供 `.scratch/chart-preview` 票 71 / 72 用。本轮只核对本地素材与代码现状，**没有改 `src/`**。
> 实物在 `.cache/game-ui/`（21 件，清单见 `.cache/game-ui/README.txt`）；生产代码读的却是
> `public/assets/game-ui/`（`simAssets.GAME_UI_ASSET_BASE` / `endingAssets.ENDING_ASSET_BASE`），
> **该目录当前不存在**，`scripts/assets-sync.mjs` 的取件根也不含 `game-ui` ⇒ 缺件是常态。

### 8.1 与 AUTO 有关的官方素材：只有两件，且都是单词 `AUTO`

| 件 | 位置 | 是什么 |
| --- | --- | --- |
| `judgeskin/skin00/judge.png` + `.asset` 的 `judge_auto` | `289,177 205×79` | 判定字 **AUTO**（白芯粉描边，与 PERFECT 同排）；运行时从未切用 —— `simHud.judgeSprite()` 硬编码 `judge_perfect`，静态锁测还主动禁止 `judge_auto` |
| `atlas/MenuAtlas.png`（KR 2048²） | 约 `72,165` 一带，无 sprite 元数据 | 粉色 **AUTO** 词标（带 ▶ / ⤬ / ∨，像选曲页的自动设置开关），**不是**打歌 HUD 提示牌 |

- 2048² 全图分块目视复核：**没有** `AUTO PLAY` 连写字样、**没有**结算用 AUTO 标记、**没有**「分数下面的 AUTO 提示」组件；文件名含 AUTO 的素材为 0。
- `RhythmGameUI.png`（tw live HUD 图集）里同样没有 AUTO 字样。
- 官方 FAQ（`gbp-live-cinematic.md` §4）：オートライブ = 专用 AUTO 判定、结算**不显示判定内译**、分数相关不记录 —— 与本仓现行「全 PERFECT 内译 + ALL PERFECT 章」相反。

### 8.2 左上分数 / 右上生命 / 暂停：`stageskin/normal/RhythmGameUI.png`

分块放大目视能确认的官方零件：`SCORE 1/2` 标签、大号分数数字字形（`4328 E` / `78952` 一类，散落未登记）、彩虹渐变 gauge 填充条、圆角白底 **❚❚ 暂停按钮**（约 `827,320 65×62`）、「倒帶」「快轉」圆钮、`LIFE 舞台` / `LIFE 減少無效` 字样、`COMBO` / `FEVER` / `ALL READY!!` 字样。

- **不是**完整顶栏组件贴图：没有 score 面板 / life 槽外框，没有标注好的 0–9 精灵表或切图坐标；唯一的 `.asset` 是 `UICommon.png` 的 29 格（§1 已注明「与 RhythmGameUI 对不上」），其中唯一 gauge 相关 sprite = `bg_gauge_score_multi`（`253,196 18×18` 九宫格），**没有** `bg_gauge_life`、没有 pause 精灵。
- §4「游戏字体没有」仍成立；本地也没有官方实机 HUD 截图（`.cache/media/` 只剩 `stamp-fc.orig.png`），只有 `gbp-live-recording-BV1BDapzbEdX.md` 的文字量测（§3「顶栏分数 / 生命这支片有；本票不做分数」、§5「只剩立绘 + 顶栏分数 / 生命」）。
- 生产侧顶栏层根本不存在：`drawSimFrameAt` 只有「判定字 + combo」两条 HUD（`simField.ts:390-411`），暂停图标只有编辑器播放条的 lucide `Pause`（`PlayBar.tsx:142`）。

**结论**：以现有本地素材，做不到「只切官方图就把左上分数 / 右上生命 / 暂停 / AUTO PLAY 提示整组复刻」。缺的零件要么补取件 + 标坐标，要么由用户补官方实机截图，要么按票 51 Q12 口径**留空** —— 不允许 CSS / SVG / 系统字体伪造。

## 9. 2026-11-08 用户补料：打歌 HUD 基准与 AUTO LIVE 提示

| 文件 | 规格 | 说明 |
| --- | --- | --- |
| `/workspace/HUB-sample.png` | 2388×1668 · 4.8 MB | 用户提供的**打歌画面基准**（本地参考件）：左上 = 分数组件（黑底白描边 + 右下凹口；顶部灰带 = 圆形灰星章 + 绿色短条 / 游标 + `C/B/A/S/SS` 字母刻度与 ▽ 标记；下方 `00002571` = 前导零白 + 有效位青），其下**深蓝底青字粉描边**「自动演出」胶囊；右上 = 生命条（白框 + 绿心 + **上亮绿 / 下深绿两段 gauge** + `1000/1000`；2026-11-08 用户局部截图复核，早先「绿/洋红双层」是误读）与蓝 ❚❚ 白底圆角暂停钮；场中央 `3 COMBO`。**与 `tmp/C-.png` md5 相同（`d36678c4…`）= 同一文件**；12:13 那版（白底红字 / 粉底白字胶囊）已被替换，票内以当前文件为准 |
| `/workspace/auto-live.png` | 512×113 RGBA | **用户自造**（非官方撕图）的 AUTO 提示：粉红圆角胶囊 + 白字 `AUTO LIVE`、粉描边、透明底；用户明确「只在 AUTO 模式下出现」，可直接用作这块组件的素材 |

- 文案口径：图上是 **`AUTO LIVE`**（对应官方「オートライブ」），不是 `AUTO PLAY`；`HUB-sample` 里那枚是中文「自动演出」，两者是同一位置的不同稿。`HUB-sample` 的胶囊与 `auto-live.png` 同为粉底白字 ⇒ 这张基准图是用户**拼过提示组件的布局示意图**，不是纯官方截屏。
- **等级带素材核对（2026-11-08 补，票 72 Q9）**：官方图集里**没有** `C/B/A/S/SS` 字母刻度、也没有 HUB-sample 那种「白圈 + 灰星」圆形星章的切图。`RhythmGameUI.png` 顶部只有 `SCORE 1/2` 标签 + 五颗紫星 + 彩虹条 + 官方分数数字字形（`036.1` / `78952`）；`MenuAtlas.png` 只有 `SCORE RANK` 词标、难度圆徽与左上角的星徽四态（形态不同）；游戏字体仍缺（§4）。⇒ 按 Q7「只切官方零件、不用系统字体伪造」复刻不出等级带，需用户拍板素材来源（见票 72 Q13）。
- 顶栏零件在官方图集里**确实能对上**（`stageskin/normal/RhythmGameUI.png`，tw）：白色圆角框 + 星形圆章 + 深灰内条 + 右下凹口（= 分数 / 生命组件的外框族）、彩虹 / 双色 gauge 填充条、大号分数数字字形、白底圆角 ❚❚ 暂停钮（约 `827,320 65×62`）、心形图标、`COMBO` 字样。**但**这张图集**没有配套 `.asset` 切图表**（`UICommon.asset` 属于另一张图，§1 已注明对不上）⇒ 实现前须按 `HUB-sample` 逐件量测并登记坐标；没有官方件的地方仍按 Q12 留空，不用 CSS / SVG / 系统字体伪造。
- 素材边界（用户 2026-11-08 Q2 = OK）：两件补料都是**本地研究件**，沿用 `game-ui` 的不入 git / 不进安装包 / 缺件降级口径；建议落位 `.cache/media/` 或 `public/assets/game-ui/hud/`，不要留在仓库根目录被误提交。

## 10. 2026-11-08 用户补料（第二轮）：等级字母与 6 档分数条

| 文件 | 规格 | 说明 |
| --- | --- | --- |
| `/workspace/score-characters.png` | 1024×223 RGBA | `C / B / A / S / SS` 五个字母 + 每个字母下方一枚 ▽ 刻度；灰白渐变 + 灰描边、透明底。等级带的字母切图由此解决（用户自备件） |
| `/workspace/tmp/{C-,C-B,B-A,A-S,S-SS,SS+}.png` | 6 张 2388×1668 | 分数跨过各等级刻度后**分数条**的 6 种形态；字母与 ▽ 不变，变的是条：`C-` 绿色小竖胶囊 / `C-B` 紫+绿双层短条 / `B-A` 绿渐变金边 / `A-S` 蓝渐变粉边 / `S-SS` 青→黄绿→紫彩虹 / `SS+` 彩虹 + 星点闪光。`C-.png` 与 `HUB-sample.png` md5 相同 |

- **数值口径冲突**：6 张图分数均为 **8 位**，且 `SS+` 为 `01126823`（1,126,823 > 1,000,000）⇒ 与 Q8 / Q10 定案的「1,000,000 满分 + 7 位」不一致，待用户拍板（票 72 Q14）。
- **官方图集核对**（`RhythmGameUI.png` 逐行扫彩色带 + 目视）：能找到彩虹渐变 gauge 条（约 `y 95–125` 与 `y 394–414`，后者带金色箭头端）、蓝紫斜纹条、以及黄 / 青 / 粉 / 蓝等小色块；`tex_parSet_fever.png` 有星点粒子。**没有** 6 张现成整条贴图，也没有切图坐标表 ⇒ 6 档要么用官方零件逐件量测拼装，要么按用户自备件从这 6 张图裁条补位。
- **提示组件冲突**：当前 `HUB-sample` 的胶囊是「深蓝底青字粉描边 + 中文自动演出」，`auto-live.png` 是「粉底白字 `AUTO LIVE`」，两者不是同款，待用户指定（票 72 Q16）。
- **素材口径（用户 2026-11-08 Q13 定案）**：`score-characters.png` 可作用户自备素材；`tmp/` 6 张**只作辨识依据，不得截取**。6 档分数条样式**必须来自官方素材**。

### 10.1 官方分数条零件核对（2026-11-08 逐块目视，坐标近似，实现前逐件量测）

用户判断成立：`stageskin/normal/RhythmGameUI.png`（tw live HUD 图集）里**有各档条的零件**，只是没有 6 张现成整条贴图、也没有 `.asset` 切图坐标表。

| 官方零件 | 近似位置（原图 1024²） | 对应形态 |
| --- | --- | --- |
| 珠光彩虹渐变条（粉→紫→青→绿→黄，灰上下边，**条内自带星点闪光**） | `x 0–255, y 95–125` | `SS+` 的彩虹条 + 星点层（或与 `S-SS` 共用本体） |
| 青→蓝→紫→粉→橙彩虹渐变条（右端金色箭头） | `x 0–660, y 394–414` | `S-SS` / `SS+` 的彩虹条本体 |
| 蓝紫斜纹渐变条（青→蓝→紫→粉→橙，斜纹） | `x 0–220, y 185–194` | 候选：`A-S` 蓝渐变档 / FEVER 条 |
| 三个双层渐变色块（黄橙 / 青绿 / 粉） | `x ~260–400, y ~100–140` | `C-B` 紫+绿双层、`B-A` 绿渐变、`A-S` 蓝渐变的填充色卡 |
| 右侧一列双层色块（蓝 / 绿 / 紫 / 粉，上浅下深 + 网点） | `x ~980–1000, y ~130–220` | 各档条的**取色 / 状态块**（与 6 档切换同构） |
| 白色圆角框 + 星形圆章 + 深灰内条 + 右下凹口（外框族）、蓝色小胶囊 | `x 0–235, y 410–500` 一带 / `x ~530–570, y ~120–145` | 分数组件外框、`C-` 的绿色小竖胶囊 / 游标 |
| `UICommon.png` + `.asset` 的 `bg_gauge_score_multi`（`253,196 18×18` 九宫格）、`fill`、`label_r10_white` | — | 条的外框 / 可拉伸填充（游戏里是九宫格拼的，不是整条贴图） |
| `tex_parSet_fever.png` 的星点 / 四芒星粒子 | 已用格 `[153,278,79,76]` | `SS+` 条上额外的星点动效层 |
| KR `atlas/MenuAtlas.png` 另有粉 / 黄 / 彩虹斜纹横条 | `y ~1250–1330` | 备选 / 交叉核对，风格同源 |

**结论（2026-11-08 Q17 修订）**：用户指出「左上角的分数组件应该在 `RhythmGameUI.png` 里面」，逐块放大复核**成立** —— §10.1 里「九宫格外框」的说法绕远了，应改为**直接切整块官方组件 + 各档条 / 框态**。`UICommon.asset` 的 `bg_gauge_score_multi`（18×18）只是个小九宫格角块，不是分数组件外框。逐档对应关系与精确坐标仍须在 HUD 原型里量测定案（票 72 Q19 / Q20）。`tmp/` 不得作为裁图源。

### 10.2 分数组件整块贴图与新增参考图（2026-11-08）

- `RhythmGameUI.png` **`x 0–280, y 390–520`（近似）**：一整块分数组件 —— 白底灰描边圆角框 + 左侧**圆形星章（白圈灰星）** + 顶部**深灰内条（= 等级灰带）** + **右下斜切凹口**；框上沿压着 `y394–414` 那条青→蓝→紫→粉→橙的彩虹渐变条（= 分数条）。与 `HUB-sample` 的分数组件同构。
- 同一区域并排还有**红 / 青 / 黄等不同描边发光态**的同一块框（`x ~280–700, y 400–500`）⇒ 6 档切换可能同时换「条填充 + 框描边色」，需逐档比对（Q19 原型里定）。
- `tmp/SS+motion.mov`（8.4 MB）：用户描述 = `SS+` 时分数条像填了荧光剂，**大小不同的四角星从左侧流向右侧、循环播放**；`S-SS` 用同一条、不叠这层。本机无 ffmpeg / Chromium 二进制，**未解帧**，动效按用户文字描述实现。官方 `tex_parSet_fever.png` 粒子图集含四芒星（§1），可作星点源。
- `tmp/result-score.png`（2388×1668，结算参考，**同受 Q13 约束：只作辨识依据**）：右上 = 大号 SS 徽章（圆形放射光芒 + 绿紫 S + 绿色 `SCORE RANK` 缎带）；白卡顶部 = 圆形星章 +「得分」+ 大号青字粉描边数字（`2830…`），下接虚线与五行判定。官方 `atlas/MenuAtlas.png` 有**蓝色** `SCORE RANK` 缎带（约 `x1375–1565, y855–890`）、`MAX COMBO` 真件、顶栏星徽四态；**本地官方图集尚未定位到** `result-score.png` 那种 SS 徽章 / 绿色缎带与「得分」二字的切图 ⇒ 票 73 Q23。
- 新增 HUD 动效（用户 2026-11-08 额外提）：音符被击打时分数条下面有分数累积特效 —— 数值从分数组件下方**左侧弹到右侧边缘**，最终呈现为 `+xxxx`（票 72 Q22）。

### 10.3 Score Rank 徽章定位（2026-11-08 Q23 复核）

用户指出 `atlas/MenuAtlas.png` 里有 `D / C / C+ / B / B+ / A / A+ / S / S+ / SS / SS+` 与 `SCORE RANK` 缎带的**全部**资源，且「图里有多个 SS/S/B，推测可能要用大的那个」。逐象限复核**成立**：

- 大号绿色 `C+` 徽章：约 `x 950–1050, y 770–865`；同区域有 `MAX COMBO` 词标、`MULTI SCORE RANK` 粉缎带、`SCORE RANK` 蓝缎带（约 `x 1375–1565, y 855–890`）。
- 大号 `B` / `S` / `C` 等字母徽章集中在 `y ≈ 1024–1100` 一排（右下象限），同区还有 `COMPLETE!` / `NEW RECORD!` / `FULL COMBO` 词标与放射状圆形徽章。
- 小号 `A` / `B` 等字母徽章另有一套（如 `x 512–1024, y 0–512` 区），印证「多个 SS/S/B」⇒ **按用户推测取大号那套**，逐档在 HUD 原型里并排比对（Q19 定案）。
- 「得分」二字（简中标签）在 KR `MenuAtlas.png` 里没有 ⇒ 用户 2026-11-08 拍板**自绘 + 走 i18n 多语言 + 用 `HEADER_SANS`**（`src/preview/fontStack.ts`，与结算曲名同一条字体链），不进素材表；见票 73 第 8 轮定案。这是「不伪造」边界里唯一允许的文字例外。
