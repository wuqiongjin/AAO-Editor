# 71 · 支持 AUTO（打歌 AUTO 显示 / 结算 AUTO 标记）

Type: grilling
Status: resolved（**2026-11-08 已实现**：AUTO 两档判定字 / AUTO LIVE 提示 / AP 辉光关断，实时预览与导出同一份）
Blocked by: —

**来源**：2026-11-08 用户第 1 条诉求，原文「支持AUTO。(打歌时的AUTO显示，结算画面的AUTO Play ? 看一下官方素材有哪些和AUTO有关的，不要自己伪造)」。
**调研**：`docs/research/gbp-ui-assets.md` §8.1、`docs/research/gbp-live-cinematic.md` §2 / §4、`docs/adr/0016-谱面预览与游戏仿真导出.md` §1.2 / §6、票 51 Q2 / 票 52 Q8。

## 症状

- 打歌画面没有 AUTO 显示：只有 `PERFECT` 判定字 + AP combo；结算画面没有 AUTO 标记，反而是全 PERFECT 内译 + ALL PERFECT 章。
- `src/` 里没有 AUTO 状态 / 开关（`isAuto` / `autoPlay` / `autoMode` 零命中），AUTO 只是注释里的一条隐含口径。

## 根因（定案冲突 + 素材缺口，不是漏实现）

1. 票 51 Q2 / ADR-0016 §1.2、§6 定案「**Auto 永远 PERFECT**」：预览被定位成「一次人类 AP」，不是游戏的「オートライブ」。因此 `simHud.judgeSprite()` 硬编码 `judge_perfect`（`simHud.ts:49-55`）、结算 `ROWS` 只有五档判定（`endingFrame.ts:84-98`）、`BADGE_SPRITES` 只有 ap/fc/clear、`EndingAssets` 八个槽位没有 AUTO 槽。
2. `tests/static/SimHudWiring.test.ts:40-47` 把 `judge_auto` 列为**禁止项**，`tests/unit/preview/video/SimHud.test.ts:26-28` 写「AUTO 本期不用」⇒ 显示 AUTO 必须同时改定案、ADR 和锁测，不是补一行绘制。
3. 官方 FAQ（`docs/research/gbp-live-cinematic.md:85-88`）：オートライブ 是专用 AUTO 判定、结算**不显示判定内译**、分数相关不记录 —— 与本仓现行结算观感相反；票 52 自己也写过「比游戏的 Auto 还『假完整』」。
4. 素材侧（§8.1 分块目视复核）：与 AUTO 有关的官方件只有 `judgeskin/skin00/judge.png` 的 `judge_auto`（`289,177 205×79`，AUTO 判定字）和 KR `atlas/MenuAtlas.png` 约 `72,165` 的粉色 `AUTO` 菜单词标。**没有** `AUTO PLAY` 连写字样、没有结算 AUTO 标记、没有 HUD AUTO 提示牌；`RhythmGameUI.png` 里也没有。用户点名的「结算画面的 AUTO Play」「AUTO PLAY 提示组件」在本地官方素材里无对应件。
5. 素材路径：实物在 `.cache/game-ui/`（本地研究件、不入 git / 不进安装包），生产读 `public/assets/game-ui/`（目录不存在，`scripts/assets-sync.mjs` 的取件根不含 `game-ui`）⇒ 即便切了 `judge_auto`，默认环境按票 51 Q12 退纯字 / 留空。

## 定案（用户 2026-11-08 · grill 第 1 轮）

1. **Q1 澄清（我上一轮问偏了）**：用户问的是**打歌时每个音符被播放时的判定显示**，不是要我重定一整套 AUTO 模式语义。`judge.png` 里 8 格全都是判定图标；预览下**没必要**显示 `GREAT / GOOD / BAD / MISS / FAST / SLOW`，**可以显示 `PERFECT` / `AUTO` 两种**。
2. **结算画面可以没有 AUTO 相关文字**。结算顶栏左上角的星徽形态待定，用户倾向 **ALL PERFECT 虹彩星**（即现行 `BADGE_SPRITES.ap` = `116,218 57×55`，与默认 `stamp:'ap'` 一致）—— 这是倾向，不是最终拍板（见 Q6）。
3. **Q2 = OK**：素材边界不变（`game-ui` = 本地研究件、不入 git / 不进安装包、缺件留空或纯字）。
4. **Q3 = OK**：画进仿真场帧 ⇒ 实时预览 + 导出都有；暂停图标只是视觉、不接点击。
5. **Q4 用户补料**：`/workspace/HUB-sample.png`（2388×1668 打歌 HUD 基准，左上分数下有一枚「自动演出」胶囊）、`/workspace/auto-live.png`（512×113，用户自造的粉底白字 **`AUTO LIVE`** 胶囊，**只在 AUTO 模式下出现**）。清单与文案口径见 `docs/research/gbp-ui-assets.md` §9。

## 定案（用户 2026-11-08 · grill 第 2 轮）

1. **Q5 = OK**：引入 AUTO 模式开关（例如 `settings.preview.autoMode`，**默认开**）：开 = 判定字切 `judge_auto`（`289,177 205×79`）+ 显示 `auto-live.png` 的 `AUTO LIVE` 提示；关 = 判定字切 `judge_perfect` + 不显示提示。两档共用现有判定字绘制链，实时预览与导出同一份（Q3），不做手动打歌。**默认开 ⇒ 现有默认观感会变**（原来只有 PERFECT + AP combo），其余结算 / combo 口径不变。
2. **Q6 = OK**：结算顶栏星徽固定 **ALL PERFECT 虹彩星**（`BADGE_SPRITES.ap` = `116,218 57×55`），与 AUTO 模式开关无关；`HUB-sample` 分数组件里那枚圆形星章按截图中的灰色未点亮态处理、不跟结算形态联动。
3. 判定档范围照第 1 轮定案：只 `PERFECT` / `AUTO`，**不**接 `GREAT / GOOD / BAD / MISS / FAST / SLOW`；结算画面不加 AUTO 文字。

本票的待拍板问题已收口；顶栏素材 / 数值 / 组件范围（Q7–Q9）归票 72。
（原型已于同日完成并定稿，见下节「定稿」。）

## 定稿（2026-11-08 · 原型验收通过）

1. **判定字**：AUTO 开 → `judge_auto [289,177,205,79]`；关 → `judge_perfect [0,177,287,79]`。
   位置沿用生产口径 `场地中线 / laneHeight − 0.092H`；`stacked`（间隔 ≤ `life`）时**不淡入**，
   否则每个音都会「灭一下再亮」，出现几帧空窗（原型已按 `judgeStateAt` 修回）。
2. **AUTO LIVE 胶囊**：`hud/auto-live.png`，落在 `(36, 150) 278×51`，只与 `autoMode` 挂钩。
3. **AP 特效**：`comboStyle().ap = comboAP && !autoMode` —— AUTO 下不存在「全 PERFECT」，
   所以 combo 保持素白、不叠彩虹辉光。
4. **结算**：仍固定 AP 虹彩星徽 + ALL PERFECT 章（AUTO 不改结算），与票 52 / 73 一致。
5. **验收**：切换 `autoMode` 只应改变判定字与 AUTO LIVE 两处，其余图层逐像素不变。
6. 素材坐标 / 顶栏其余三件见票 72「定稿」§1（本票只引用，不重复登记）。

## 实现落点（定案后才动，本轮不改代码）

- `src/preview/video/sim/{simHud,simField,simAssets}.ts`：判定字切格 + AUTO 状态入口 + 素材槽位。
- `src/preview/video/ending/{endingFrame,endingAssets}.ts`、`src/settings/AppSettings.ts`：结算 AUTO 标记 / 形态。
- `docs/adr/0016-谱面预览与游戏仿真导出.md` §1.2 / §5.2 / §6、`CONTEXT.md`「仿真场」「PERFECT 显示状态」词条（与既有 ADR 冲突须显式标注，见 `docs/agents/domain.md`）。
- 顶栏 AUTO 提示的**位置**归票 72；本票只定「显示什么、什么时候显示」。

## 锁测（定案后哪些用例会红 / 要新增）

- 会红：`tests/static/SimHudWiring.test.ts:40-47`（禁止 `judge_auto`）、`tests/unit/preview/video/SimHud.test.ts:26-28`、`tests/unit/preview/video/EndingFrame.test.ts`（钉住 `ENDING_SPEC` 与五行内译）、`tests/static/EndingWiring.test.ts`（八件素材槽位 / 缺件纯字）。
- 新增：AUTO 档切 `judge_auto (289,177,205,79)` 的静态源码断言；「不出现自造 `AUTO PLAY` 字样」静态断言；缺件降级仍走纯字 / 留空。
- 单测覆盖不到的（Canvas 像素、图集切图观感、实时预览与导出一致）：Playwright 1080p 单帧像素实测 + 逐帧目视对照（照票 51 / 52 的验收惯例）；单测只锁常量与接线，锁不了像素。

## Comments

- 2026-11-08 开票：只读盘点完成，未改 `src/`。素材目视结论见 `docs/research/gbp-ui-assets.md` §8.1。与票 72 分工：本票管 AUTO 语义与 AUTO 显示，票 72 管顶栏 HUD 组件与布局。
- 2026-11-08 grill 第 1 轮：用户澄清 Q1 问的是「打歌时每个音符的判定显示」，`judge.png` 全是判定图标、预览只需 PERFECT / AUTO 两档；结算可无 AUTO 文字、星徽倾向 ALL PERFECT。Q2 / Q3 = OK，Q4 补 `HUB-sample.png` 与 `auto-live.png`（见 §9）。第 2 轮待 Q5 / Q6。
- 2026-11-08 grill 第 2 轮：Q5 / Q6 = OK（AUTO 模式开关默认开、判定字两档、结算固定 AP 虹彩星）。本票待拍板问题收口，Q7–Q9 归票 72。
- 2026-11-08 grill 第 3 轮：Q12 = OK —— AUTO 开时**只**换判定字（`judge_auto`）+ 显示 `AUTO LIVE` 提示；AP combo 变色、结算全 PERFECT 内译与 AP 章全部保持现状（票内原先那条「其余不变」的假设已获确认）。
- 2026-11-08 **实现**（TDD 先红后绿）：`settings.preview.autoMode` additive 默认开 + 动态组开关（i18n `preview.display.autoMode`）；`SimScene.autoMode` 随 scene 走；`simHud.JUDGE_BOXES` 两格 + `judgeSprite(auto)` + `comboApActive()`；`simField.drawJudgement` 按档切格 / 缺图集纯字 `AUTO`；`simAssets.simHudUrls()` 五件逐件兜底（缺件不置 `missing`）；`drawAutoLive` 落 `(36,150) 278×51`、只在 AUTO 开时画。结算**不加** AUTO 文字、星徽仍固定 AP 虹彩星。锁测：`SimHud.test.ts`（两档切图 / comboApActive）、`SimHudWiring.test.ts`（禁用自造 `AUTO PLAY` / 缺件降级 / AUTO 提示挂接）、`SimField.test.ts`（AUTO 胶囊位置与开关）、`PreviewMarkerSettings.test.ts`（默认 / 归一化）。`npx tsc -b` 干净、全量 408 文件 / 4556 例绿。
- 口径澄清：原型「定稿」§3 `comboStyle().ap = comboAP && !autoMode`（AUTO 下 combo 素白）与较早的 Q12「AP combo 保持现状」冲突；实现按**定稿**（原型验收通过那一组）执行，并写进 ADR-0016 §1.2。待用户验收确认。
- **2026-11-08 用户验收裁定（推翻上面两条旧口径）**：① `autoMode` **默认关**（推翻 Q5 与实现项的「默认开」）；② **AUTO 不影响 PERFECT 显示状态** —— 按 Q12「AP combo 保持现状」执行，`comboApActive(apCombo)` 只认 `apCombo`，原型的 `comboAP && !autoMode` 作废。改动：`AppSettings` / `DEFAULT_PREVIEW_SETTINGS` / 归一化 / `SimScene` 缺省 `false`、`simHud.comboApActive` 单参、`simField.drawSimFrameAt`、`PreviewDisplayPanel` 注释与重置白名单、`hudProto.HUD.autoMode=false`、`scenes.html comboStyle()`；ADR-0016 §1.2 / §6 与 CONTEXT「预览标注」同步。锁测：`SimHud.test.ts`（单参）、`SimHudWiring.test.ts`（`?? false` / `return apCombo`）、`SimField.test.ts`（未设置时切 PERFECT 格）、`PreviewMarkerSettings.test.ts`（默认关 / 脏值回落关）。
