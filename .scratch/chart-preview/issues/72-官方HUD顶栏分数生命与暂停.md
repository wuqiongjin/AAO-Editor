# 72 · 官方 HUD 顶栏：左上分数 / 右上生命 / 暂停图标

Type: grilling
Status: resolved（**2026-11-08 已实现**：官方 / 自备件顶栏四件 + 6 档分数条 + `+增量` + SS+ 星点，画进仿真场帧）
Blocked by: —

**来源**：2026-11-08 用户第 2 条诉求，原文「支持左上角的分数统计，右上角的生命值和暂停图标。(对标官方的素材，不要自己伪造)」，并附「如果是AUTO模式左上角分数统计组件下面可能还有个AUTO PLAY相关的提示组件 (也找一找官方的素材)」。
**调研**：`docs/research/gbp-ui-assets.md` §8.2、`docs/adr/0016-谱面预览与游戏仿真导出.md` §1.2 / §4、`docs/research/gbp-live-recording-BV1BDapzbEdX.md` §3 / §5、`docs/research/gbp-live-cinematic.md` §4、票 01 定案② / 票 51「本票不包含」。

## 症状

- 仿真场画面只有右侧 combo + 场中央判定字；左上分数、右上生命、游戏内暂停图标都不存在。
- 画面里唯一的「暂停」是舞台**外部**播放条的 lucide `Pause` 图标（`src/playback/PlayBar.tsx:142`），属于编辑器控件，不是游戏 HUD。

## 根因（首期范围定案 + 官方零件不齐 + 素材路径错位）

1. 票 01 定案② / ADR-0016 §1.2 明写「首期**不含**分数 / 技能 / fever」，判定字与 AP combo 是票 51 后补的；`simGeometry.ts:616-622` 注释仍写「HUD 只画 combo」。`drawSimFrameAt` 的 HUD 段确实只有 `drawJudgement` + `drawCombo`（`simField.ts:390-411`），没有顶栏层。⇒ 这是范围定案，不是漏画。
2. 官方素材**只有零件，没有整组件**（§8.2 分块目视）：tw 服 `stageskin/normal/RhythmGameUI.png` 有 `SCORE 1/2` 标签、大号分数数字字形、彩虹 gauge 填充条、圆角白底 ❚❚ 暂停按钮（约 `827,320 65×62`）、「倒帶」「快轉」、`LIFE` 字样；但**没有** score 面板 / life 槽外框、没有标注好的 0–9 精灵表、没有 `RhythmGameUI.png` 的切图坐标表。唯一的 `.asset` 属于 `UICommon.png`，其中只有 `bg_gauge_score_multi`（`253,196 18×18` 九宫格），无 `bg_gauge_life`、无 pause 精灵。
3. 游戏字体没有（`gbp-ui-assets.md:76`）；本地也没有官方实机 HUD 截图（`.cache/media/` 只剩 `stamp-fc.orig.png`），实机顶栏只有录屏文字量测（「顶栏分数 / 生命这支片有；本票不做分数」）。
4. **数值本身也无法从谱面真算**：分数 / 等级依赖卡组、技能、fever、活动倍率（`gbp-live-cinematic.md:92`「分数 / 等级 / 编成 / 奖励无法从谱面单独算真」；ADR-0016 的对应结论在 §1.2「首期不含分数」与 §5.2「不画 SS / 得分 / 排名」，**§4 是「载体与作用域」，此前票里引错了**）；AUTO 模式下官方甚至「分数相关不记录」。公式检索见 `gbp-live-cinematic.md` §7：官方无公开公式，社区拆解依赖総合力 / Lv / 技能，谱面工程里都不存在。
5. 素材路径同票 71：实物在 `.cache/game-ui/`，生产读 `public/assets/game-ui/`（不存在，且不进安装包 / 不在 `assets-sync` 取件根）⇒ 接了也读不到。
6. 用户点名的「分数下面的 AUTO PLAY 提示组件」：官方素材里**没有**对应件（只有 `judge_auto` 判定字与 KR `MenuAtlas` 的 `AUTO` 菜单词标，见 §8.1）。该组件的**语义与素材**归票 71，本票只负责它在顶栏的**位置与依赖**。

## 定案（用户 2026-11-08 · grill 第 1 轮）

1. **Q2 = OK**：`game-ui` 维持「本地研究件、不入 git / 不进安装包、缺件留空或纯字」，不把 HUD 零件纳入 `assets-sync` 与发布物。
2. **Q3 = OK**：画进仿真场帧 ⇒ 实时预览 + 导出都有；暂停图标只作视觉，不接点击（实时预览仍用底部 `PlayBar`）。
3. **Q4 用户补料**：`/workspace/HUB-sample.png`（2388×1668，打歌 HUD 实机基准：左上分数组件含 `C/B/A/S/SS` 等级带 + 圆形星章 + `00002571`；右上生命条含绿心 + 双层 gauge + `1000/1000` + 蓝 ❚❚ 暂停钮；分数下面的蓝色「自动演出」胶囊）与 `/workspace/auto-live.png`（512×113 用户自造的 `AUTO LIVE` 胶囊，只在 AUTO 模式出现）。详见 `docs/research/gbp-ui-assets.md` §9。
4. **补料后的事实修正**：顶栏零件在 tw `RhythmGameUI.png` 里**确实能对上**（白框 + 星圆章 + 深灰内条 + 右下凹口的外框族、gauge 填充条、分数数字字形、暂停钮、心形图标），但**这张图集没有配套 `.asset` 切图表**，实现前须按 `HUB-sample` 逐件量测登记坐标。原根因 2「无整组件」仍成立（是零件，不是现成组件）。

## 定案（用户 2026-11-08 · grill 第 2 轮）

1. **Q7 = OK**：顶栏四件从 `RhythmGameUI.png` 切官方零件，`HUB-sample.png` 只作量测 / 布局基准（不直接抠图），`auto-live.png` 作为用户自备图接入 AUTO 提示槽位、文案照用 `AUTO LIVE`；缺件仍按 Q2 / Q12 留空。
2. **Q8 = OK + 补充**：分数 = 从谱面可算的累计量、生命 = `1000/1000` 恒满（预览无伤、AUTO 不掉血）。用户追加：**满分 = 1,000,000**，单音符得分取决于这张谱面的音符总数；若能找到官方公式则优先。
   - 公式实查（`docs/research/gbp-live-cinematic.md` §7）：官方 [SYSTEM 页](https://bang-dream.bushimo.jp/system) **没有**公开分数公式；社区拆解（巴哈 / PTT 2017、NGA 2024）是 `總和力 × Lv加成 / NOTE數` 再乘判定 / 卡组 / 技能 / FEVER / COMBO 倍率，各来源倍率不一致，且依赖谱面工程里没有的参数 ⇒ **不可套用**。但其「同一谱面每个可击打物基础分相等、与 NOTE 数成反比」的结构**支持**用户推测。
   - 1,000,000 是本仓预览的**归一上限**，不是ガルパ官方满分（实机分数随总力变化）；票面 / UI 不得宣称它是官方分数。
3. **Q9 用户未答**，留到第 3 轮。

## 定案（用户 2026-11-08 · grill 第 3 轮）

1. **Q9 用户否了「不做」推荐**：`C/B/A/S/SS` 等级带**要加**（原话「我觉得要加啊…应该不难的」）。本期范围 = 分数框（含等级带 + 圆形星章）+ 数字 + 生命条 + 暂停钮 + `AUTO LIVE` 提示。**但**官方图集里没有 `C/B/A/S/SS` 字母刻度与该圆形星章的切图（`gbp-ui-assets.md` §9 补记），Q7 的「只切官方零件」覆盖不到它们 ⇒ 素材来源见 Q13。
2. **Q10 位数修正**：满分 1,000,000 ⇒ `00002571`（8 位）应减 1 位，按 **7 位固定宽**显示（`0002571`；满分 `1000000`）；前导零灰、有效位洋红（照 `HUB-sample`）。线性归一公式本身待 Q14 一并确认。
3. **Q11 = OK**：改生产代码前先做 HUD 调参原型（沿用 `public/proto/` 的 canvas + 参数面板）定位置 / 尺寸 / 比例。本机 Playwright Chromium 二进制缺失 ⇒ 原型需用户自己在浏览器看数。
4. **Q12 = OK**（记在票 71）：AUTO 开时只换判定字 + 显示提示，AP combo / 结算内译 / AP 章不变。

## 定案（用户 2026-11-08 · grill 第 4 轮 · 部分）

1. **Q15 用户纠正语义**：不是「逐字母点亮」；**字母本身样式不变**，变的是**分数条** —— 分数跨过每个字母刻度后，分数条换一种样式。给出 6 张形态图 `tmp/{C-,C-B,B-A,A-S,S-SS,SS+}.png`（见 `gbp-ui-assets.md` §10）：绿色小竖胶囊 / 紫+绿双层短条 / 绿渐变金边 / 蓝渐变粉边 / 青→黄绿→紫彩虹 / 彩虹+星点闪光。
2. **等级字母素材已补**：`/workspace/score-characters.png`（1024×223，C/B/A/S/SS 五个字母 + 各自 ▽ 刻度，透明底）⇒ Q13 里「字母无官方切图」由用户自备件解决；灰带与圆形灰星仍待定来源。
3. 用户把这轮回答标作「Q14」，内容实际属 Q13 / Q15；**公式 / 位数那条 Q14 未答**，见下。

## 定案（用户 2026-11-08 · grill 第 5 轮）

1. **Q13 定案（收紧）**：`score-characters.png` 可作**用户自备素材**；`tmp/` 6 张**只作辨识依据，不得截取**。6 档分数条样式**必须用官方素材**（用户：「我非常确定官方素材有分数条的样式的」）。⇒ Q7「`HUB-sample` 只作布局基准」与这条一致：灰带 / 圆形灰星也不能从 `C-.png` 裁。
   - 已复核：官方 `RhythmGameUI.png` 确有各档零件（珠光彩虹条、青→橙彩虹条、蓝紫斜纹条、多组双层渐变色块、白色圆角外框族、蓝色小胶囊），`UICommon.asset` 有 `bg_gauge_score_multi` 九宫格，`tex_parSet_fever.png` 有星点。坐标与逐档对应见 `gbp-ui-assets.md` §10.1。**没有 6 张整条贴图、无切图坐标表** ⇒ 需逐件量测 + 拼装。
2. **Q14 = OK**：`score = floor(1_000_000 × 已命中数 / 可击打物总数)`、最后一个可击打物补齐到 1,000,000、**7 位固定宽**（`0002571` → `1000000`）；6 张形态图只作样式参考，8 位数字与 >100 万的读数不照抄。
3. **Q15 = OK + 补充**：按 6 区间切分数条样式，字母与 ▽ 固定不变，阈值按 `score / 1,000,000` 百分比在原型里定。用户补充：**`SS+` 与 `S-SS` 的分数条样式相同，但 `SS+` 时条本身有额外动效** ⇒ 两档共用同一条贴图，`SS+` 叠一层动效（不是换条）。
4. **Q16 = OK**：AUTO 提示用 `auto-live.png`（粉底白字 `AUTO LIVE`），`HUB-sample` 里的中文胶囊只作位置 / 尺寸参考。

## 定案（用户 2026-11-08 · grill 第 6 轮）

1. **Q17 用户质疑「九宫格外框」，复核后成立**：`RhythmGameUI.png` `x 0–280, y 390–520`（近似）就是**一整块分数组件**（白底灰描边圆角框 + 圆形星章 + 深灰等级灰带 + 右下斜切凹口），上沿压着彩虹渐变分数条；旁边还有红 / 青 / 黄描边发光态的同一块框 ⇒ **口径改为直接切整块官方组件 + 各档条 / 框描边态**，不用 `UICommon.asset` 的 18×18 九宫格角块拼。上一轮的拼装说法作废（见 `gbp-ui-assets.md` §10.2）。
2. **Q18 定案**：用户给 `tmp/SS+motion.mov`（8.4 MB）并描述 —— `SS+` 时分数条像填了荧光剂，**大小不同的四角星从左侧流向右侧、循环播放**；`S-SS` 共用同一条、不叠这层。官方 `tex_parSet_fever.png` 有四芒星粒子可作星点源。本机无 ffmpeg / Chromium 二进制，**未解帧**，动效以用户文字描述为准。
3. **Q19 = OK**：6 档与官方色块 / 渐变条的逐档对应，在 HUD 调参原型里给候选由用户逐档挑。
4. **新增需求（用户额外提）**：音符被击打时，分数条下面有分数累积特效 —— 数值从分数组件下方左侧弹到靠右侧边缘，最终展示成 `+xxxx`。归本票（Q22）。
5. **结算画面分数适配**（score-rank 图标 +「得分」行）与 HUD 不同模块 / 不同定案 ⇒ **另开票 73**（`Blocked by: 72`，分数口径依赖 Q14）。

## 定案（用户 2026-11-08 · grill 第 7 轮）

1. **Q20 = OK**：直接切 `RhythmGameUI.png` 整块分数组件 + 各档条 / 框描边态，不用九宫格拼；红 / 青 / 黄描边框一起量测。
2. **Q21 = 可以**：`SS+` 用官方 `tex_parSet_fever.png` 四芒星做「大小不一、左→右流动、循环」的星点层叠在 `S-SS` / `SS+` 共用条上；动效参数（速度 / 密度 / 循环时长）在 HUD 原型里调（本机未解帧）。
3. **Q22 = OK**：击打特效是**每次增量**（用户原话「我要的就是每次增量」）——每命中一次显示 `+<本次增量>`（= 1,000,000 / 可击打物总数取整），从分数组件下方左侧弹到右侧边缘后淡出，数字用官方分数数字字形。_2026-11-09 用户验收：曾引入「限流合并」被否决并回退（实机没有该机制），维持每次命中各画一条、不设条数上限；位移 / 亮度 / 渐隐等观感参数保留在原型可调，见 Comments。_

**本票待拍板问题已收口**。原计划的「Q11 HUD 调参原型」已于同日完成并定稿，见下节；结算部分独立在票 73。

## 定稿（2026-11-08 · 原型验收通过，可直接开工）

原型：`public/proto/hudProto.js`（绘制层）+ `public/proto/scenes.html`（打歌 tab）。
本节的数值就是原型里跑通的那一组，实现时照抄即可，不必再翻上面的历史轮次。

### 1. 素材（已归档并校验）

`.cache/game-ui/` ↔ `public/assets/game-ui/` **逐字节一致，24 件**（`hud/_source/` 只在 cache 侧，是抠底前原件）。
清单与切图坐标写进 `public/assets/game-ui/README.txt` §六。

| 用途 | 文件 | 取景 |
|---|---|---|
| 分数组件**整块** | `hud/score-bar.png`（593×132） | 4 切片 `60 / 190 / 310 / 33`；空槽 `[64,10,521,41]` |
| 生命组件**整块** | `hud/life-bar.png`（540×115） | 4 切片 `78 / 180 / 230 / 52`；空槽 `[78,9,451,50]` |
| 分数条渐变（6 档共用） | `stageskin/normal/RhythmGameUI.png` | `barA [1,393,661,22]` |
| 暂停钮 ❚❚ | 同上 | `[828,318,63,60]` |
| 圆星章（结算 Score 行） | 同上 | `[7,421,29,30]` |
| AUTO LIVE 胶囊 | `hud/auto-live.png`（512×113） | 整图 |
| 判定字 | `judgeskin/skin00/judge.png` | PERFECT `[0,177,287,79]` / AUTO `[289,177,205,79]` |
| SS+ 星点 | `stageskin/normal/tex_parSet_fever.png` | `[0,266,110,100]` |

仍属**自绘**（生产要替换或明确接受）：分数数字、`+增量`、`C/B/A/S/SS` 字母、▽ 刻度、生命槽绿色填充。

### 2. 参数（= 将来 `SIM_HUD` 的初值）

| 键 | 值 | 说明 |
|---|---|---|
| `boxX/Y/W/H` | 36 / 38 / 652 / 105 | 1920×1080 设计坐标 |
| `bandRadius` | 0.15 | ×槽高；槽是小圆角矩形（0.5 = 胶囊，会留暗角） |
| `fillScale` | 1 | 归一填充倍率 |
| `digitFont/DX/DY` | 35 / 0.115 / 0.725 | 7 位定宽，前导零 `#c9c9c9`、有效位 `#e8417f` |
| `letterH/Alpha/DY` | 13 / 0.75 / 7 | 字号 = `letterH/0.72`；`letterDY` 让字母下移接近刻度 |
| `tickGap` | 0 | ▽ 相对默认位下移量（px，可负） |
| `tickH` | 4.24 | ▽ 三角图标高（设计 px，随 `s` 缩放；宽 = 高 × 1.35）。2026-11-09 起可独立调，原型旋钮「刻度图标大小」 |
| `thresholds` | `[0.06, 0.27, 0.48, 0.69, 0.9]` | 相对槽宽；同时决定 6 档切换 |
| `life` | 1458 / 38 / 350 / 82 | 计数字号 22，右对齐贴在右下凹口 |
| `pause` | 1822 / 38 / 82 / 82 | 宽高分开给（图集那块更扁） |
| `auto` | 36 / 150 / 278 | `auto-live.png`，仅 AUTO 模式显示 |
| `plus` | dur .5 / fadeFrac .35 / fadeOutFrac .2 / baseAlpha .85 / X .45 / Y 122 / DX .34 / rise 0 / spreadX 0 / spreadY 0 / font 35（原型另有 demoRate 14） | `+增量`：**每次命中各一条 `+inc`、不设上限、不合并**（2026-11-09 回退）；默认档 = 用户 2026-11-09 原型快照，透明度 = 底亮度 + 渐显 × 末尾渐隐；X/Y/DX/Rise/Spread/BaseAlpha/FadeOut 全在原型可调 |
| `star` | count 12 / size 17 / alpha .9 | 仅 SS+ 档叠加 |

6 档 = 官方条 A 上的窗口（**材质 B 已废弃**）：C- `0–16%` / C-B `2–30%` / B-A `55–100%` / A-S `30–80%` / S-SS `8–92%` / SS+ `0–100%`。

### 3. 生产落点

- `src/preview/video/sim/simHud.ts`：新增顶栏层（`drawTopBar`），在 `drawSimFrameAt` 的 HUD 段里、`drawJudgement` / `drawCombo` 之前。
- `src/preview/video/sim/simAssets.ts`：加 `RhythmGameUI.png` / `auto-live.png` / `score-bar.png` / `life-bar.png` 的 URL 与切图常量；缺件走留空。
- 判定字：沿用生产 `judgeStateAt` 的 `stacked` 口径（间隔 ≤ `life` 不淡入），原型已对齐。
- `PreviewVideoStage.tsx` 不动（暂停钮只作视觉）。

### 4. 验收清单

- [ ] 1920×1080 抓 C- / B-A / S-SS / SS+ 四档，填充条左右端都落在槽内、无暗边、无竖缝（切片取整）。
- [ ] 7 位定宽：`0000300` 这类前导零灰、有效位洋红；满分 `1000000` 不溢出。
- [ ] `+增量` 窗口内**每次命中各一条 `+inc`**、不设上限、不合并；越往右越不透明、末尾渐隐；位移 / 亮度 / 渐隐可在原型里调。
- [ ] AUTO 下判定字 = `judge_auto`、显示 AUTO LIVE、combo 无 AP 辉光。
- [ ] 缺 `score-bar.png` 时降级为描边框，不抛错、不留白块。

### 5. 未决（不阻塞开工）

- `B–A` 参考图是「绿→金」，材质 A 上无绿金段，现取 A 暖端近似；要严格复刻须另找官方件。
- 分数数字仍无官方字形表，先用 `HEADER_SANS` 占位。
- SS+ 最右端的星点会被槽的右圆角裁掉一半，需要时可加右端淡出。

## 实现落点（定案后才动，本轮不改代码）

- `src/preview/video/sim/`：新增顶栏 HUD 绘制（分数 / 生命 / 暂停 / AUTO 提示占位）与素材槽位，接进 `drawSimFrameAt` 的 HUD 段；`simAssets.ts` 增加 `RhythmGameUI.png` / `UICommon.png` 的 URL 与切图常量。
- `src/pages/preview/PreviewVideoStage.tsx`：若要交互，需与既有 `PlayBar` 播放 / 暂停语义对齐（默认不做）。
- `docs/adr/0016-谱面预览与游戏仿真导出.md` §1.2（「首期不含分数」作废）、`CONTEXT.md`「仿真场」词条、`docs/research/gbp-ui-assets.md` §8.2（补切图坐标 / 官方出处）。
- 与票 71 的交叉：AUTO 提示的显示条件由 71 定案，本票只给它留位置。

## 锁测（定案后哪些用例会红 / 要新增）

- 会红：`tests/static/SimHudWiring.test.ts`（HUD 段结构 / 缺件纯字）、`tests/unit/preview/video/SimField.test.ts`（帧图层顺序）、`tests/unit/preview/video/SimAssets.test.ts`（素材 URL 与缺件不空态）、`tests/unit/preview/video/SimGeometry.test.ts`（combo 锚点注释不是测试，但相邻断言需复核）。
- 新增：顶栏组件「只用官方切图坐标、不出现 `fillText` 自造分数 / 自绘 gauge」的静态源码断言；缺件降级（留空 / 不画）单测；AUTO 提示位置与票 71 状态挂接的静态断言。
- 单测覆盖不到的（Canvas 像素、图集切块观感、1080p / 720p 等比、实时预览与导出一致）：Playwright 1080p 逐帧像素实测 + 手工验收清单；单测锁不了像素与素材是否到位。

## Comments

- 2026-11-08 开票：只读盘点完成，未改 `src/`。素材目视结论见 `docs/research/gbp-ui-assets.md` §8.2。与票 71 分工：本票管顶栏 HUD 组件与布局，71 管 AUTO 语义与 AUTO 显示内容。
- 2026-11-08 grill 第 1 轮：Q2 / Q3 = OK；Q4 补 `HUB-sample.png` / `auto-live.png`。补料后核对：顶栏零件在 `RhythmGameUI.png` 能对上，但无配套切图坐标表（`gbp-ui-assets.md` §9）。第 2 轮待 Q7 / Q8 / Q9。
- 2026-11-08 grill 第 2 轮：Q7 / Q8 = OK；用户追加满分 1,000,000、单音符分随谱面音符数。官方 SYSTEM 页无分数公式、社区拆解不可套用，见 `docs/research/gbp-live-cinematic.md` §7；顺带修正根因 4 对 ADR-0016 §4 的错误引用。Q9 未答，第 3 轮待 Q9 / Q10 / Q11。
- 2026-11-08 grill 第 3 轮：Q9 用户否了「不做等级带」的推荐（`C/B/A/S/SS` 要加）；Q10 指出满分 1,000,000 应为 7 位显示；Q11 / Q12 = OK。补核素材：官方图集无等级带字母 / 圆星切图（`gbp-ui-assets.md` §9），`HUB-sample` 是合成示意图。第 4 轮待 Q13 / Q14 / Q15。
- 2026-11-08 grill 第 4 轮：用户纠正 Q15 语义（字母不变、变的是分数条），补 `score-characters.png` 与 `tmp/` 6 张形态图；回答标作 Q14 但公式 / 位数那条**未答**。核对发现 `HUB-sample.png` 已被替换为与 `C-.png` 相同的文件（md5 `d36678c4…`），§9 描述已按现状更正。新冲突：8 位分数 / `SS+` 超 100 万、两款 AUTO 胶囊。清单见 `gbp-ui-assets.md` §10，第 5 轮待 Q13 / Q14 / Q15 / Q16。
- 2026-11-08 grill 第 5 轮：Q13 收紧（`tmp/` 只作辨识依据、6 档条必须官方素材），Q14 / Q15 / Q16 = OK；补充 `SS+` 与 `S-SS` 同条但 `SS+` 有额外动效。当日逐块复看 `RhythmGameUI.png` / `UICommon.png` / `tex_parSet_fever.png`，确认官方零件齐（近似坐标见 `gbp-ui-assets.md` §10.1），无 6 张整条贴图、无坐标表。第 6 轮待 Q17 / Q18 / Q19。
- 2026-11-08 grill 第 6 轮：Q17 用户质疑九宫格，复核确认整块分数组件就在 `RhythmGameUI.png`（`x0–280, y390–520`，另有红 / 青 / 黄描边态），拼装口径作废；Q18 给 `SS+motion.mov` + 文字描述（四角星左→右流动循环，未解帧）；Q19 = OK。用户额外提击打 `+xxxx` 特效（归本票）与结算分数适配（**拆出票 73**）。详见 `gbp-ui-assets.md` §10.2，第 7 轮待 Q20 / Q21 / Q22（票 72）与 Q23–Q25（票 73）。
- 2026-11-08 grill 第 7 轮：Q20 / Q21 / Q22 = OK（击打特效是**每次增量**）。本票待拍板问题收口，等用户确认设计共识后做 Q11 的 HUD 调参原型；结算部分在票 73。
- 2026-11-08 Q26 共识确认后：新建 `public/proto/hud.html` 调参原型（**未改 `src/`**）。含打歌 HUD / 结算两个 tab、官方零件候选板（源图坐标可直接量测）、6 档 → 候选条分配、阈值联动自动切档、`SS+` 四芒星流动与 `+增量` 弹跳参数、结算 rank / 缎带切图坐标与中英标签、参数 JSON 导出。自备件 `auto-live.png` / `score-characters.png` 复制到被 gitignore 忽略的 `public/assets/game-ui/hud/`。校验：内嵌脚本 `node --check` 通过、页面与 7 个素材 URL 本地 / 云环境均 200、无 lint 报错；**Playwright Chromium 二进制缺失，未做浏览器截图验收**，需用户在浏览器看数。
- 2026-11-08 原型重构（用户反馈「hud.html 从头重建、融进 scenes.html」）：删掉独立的 `public/proto/hud.html`，改为 **`/proto/hudProto.js`（绘制层）+ `scenes.html` 打歌 / 结算两个 tab**。理由：HUD 必须叠在**生产渲染的真帧**（`drawSimFrameAt` / `drawEndingFrameAt`）上才看得准，独立页面既看不见轨道音符、又要把打歌与结算的页面重造一遍。原型层只负责「生产还没实现的那一层」，参数与将来要落的 `SIM_HUD` / `ENDING_SPEC` 键同名。重做顺带修掉的坑：① 分数组件改**三切片**（左帽星章 / 中段 / 右帽凹口），灰带不再跟着贴图拉伸 —— 贴图自带灰带只占 32%，先盖白再按 `bandY / bandH` 画槽；② 等级字母与 ▽ 刻度**分开切**，字母高跟灰带高走，不再溢出被裁；③ `+增量` 从数字右侧弹到框右缘并淡出，与 `SS+` 星点同层；④ 判定字改由原型接管（才能切 AUTO / PERFECT），位置按生产口径 `场地中线 / laneHeight − 0.092H` 算，不再拿整帧高估；⑤ 结算行 `rowFirst` 下移时同步推 `comboY`，否则 MAX COMBO 压住「得分」；顶栏 `barW` 收窄到 74.6%W 给右上徽章让位；⑥ 时间轴在打歌段改用**命中密度 + 命中线**（原来没有音效 cue 就是一条空轨）。校验：本机装好 Playwright Chromium（`install-deps` 补了 glib/gbm），1920×1080 逐帧截图核对 S-SS / SS+ / C- 三档与结算卡，控制台无报错。
- 2026-11-08 第二轮修正（用户逐条）：① **判定字叠字**：只有上一次消失后才淡入，否则每音"灭一下再亮"就是几帧空窗 —— 改成生产 `judgeStateAt` 的 `stacked` 口径（间隔 ≤ `life` 时不淡入、满强度、只重新弹）；`+增量` 同理改成**多条各绘各的相位**（`SS+.png` 里本来就两条叠着）。② **AUTO 下关 AP 特效**：`comboStyle().ap = comboAP && !autoMode`。③ **生命组件改官方切图**：`RhythmGameUI.png` 里就有同模子的一块（`lifeL [2,331,40,58]` / `lifeM [42,331,100,58]` / `lifeR [142,331,41,58]`，槽在 `x31..175, y6..26`，绿心 + 白框 + 右下斜切凹口），三切片绘制；**只有槽里的绿色填充是色块**（图集只有空槽与整块「LIFE舞台」绿条，无独立 gauge），颜色取同图集绿条。暂停钮切图 `[828,318,63,60]`，宽高分开给。④ **尺寸按 `tmp/C-.png` 实测**（811×137 / 370×101 / 85×93，按 W 等比折到 1920）：分数组件 652×110、生命 297×81、暂停 68×75、AUTO 胶囊 285×51 —— 原来是 646×126 + 376×64 + 62×55，分数偏大、生命与暂停偏小。⑤ **灰带圆角可调**（`bandRadius`，× 带高，实测 ≈0.22，原来写死胶囊 0.5）；顺带把分数数字上移到带下（`digitDY` 0.78→0.605、`digitDX` 0.15→0.075），空白不再挤在下面。⑥ 等级字母 / ▽ 刻度仍是 `score-characters.png` 切图（`LETTERS[].box / .tri` 分开切），贴图是灰白渐变、压在亮条上会糊，改用**同一张图 additive 叠画一遍**提亮到实机白字观感（仍是原图，不换色）。
- 2026-11-08 第三轮修正（用户逐条）：① **分数组件 / 生命组件换成用户自备件** `score-bar.png`(593×132) / `life-bar.png`(540×115)。两张原图是不透明棋盘格底（不是 alpha），已用「最大纯白连通块 + 填内部空洞 + 外扩 2px 保描边」抠底后放到 `public/assets/game-ui/hud/`；绘制走**横向 4 切片**（`scoreSlices` / `lifeSlices`，星章 / 绿心 / 右端圆角固定，中间两段按原宽比例分剩余宽度），纵向永远等比。空槽位置从图里量：`scoreBand {57,8,527,45}`、`lifeBand {80,10,448,46}`，填充条画在槽里。② **C/B/A/S/SS 与 ▽ 改 Canvas 自绘**（`score-characters.png` 弃用并删除副本）：字号 = `letterH/0.72`，白字 + 深色描边，▽ 用三角形画，`letterColor` 可调。③ **`+增量` 透明度方向反了**：改成 `0.05 + p × 1.15`（越往右越不透明），去掉末尾淡出。④ 缺省值整组换成用户 2026-11-08 给的那份（`BASE` 由「读生产常量」改为字面量；生产常量仍由 `PROD` 跟踪做差分），落地页 = `scene=ending&stamp=ap&t=7.5`。⑤ 辅助线改由 `hudGuideRects()` 出（组件几何只在一处算）。
- 2026-11-08 第四轮修正：① `+增量` 加 `plusFadeFrac`（透明→不透明的占比 × 时长，默认 0.9 —— 只在最后 10% 才是全不透明），公式 `0.05 + p / plusFadeFrac`。② 等级字母与 ▽ 刻度加 `tickGap`（px，±24），并把字母层挪到**灰带裁剪之外** —— 否则刻度往下推会被裁掉；注意往下推到白牌上是白字白底（看不见），实际用法是往负方向调近。③ 结算「得分」左的圆星章取景修正 `[8,424,27,27] → [7,421,29,30]`：原坐樯把圆环上沿两行切平了。④ 结算加 `resultRowDY`（px，沿卡宽等比，±90）：整行（图标 / 得分 / 分数）上下微调，用来调距卡片上沿的间隙；`rowFirst` 仍控行高。⑤ 缺省值换成用户第四轮那份（`boxH 105 / digitFont 35 / letterH 12 / life 350×82 / pause 82×82 / rowFirst 12 / score 970000`），落地页 = `scene=sim&t=5.033`。
- 2026-11-08 第五轮修正：① 结算叠层拆成「行 / 徽章」两套时机：`resultInAt / resultInDur`、`rankInAt / rankInDur`（都以**转场结束 = 结算段起点**为 0 点，单位 %结算段 + 秒）；`drawEndingScore` 拆成 `drawResultRow` + `drawRankBadge(alpha)`，两者各自淡入。② 等级字母加 `letterDY`（px）—— 让**字母下移去接近刻度**，刻度不动；`tickGap` 保留但降为次要。③ **修掉分数条下面的两条竖线**：根因是切片在小数 x 上 `drawImage`，左列按覆盖率与背景混合，相邻两块各混一次 = 一条透出背景的 1px 线（用单张拉伸可复现消失，已确认）。改法：`sliceX` 先算累计切点，**内部切点取整**、外沿保持原样（轮廓抗锯齿仍要）。④ 缺省值换成用户第五轮那份（`plusDur .85 / plusFadeFrac .5 / score 30000 / rankRight 150 / resultRowDY -12 / t 4.624`）。
- 2026-11-08 第六轮修正：① **结算元素出现时机**：之前锁在 `stampDur+transDur`（生产里卡片早就入场完了）—— 这就是「最后才出现」的真正原因。改为**复用生产 `drawSettlement` 的同一把尺** `q = clamp01((e - transDur*0.4) / (transDur*0.6))`，`resultInAt / resultInDur`、`rankInAt / rankInDur` 都改成 %入场轴（默认 8/24、20/25，对齐卡片本体 `at(0.08,0.32)`）；另乘 `1 - curtainAlpha(e, transDur)` 做「画在黑幕下面」的效果（曲线与 `endingFrame.ts` 的 `curtainAlpha` 同一条，原型不改 src 故本地复制一份）。② **6 档颜色改用官方渐变条**：`RhythmGameUI.png` 里量到两条长条 —— `barA [0,390,668,25]`（薄荷→青→蓝→紫→品红→粉→珊瑚→橙）、`barB [0,96,316,14]`（粉→紫→蓝→青→绿→黄），`TIERS` 从「自编色标」改成 `{bar, from, to}` 的**窗口**：C-(a 0–16%) / C-B(a 0–26%) / B-A(b 55–100%) / A-S(a 30–80%) / S-SS(a 5–62%) / SS+(a 0–100%)；填充条 = 该窗口拉伸到当前填充宽度，圆角按填充条自身形状裁剪（右端也是圆的）。面板的档位配色改成「取条 + 起点/终点」，芯片预览直接画官方图。③ 缺省值按第六轮 JSON（`letterH 13 / letterDY 7 / score 795000`）。
- 2026-11-08 第七轮修正：**填充条与槽错位**。根因＝`SPR.scoreBand / lifeBand` 还是按图集那块组件量的（`[57,8,527,45]` / `[80,10,448,46]`），而用户自备件的深色槽实测是 `[64,10,521,41]`（score-bar.png 593×132）/ `[78,9,451,50]`（life-bar.png 540×115）——填充条比槽左右各多 7px、上下各多 2~4px，把槽的描边盖掉又露出白边，看起来就是「材质和槽错位」。同时官方槽是**胶囊**（r = 带高/2），`bandRadius` 却默认 0.24，两端必然露出暗角。改法：两个 band 换成实测 bbox，`bandRadius` 默认 0.5（= 槽的圆角）；填充条按自身圆角裁剪，左右两端都是圆的。缺省值同步到第七轮 JSON（`score 1000000 / resultInAt 24 / resultInDur 24 / rankInAt 20 / rankInDur 20 / t 6.071`）。
- 2026-11-08 第八轮修正：**填充条填不满槽**。两处原因叠在一起：① `SPR.barA / barB` 的取景把图集背景也圈进去了（`barA [0,390,668,25]` 上面多 3 行、右边多 6 列背景色 `#4c6971`，`barB` 多 2 行）——拉伸后就是填条四周那圈暗边；实测真实内容区是 `barA [1,393,661,22]`（y393 是条自带的灰色高光沿、y394..414 是渐变）、`barB [0,96,312,16]`。② `bandRadius` 之前按旧组件设成 0.5（胶囊），但自备件的槽是**小圆角矩形**（score 槽 41 高、r≈6 ⇒ 0.15；life 槽 50 高、r≈8 ⇒ 0.16），0.5 会在两端留下很宽的暗角。现在两处都改了，life 的填充也改用同一个 `bandRadius`（原来是写死的 `min(gh*0.5, 11*ky)`）。默认 `bandRadius` 0.5 → 0.15。另：SS+ 档最右端那个白色缺口是**星点被裁**（`starSize` 17 的星正好压在槽的右圆角上），不是填充问题，需要的话可给星点加右端淡出。
- 2026-11-08 **实现**（TDD 先红后绿）：`simHud.ts` 落 `SIM_HUD` / `HUD_SPRITES`（原型定稿逐键誊抄）、`SCORE_MAX=1_000_000` / 7 位 `formatScore` / `scoreForHits` / `scoreAt` / `scoreIncrement` / 6 档 `scoreTierAt` / `plusAgesAt`；`simField.ts` 新增 `drawTopBar`（4 切片组件、内部切点取整、槽圆角 `bandRadius 0.15`、官方渐变条 A 取窗口、字母与 ▽ 自绘、`+增量` 多条相位、SS+ 12 枚四芒星左→右流动、生命恒满、暂停钮只作视觉、AUTO 提示）。`SimFrameLayers.hud: false` 让结尾段舞台不画打歌顶栏。`simAssets.ts` 五件 URL 与逐件兜底。素材边界不变（不入 git / 不进安装包、缺件留空或纯字）。锁测：`SimHud.test.ts`（归一公式 / 6 档 / 增量多条）、`SimAssets.test.ts`（五件 URL + 缺件不置 missing）、`SimField.test.ts`（缺件降级 / 4 切片取整 / AUTO 提示 / `+增量` / SS+ 星点）、`SimHudWiring.test.ts`（官方切图坐标 / 归一分接线 / 禁自造字样）。Playwright 1080p 真 Canvas 冒烟（dev server + 7 件素材均 200）：分数框区 51,426 非底像素、`AUTO LIVE` 区 AUTO 开 16,958 / 关 **0**、结算白卡与右上徽章区均有像素，控制台 / pageerror 全空；截图 `/tmp/hud-{autoOn,autoOff,ending}.png` 目视核对：四件组件、6 档条、`+100000`、SS+ 档与结算 Score 行 / SCORE RANK 都在位，切换 `autoMode` 只改判定字 / 胶囊 / AP 辉光。「验收清单」里逐档（C- / B-A / S-SS / SS+）逐帧对照仍需用户在原型里跑。
- 2026-11-08 **用户验收两处回退修正**（已实现）：① **分数条下面又出现 2 条竖线** —— 第五轮那次修复只把内部切点按 **CSS 像素**取整；生产帧会带任意 CTM（实时回放 `simPlayback.render()` 的 `bw/metrics.w`、dpr 1.25 等），整数 CSS 像素落到物理像素上仍可能是半列，`drawImage` 的覆盖率混合又把线带回来。改法：`simField.sliceX` 读 `ctx.getTransform()`，把切点吸附到**整数物理像素列**（`(round(v*a+e) - e)/a`），并给相邻切片各留 1 个物理像素的**同源 bleed**（源区同步外扩）盖死边界半透明列；外沿仍保留抗锯齿。`lifeBar` 走同一函数一并受益。② **0 分时分数条该是空的** —— `fillW = Math.max(band.h*1.7, band.w*frac)` 强行留了一颗底珠；改成 `frac <= 0 ? 0 : ...`，且 `fillW === 0` 时整段（渐变条 + SS+ 星点 + 裁剪）跳过，槽保持全空。原型 `hudProto.js` 同步这两条；`scenes.html` 打歌段给 `drawSimFrameAt` 传 `hud: false`，收掉生产那层 HUD，避免与可调的 `drawSimHud` 叠两遍。锁测：`SimField.test.ts`（0 分不画渐变条 / 命中后恢复 / 非整数 CTM 切点落在整数设备列）、`SimHudWiring.test.ts`（物理像素吸附 + bleed + 0 分空槽）。Playwright 复验：生产 1920 / 小画布 640 + dpr 1.25、原型 `/proto/scenes.html` 三路，满分帧无竖线、0 分帧槽全空。`npx tsc -b` 干净、全量 408 文件 / 4560 例绿、改动文件 lint 0 error。
- **2026-11-08 用户验收第二批（已按最终口径修订）**：① `AUTO LIVE` 组件带背景 —— 查证是**原图没处理**，不是绘制用错：`auto-live.png` 全图 0 个透明像素（棋盘格灰底烤进了 PNG），而 `score-bar` / `life-bar` 当初已抠底。已按胶囊 bbox `[7,7,499,99]` 重算 alpha（边缘 4×4 超采样）+ 绿通道解白字重建 RGB，原件留 `.cache/game-ui/hud/_source/`，`public/` 与 `.cache/game-ui/` 两份同步；`README.txt` §六补记。② **生命条填充按实机截图定案** —— 上一轮误用 `RhythmGameUI.png` 的绿 / 洋红网点色块；用户给出实机局部图，量得填充是上段 `#6eff69` / 下段 `#47aa43`、中间一条短过渡的干净两段渐变（**无网点、无洋红层**）。改为 `SIM_HUD.lifeGaugeTop / lifeGaugeBottom / lifeGaugeSplit` 驱动 Canvas 竖向渐变，原型 `hudProto.js` 同步；`docs/research/gbp-ui-assets.md` 与 `README.txt` 撤掉旧推断。③ **顶栏开关收成一枚**：删掉 `hudScore/hudLife/hudPause/hudAutoLive` 四个布尔与 `SimHudRegions`，改成 `settings.preview.showGameUi`（缺省开、additive、脏值回落默认）；动态预览面板只放一枚「显示分数条和生命条」，标签旁 `?` 说明还管暂停钮与 `AUTO LIVE`，界面不再出现「HUD 组件 / HUD」字样；`AUTO LIVE` 仍要 `autoMode` 开。_（文案与 `?` 提示于 2026-11-09 再改，见第四批。）_
- **2026-11-08 用户验收第三批（② 的合并机制已于 2026-11-09 回退，见第四批）**：① 开关文案「显示顶部状态栏」太笼统 ⇒ 改成**「显示分数条和生命条」**（用户原话），标签旁挂站内 `HelpHint` 说明还管暂停钮与 `AUTO LIVE`；中英 i18n 补 `.hint`，面板 `Row` 支持 `hint`，CSS 照 `WorkspaceDisplayPanel` 收窄气泡。② **`+增量` 高密度叠字** —— 根因：`plusAgesAt` 把 0.85s 窗口内每个命中都画一条 `+inc`，`plusY` 固定、`plusRise=0`、无条数上限且无末尾淡出，密集音符年龄差极小 ⇒ X 几乎相同、旧字不退场。改用 `plusBurstsAt`：**最近 `plusMaxCount-1` 次各一条，窗口内更早命中合并成一条 `+k×inc`**（不丢命中，每次仍计入），保证同屏 ≤`plusMaxCount` 个数字；新增 `plusSpreadX/plusSpreadY` 逐条错开、`plusBaseAlpha` 底亮度、`plusFadeOutFrac` 末尾渐隐；真 Canvas 复验后把 `plusY` 下移到分数框下方暗背景、改成横向排开（`spreadY=0`），避免压住数字 / 等级带。原型 `HUD_KNOBS` 暴露全部新参数 + `plusDemo` 密集音符演示；生产 / 原型同构。锁测：`SimHud.test.ts`（合并后条数与命中守恒）、`SimField.test.ts`（高密度谱面 ≤3 条且累计值相等）、`SimHudWiring.test.ts`（接线与原型参数）。Playwright 真 Canvas 复验：生产 41 音符 / 0.05s 间隔帧只画 `+24390 / +24390 / +365850` 三条且横向排开在分数框下方，原型 `plusDemo` 三档 / 单档一致，控制台 / pageerror 全空；截图 `/tmp/r4-*.png`。`npx tsc -b` 干净、全量 408 文件 / 4569 例绿、改动文件 lint 0 error、原型语法检查 0。
- **2026-11-09 用户验收第四批（已实现）**：① **结算形态支持 CLEAR** —— 渲染 / 音效 / 音效分支早已就位，只补导出弹窗下拉第三档与中英文案（详见 [票 52](./issues/52-谱面结束中央章与结算画面.md)）。② **刻度图标大小可调** —— ▽ 是 Canvas 自绘三角、原尺寸写死在 `Math.max(2.5*s, band.h*0.13)`；生产 `SIM_HUD.tickH = 4.24`（= 原魔数在 1920 帧下的值）、原型 `HUD.tickH` 同名同值，面板「等级字母」组加「刻度图标大小」旋钮（1–20 px）。③ **开关文案改「分数条与生命条显示」并撤掉 `?` 提示** —— 用户认为标签已足够直观、试一下即懂；删 `showGameUi.hint` 中英键、`Row` 的 `hint` 参数与仅服务该浮层的 CSS（公用 `HelpHint` 组件保留）。④ **回退 `+增量` 合并机制**（用户原话「游戏里没有这种机制…不要擅自引入这个」）：`plusBurstsAt` / `SimPlusBurst` / `plusMaxCount` / `PLUS_EPS` / `+k×inc` 全部删除，恢复 `plusAgesAt` 逐命中各一条；`plusSpreadX` 默认归零（避免无上限时把字推到画外）。**保留**用户上一轮明确要的观感可调项：`plusDur / plusFadeFrac / plusFadeOutFrac / plusBaseAlpha / plusX / plusY / plusDX / plusRise / plusSpreadX / plusSpreadY / plusFont / plusColor` 与原型 `plusDemo` 密集演示。锁测：`SimHud.test.ts`（窗口内 6 次命中 = 6 条）、`SimField.test.ts`（9 次命中 = 9 条同值文本 / ▽ 三角顶点按 `tickH`）、`SimHudWiring.test.ts`（禁 `plusBurstsAt` / 锁刻度旋钮）、`VideoExportFlow.test.tsx` / `EndingWiring.test.ts` / `EndingSettings.test.ts`（CLEAR 三档闭环）。Playwright 真 Canvas 复验：生产 41 音符帧窗口内 17 次命中 → 17 条同为 `+24390`（无合并值），原型 `plusDemo` 与 `h.tickH=12` 大刻度、结算 `stamp=clear` 金星徽均正常，控制台 / pageerror 全空；截图 `/tmp/r5-*.png`。`npx tsc -b` 干净、全量 408 文件 / 4573 例绿、改动文件 lint 0 error、原型语法检查 0。
- **2026-11-09 默认档定案（用户给的原型参数快照）**：贴回 `场景 sim / stamp ap / t 5.3` 的全量 JSON，逐键比对结果 —— `params`（119 项）与 `BASE` **完全一致**，无需改动；`hud`（95 项）仅 5 项有差异：`plusDemoRate 16→14`（原型演示专用）、`plusDur .85→.5` / `plusX .38→.45` / `plusY 170→122` / `plusRise 12→0`（生产 `SIM_HUD` 与原型 `HUD` 同步写回）；打歌默认帧 `defaultT('sim') 5.819→5.3`。`scoreMode manual / score 30000 / totalNotes 680 / life 1000/1000 / autoMode false / showHud true` 等快照值本就是缺省。锁测：`SimHud.test.ts`（整组 `plus*` 默认档）、`SimField.test.ts`（0.5s 窗口 ⇒ 5 条）、`SimHudWiring.test.ts`（生产 / 原型同名同值 + `Math.min(5.3, chartSeconds)`）。
- 仍未决（沿用票内「未决」）：`B–A` 绿→金在材质 A 上无对应段、分数数字无官方字形表（`HEADER_SANS` 占位）、SS+ 最右端星点被槽圆角裁半。
- 2026-11-08 第九轮修正：① **结算标签统一 `Score`，不走 i18n**（`HUD.resultLabel` 默认 `'得分'` → `'Score'`，注释里「i18n + HEADER_SANS」的口径一并撤掉，按用户定论）。② **官方材质 B 废弃**：删掉 `SPR.barB`、`TIERS[].bar` 字段与面板里的 A/B 选择器，6 档全部从 `barA [1,393,661,22]` 取窗口 —— C- 0–16% / C-B 2–30% / **B-A 55–100%（改用暖端 品红→粉→珊瑚→橙，因为 A 上唯一没有绿金段）** / A-S 30–80% / S-SS 8–92% / SS+ 0–100%。③ 缺省值按第九轮 JSON（`plusFadeFrac 0.35 / score 30000 / t 5.819`；`t` 已由 2026-11-09 快照改 5.3）。B-A 的冷暖替代是权宜，若要求严格复刻参考图的「绿→金」，需要另找官方件或接受从 A 的橙端取。
- **2026-11-14 用户验收修订（`+增量` 运动重定，已实现）**：用户对比实机后定案「移动速度很快，很快就到最右侧，然后缓慢再向右挪一点点；那段缓移就是淡出时间」。新增 `simHud.plusMotionAt` 纯函数（生产 / 原型共用同一条曲线，参数各调各的）：`plusDashFrac 0.18` 的冲刺段用三次 ease-out 跑完 `plusDX 0.34`，剩下的整段时间只再挪 `plusDriftDX 0.03`（×框宽）并线性淡到全透明；删掉与定案冲突的 `plusFadeOutFrac`，`plusFadeFrac 0.35` 改为冲刺段内的渐显占比。原型面板新增「冲刺占比 / 淡出位移」两枚旋钮，其余 `plus*` 默认值不变。锁测：`SimHud.test.ts`（两段曲线 / 默认档）、`SimField.test.ts`（真绘制层落点与 alpha）、`SimHudWiring.test.ts`（生产 / 原型同名同值）；Playwright 真帧复核 `+inc` 正常绘制、控制台无报错。
- **2026-11-14 第二版默认档定案（用户给的全量参数快照）**：`scene sim / stamp ap / t 5.379`。逐键比对结果 —— `params`（119 项）与 `BASE` **完全一致**，无需改动；`hud`（87 项）仅 6 项有差异：`plusDemo false→true`、`plusDemoRate 14→12`（这两项只属原型演示层，生产 `SIM_HUD` 没有）、`plusDur .5→.4` / `plusDriftDX .03→.02` / `plusY 122→120` / `plusFont 35→36`（生产 `SIM_HUD` 与原型 `HUD` **同步写回**）。默认打歌帧 `defaultT('sim') 5.3→5.379`。`simField` 的高密度锁测改成按 `SIM_HUD.plusDur` 推期望条数、两段运动锁测的采样帧跟着 0.4s 窗口挪到 `0.35 / 0.05s`，避免换默认档就要手改数字。注：这一版把「密集音符演示」开成缺省，打开原型无参数页即可看到一串 `+inc` 的两段运动。
- **2026-11-14 第三版默认档定案（用户给的全量参数快照）**：`scene sim / stamp ap / t 6.07`。`params`（119 项）仍与 `BASE` **完全一致**；`hud`（87 项）仅 5 项有差异：`plusDemoRate 12→15`（只属原型演示层）、`plusDur .4→.5` / `plusDashFrac .18→.2` / `plusY 120→119` / `plusDX .34→.37`（生产 `SIM_HUD` 与原型 `HUD` **同步写回**）。默认打歌帧 `defaultT('sim') 5.379→6.07`。两条 `+inc` 绘制锁测改成按当前默认档反推采样拍数（冲刺中点 / 尾段近末），换档不必再改谱面或断言里的秒数；`SimHud.test.ts` 的默认档断言、`SimHudWiring.test.ts` 的静态锁同步到第三版数值。
- **2026-11-14 生命条暗框（用户对比实机后要求「先按推荐改一下再看看效果」，待验收）**：用户指出实机生命填充边缘有一圈像黑边的东西。像素复核：`life-bar.png` 的空槽本来就带深色框（左 x78 `#383838`→x82 `#606060`，上 y10 `#3c3c3b`→y14 `#606060`，下/右各约 4~5 素材 px），实机截图的深绿灰框（`#3c603d`～`#4b774a`）+ 顶部 1px `#20821b` 深绿发线 + 底部灰线就是它。旧写法把 `lifeBand` bbox 整块铺满渐变 ⇒ 暗框被盖掉，绿色只剩一圈和白色混合的浅灰 AA（`当前` 截图 y7 `#d5d8d5` / x50 `#ebebeb`）。本轮只做**方案 1**（最小改动）：新增 `lifeGaugeInset: 4`（素材 px，0 = 回到旧效果），生产 `simField.drawLife` 与原型 `hudProto.drawLife` 都把填充四边内缩、圆角同步减一个 inset、渐变架到内沿；原型面板加「填充内缩」旋钮（0~12）便于对比。`iw * ratio` 保证低血量时暗框不跟着缩。锁测：`SimField.test.ts`（内缩几何 + 渐变纵向范围）、`SimHud.test.ts`（默认 4 与 bbox）、`SimHudWiring.test.ts`（生产 / 原型同名同值、不再 `fillRect(gx,gy,gw,gh)`）。**未做**：方案 2 的绿味描边 / 顶部发线、色值微调（游戏亮段 `#64ff5d` / 暗段 `#37a836`，当前 `#6eff69` / `#47aa43`）——等用户看效果后再定。
- **2026-11-14 提交复核（票 72/73 同批）**：门禁 `npx tsc -b` 干净、全量 439 文件 / 4891 例通过、eslint 与 IDE 诊断 0。Playwright 真帧复核：默认帧 `t = 6.070` 的 `+inc` 两段运动、生命条暗框与原型「填充内缩」旋钮可对比，控制台无报错。
