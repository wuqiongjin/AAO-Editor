# 51 · 判定文字 + ALL PERFECT Combo 特效

Type: grilling
Status: resolved（2026-10-27 落生产）
Blocked by: —

**来源**：2026-10-26 用户要动态预览更接近实机播放：
- a) 每个音符要有判定特效（如 PERFECT）
- b) Combo 数支持 ALL PERFECT 状态下的特效
明确不对标 Sonolus / Bestdori 动态预览。

调研：`docs/research/gbp-live-cinematic.md` §2–3。

## 症状

- 音符过线只有打击光效（Bestdori `particles`），**没有 PERFECT 等判定字**。
- Combo 是 Bestdori 白数字 + 「COMBO」标签 + 命中弹跳，**AP 续航时不变色**。

## 根因（范围取舍，不是漏实现）

1. ADR-0016 §1.2 首期明示不含判定文字；§6 写「不需要 judgeskin，Bestdori 模拟器没有判定字」。
2. 票 21 把 combo / 打击特效对齐 **Bestdori 自家三张精灵**。Bestdori 模拟器没有判定字、没有 AP combo 态。
3. 游戏 AP combo 是 v6.2.0「コンボ状態表示」：从开场起全 PERFECT 时 **combo 变色**（官方 FAQ 原文「コンボ表示の色が変わります」），选项可关。
4. 预览不是手打。不出判定字则永远缺这块；出的话必须先定 Auto 档（永远 PERFECT vs 游戏オートライブ的 AUTO 判定）。

打击特效（particles）与判定字是两层：用户这次点名的是判定字 + AP combo 变色，不是重做 tap 光效。

## 定案（用户 2026-10-26 · grill 第 1 轮）

1. **对标实机**（Q1）：判定字与 AP combo 变色按ガルパ，不对标 Sonolus / Bestdori。
2. **Auto = 永远 PERFECT**（Q2）：判定只出 PERFECT；combo 全程走 AP 变色。用户附注「未来可能会支持配置」——本期不做档位开关，登记为后续扩展。

判定字与 AP combo 画在仿真场帧里 ⇒ **实时预览和导出都会有**（它们不是时间线前置/后置段）。未另作「只导出」限制。

## 定案（用户 2026-10-26 · grill 第 2 轮）

1. **实时预览和导出都画**（Q10）：判定字 + AP combo 变色不是时间线前后段，仿真场帧里有就两边都有。本期**不另做开关**（「未来可配置」仍只是登记）。
2. **素材 = 游戏原图，缺图不造假**（Q12）：判定走 `ingameskin/judgeskin`（默认 `skin00` 的 `judge.png`）。缺精灵 ⇒ **留空或纯字**，不准画假徽章。中央章 / 结算章归票 52。

核验（2026-10-26）：`judgeskin/skin00` 的 `judge.png` 是 512×256 图集，`.asset` 切了 `judge_perfect / great / good / bad / miss / auto / fast / slow`。Auto 永远 PERFECT ⇒ 本期只用 `judge_perfect`。CDN 无 CORS，必须进外部快照，主仓不复活抓取脚本。AP combo 官方描述是**改色**，可以先拿现有 Bestdori `digits` 染色；像不像游戏要观感拍板。

## 定案（用户 2026-10-26 · grill 第 3 轮）

1. **落点**（2026-10-26 录屏复核后用户改口）：判定字**每音出一次、位置固定**——正中轨中线 × 判定线上方 **0.092 H**（字心 0.497 W；字底离判定线 0.069 H；宽约 0.15–0.16 W、高 0.042 H）。**原「该轨正中」作废**：实机 t012 / t030 与 35.0 s / 40.0 s 帧都证明字不跟轨道左右移动（双轨同时命中仍只有一条）。
2. 精确像素（字相对判定线偏上多少、多轨同时出时是否叠、AP combo 染色够不够）**只认实机录屏**，本轮不另猜。

**录屏未核完前不改 `simField` HUD。**

## Comments

- 2026-10-26 grill 第 1 轮：Q1 对标实机；Q2 Auto = 永远 PERFECT（未来可配置另说）。
- 2026-10-26 grill 第 2 轮：Q10 预览+导出都画、无开关；Q12 真素材、缺图纯字/留空。素材核验见 `docs/research/gbp-live-cinematic.md` §5。
- 2026-10-26 grill 第 3 轮：落点纠正为「每音、该轨正中」。录屏 `BV1BDapzbEdX` 已核：「无判AP」**不是**关判定字（t012/t020/t030 有 PERFECT，贴在该轨×判定线）。细节 `docs/research/gbp-live-recording-BV1BDapzbEdX.md`。
- 2026-10-26 复核（逐帧重测）：判定字实测**固定在场地水平中线 0.50 W、判定线上方 ~0.092 H**（字宽 ~0.15 W / 高 ~0.042 H / 底边离线下 ~0.069 H），不跟轨道左右移动 —— t012 命中在 x≈395、t030 左右两轨同时命中（x≈279 / 632），字仍在 cx≈512；30 fps 跟踪 1 s 未见上浮。多押是否只出一条字：本片只见一条，未推广。
- 2026-10-26 第 4 轮：用户拍板「**按实机：场中央一条**」，第 3 轮的「该轨正中」作废（已回改票面定案 1）。复核细节见 `docs/research/gbp-live-recording-BV1BDapzbEdX.md` §3。

## 本票不包含

- Opening → 50；环境音 → 31
- 谱面结束中央章 / 结算 → 52
- 分数、技能切镜、fever、FAST/SLOW（用户未点名）
- 2026-10-27 落生产（定案 3 条全部照办）：
  - 新模块 `src/preview/video/sim/simHud.ts`：`SIM_JUDGE`（字心 0.497 W / 离判定线 0.092 H / 高 0.042 H / 停留 0.42 s）、`judgeSprite()`（`judge.asset` 的 `judge_perfect` 切图）、`judgeAt(chart, seconds)`（最近一次命中的年龄）、`SIM_AP_COMBO` + `apColorAt(age)`（`#c17cff` 恒染、命中 0–0.16 s 闪白、1.05 s 内转紫）。
  - `simField.drawSimFrameAt` 的 HUD 段：`drawJudgement`（图集优先，缺图集 ⇒ 纯字 "PERFECT"，Q12）→ `drawCombo`（数字 / 标签经 `tintedImage` 染色 + 命中光环）。画在仿真场帧里 ⇒ 实时预览与导出**同一份**，无开关。
  - `simSprites.tintedImage`：`multiply` 上色 + `destination-in` 裁回字形 alpha（透明底不会被填成实色），按图 + 颜色缓存。
  - 素材：`simAssets` 加 `judge`（`GAME_UI_ASSET_BASE` + `assets/game-ui/judgeskin/skin00/judge.png`），缺件不置 `missing`（只退纯字）。
  - 锁测：`tests/unit/preview/video/SimHud.test.ts`（判定窗口 / 位置常量 / 三档配色）、`tests/static/SimHudWiring.test.ts`（不跟轨道、缺件纯字、染色口径）、`tests/unit/preview/video/SimField.test.ts`（切图坐标 + 字心位置 0.497W / 0.092H）、`tests/unit/preview/video/SimAssets.test.ts`（判定图集 URL / 缺件不空态）。`npx tsc -b` 干净，全量 3766 例全绿。
  - 目视：1080p 单帧（命中后 0.02 / 0.3 / 0.6 s）已核 —— PERFECT 落在场地中线、数字紫色、光环随命中淡出。
- 2026-10-27 第三轮（用户给了 `.cache/Combo-Style.mov` 作参考，逐帧重做）：
  - **录屏实测**（Chromium 解帧，1920×1342 / 1.53 s / 60 fps，共 12 帧）：
    - 字**芯是白的**；外边是**竖向渐变描边**：上 `#e35bd2`（洋红）→ 中 `#a163d8`（紫）→ 下 `#3fc9c7`（青）；
    - 描边外是同色柔光，**会脉动** —— 高饱和像素能量按 ~0.5 s 一个周期起伏（12 帧里 3 个峰）；
    - 下面的「COMBO」吃**同一套**描边 + 光晕（不是白字）；
    - 字本身不缩放（白芯包围盒稳定在 270×77），所以「动」的是**光**，不是尺寸。
  - 实现换成：`apTile()` 给每个字形做「白剪影 8 向扩张 → `destination-out` 挖空 → `source-in` 灌竖向渐变 → 白芯压回」的瓦片；
    光晕 `drawApGlow()` = 暖(`#ff6bd6`)/冷(`#4de1d2`) 两团 `lighter` 径向渐变，
    强度 `0.16 + 0.2·cos(2π·since/glowPeriod) + 0.24·e^(−since/0.14)`（常亮底 + 脉动 + 命中闪）。
  - **删掉白色描边**（用户点名：「外围一圈白色发光，观感太差」）——旧实现把渐变灌进字芯、再套白环，正好反了。
  - 修**居中**：上一版在 `left` 上多减了 `dw / 2`，整串向左偏半格；回到 `left = x + dx * scale`（`Ae = -length/2` 口径）。
  - 新增 `SimComboStyle.ap`（AP / 非 AP 可切）+ `glow` / `glowPeriod` 两个可调项；非 AP = 纯白原图、不发光。
  - 判定字加**弹放**（`SimJudgeStyle.pop`，默认 0.2 s，与 combo 同一条 `comboPopScale` 曲线）。
  - 锁测：`SimHudWiring` 的 combo 组按新口径重写（色值/环的构造/COMBO 同套/居中/脉动/非 AP），
    `SimField.test` 的判定字高度改成「基准 × 弹放系数」。门禁：`npx tsc -b` 干净、`npx vitest run` 339 文件 / 3784 例全绿。
- 2026-10-27 第四轮（用户又指两条：光晕形状 / 2 位以上不居中）：
  - **光晕改成"沿字形边缘向内外渗透"**：上一版是 `createRadialGradient` 在锚点画一团圆光——错。现在 `glowTile()` 把**字形本身**用画布
    `filter: blur(th·0.09)` 糊开再 `source-in` 灌竖向渐变，垫在主体后面；正面再以 `lighter` 铺一层 15% 的同一张瓦片 →
    笔画边缘向外发、向内也透一点，看起来是字在"呼吸"。数字与「COMBO」各用一套（标签描边更细：4.5% 字高）。
  - **居中改成按墨迹**：`glyphInk()` 用 alpha>24 量出每格字形在切图里的左右边界（`1` 只占 16..54 / 72），
    算整串的墨迹跨度再对到锚点 —— 1/2/3/4 位都成立；上一版按**字宽**居中，字数一变就偏（2 位偏 ~9 px）。
  - 描边粗细 9% → 6.5%（对照录屏比例），内渗透层 28% → 15%。
  - 锁测补三条：光晕用 `blur()` 而非 `createRadialGradient`、前后两趟 `glowPass`、`inkShift` 居中。
    门禁：`npx tsc -b` 干净、`npx vitest run` 339 文件 / 3786 例全绿。
