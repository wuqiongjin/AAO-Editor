# 76 · 跨段 HUD 入场 / 退场时机与结尾图层顺序

Type: bug
Status: resolved 实现（2026-11-15 已实现 + 锁测全绿；待用户导出成片验收）
Blocked by: none
Related: [票 72](./72-官方HUD顶栏分数生命与暂停.md), [票 52](./52-谱面结束中央章与结算画面.md), [票 74](./74-视频导出开头前导补偿.md), [票 75](./75-视频导出末击收尾与结算画面残留.md), `public/proto/scenes.html`（④ 全片连播原型）

## 来源与症状

用户 2026-11-15 报两条：

1. 「分数条、生命条 出现的时机。（应该是开场动画转场后紧接着它们的入场，它们也有淡入效果。现状是跟随谱面一同『闪现』出来的）」
2. 「分数条、生命条 消失的时机。（应该是跟着中央章结束后，要转场进入结算画面时，它才跟着消失，注意：它们俩的图层是在下面的，那些爆炸特效都要在它们上面）」

三处追问的答复：

- q1「入场锚点定在哪一刻」→ 用户 **「不知道，这个难道不是应该让我在原型里调整吗，你问我这个干啥」** ⇒ 锚点不拍板，做成原型滑杆，由用户在原型里挑。
- q2 交付范围 → **「只改 `public/proto/`（全片连播 + 淡入淡出 + 层序对比，生产代码不动；结尾段的真实分层用原型近似）」**（原型阶段）。
- q3「爆炸特效在它们上面」覆盖范围 → **「打歌特效也碰不到分数条和生命条吧…（只有结尾的爆炸特效、中央章烟花才有概率触碰到）」** ⇒ 打歌段 `drawTopBar` 相对 `drawEffects` 的顺序**不动**，只改结尾段。
- 2026-11-15 用户「原型OK了」→ 同轮「开始按照原型，修改代码吧」⇒ 生产落地；实现、锁测与本票票面**同批提交**（`feat(chart-preview-76)`）。

## 根因

HUD 被当成「谱面段内部的一个图层」，开关绑在段边界上，既没有整层 alpha，也不在结尾的图层栈里：

- `encode/frameDriver.ts`（旧）`const seg = req.opening ? openingSegmentAt(t) : 'sim'`；开场一结束就进 sim 分支，HUD 随 `drawSimFrameAt` 缺省开关**同帧出现**；`endingAt` 一到整段切走。
- `sim/simField.ts`（旧）`if (layers?.hud !== false && showGameUi) { drawTopBar(...) }`：`SimFrameLayers.hud` 只有布尔、没有 alpha；`drawTopBar` 画在打击特效之后。
- `ending/endingFrame.ts` 的 `drawStage` 直接传 `hud: false`，而烟花在舞台之后画 ⇒ **章第一帧 HUD 就没了**，更谈不上「爆炸在它上面」。

## 原型阶段（只动 `public/proto/`）

- `hudProto.js` 新增 `hudAnchorTimes` / `hudWindows` / `hudAlphaAt` / `hudPhaseAt`；`drawSimHud(..., alpha)` 离屏画完整层再按 alpha 合成 —— 内部等级字母 / ▽刻度 / `+增量` / 星点各自写 `globalAlpha`，不能只在外层设一次。
- `scenes.html` 新增「④ 全片连播」：`seqTimeline()` 按生产常量拼 25.90s 绝对时间线；时间轴画分段带 + 绿线 HUD alpha 曲线 + 入 / 出窗口；右侧滑杆（入场锚点 转场起 4.95 / 转场末 6.75 / 谱面 0 秒 + 偏移 + 淡入时长；退场锚点 章结束 / 幕满 / 结算入 + 偏移 + 淡出时长），另有「现状 / 修正后」对比与「特效下 / 特效上」层序对比，状态行逐帧打印 `段 / HUD α / 阶段 / 层序`。
- 结尾段分层用拦绘制调用近似：拆 `stageOnly` / `fxAdd` / `fxUI`，按「舞台 → HUD → 加色烟花 → 章字样 / 结算 / 黑幕」合成。`src/` 一行未改。
- **第四版默认档**（2026-11-15 全量快照 `scene seq / stamp ap / t 25.9`）：96 项 `hud` 逐键比对仅 2 项差异 —— `hudInOffset 0→-2`、`hudInDur .35→1`；`params {}`（三段沿用 ①②③ 各页已调好的值）；缺省帧 `SEQ_DEFAULT_T = 25.9`，偏移滑杆下限放宽到 -3。⇒ 入场窗 **4.75→5.75s**、退场窗 **21.40→21.74s**。原型 `legacy` / `aboveFx` 只作 A/B 对照，不进生产。

## 生产实现（与票面同批提交）

1. `encode/exportSpec.ts`：`VideoHudTimeline { openEnd, endingAt, stampDur }` + `VIDEO_HUD_TIMING { inOffset:-2, inDur:1, outOffset:0, outDur:0.34 }`；`videoHudWindows` / `videoHudAlphaAt`（smoothstep：开场 0 → 淡入 → 常驻含前导 / 正片 / 中央章 → 淡出 → 结算 0）。关开场 `openEnd=0` 从第 0 帧淡入；关结尾 `endingAt` 超尾 ⇒ 末帧仍常驻、不淡出。**调参入口单一**：改时机只动 `VIDEO_HUD_TIMING`。
2. `sim/simField.ts`：`SimFrameLayers.hudAlpha?: number` + 新出口 `drawSimHudLayer`；`drawTopBar` 多一个 `alpha`，除设 ambient `ctx.globalAlpha` 外还把倍率乘进四处自写 `globalAlpha` 的元件。`showGameUi` 一枚总开关同时管住两条路径；实时预览不传 `hudAlpha` ⇒ 缺省 1，观感不变。打歌段 `drawTopBar` 仍在 `drawEffects` 之后（用户 q3）。
3. `encode/frameDriver.ts`：`hudTimeline` 由 `OPENING_SECONDS` / `ENDING_SPEC.stampDur` / `endingAt` 拼成，每帧算一次 `hudAlpha = videoHudAlphaAt(t, hudTimeline)`；谱面段传 `hudAlpha`，开场两支补画独立层，结尾段把 HUD 回调交给 `drawEndingFrameAt`。`drawHudLayer` 按场地原点画，HUD 内容秒钳到 `[-leadIn, chartSeconds]`（与原型 `drawSeqHud` 同口径）。
4. `ending/endingFrame.ts`：可选 `EndingHudDrawer` 回调插在 `drawStage` 之后、`lighter` 粒子之前 ⇒ 舞台 → HUD → 烟花 / 章字样 → 结算 / 黑幕；舞台仍 `hud: false`，不会出现两份顶栏。文件头票 52 的「UI 层与仿真场互不共享画笔」同步改写为本票这一处唯一例外。
5. `sim/index.ts` / `encode/index.ts` / `ending/index.ts` barrel 导出新 API。

## 评审收口（code-review 两轴）

- **Standards 硬违规 1**：`endingFrame.ts` 旧分层注释与新 HUD 层冲突 ⇒ 按用户定案改写注释。
- **范围蔓延 / Speculative Generality**：生产多算了 4 个用不到的锚点，还复制了结尾黑幕比例 `transDur*0.22` / `*0.4` ⇒ 删，`VideoHudTimeline` 收成 3 个真正用到的字段；`legacy` / `aboveFx` 不进生产。
- **Spec 两处实现偏差**：① 开场帧 HUD 内容秒未钳位（拿负得离谱的秒算分数）⇒ 已钳；② `openEnd` 取 `req.openingSeconds`，旧调用方只给 `simStartSeconds` 时会变成 0 ⇒ 改取 `OPENING_SECONDS` 常量（与 `openingSegmentAt` 同一份切段口径）。
- 保留的 judgement call：`showGameUi` + `drawTopBar` 两处形状重复（仓库静态锁要求显式接线）、裸 `hudAlpha` number（与既有 `noteAlpha` 同口径）。

## 锁测（新增 11 例）

- `tests/unit/preview/video/ExportTimeline.test.ts`：默认档 / 窗口 4.75→5.75、21.40→21.74 / 整条 alpha 时间线 / 关开场 / 关结尾。
- `tests/unit/preview/video/SimField.test.ts`：`drawSimHudLayer` 四例（缺省独立层 / HUD 关掉 / alpha 半透明乘进各元件 / alpha=0 不画）。
- `tests/unit/preview/video/EndingFrame.test.ts`：HUD 回调在 `drawStage` 之后、`lighter` 粒子之前。
- `tests/static/VideoExportWiring.test.ts` / `EndingWiring.test.ts` / `SimHudWiring.test.ts`：接线锁、生产 / 原型默认档同名同值、总开关两条路径、结尾 `hud:false` + `hud?.()`。

## 手工验收

单测与 Playwright 到不了真实 WebCodecs 成片，需用户导一条带开场 + AP 结尾的谱逐帧看：

1. **4.75–5.75s** 分数条 / 生命条淡入，不是同帧闪现；淡入期间开场 ③④ 段仍干净，只有 HUD 渐亮。
2. 中央章 3s 内 HUD 常驻，烟花 / 爆炸星点**压在**分数条与生命条之上（不是条压住星点），且星点不带黑方块。
3. **21.40–21.74s** 随黑幕淡出，结算画面无 HUD。
4. 关开场时入场从 0 起淡入；关结尾时末帧 HUD 仍常驻；`showGameUi` 关掉时三条路径都无 HUD；实时预览观感不变。
5. **验收结论回填 `## Comments`；时机不对只调 `VIDEO_HUD_TIMING`（一处），不动帧循环 / 绘制函数。**

## Comments

- **2026-11-15 原型阶段黑底方块回修**：用户报「结算画面的爆炸特效怎么感觉不太对，每个烟花星星都带黑色的背景了（只有在全篇连播里面是这样的，其它的没问题）」。根因是 `tex_parSet_fever.png` 为**黑底加色贴图**：生产 `drawParticles` 用 `lighter` 画在不透明舞台上，黑底加 0 等于没画；原型把整层特效画到透明离屏再用 `source-over` 盖回，黑底就变成实心黑方块。修法 = 按 `globalCompositeOperation` 把加色段与普通段拆成 `fxAdd` / `fxUI`，`fxAdd` 单独离屏、最后用 `lighter` 盖回，`fxUI` 仍 `source-over`（结算组件与黑幕压暗不受影响）。真实素材与强制结算分层帧复核无黑底、无报错。
- **2026-11-15 提交复核**：`npx tsc -b` 干净、改动文件 ESLint 0、全量 `vitest run` **439 文件 / 4920 例全绿**。Playwright 真 canvas 整层 alpha 光栅差 `0→0 / 0.25→2.75 / 0.5→5.56 / 1→11.1`，窗口与原型状态行一致；原型页 `?scene=seq` 无报错。`npm run test:types` 在**未改动**的 `tests/unit/settings/ShortcutIndexFilter.test.ts` 有既存类型错，本票未碰。
- 第四版默认档属本票（④ 全片连播）；票 72 的三版打歌默认档不变，`defaultT('sim')` 仍 6.07。生产只落 `fixed` 一条口径，原型 `legacy` / `aboveFx` 保留作 A/B 对照。
- `.cache/`、`public/proto/` 等目录在本轮之前就未跟踪，未纳入本次提交。
- **2026-11-22 顶栏半透明接缝白线回修（随票 81 落地）**：`drawTopBar` 在 `alpha < 1` 时先按 alpha=1 画进设备像素对齐的顶栏离屏层、再整层一次贴回（`topBarLayerAt` / `topBarBounds` / `drawTopBarParts`），避免 4 切片 bleed 重叠与 `lighter` 星点在逐元件 `globalAlpha` 下被合成两遍、淡入段浮出白线；alpha=1 仍直画，不多开画布。无 DOM（Node）或 CTM 带旋转 / 斜切时退回旧逐元件画法。属本票 HUD alpha 层范围，锁测在 `tests/static/SimHudWiring.test.ts`；用户成片验收结论仍待回填。
- **2026-11-15 回修 · SS+ 星点续动到分数条消失**：用户报「由打歌转向结算画面时，分数条在 SS 后的额外动效，希望一直存在，而不是中央章到来时停止（这个动效会跟随到分数条的完全消失）」。用户只报症状与诉求，**语义未重新拍板**：「动效是分数条的常驻属性、要跟随到条完全消失」是本次诉求本身，下面全部是**本轮实现口径（待验收）**，不是用户定案。根因 = 结尾段 HUD 内容秒钳到 `chartSeconds`，而四芒星相位也用同一个秒 ⇒ `endingAt` 一到相位就冻结。本轮实现口径 = **内容秒（分数 / `+增量`）仍冻结在末帧，星点相位改走独立的连续时钟**：`frameDriver` 结尾段把未钳的 `t - simStartSeconds` 传给 `drawSimHudLayer(..., flowSeconds)`，沿 `drawTopBar → drawScoreBox → drawStarFlow` 单走一条线；缺省 = 内容秒 ⇒ 开场 / 前导 / 实时回放观感不变。淡出窗（章结束后 0.34s）里星点继续流动并随整层 alpha 一起淡到 0。原型「④ 全片连播」`drawSeqHud` 同口径（`flowSec`）。锁测：`SimField.test.ts` 新增「内容秒冻结时相位时钟推进 ⇒ 星点 x 变化」+「真实 `videoHudAlphaAt` 退场窗内仍在流动、`outEnd` 才收干净」；`VideoExportWiring.test.ts` 新增生产接线锁；`SimHudWiring.test.ts` 新增原型同口径锁；`EndingWiring.test.ts` 结尾调用同步。**门禁（非验收结论）**：`npx tsc -b` 干净、改动文件 ESLint 0；评审修订后全量 `vitest run` **439 文件 / 4939 例全绿**（另一次运行中 `PatternLibraryDrawer.test.tsx` 的 IntersectionObserver 用例曾偶发 1 红、单独复跑 46 例全绿，与本票无关）。**验收结论待用户导出成片后按「手工验收」第 2 / 3 条逐帧回填，`Status` 本轮不改。**
