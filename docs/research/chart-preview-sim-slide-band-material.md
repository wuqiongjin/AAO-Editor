# 动态预览带体材质对齐游戏 SP 绿条：调研与实测（chart-preview 65，2026-11-12）

> 对应 effort `chart-preview` / 票 [65](../../.scratch/chart-preview/issues/65-动态预览带体材质对齐游戏SP绿条.md)。
> 只记**可复核的事实与复算命令**，不做决策（决策在票内定案 / ADR）。
> 相关：[ADR-0009](./../adr/0009-SP绿条与段曲线模型.md)（SP 绿条模型）、[ADR-0016](./../adr/0016-谱面预览与游戏仿真导出.md)（单一出帧真相）、
> [ADR-0017](./../adr/0017-渲染密度整数比不变量.md)、[06 导出链路与尺寸实测](./chart-preview-export-limits.md)、
> [技术基线](./chart-preview-technical-baseline.md)、票 46（带体观感缺陷批次）。
>
> 压测复算命令见 §1（本地一次性探针，**不入库**）；视觉 A/B 用本地一次性原型页（**不入库**），结论见 §5。
> 探针从 dev server 现场 `import('/src/...')`，调的是**产品代码本身**的 `buildSimChart` / `drawSimFrameAt` /
> `rasterBandRuns` / `sampleProfileAt`，不是复刻实现。
>
> **2026-11-12 真实谱补测**：§10 的覆盖面积 LOD 在全屏播放中漏算整图清零 / 复制 / 回写，
> 实时已超预算仍不降档。票 66 补修恢复实时固定 50%，导出保留 100%；原合成语料数据作为历史保留，
> 真实工程对照与 LOD 失效机理见 §11。票 68 的停顿追查留在该票正文，不入单独 research。

## 0. 结论速览

| 问题 | 结论 |
| --- | --- |
| 当前动态预览带体是什么 | 常数体 α + 3% 宽亮缘的半透明多边形（`simField.drawBands`）；两张官方带体图加载后只采样成几个标量就被丢弃 |
| 画布 / 静态预览为什么是对的 | SP 贴图 `longNoteLine2.png` **纵向 α 恒定**，整张图 = 一条横截面 17 点剖面；画布按该剖面逐像素光栅（`renderSpBandStrip` / `rasterBandRuns`） |
| 游戏 / Sonolus 的 SP 材质 | `longNoteLine2` ↔ Sonolus `NoteConnectionGreenSeamless`；Sonolus 另有 `NoteConnectionGreen` 给直段。本仓按**整条传染**（ADR-0009 §5，issue 157 实机/Bestdori 实测），不跟段级选择 |
| 视觉排序（用户 2026-11-12） | **B > C > D > A**：B 逐像素剖面；C 局部渐变仿射（边缘阶梯棱角）；D 真梯形逐段渐变（接缝可见但边缘是曲线）；A 现状平涂 |
| 可行的画法 | 逐条 bbox 限幅 + 逐点半宽 + **50% 光栅分辨率** + **预加载 LUT 优化内核** + 一张共享缓冲一次回写；25% 画质被用户否决 |
| 1w 音符材质层成本（**原型模拟层**） | 1334×750 dpr1 **8.2ms**；1920×1080 dpr1 **10.9ms**；1334×750 dpr2 **24.1ms**（超出 16.67ms 预算，唯一未达标档） |
| 落地后产品材质层增量（票 65） | 1334×750 dpr1 **record 5.5ms / total 5.8ms**（`--product=1`，见 §6.2）；1920×1080 dpr1 record 12.5ms |
| 弱机（无 GPU + CPU 4×） | 1w 音符时**现有基线整帧已 1094ms**，优化 50% 增量在噪声内（−3.6ms）；常规密度 2000 音符时材质层 5.5ms |
| 预加载额外成本 | LUT 构建 **0.0114ms**；缓冲分配 0.019~0.041ms、常驻 0.95~3.82MB；每帧清零 0.012~0.055ms（已计入上表） |
| 视频导出 | 分辨率 / 60fps / 码率档固定 ⇒ **文件大小基本不变**；每帧多 7.6ms（720p）/ 10.9ms（1080p） |

## 1. 环境与复算命令

浏览器 Chromium **153.0.8010.12**（Playwright 1.63 headless shell），Linux x86_64 / 8 核，
**SwiftShader 软件光栅（无 GPU）**。`--cpu=N` 通过 CDP `Emulation.setCPUThrottlingRate` 叠加 CPU 降速。

压测用本地一次性探针 `scripts/bench-sim-band-raster.mjs`（**不入库**，仅本地留存）：

```
bash scripts/dev.sh
node scripts/bench-sim-band-raster.mjs --final=1 --opt=1 --notes=10000 --frames=8 \
  --sizes=1334x750x1,1920x1080x1 --scales=1,0.5 --longitudinal=1 --cpu=1
node scripts/bench-sim-band-raster.mjs --final=1 --opt=1 --notes=10000 --frames=6 \
  --sizes=1334x750x1 --scales=1,0.5 --longitudinal=0 --temporal=2 --cpu=4
# 65 落地后复算产品材质层的真实增量（不是原型模拟层）
node scripts/bench-sim-band-raster.mjs --product=1 --notes=10000 --frames=8 \
  --sizes=1334x750x1 --cpu=1
```

口径（沿用 06 §4）：canvas 2D 延迟光栅，每帧 `getImageData(0,0,1,1)` 强制 flush 并减掉空白读回开销。
`total = record.p50 + raster.p50`。**headless 软件光栅的整帧毫秒数远慢于有硬件加速的真机，不能当真机帧率**；
可比的是「材质层」这一列——它是纯 JS CPU 成本，与 GPU 无关。
65 落地后 `drawSimFrameAt` 自带 50% 光栅，`baseline` 已含产品材质层 ⇒ `--final/--opt` 只复算原型模拟层，
真实增量一律认 `--product=1`（票 65 Comments）。

## 2. 官方贴图实测（skin00，脚本解 PNG 逐像素，非估算）

两张都是 146×205，中心 RGB `(75, 227, 113)` = `#4be371`。

| | 横截面（中心→边缘，17 点 α） | 纵向中心列 α（9 点） |
| --- | --- | --- |
| `longNoteLine.png`（普通） | `0.38 ×13 → 0.95 → 0.25`（平顶 + 细亮缘） | `0.75 0.67 0.55 0.44 0.38 0.42 0.54 0.66 0.75` → **两端实、中间虚** |
| `longNoteLine2.png`（SP） | `0.38 0.40 0.45 0.51 0.58 0.65 0.71 … 0.95 0.25`（**从中心往两侧渐亮**） | `0.38 × 9` → **纵向恒定（seamless）** |

两条推论：

1. SP 贴图纵向不变 ⇒ **横截面剖面就是整张贴图**，不需要真 UV 的 Y 维度；「真 UV」对 SP 是伪需求。
2. 曲线滑条被 hidden 采样点切成几十段，若某段用普通图，每段两端都会冒出亮横纹（竹节）。这是游戏给曲线专门做 `longNoteLine2` 的原因，也是**整条传染必须遵守**的物理理由（ADR-0009 §5）。

## 3. 外部对标

| 来源 | 做法 | 与本仓关系 |
| --- | --- | --- |
| `WindowsSov8forUs/sonolus-notgarupa-engine` `docs/RESOURCE_CONTRACT.md` | `longNoteLine` / `longNoteLine2` 原尺寸导出，记 `pivot` / `ppu` / `border` / 三段九宫格切片；另有预烘焙 `@E6E6E6` 按住段亮化版 | 参考「资源契约」与按住段亮化；不照抄选图规则 |
| 同仓 `engine/draw_notes.go` `drawBeltLit(..., curve, ...)` | **逐段**按 `curve` 选 `LongLine2` / `LongLine`，`alpha = Config.LineBright/100`；`sp.DrawZ(beltQuad(front, after, fh, ah), ...)`，两端各自半宽的网格承载 UV | 段级 `curve` 与本仓整条传染冲突；本仓以实机为准 |
| `NonSpicyBurrito/sonolus-bandori-engine` `play/src/engine/playData/skin.ts` | `straightSlideConnector = SkinSpriteName.NoteConnectionGreen`、`curvedSlideConnector = SkinSpriteName.NoteConnectionGreenSeamless`；目录里另有 `StraightSlideConnector.ts` / `CurvedSlideConnector.ts` | 确认「SP 用无缝绿图」；段级选择口径不采用 |
| `WindowsSov8forUs/GarupaEditor`（Tauri + TS，内置 Simulator / Pixi） | 有谱面播放能力 | 用户明确「不必非得跟着它」 |
| Bestdori `MySongSimulator`（见 [技术基线](./chart-preview-technical-baseline.md)） | 带体 = 相邻 `(lane, A)` 四边形 + 取 `longNoteLine.png` **中心 1 像素**填色；无 `longNoteLine2`、无 UV | 用户记忆「Bestdori 不支持」成立；本仓动态预览现状正是这个模型 |

本仓 `docs/adr/0009` §6 明确记录：早期曾「对齐 Sonolus CurvedSlideConnector」做段级，issue 157 用 Bestdori 编辑器 + 官方谱实测后改为整条传染并否决段级。

## 4. 现状链路（为什么只有一个地方要改）

- `PreviewVideoStage` 预加载：`loadSimAssets`（依赖 `noteIcons` / `fieldPackId` / `bgPackId`）、
  `CanvasSpriteIcon.ensureImagesLoaded`、`warmupSimSprites`、`buildSimChart`（`useMemo`），四者齐了才 `ready`。
- 播放：`simPlayback` 的 rAF `tick` → `render()` → `drawSimFrameAt(ctx, frame, seconds)`，**每帧从头画，带体无位图缓存**。
- 导出：`exportVideo.ts` 的 `phase:'assets'` **自己再调一次 `loadSimAssets`**；`frameDriver.driveExportFrames`
  逐帧调**同一个** `drawSimFrameAt`（ADR-0016 §5「不开第二份渲染真相」，`VideoExportWiring.test.ts` 锁）。
- `loadSimAssets` 已经把两张带体图 `drawImage` 到离屏 canvas 做 `sampleCenterColor` / `sampleBandMaterial`，
  但**图片随即丢弃**，`SimFrameAssets` 只留 `bandColor` / `bandColorSp` / `bandMaterial` / `bandMaterialSp` 四个标量。
- ADR-0016 §3 允许 `preview → rendering` 单向依赖，`simField.ts` 现已 import `rendering/render` 与
  `rendering/primitives/noteMetrics`；复用 `slideBandGeometry.sampleProfileAt` / `splitBandAtFolds` 不破架构。

## 5. 视觉原型与用户排序

本地一次性视觉原型页（`?variant=A|B|C|D&case=…`，**不入库**）：左侧放用户给的两张实机截图
（普通 / SP，仅本地留存、**不入库**）+ 3× 贴图预览。下表数字是这一页的实测，不是产品实现跑分。
暗缝指标 = 带体中心列逐行最亮绿通道的最大行间跌幅（/255，越小越好）：

| 变体 | 直条 24 段 | S 曲线 32 段 | 大角度 12 段 | 交叉两条 | 用户观察 |
| --- | --- | --- | --- | --- | --- |
| A 现状平涂 | 19.3 | 25.3 | 60.0 | 29.8 | 平涂暗绿 + 细亮边，不像实机 |
| **B 逐像素剖面** | **2.5** | **4.0** | 18.0 | **3.5** | **最接近实机，排序第一** |
| C 局部渐变仿射 | 24.3 | 27.5 | 24.0 | 30.0 | 材质本身没问题，但**边缘是一段段阶梯棱角**，另有段间横纹 |
| D 真梯形 + 逐段世界渐变 | 13.5 | 22.0 | 36.0 | 21.8 | **边缘是曲线**了，但**每段衔接处可见**（渐变相位按段重置） |

C 错在**几何**（仿射平行四边形近似梯形），D 错在**材质连续性**（每段各生成一份渐变）。
B 同时满足「沿整条中心线逐行插值」与「按离中心线距离连续求剖面」，故排序第一。
结论：**按「段」生成渐变必然在接缝处不连续**；任何快方案都必须保持中心线连续求值。
原型端点是 `roundRect` 占位精灵（用户已指出），正式实现不改端点。

## 6. 压测结果

### 6.1 四种画法（1w 音符，1334×750 dpr1，p50 ms）

| 方案 | 材质层 | 其中计算 / 回写 | 帧总增量 |
| --- | --- | --- | --- |
| 逐条滑条各出一张 RGBA | 454 | 104 / 347 | +213 |
| 整帧单缓冲（全分辨率） | 112 | 111 / 1 | +104 |
| 局部渐变仿射 | 2.5 | 0.1 / 2.5 | +13.7 |
| **逐条 bbox + 单缓冲（final）** | 61.8 | 61.5 / 0.4 | +54.1 |

逐条缓冲的回写爆炸来自每帧 119 次 `putImageData` + `drawImage`；单缓冲把它压到 1 次。

### 6.2 光栅分辨率 × 优化内核（1w 音符，材质层 p50 ms）

| 场地 | 分辨率 | 原内核 | 优化内核 | 光栅像素/帧 |
| --- | --- | --- | --- | --- |
| 1334×750 dpr1 | 100% | 61.8 | **24.1** | 2,565,555 |
| | **50%** | 17.8 | **8.2** | 643,430 |
| | 25% | 5.9 | — | 160,831 |
| 1920×1080 dpr1 | 100% | 114.2 | **34.6** | 5,314,788 |
| | **50%** | 31.9 | **10.9** | 1,325,659 |
| 1334×750 dpr2 | 50% | 59.0 | **24.1** | 2,565,121 |
| 1280×720 dpr1（导出档） | 50% | 17.0 | **7.6** | 589,699 |

优化内核 = 预加载 1025 项剖面 LUT + 257 项纵向 LUT + `Uint32` 单次写入 + 内循环无函数调用。
**像素数几乎不变（2,565,555 → 2,564,660）⇒ 画质完全不降，只是算得快 2.5~3.3×。**
普通带「整条一次」纵向渐变成本 ≈ 0（有无之差在噪声内，2000 音符冒烟 4.0 vs 3.9ms）。
上表是**方案选型期的原型模拟层**数字。65 落地后按 `--product=1` 复算产品材质层：1w 音符 /
97515 段 / 8 帧 / CPU 1×，`1334×750 dpr1` record **5.5ms** / total **5.8ms**（门槛「个位毫秒」PASS，
优于原型模拟层的 8.2ms）；`1920×1080 dpr1` record 12.5ms（参考值，非门槛档）。
因此 65 之后不能用 `--final/--opt` 的数字当产品基线。

**唯一未达标档**：`1334×750 dpr2`（实时高画质档）+ 1w 音符 = 24.1ms > 16.67ms。
同档常规密度（2000 音符）**实测 4.9ms（均值 5.68ms）**，达标 —— 即缺口只在「高画质档 × 极端密度」这一组合，
不是「1w 音符 + 优化后仍普遍不达标」。24.1ms 已包含优化内核（原内核同档 64.5ms），
是纯 JS CPU 成本，不含其它绘制层与光栅 flush；单它一项就超出 16.67ms 预算 7.4ms。

### 6.3 时间复用（每 2 帧算一次，中间帧贴缓存）

1w 音符 / 100% 光栅：均值 24.0 → **13.3ms**，但 p50 仍 22.4ms（双峰分布，**尖峰没消**），
且带体动作降到 30fps。结论：降均值不降最坏帧，不作为首期方案。

### 6.4 弱机（headless 无 GPU + CDP CPU 降速）

| 场景 | 现有基线整帧 | 优化 100% 材质层 | 优化 50% 材质层 |
| --- | --- | --- | --- |
| 2000 音符 · CPU 2× | 109.6ms | 8.5ms | 2.8ms |
| 2000 音符 · CPU 4× | 213.9ms | 16.6ms | 5.5ms |
| 1w 音符 · CPU 4× | **1093.9ms** | 87.9ms | 27.0ms（增量 −3.6ms，噪声内） |

诚实结论：CPU 4× + 1w 音符时**现有产品本身已 65× 超预算**，材质改造不是瓶颈；
headless SwiftShader 比真实无独显机器（多数仍有硬件加速 canvas）悲观，
但材质层的纯 JS CPU 数字可信。

## 7. 预加载成本实测

| 项 | 实测 |
| --- | --- |
| 1025 项剖面 LUT + 257 项纵向 LUT 构建 | **0.0114ms**（Node 2000 次均值） |
| 复用 `getImageData` 里多读 17 列剖面 | 与现有 `sampleBandMaterial` 同一份像素，无第二次回读 |
| RGBA 缓冲分配 | 667×375（0.95MB）0.019ms；1334×750（3.82MB）0.041ms |
| 每帧 `Uint32Array.fill(0)` | 0.012ms / 0.055ms（同两档；2668×1500 15.27MB 为 0.225ms） |

触发点（都不在帧循环里）：

1. `PreviewVideoStage` 的 `loadSimAssets` effect：进页 / 换音符皮肤 / 换场地包或背景包 → 重建剖面 LUT；
2. 舞台 resize / 画质档 `density` 变化 → 按 `metrics` 重建 RGBA 缓冲；
3. 点导出视频时 `exportVideo.ts` 的 `phase:'assets'` 重新 `loadSimAssets` → LUT 再建一次（0.011ms）。
4. **不触发**：seek、播放/暂停、倍速、改谱面、`slideOpacity` / `noteSize` 等设置（LUT 只与皮肤贴图有关，缓冲只与场地尺寸有关）。

## 8. 导出侧事实

- `exportSpec.ts`：两档 `1920×1080 @ 12 Mbps` / `1280×720 @ 6 Mbps`，`EXPORT_FPS = 60`，
  帧数 `ceil(duration × fps)`，**画布 CSS px = 位图 px（导出不做超采样，dpr 1）**。
- `muxer.ts` 把 `bitrate` 传给 `VideoEncoder.configure`；文件大小由「目标码率 × 时长」主导。
- `frameDriver`：`YIELD_EVERY_FRAMES = 2`，每帧 `new VideoFrame(canvas)` 快照；
  新增的 `putImageData` / `drawImage` 是同步的，只让单次任务变长，不改分片让出策略。
- 06 实测基线：1080p 单帧约 45.7ms、端到端 0.26× 实时（同机软光栅，非本次语料）。

推论（**未实测编码后字节数**）：视频大小基本不变；每帧多 7.6ms（720p）/ 10.9ms（1080p），
3 分钟谱 10800 帧约多 82s / 118s，相对 06 的 1080p 基线约 +15~20%。

**导出没有「掉帧」概念**：`driveExportFrames` 按帧号 `for k` 逐帧出帧 → `new VideoFrame` → 编码入队
（背压等待），无实时时钟、不跳帧；产出恒定 60fps、帧数 `ceil(duration×60)`。新增成本只体现为
**导出耗时变长**。06 的「1080p 0.26× 实时」说的是导出速度，不是视频帧率。
另需区分「50% 光栅 = 空间分辨率」（放大回 1080p 轻微软化）与「时间掉帧」，两者无关。
导出若想换 100% 画质：1w 音符 1080p 100% 优化内核 34.6ms/帧（3 分钟谱约多 6 分钟）；
720p 100% 未实测，按像素数线性推算约 20~25ms/帧。这会与实时预览的亮缘锐度产生细微差异，
且需要给 `SimFrameInput` 加显式光栅比例参数，属待拍板项。

## 9. 未验证 / 后续

1. 用户提供的两张实机截图已用于原型同位对照（本地留存、不入库）；最终画质待用户在实机动态预览里复核（亮缘宽度 / `slideOpacity` 是否还要调）。
2. `1334×750 dpr2` + 1w 音符仍 24.1ms；若要保 100% 画质，唯一干净的路是
   **Worker / OffscreenCanvas + 1~2 帧预取环形缓冲**（主线程只贴位图），代价是动 ADR-0016 的单一出帧真相、
   seek / 倍速失效重算、8~16MB 环形缓冲、导出链路单独处理。首期不做。
3. LOD 若要加，应按**每帧可见滑条数**而非总音符数（成本 ∝ 可见带体覆盖像素），并带滞回；
   首期固定 50%（画质已接受、无切换跳变、无判定成本）。
4. 按住段 `@E6E6E6` 亮化（NotGarupa 从原作逆向）本仓未做，另议。
5. 实现后的像素验收脚本、锁测清单见票 65。

## 10. 票 66 光栅分档实测（2026-11-12）

§8 末尾「导出换 100% 属待拍板项」与 §9.3「首期固定 50%」均已由票 66 收敛：导出固定 100%，
实时按每帧可见带体覆盖量走 100% / 50% 两档。本节放该票的**实测数据与复算命令**，
票内只留结论与指向本节的链接（照 `docs/agents/issue-tracker.md` 的记账粒度）。

### 10.1 原型模拟层：成本 vs 光栅像素

同机 Chromium 153 / SwiftShader / CPU 1×，`1334×750 dpr1`、`--final=1 --opt=1 --frames=8`、
合成语料 24% 复杂曲线滑条。口径同 §6（每帧 `getImageData(0,0,1,1)` 强制 flush）。

| 顶层音符 | 100% 光栅像素 | opt 100% 材质层 p50 | 50% 材质层 p50 |
| --- | --- | --- | --- |
| 1000 | 29 万 | **2.7ms** | 1.0ms |
| 2000 | 48 万 | **4.3ms** | 1.4ms |
| 4000 | 101 万 | **8.8ms** | 2.7ms |
| 10000 | 256 万 | **22.0ms** | 5.7ms |

拟合 `cost(ms) ≈ 0.6 + 8.5 × 光栅像素(百万)`。8ms 预算 ⇒ **80 万像素**，
换算约 3100 音符当量；滞回上/下阈取预算 ±12.5% / −18.75% = **90 万 / 65 万**。

复算命令（dev server 由 `bash scripts/dev.sh` 起；云环境地址按 AGENTS.md）：
```
for n in 1000 2000 4000 10000; do
  node scripts/bench-sim-band-raster.mjs --final=1 --opt=1 --notes=$n --frames=8 \
    --scales=1,0.5 --sizes=1334x750x1 --cpu=1
done
```

### 10.2 产品代码两档（`--product=1 --scale=`）

票 66 起产品出帧缺省走 LOD（档位随密度变、不可复算），压测必须显式钉档：
```
node scripts/bench-sim-band-raster.mjs --product=1 --scale=1 --notes=2000 --frames=8 --sizes=1334x750x1 --cpu=1
```
`record` 增量（有带体 − 无带体）：100% 档 2000 音符 **3.8ms**、4000 音符 **7.7ms**（8ms 预算内）、
1w 音符 **18.6ms**（超预算，正是 LOD 降档依据）；50% 档 1w 音符 **5.7ms**（个位毫秒内）。
100% / 50% 成本比 ≈ 3.3×，与 §6 的 3~4× 一致。
`scripts/bench-sim-band-raster.mjs` 是本地一次性探针，按 `scripts/README.md` 不入库。

### 10.3 直带横截面的「糊」到底差在哪

真浏览器（`scripts/verify-sim-band-raster.mjs`，skin00 SP 竖带，y=400）：
50% 与 100% 的亮缘→带外过渡宽度都是 **6px**，最大斜率 **0.210 / 0.190**，峰值同为 0.667
—— 17 点 LUT 剖面本身有软边，半分辨率采样 + 2× 双线性放大**并没有**把过渡拉宽一倍，
票 66 根因节那句「过渡区被拉宽约 2 倍」是推断、不成立。可证伪的差异有三项：
① 100% 根本不做放大（`imageSmoothingEnabled` false vs true）；
② 与内联 B 逐像素真值的整条剖面平均绝对误差 **0.0032 → 0.0024**；
③ 外圈软边能量 **0.895 → 1.024**（50% 放大把未预乘 RGBA 与透明像素混在一起，抹暗最外几像素）。
用户感知到的整体「糊」更可能来自整层重采样在实机高 DPI / 曲边上的表现，待实机截图复核。

## 11. 票 66 · 真实谱 100% 光栅性能回归（2026-11-12）

2026-11-12 修复前调查记录（当时只做诊断）。后续补修与验收见 [票 66](../../.scratch/chart-preview/issues/66-动态预览带体边缘锐度与画质分档.md) Comments「实时 100% 性能回归调查与补修」。

> **读者须知**：下文性能数字来自作者本机一次性 Playwright / CDP 回放，**不承诺**他机可复现同表数值。
> 对照探针与原始 JSON 留在本机 `.scratch/diagnostics/band-stutter-20261112/`（**不入库**）。
> 克隆本仓后若要核对**当前产品口径**（实时固定 50%、导出 100%），用本节「入库验收路径」，不要用已删除的 scratch 脚本。

### 11.1 结论

- `59fbee9` 的实时默认 100% 确实显著增加绘制负载；自动降档未能保护这张真实谱。
- 成本预测仅统计带体覆盖面积，漏掉每帧整张缓冲清零、复制、`putImageData` 等随场地位图面积增长的开销。全屏和较高像素密度下，这部分可以比逐像素内核更贵。
- 本次问题区间没有反复切档：新版本全程 100%，估计压力一直低于降档线。因此本例的首要原因不是切档抖动或 EMA 延迟。
- 旧版仍有音符/特效层的偶发尖峰。同页第二遍明显减轻，支持进一步检查首次执行/绘制冷态；尚未区分 GPU 资源、编译、缓存等内部原因。
- 建议止损范围：实时预览先恢复固定 50%，保留离线导出固定 100%。保留实时 100% 需要重新建立覆盖整条绘制链路的成本模型，不能仅调低当前覆盖面积阈值。

### 11.2 输入与环境

- 用户指定工程：`p38526b919a60406c8e225fe1467d0217`，Retribution ~ Cycle of Redemption ~。
- 直接读取用户指定的 `project.json` / `audio.bin`，不复制工程数据到仓库；1264 个顶层条目、241 条滑条、15224 个连接点，派生带体段 14983。
- Chromium，已通过 CDP 确认 NVIDIA GeForce GTX 1650、Canvas/GPU 合成/光栅加速启用。
- 场地 CSS 尺寸 1536×864；密度 1.25 和 2，对应主画布 1920×1080 和 3072×1728。
- 默认音符速度 9.5、大小 1、带体透明度 0.8、默认音符皮肤、开启同时点击线。未读取用户应用的持久化显示设置。
- 使用真实 `createSimPlayback`、`AudioEngine`、音符精灵、场地素材、打击特效和音频，从 40 秒连续播放到 48 秒，统计 43–46 秒。音频照常解码/调度，总输出静音。
- 这是全屏尺寸下的真实渲染和音频路径回放；未装配完整 React 页面、自动保存或原生全屏按钮，不把这些测量称为完整应用端到端性能。
- 对照提交固定为 `5885d30` 与 `59fbee9`。工作区曾在测量中切换版本，最终证据使用单独的 detached worktree 和 5174 服务，避免混版。

### 11.3 测量摘录

单位 ms；P95 是 95% 的采样不超过的耗时。绘制耗时不等于完整帧间隔。

| 主画布位图 | 版本/档位 | 整帧绘制 P50 / P95 | 带体层 P50 / P95 | >25ms 帧间隔 / 样本 |
| --- | --- | --- | --- | --- |
| 1920×1080 | 旧版固定 50% | 2.5 / 4.7 | 1.2 / 2.1 | 1 / 178 |
| 1920×1080 | 新版自动 | 6.4 / 9.0 | 5.2 / 6.9 | 1 / 181 |
| 1920×1080 | 新版显式 50% | 1.9 / 3.4 | 0.8 / 1.5 | 1 / 181 |
| 3072×1728 | 旧版固定 50% | 4.3 / 6.6 | 3.1 / 4.6 | 4 / 181 |
| 3072×1728 | 新版自动 | 17.6 / 30.4 | 15.7 / 24.1 | 20 / 147 |
| 3072×1728 | 新版显式 50% | 4.9 / 10.3 | 3.5 / 6.1 | 4 / 180 |

### 11.4 为什么 LOD 没起保护作用

`simBandCoverageCss` 求带体梯形面积，`nextSimBandRasterLodState` 乘画布密度得到预计像素，再用 EMA 与 900000/650000 阈值分档。没有按实际绘制时间反馈。

43–46 秒预计压力的最大值：密度 1.25 为 190325、密度 2 为 487232，均低于 900000。

但 `drawSimBandRaster` 每个有带体的帧都执行整张缓冲的 `fill(0)`、`image.data.set`、`putImageData`、`drawImage` 回贴。密度 2 的 100% 缓冲为 3072×1728（约 21.2 MB RGBA）；50% 为 1536×864（约 5.3 MB）。即使只覆盖少量带体，整张缓冲仍做这些工作。密度 2、新版 100% 的分步 P50：清零 3.2ms、逐像素内核 0.6ms、复制 6.1ms、putImageData 5.5ms。

### 11.5 补修后复测（`a1af7da`）

实时恢复固定 50%，移除覆盖面积 LOD 与 EMA 状态；导出继续显式固定 100%。

同一工程/音频、相同场地尺寸和默认显示参数，从 40 秒连续播放到 48 秒，统计 43–46 秒：

| 主画布位图 | 回归版本自动分档的绘制 P95 | 补修后绘制 P95 | 补修后带体层 P95 | 实际带体缓冲 |
| --- | --- | --- | --- | --- |
| 1920×1080 | 9.0ms | 4.8ms | 1.9ms | 960×540 |
| 3072×1728 | 30.4ms | 7.4ms | 5.0ms | 1536×864 |

补修后仍捕获到独立的音符/特效尖峰与偶发内存复制尖峰（与 [票 68](../../.scratch/chart-preview/issues/68-动态预览残留随机停顿与切片预热缺口.md) 的切片预热缺口为不同信号）。

### 11.6 入库验收路径（克隆后可跑）

1. `npx vitest run tests/unit/preview/video/SimField.test.ts tests/unit/preview/video/BandMaterialRaster.test.ts tests/static/VideoExportWiring.test.ts` — 实时缺省 50%、导出显式 100%、缓冲复用。
2. 先 `bash scripts/dev.sh`，再 `node scripts/verify-sim-band-raster.mjs` — 12 条浏览器像素断言（含实时半尺寸 / 导出全尺寸）。
