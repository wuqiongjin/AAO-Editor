# 64 · 结算画面分数适配（SCORE RANK 图标 + 得分行）

Type: grilling
Status: resolved（**2026-11-08 已实现**：Score 行 + SCORE RANK 徽章 + 三项版式常量；依赖 63 的归一分已接通）
Blocked by: 63

**来源**：2026-11-08 用户额外第 2 点，原文「结算画面，也需要同步适配分数相关内容组件，包括 (可以参考 tmp/result-score.png)：a) 右上角的 score-rank 图标 b) 结算面板中的 "得分" 和 具体的分数。」
**调研**：`tmp/result-score.png`、`docs/research/gbp-ui-assets.md` §10.2、`docs/adr/0016-谱面预览与游戏仿真导出.md` §5.2、`docs/research/gbp-live-recording-BV1BDapzbEdX.md` §6、票 52。

## 症状

- 现行导出结算画面（票 52）只有顶栏（星徽 + 难度 + 曲名 + Lv）+ 白卡（五行判定 + MAX COMBO + AP 标）+ 左半封面渐隐；**没有**右上角 score-rank 图标，也**没有**「得分」行。

## 根因（定案排除，不是漏画）

1. ADR-0016 §5.2 / 票 52 Q6 明写「结算 = 顶栏…**不画 SS / 得分 / 排名**」，依据是 `docs/research/gbp-live-cinematic.md:92`「分数 / 等级 / 编成 / 奖励无法从谱面单独算真」。
2. `tests/unit/preview/video/EndingFrame.test.ts:289-300` 用 `expect(t.join('')).not.toMatch(/SCORE|RANK|SS/)` 主动锁死；`EndingFrameInput` 只有 `counts` / `maxCombo`，**没有 score 字段**；`endingAssets` 八槽位没有 score-rank 槽。
3. 票 63 Q14 已定「1,000,000 归一分」⇒ 结算要显示得分就得把归一分数接进 `EndingFrameInput`，并同步改 ADR / CONTEXT / 锁测。

## 素材现状（2026-11-08 目视）

- `tmp/result-score.png`（2388×1668）：右上 = 大号 SS 徽章（圆形放射光芒 + 绿紫 S + 绿色 `SCORE RANK` 缎带）；白卡顶部 = 圆形星章 +「得分」+ 大号青字粉描边数字（`2830…`），下接虚线与五行判定。
- **Q23 用户指出并已复核**：官方 `atlas/MenuAtlas.png` 里**有整套** `D / C / C+ / B / B+ / A / A+ / S / S+ / SS / SS+` 大号字母徽章与 `SCORE RANK` / `MULTI SCORE RANK` 缎带，另有小号一套（用户推测取大的那套）。定位见 `docs/research/gbp-ui-assets.md` §10.3 ⇒ score-rank 图标与缎带**全用官方素材，无需自备件**。仅「得分」二字（简中标签）尚未在本地官方图集定位。
- 票 63 Q13 定案：`tmp/` 只作辨识依据、不得截取 ⇒ 这些件要么在官方图集里定位，要么由用户补官方切图 / 登记为用户自备件（如 `score-characters.png` 那样）。

## 定案（用户 2026-11-08 · grill 第 7 轮）

1. **Q23 素材**：官方 `atlas/MenuAtlas.png` 里有整套 `D / C / C+ / B / B+ / A / A+ / S / S+ / SS / SS+` 大号徽章 + `SCORE RANK` / `MULTI SCORE RANK` 缎带（另有小号一套，按用户推测取**大号**），逐档在原型里并排挑（票 63 Q19 口径）。定位见 `docs/research/gbp-ui-assets.md` §10.3 ⇒ **不需要自备件**。
2. **新发现的口径差**：这 11 档是**结算 score-rank 档位**，与打歌分数条的 6 档区间不是同一套，不能混用（见 Q24）。

## 定案（用户 2026-11-08 · grill 第 8 轮）

1. **Q24 = OK**：结算 score-rank 按官方 **11 档**（`D / C / C+ / B / B+ / A / A+ / S / S+ / SS / SS+`）取，阈值按 `score / 1,000,000` 百分比映射、与打歌 6 档独立、阈值在 HUD 原型里定；结算「得分」显示归一最终分（AUTO 全 PERFECT = `1000000`）。
2. **Q25 = OK（用户拍板自绘）**：「得分」标签**允许自己绘制**（原话「这个"得分"可以自己绘制…还得区分多语言…这个字体和结算页面的歌曲名称的字体是一个」）⇒ 走 i18n 多语言（`src/i18n/messages/{zh-CN,en}.json`，按 `preview.ending.score` 风格新增键），Canvas `fillText` 用 `HEADER_SANS`（`src/preview/fontStack.ts`，与 `endingFrame.ts:1590` 曲名同一条字体链），不用图片、不引入第二套字体。这是「不伪造」边界里用户明确开的**唯一文字例外**。
3. 确认推翻 ADR-0016 §5.2「不画 SS / 得分 / 排名」与票 52 Q6，同步改 `CONTEXT.md`「视频导出」词条与 `tests/unit/preview/video/EndingFrame.test.ts:289-300` 的 `not.toMatch(/SCORE|RANK|SS/)` 反断言。

**本票待拍板问题已收口**；三张票（62 / 63 / 64）均收口。原计划的「Q11 HUD 调参原型」已于同日完成并定稿，见下节。

## 定稿（2026-11-08 · 原型验收通过，可直接开工）

原型：`public/proto/hudProto.js` 的 `drawEndingScore`，叠在 `drawEndingFrameAt` 真帧上（`scenes.html` 结算 tab）。

### 1. 口径（覆盖前面各轮）

1. **标签固定 `Score`，不做 i18n**（用户 2026-11-08 拍板）：`HUD.resultLabel = 'Score'`，
   `HEADER_SANS` 占位字，生产实现换成官方字形即可。Q25「得分 + 多语言」作废。
2. 分数 = 归一最终分（0–1,000,000），右对齐、无前导零；AUTO 全 PERFECT = `1000000`。
3. 右上 SCORE RANK 徽章 = `MenuAtlas` 太阳纹圆盘 + 大号字母 + `SCORE RANK` 缎带；
   11 档（`D…SS+`）与打歌 6 档**不是同一套**，按归一分映射，阈值仍在原型里调。
4. 出场时机**复用生产的入场时间轴** `q`（`drawSettlement` 的 `base = transDur*0.4`、`span = transDur*0.6`），
   再乘 `1 - curtainAlpha(e, transDur)` 模拟「画在黑幕下面」。

### 2. 素材与坐标

| 用途 | 文件 | 取景 |
|---|---|---|
| 圆星章（Score 行左侧） | `RhythmGameUI.png` | `[7,421,29,30]` |
| 太阳纹圆盘 | `atlas/MenuAtlas.png` | `[1080,1286,140,132]` |
| 大号字母（SS） | 同上 | `[1303,969,86,82]` |
| SCORE RANK 缎带 | 同上 | `[1375,855,190,35]` |

其余 10 档字母待逐档定位（原型只挂了 SS）。

### 3. 参数

| 键 | 值 | 说明 |
|---|---|---|
| `resultFont` / `resultScoreFont` | 34 / 40 | 沿卡宽等比（`ui = card.w/720`） |
| `resultScoreColor` / `Stroke` | `#e8417f` / `#ffffff` | 粉字白描边 |
| `resultPadX` | 16 | 卡内左右内距 |
| `rowFirst` | 12（%H） | 给 Score 行让位，**生产常量要从 5.6 改过来** |
| `resultRowDY` | −12 | Score 行整体上下微调（px，沿卡宽等比） |
| `resultBarW` | 74（%W） | 顶栏收窄，**生产常量 85 → 74** |
| `resultInAt` / `resultInDur` | 24 / 24（%入场轴） | 行出现的时机与淡入 |
| `rankInAt` / `rankInDur` | 20 / 20 | 徽章单独控制 |
| `rankSize` / `rankRight` / `rankTop` | 156 / 150 / 126 | 右上角徽章位置 |
| `rankLetterScale` / `ribbonW` / `ribbonBelow` | 0.6 / 200 / 4 | 字母层与缎带 |

### 4. 必须一起改的生产常量（三处，缺一个就会压版式）

- `ENDING_SPEC.rowFirst`：`5.6 → 12`（%H）。
- `ENDING_SPEC.comboY`：同步下移同样差值，否则 MAX COMBO 压住 Score 行。
- `ENDING_SPEC.barW`：`85 → 74`（%W），否则右上徽章压住顶栏。

### 5. 验收清单

- [ ] Score 行在**卡片出现的那一段**就开始淡入（不是五行判完才出现）；`q` 与生产一致。
- [ ] 黑幕未抬起时 Score 行被压暗（等效画在黑幕下）。
- [ ] 圆星章圆环完整（上沿不被切平）。
- [ ] 卡片高度不再溢出：五行判定 + MAX COMBO 仍然完整可见。
- [ ] 顶栏 74%W 时右上徽章不重叠。

### 6. 未决

- 其余 10 档大号字母的坐标未登记（`D / C / C+ / B / B+ / A / A+ / S / S+ / SS+`）。
- rank 11 档的阈值仍待定（原型未实现映射，只挂了 SS 一档）。

## 实现落点（定案后才动，本轮不改代码）

- `src/preview/video/ending/{endingFrame,endingAssets,endingSpec}.ts`、`src/preview/video/encode/exportVideo.ts`、`src/pages/preview/PreviewPage.tsx`（把归一分数接进 `EndingFrameInput`）。
- `docs/adr/0016-谱面预览与游戏仿真导出.md` §5.2 / §6、`CONTEXT.md`、`docs/research/gbp-ui-assets.md`（补官方切图坐标）。

## 锁测（定案后哪些用例会红 / 要新增）

- 会红：`tests/unit/preview/video/EndingFrame.test.ts:289-300`（`not.toMatch(/SCORE|RANK|SS/)`）、`tests/static/EndingWiring.test.ts`（八槽位 / 缺件纯字）、`tests/unit/settings/EndingSettings.test.ts`（默认形态）。
- 新增：得分 = 归一最终分的静态源码断言；score-rank 按档取图、缺件留空 / 纯字降级。
- 单测覆盖不到的（Canvas 像素、图集切图观感、结算顶栏排版）：Playwright 1080p 单帧像素实测 + 手工验收清单。

## Comments

- 2026-11-08 开票：从票 63 拆出（不同模块 / 不同定案），分数口径依赖票 63 Q14。只读盘点，未改 `src/`。
- 2026-11-08 grill 第 7 轮：Q23 用户指出 `MenuAtlas.png` 有整套 `D…SS+` 徽章与 `SCORE RANK` 缎带，逐象限复核成立（大号 `C+` 约 `x950–1050, y770–865`；大号 `B/S/C` 在 `y≈1024–1100` 一排；另有一套小号，按用户推测取大号），详见 `docs/research/gbp-ui-assets.md` §10.3。发现 11 档 rank 与打歌 6 档不同套 ⇒ 第 8 轮待 Q24 / Q25。
- 2026-11-08 grill 第 8 轮：Q24 = OK（11 档 rank、阈值按归一分映射、得分 = `1000000`）；Q25 用户拍板「得分」**自绘 + 多语言**（理由：官方应该也是自绘、字体同结算曲名）⇒ i18n 新键 + `HEADER_SANS`。核对：`src/preview/fontStack.ts` 的 `HEADER_SANS` 正是 `endingFrame.ts:1590` 曲名用的那条链，i18n 仅 `zh-CN` / `en` 两份。本票收口。
- 2026-11-08 原型重构：结算「得分」行不再另开页面，作为 `scenes.html` 结尾 tab 的一层叠在 `drawEndingFrameAt` 真帧上（绘制在 `/proto/hudProto.js` 的 `drawEndingScore`）。落地口径：圆星章复用打歌分数组件那枚；「得分」`HEADER_SANS` + i18n；分数右对齐 + 点线下移；右上 = `MenuAtlas` 太阳纹圆盘（`[1089,1289,136,126]`）+ 大号 SS（`[1303,969,86,82]`）+ `SCORE RANK` 缎带（`[1375,855,190,35]`）。**顺带发现两处必须一起改的生产常量**：`ENDING_SPEC.rowFirst` 5.6 → 14.5（%H，给得分行让位）、`comboY` 同步下移同样差值、`barW` 85 → 74.6（%W，否则右上徽章压住顶栏）。
- 2026-11-08 标签定论：结算首行标签**固定 Score**，不做多语言（用户在会话中拍板，原「HEADER_SANS + i18n」的开放问题关闭）。
- 2026-11-08 **实现**（TDD 先红后绿）：`EndingInput` / `EndingContentInput` 加 `score`，页面传 `SCORE_MAX`（全部命中）、`exportVideo` 透传；`endingSpec.ts` 三项常量按定稿改（`barW 85→74` / `rowFirst 5.6→12` / `comboY 5→11.4`），另加 Score 行与徽章的 15 个参数键；`endingAssets` 加第 9 槽 `rhythmGameUI`；`endingFrame.ts` 加 `drawResultRow`（圆星章 + 固定 `Score` + 右对齐粉字白描边分数 + 点线）与 `drawRankBadge`（太阳纹盘 + 大号字母 + 缎带），出场时机复用 `drawSettlement` 的 `q`（行 24%/24%、徽章 20%/20%），黑幕在其后盖 ⇒ 天然画在幕下。锁测：`EndingFrame.test.ts`（整份 `ENDING_SPEC` / Score 行时机 / 圆星章 / 徽章三件 / 缺件纯字）、`EndingWiring.test.ts`（九槽 / 三项常量 / rank 映射 / 数据面接线）。`npx tsc -b` 干净、全量 408 文件 / 4556 例绿。
- **本轮实现口径（待验收）**：票内「未决」的两项 —— 11 档 rank 阈值取归一分十等分 `[0,.1,…,1]`；其余 10 档大号字母切图仍未逐档定位，故只登记 SS 的 `[1303,969,86,82]`，其余档 / 缺 `MenuAtlas` 走纯字降级（不伪造字母）。这两条不是用户拍板，待原型逐档挑图 / 调阈值后再改 `simHud.SCORE_RANK_THRESHOLDS` 与 `endingFrame.RANK_LETTER_SPRITES`。
