# 21 · 动态预览 HUD 与打击特效对齐 Bestdori 素材（combo 精灵 + particles）

Type: feature
Status: resolved 实现（2026-10-07，待用户验收；实现与验证见 Answer）

**来源**：票 05 验收问题 6（"combo 和数字的字体、样式、大小和 bestdori 的不一样！（可以看看 bestdori 有没有对应的材质，不要自己造）"）+ 问题 7（"音符的打击特效和 bestdori 的好像也不一样？（这个 bestdori 有没有对应的材质？）"）。

**答案：有。** Bestdori 模拟器（scope `691780a2`）用的就是它自家三张精灵 —— 本机已实测可直读（HTTP 200）：

| 素材 | 尺寸 | 用途 |
| --- | --- | --- |
| `/res/sprites/digits.png` | 720×96 = 10 个 72×96 | combo 数字（左起 10 列切片） |
| `/res/sprites/combo.png` | 150×41 | "COMBO" 标签（比例 150:41） |
| `/res/sprites/particles.png` | 1024×1024 = 4×4 图块（每块 256×256） | 打击特效图块（按色 tint） |

另有 5 个**程序化**圆（`createCircleSprite` = 256² 径向渐变，内→外）：白 `255,255,255`、青 `124,225,225`、粉 `255,156,184`、紫 `214,180,250`、橙 `250,196,170`。

## 问题 6 · combo（现状 vs Bestdori）

- **Bestdori**：锚点 `(0.85W, 0.4375H)`，整体按 `canvasHeight` 缩放 —— 数字 **0.09375H 宽 × 0.125H 高**、整串**水平居中**于锚点；"COMBO" 标签 **0.1829H × 0.05H**，画在数字下方（y ∈ `[+0.025H, +0.075H]`）；每次命中有一帧弹跳（`scale`：命中瞬间 0.8 → 0.1s 时 1.1 → 0.2s 落回 1）。
- **我们**：系统无衬线字体、`fontSize = 0.075H`、**右对齐**于锚点 + 小字 "COMBO"（`simField.drawCombo`）⇒ 字体 / 字号 / 对齐 / 标签形态全不同。
- 落点：HUD 三个数字位图 + 标签精灵 + 弹跳插值；`comboAnchor` 保留（锚点口径不变）。

## 问题 7 · 打击特效（Bestdori 的效果表）

坐标空间 = `setTransform(laneWidth, 0, 0, laneWidth, W/2, laneHeight)`（**x、y 都以 laneWidth 为单位**，原点在判定线中心）；`n = styleNoteSize`（= 我们的 `noteSize`）；`$e(x,w,h,α)` = 以 (x, 判定线) 为中心画 w×h；`He(x,w,h,α)` = 以判定线为**底边**画；缓动 `easeInCubic = t³`、`easeOutCubic = 1−(1−t)³`；窗口从命中时刻起算。

| 类型 | 窗口 | 元素（图块 / 生成圆） | 尺寸（×n） | α |
| --- | --- | --- | --- | --- |
| tap | <0.4s | beam `(0,0)` 青 / slot `(1,0)` 青 | 1.33×2 / 1×1 | 1−easeIn |
| tap | <0.6s | circle（青，生成） | 2.25·easeOut × 1.5·easeOut | 0.5(1−easeIn) |
| tap | <0.3s | whiteCircle | 2.25·easeOut × 1.5·easeOut | 0.5(1−easeIn) |
| tap | <0.6s | ring `(2,0)` 青 ×2（3×2 与 2.4×1.6） | 3·easeOut × 2·easeOut | 0.8(1−easeIn) |
| flick | <0.4s / <0.2s / <0.6s | slot `(1,0)` 粉 / circle（粉，生成）+whiteCircle / ring `(2,0)` 粉 | 1×1 / 1.5(1−u)×2(1+4u) / 3·easeOut×2·easeOut | 1−easeIn / 1 / 0.8(1−easeIn) |
| skill | <0.4s / <0.3s / <0.6s | beam `(3,0)` 黄 + slot `(1,0)` / whiteCircle / star `(0,1)` + ring `(2,0)` 黄 | 0.6×1.5、1×1 / 2.25·easeOut×1.5·easeOut / 2.25、3（×easeOut） | 1−easeIn / 0.5(1−easeIn) / 0.8(1−easeIn) |
| directionalFlick | <0.2s | 本体圆（左紫 / 右橙，生成）：绕 `±π/3` 斜扫一记（`He`，1.5·easeOut × 4·easeOut，α=1−easeOut）+ whiteCircle + 正位圆（1.5(1−v) × 2(1+4v)） | 同上 | — |
| directionalFlick | <0.6s | 箭头 `(1,1)`（左紫 / 右橙）：圆心外移 `easeOut·1` 个 lane、转 `±π/2` 画一记；+ ring `(2,0)` | n×n / 3·easeOut × 2·easeOut | 1−easeIn / 0.8(1−easeIn) |
| 连按（带体按住） | 持续 | connectionRing `(2,1)`：`3×0.6n × 1.2n`；旋转环 `(3,1)` 青：双环对转（`2·laneWidth·n × 4/3·laneWidth·n`，1× 与 0.75×） | — | 1 |
| 轨道闪 | 0.2s | **自绘三角楔**（左竖边 + 底边；白 0.5→0 线性渐变），`setTransform(1, 0, (lane−0.5)·laneWidth/laneHeight, 1, W/2, 0)` ⇒ **满高**、上端收成消失点 | 全高 | 1−p |

- 我们的现状：全程序化自绘（圆 / 环 / 光柱 / 槽 + 轨道闪梯形，`SIM_EFFECT_DURATION = 0.32s`、`SIM_LANE_FLASH_SPAN = 0.22` A 空间），配色 `SIM_EFFECT_COLORS`（tap `#5ad7ff` / flick `#ff6fb5` / skill `#ffd457` / slide `#7ce7a6` / dirL `#b58bff` / dirR `#ffa552`）—— 与上表**系统性不同**（时长、尺寸基准、形态、配色、以及"滑条结点走绿 tap"这条自造口径：Bestdori 的滑条结点就是 `tap`）。
- Bestdori 的默认档：`simTapEffect = 0`（开）、`simLaneEffect = 0`（开）、`styleNoteSize = 1`。

## 素材通道（本票第一件事）

三张精灵**不在**归档树里（`docs/resource/bestdori/` 只收 `/api/explorer/<server>/assets/**`），它们是 Bestdori 自家静态资源 `/res/sprites/*.png`。要复用 → 归档脚本加"**直读 URL 清单**"这一类（`--category bestdori-sprites`），产物落 `docs/resource/bestdori/sprites/`，dev 仍走 `/__bestdori-assets/` 中间件；生产构建没有该通道 ⇒ 缺素材**回落现有自绘**（不空态）。
素材边界与 fieldskin / bgskin 同一条：**仅供本地研究、不入 git、不进安装包**；ADR-0016 §6 补一句"素材含 Bestdori 自带精灵"。

## 落点

- `src/preview/video/sim/simAssets.ts`：加 `digits` / `combo` / `particles` 三图（缺席 = 回落自绘，不置 `missing`）。
- `src/preview/video/sim/simField.ts`：`drawCombo` 改精灵版（+弹跳）；`drawEffects` 按上表重写（图块切片 + tint 缓存 + 缓动）；轨道闪改满高三角楔。
- `src/preview/video/sim/simGeometry.ts`：特效表（窗口 / 尺寸 / α 常量）与 `comboAnchor`（补数字 / 标签尺寸）。
- `scripts/fetch-bestdori-skins.mjs` + `scripts/README.md`：新类别与获取命令。
- 锁测：`SimAssets.test.ts`（三图缺席 → 回落路径不抛）；`tests/unit/preview/video/SimEffects.test.ts`（时间窗 / 尺寸 / α 的字面断言，记录型 stub）；`SimRendererWiring.test.ts` 守"素材只走直读通道"。
- 像素侧：`scripts/sim-shot.mjs` 抓命中帧（tap / flick / skill / 方向键各一）+ Bestdori 同秒对照（人工）。

## Comments

- 2026-10-07 开票（本会话）：素材可得性已实测（三张 PNG HTTP 200 + 尺寸）；效果表从 bundle 原文逐条誊出（`.cache/bestdori-bundles/CommunityChartsNew.b534f9a9.js`，`0===this.simTapEffect` 段）。
- 2026-10-07 **定案（用户拍板）**：素材走 Bestdori 自家 `/res/sprites/*.png`（dev 直读、不入 git / 不进安装包；缺图回落现有自绘）。

## Answer

2026-10-07 实现（待用户验收）。

**素材通道**

- 归档脚本新增 `bestdori-sprites` 类别（`DIRECT_ASSETS` 直读 URL 清单，**不走** `/api/explorer` 资源树）：`node scripts/fetch-bestdori-skins.mjs --category bestdori-sprites` → `docs/resource/bestdori/<server>/sprites/{digits,combo,particles}.png`（本机已拉，三张 0.2 MB）。`--category` 已知类别校验、dry-run 汇总、`scripts/README.md` 的命令与产物路径都同步。
- `simAssets`：新增 `simSpriteUrls(server)` / `SimSprites` / `SimAssets.sprites`；**三张齐了才给**，缺任何一张 = `null`（回落自绘，**不置 `missing`**、不影响场地与空态）；`SimFrameAssets` 增同名字段（07 的导出复用同一份素材）。

**HUD（问题 6）**（照 Bestdori `drawCanvas`）

- `digits.png`（10 列）+ `combo.png`（150:41）替代系统字体文本：整体按 `canvasHeight`（数字 0.09375H × 0.125H、标签 0.1829H × 0.05H、标签从数字**下缘**起）、整串水平居中于锚点 `(0.85W, 0.4375H)`；命中后 0.2s 弹跳（`comboPopScale`：0.8 → 1.1 → 1）。缺精灵 → 回落原自绘文本。

**打击特效（问题 7）**（照 Bestdori 的 `0===this.simTapEffect` 段）

- `particles.png` 的 4×4 块 + 程序化径向渐变圆，按元素配色染色（tap 青 `124,225,225` / flick 粉 `255,156,184` / skill 黄 `255,255,64` / 方向键紫 `214,180,250`·橙 `250,196,170` / 白）；图块染色与生成圆都缓存（`simSprites.ts`，node 无 DOM → 退回不染整块）。四类 + 方向键的**窗口 / 尺寸 / α / 缓动**照票内表格逐条落地；滑条结点按 Bestdori 走 **tap**（不再是自造的绿色）。
- 轨道闪改**满高三角楔**（`laneFlashShear` 的剪切 → 上端收成消失点），窗口 0.2s、α = 1−p、渐变白 0.5 → 0；缺精灵时整条链路回落程序化自绘（原实现保留）。

**落点**：`src/preview/video/sim/simSprites.ts`（新：取块 / 染色 / 生成圆 / 数字矩形）、`simField.ts`（`drawCombo` / `drawEffects` / `drawLaneFlash` 两套路径）、`simGeometry.ts`（配色 / 窗口 / 缓动 / `comboMetrics` / `comboPopScale` / `laneFlashShear`）；barrel 出 `simSpriteUrls` / `SimSprites`；ADR-0016 §6 补记"另需 Bestdori 自家三张精灵 + 缺图回落"。

**验证**

- `npm test` **209 文件 / 2,302 用例全绿**；`npx tsc -b` 通过；改动文件 eslint 干净。
- 锁测：`SimField.test.ts` +4 例（精灵版 combo 用 digits+combo 且不画文本 / 缺精灵回落文本 / 特效按窗口画 particles 图块且 0.2s 后轨道闪收手、0.6s 后特效收手 / 程序化回落仍画圆）；`SimGeometry.test.ts` +1 例（缓动 / combo 尺寸与弹跳 / 轨道闪剪切）；`SimAssets.test.ts` +2 例（三个 URL 都在直读通道；三张齐才给、缺一张整组 null 且不判空态）；`PreviewPageWiring` 的 sim 目录清单同步。
- 真机（`.cache/sim-frame.mjs` 渲染 t=2.9s + `scripts/sim-shot.mjs`）：命中帧出现 Bestdori 的 "2 COMBO"（数字 + 标签精灵）、青色打击环与**满高轨道闪楔**；7 个车道标记与音符对齐（票 18 的修复保持）。
- **待人工验收**：与 Bestdori 同秒并排对照（tap / flick / skill / 方向键命中帧 + 长条按住），以及缺精灵时的回落观感。
