# 导出链路与尺寸实测（chart-preview 06，2026-10-09）

> 对应 effort `chart-preview` / 票 06。只记**可复核的事实**与**复算命令**，不做决策（决策走 ADR / 票内定案）。
> 相关：[chart-preview-technical-baseline.md](./chart-preview-technical-baseline.md) §3.3 / §4（「待实测」清单就是本票）、
> 票 03（宽图尺寸与默认档）、票 07（视频导出）。
>
> 测的都是**产品代码本身**：探针页从 dev server 现场 `import('/src/...')`（Vite 转译），
> 出图走 `preview/static/exportPanels.renderSheet`、出帧走 `preview/video/sim.drawSimFrameAt` —— 不是复刻实现。
>
> **本笔记的重心是 §4–§6（视频导出链路）——那三节是没人做过的，07 卡在它们上面。**
> **§2 / §3 是复核性质**：票 06 开票（2026-09-30）时 03 尚未落地，票面把它们当成"选型前的实测"；
> 03 / 13 / 14 落地后自己按公式复算过（`exportPanels.ts` 注释里那组数，语料是 805 张真实谱面，比本票的 2 张强），
> 所以这两节**对已完成的宽图导出没有新增结论**，只是把公式换成了真分配验证，并补了两个 03 没测的数。
> 读到 §2 / §3 请按"复核 + 补漏"读，不要误以为宽图还有未决问题。

## 0. 结论速览

| 问题 | 实测（Chromium 153 / Linux / 软光栅，见 §1） |
| --- | --- |
| 画布单边上限（复核） | **65,535 px**（65,536 起分配失败；二分实测，误差 ±1） |
| 画布面积上限（复核） | **2^28 = 268,435,456 px²**（16,384² 正好通过、16,385² 失败） |
| 超限后的行为（**复核两节里唯一的新东西**） | **全程静默**：`canvas.width/height` 照写、`fillRect` 不抛、`getImageData` 回 `0,0,0,0`、`toBlob` 回调 **null**、`drawImage` 画出透明 |
| 5,850 × 537 网格图（复核） | 正常 `toBlob`：1.4 MB / 27 ms；dpr 2（11,700 × 1,074）也正常：4.4 MB / 86 ms |
| 3 分钟谱宽图（**补漏**：03 只算过尺寸） | 19 面板 → 缓冲 10,982 × 7,324（**307 MB**），端到端 **995 ms**，PNG 12.5 MB，进程 RSS 峰值 **+500 MB** |
| 5 分钟谱宽图（**补漏**） | 31 面板 → 缓冲 17,918 × 7,324（**501 MB**），端到端 **2,361 ms**，PNG 18.4 MB，进程 RSS 峰值 **+735 MB** |
| 仿真场单帧（1080p、dpr 1） | 命令录制 0.4 ms + **光栅 45.7 ms** = 46 ms/帧 → **22 fps** |
| 仿真场单帧（dpr 2 / 720p / 540p） | 190 ms（5 fps）/ 16 ms（62 fps）/ 10 ms（97 fps）—— 成本**按位图像素数走** |
| 端到端（出帧 + 快照 + 编码） | 1080p **15.8 fps（0.26× 实时）**；720p 42.8 fps（0.71×）；540p 68.5 fps（1.14×） |
| 编码吞吐（1080p @8 Mbps） | H.264 107 fps、VP9 120 fps、VP8 66 fps、AV1 100 fps（含合成图绘制与快照；编码器 enqueue 本身只 0.6–1.2 ms/帧） |
| 视频 codec 可用性 | `avc1.42001f`（Baseline）**false**；`avc1.4d0028` / `avc1.640028` / `avc1.640033` **true**；`vp8` / `vp09.*` / `av01.*` true |
| 音频 codec 可用性 | **只有 `opus` true**；`mp4a.40.2` / `mp4a.40.5`（AAC）、`flac`、`alaw`、`ulaw` 全 **false** |
| H.264 的硬门槛 | **边长必须偶数**：`1920×1079` → `isConfigSupported` = false；`1920×1078` → true |
| worker 出帧 | worker 里 `OffscreenCanvas` + 2d、`VideoEncoder` 都可用；但 **worker 无 `Image`** → 精灵图集得走 `ImageBitmap`（实测可从字节建 2048×1024） |
| 封装库 | `mp4-muxer` 5.2.2（ESM 69 KB / gzip 14 KB；音频 `aac` + `opus`）、`webm-muxer` 5.1.4（65 KB / gzip 12 KB；codec 字符串 `V_VP9` / `A_OPUS`） |
| MediaRecorder 对照 | 1080p 实时录制只有 **19–25 fps**（5 s 产出 0.9–1.7 MB）；与离线逐帧**同一瓶颈**（光栅），换录制方式不改变它 |

三条给 07 的硬结论：**① mp4 装不了 AAC（只能用 Opus）；② 画布边长必须取偶数，否则 H.264 直接判不支持；
③ 1080p/60 在这台软光栅机器上达不到实时，瓶颈是光栅与快照，不是编码器。**

## 1. 环境（与「为什么不是 Electron」）

| 项 | 值 |
| --- | --- |
| 浏览器 | Chromium **153.0.8010.12**（Playwright 1.63 / `chromium-1243`，headless shell） |
| 平台 | Linux x86_64，8 核，`navigator.deviceMemory` 32 GB（容器实 16 GB） |
| 光栅后端 | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` —— **软件光栅，无 GPU** |
| 安全上下文 | `http://127.0.0.1:5173/` = secure；WebCodecs / OffscreenCanvas / MediaRecorder 全在 |
| 产品代码 | dev server 现场模块（Vite 转译），非快照 |

**环境取舍（票面要求本票定）：**

- **Playwright 浏览器已在本工作区装好**（`~/.cache/ms-playwright/chromium-1243`），不需要下载 —— 所以走**在仓内实测**，不麻烦用户在本机跑一遍回填。
- **Electron 在本工作区跑不起来**：`node_modules/.bin/electron` 报 `error while loading shared libraries: libgtk-3.so.0`（容器缺 GTK 依赖），`npm run electron:dev` 这条路在云工作区走不通（装系统库超出本票范围）。
- 因此**全部数字是浏览器侧的**；与出货目标 Electron 38（Chromium 140）的版本差要在读结论时带上：
  - 画布上限（65,535 / 2^28）只在 **153** 上核实过；它是 Chromium 的长期常量（票 03 起就按它算），140 上同值几乎无悬念但本票没有实测（见 §9）；
  - **软光栅是最坏情况** —— 真机 GPU 光栅下 §4 的单帧成本会显著下降，1080p/60 是否够要真机复测；
  - **编码可用性（尤其 AAC）建议真机复验一次**（见 §7 的复验命令）。

## 2. 画布 / 位图上限与失败行为（复核：03 已落地并自测）

> **性质说明**：03 落地时已按公式复算出面板数边界（语料 805 张真实谱面，`exportPanels.ts` 注释里那组数），
> 本节**不推翻它的任何结论**，只做两件事：① 把"公式算"换成**真分配验证**（画像素再读回）；
> ② 补记**超限后的行为**——那是 03 从未验过的，而它恰恰决定了"为什么要提前算尺寸"。

二分实测（每张画布画左上 + 右下两个色块，读回两个像素判定分配成功）：

| 边界 | 通过 | 失败 |
| --- | --- | --- |
| 单边（`h = 4`） | **65,535** | 65,536 |
| 面积（正方形） | **16,384² = 268,435,456 = 2^28** | 16,385² |

**超限后的行为（重点：全程静默，没有异常）：**

| 操作 | 结果 |
| --- | --- |
| `canvas.width/height = …` | 照写不抛，`canvas.width` 读回就是越界值 |
| `getContext('2d')` | 正常返回 ctx |
| `fillRect` | 不抛（命令被丢弃） |
| `getImageData` | 返回全 0（透明黑），**不抛** |
| `toBlob` | 回调 **null**（不是抛错）→ `exportPanels.canvasToPngBytes` 会走到它自己的 `导出失败：画布无法编码为 PNG` |
| 拿它当 `drawImage` 的源 | 画出透明，**不抛** |

→ 含义：**尺寸必须在画之前自己算清楚**（`planSheetExport` 的存在理由）；一旦越界，用户看到的是「白图 / 导出失败」，不会有堆栈。

**具体尺寸：**

| 尺寸 | 结果 |
| --- | --- |
| 5,850 × 537（dpr 1） | 分配成功，PNG 1,449,219 B / 27 ms |
| 11,700 × 1,074（dpr 2） | 分配成功，PNG 4,405,579 B / 86 ms |
| 10,982 × 7,324（3 分钟谱宽图 @dpr2） | 分配成功，PNG 23,290,653 B / 495 ms（纯渐变图；真谱面同尺寸见 §3） |

**宽图面板数边界（与 `exportPanels.ts` 注释里的数逐条对上，`SHEET_LIMITS` 不用改）：**

| 情形 | 通过 | 拒绝 | 触顶的是 |
| --- | --- | --- | --- |
| dpr 2 + 头带（高 3,662） | 63 面板（266.7 MPix） | 64（270.9 MPix） | **面积** |
| dpr 2 + 无头带（高 3,222） | 72（268.2 MPix） | 73（272.0 MPix） | **面积** |
| dpr 1（高 3,662） | 226（单边 65,314） | 227（单边 65,603） | **单边** |

> 票 06 原票面写的是「面板 130 × 537、`es ≈ 0.3`」——那是票 03 二轮的旧档，已被票 13（宽 130 → 289）与票 14（高 537 → 3,222）
> 改掉，本票按**当前**档测（面板 `289 × 3,222`、`es 0.74`、`dpr 2`、头带 440）。旧档下 3 分钟谱是 50 面板 × 130 = 6,500 × 537
> @dpr2 ≈ 14 MPix，今天同一张谱是 **80 MPix**——面积压力涨了 5.7 倍，这也是 §3 峰值内存的主要来源。

## 3. 宽图导出实测（复核 + 补两个数：峰值内存 / 端到端耗时）

> **性质说明**：尺寸 / 面板数 / PNG 体积这几项 03 已经测过并写进代码注释，本节只是重跑一遍坐实；
> **本节的新东西只有两个数 —— 进程 RSS 峰值增量与端到端耗时**（03 没测，票 03 的 Comments 把
> "面板位图内存上限与淘汰口径"明写成了待 06 压测的债）。语料只有 2 张谱（3 分钟 / 5 分钟各一），
> 论边界覆盖不如 03 那 805 张，**别拿本节去推翻 03 的边界结论**。

- 语料：3 分钟 = `SampleChartCode/Official/HOHSSP.json`（106.6 s）平铺 ×2；5 分钟 = `Community/150030.json`（172.8 s）平铺 ×2。
  平铺 = 整份谱面代码按 beat 平移拼接（纯 JSON 层，不碰投影），`chartDuration` 另按目标秒数给。
- 路径：`renderSheet` → `canvasToPngBytes`（`toBlob`）。

| | 3 分钟（180 s） | 5 分钟（300 s） |
| --- | --- | --- |
| 音符数 | 1,952（≈10.8 音符/秒） | 2,484（≈8.3 音符/秒） |
| 面板数 / 每面板秒数 | 19 / 9.9 s | 31 / 9.9 s |
| 宽图 CSS | 5,491 × 3,662 | 8,959 × 3,662 |
| 缓冲（×dpr 2） | **10,982 × 7,324 = 307 MB** | **17,918 × 7,324 = 501 MB** |
| 出图（命令录制） | 638 ms | 1,825 ms |
| `toBlob`（含整图光栅 + PNG 编码） | 357 ms | 536 ms |
| **端到端** | **995 ms** | **2,361 ms** |
| PNG 体积 | 12.5 MB | 18.4 MB |
| 进程 RSS 峰值增量 | **+500 MB** | **+735 MB** |
| JS 堆增量 | +28 MB | +98 MB |

读法：

1. **耗时不是问题**（长谱 2.4 s，票 16 的分块让出还在）；**内存与体积才是**——一张 5 分钟谱的导出物要同时持有一块 501 MB 的画布缓冲和一份 18 MB 的 PNG 字节，峰值 RSS 增量 735 MB。
2. 「出图」那 638 / 1,825 ms 是**命令录制**；真正光栅发生在 `toBlob` 里（见 §4 的口径警告）——所以端到端才是可比的数字。
3. RSS 增量 ≫ 缓冲字节（+500 vs 307 MB）：多出来的是面板画家自己的离屏 target、瓦片缓存与 PNG 编码缓冲。**JS 堆增量很小**（画布位图不在 JS 堆里，别拿 `performance.memory` 当画布内存口径）。

## 4. 仿真场单帧成本（真 canvas）

> **口径警告（本票最容易踩的坑）**：canvas 2D 的绘制命令是**延迟光栅**的。只 `drawSimFrameAt` 然后计时，量到的是命令录制
> （0.2–0.4 ms，看着「1080p 只要 0.1 ms」），真正的光栅要等 flush（读回 / 合成 / `VideoFrame` 快照）才发生。
> 本票每帧额外做一次 `getImageData(0,0,1,1)` 强制 flush，并单独量出这枚读回自身的开销减掉。

谱面：`HOHSSP` 平铺 ×2（1,952 音符 → 2,538 元素 / 2,078 带体段），`noteSpeed` 默认档 9.5 → 接近时长 T = 1.25 s，
最密的一秒窗口有 **32 个可见元素**（t ≈ 96.1 s）。

| 场景（每帧：clear + 出帧 + flush） | 命令录制 p50 | 光栅 p50 | 合计 | 折合 fps | 占 60fps 预算 |
| --- | --- | --- | --- | --- | --- |
| 1080p dpr1 · 密段 | 0.4 ms | **45.7 ms** | 46.1 ms | 22 | 277 % |
| 1080p dpr1 · 全谱抽样 | 0.2 ms | 36.3 ms | 36.5 ms | 27 | 219 % |
| 1080p dpr2 · 密段 | 0.4 ms | **189.7 ms** | 190.1 ms | 5 | 1141 % |
| 720p dpr1 · 密段 | 0.2 ms | 15.9 ms | 16.1 ms | 62 | 97 % |
| 540p dpr1 · 密段 | 0.2 ms | 10.1 ms | 10.3 ms | 97 | 62 % |

- 成本**几乎全部在光栅**，且**按位图像素数线性走**（dpr 2 = 4 倍像素 → 4.1 倍耗时）：命令录制恒在 0.2–0.4 ms，JS 侧的取窗口 / 二分 / 几何计算不是瓶颈。
- 单帧的读回成本（导出不一定需要，但「要不要 getImageData」是 07 的接缝）：整帧 `getImageData` 37 ms、`toBlob` 50 ms（1080p）；`new VideoFrame(canvas)` 在已 flush 的画布上 < 0.01 ms。

### worker + OffscreenCanvas

worker 里实测：`OffscreenCanvas` + `getContext('2d')` 可用、`convertToBlob` 可用（44 KB PNG）、
`VideoEncoder.isConfigSupported` 可用、`new VideoFrame(offscreenCanvas)` 可用。

**唯一的接缝是精灵**：worker 没有 `Image`（`typeof Image === 'undefined'`），而 `CanvasSpriteIcon` 的图集缓存是
`Map<string, HTMLImageElement>`。实测把图集字节传进 worker 再 `createImageBitmap` 可行（2048×1024）。
→ 导出要离开主线程，得给 `CanvasSpriteIcon` 加一条 `ImageBitmap` 通路（或主线程预热后把位图传进去），**不是免费的一行改动**。

## 5. 编码可用性与吞吐

### 5.1 `isConfigSupported` 矩阵

| 视频 codec | 支持 | 音频 codec | 支持 |
| --- | --- | --- | --- |
| `avc1.42001f`（Baseline 3.1） | **false** | `opus` | **true** |
| `avc1.4d0028`（Main 4.0） | true | `mp4a.40.2`（AAC-LC） | **false** |
| `avc1.640028`（High 4.0） | true | `mp4a.40.5`（HE-AAC） | **false** |
| `avc1.640033`（High 5.1） | true | `flac` | **false** |
| `vp8` | true | `alaw` / `ulaw` | **false** |
| `vp09.00.10.08` / `vp09.00.31.08` | true | | |
| `av01.0.04M.08` | true | | |

Opus 实测可编码：48 kHz 立体声 1 秒 → 51 个 chunk、16,691 B。

**→ 07 的容器口径被这一条定死了一半：mp4 只能装 H.264 + Opus（`mp4-muxer` 支持 `opus` 音轨），
「mp4(H.264 + AAC)」这条写不进代码。要 AAC 就得自己落 ADTS/裸流或引第三方编码器，本票不建议。**

### 5.2 H.264 的偶数边长门槛

`fitDesignSurface(1920, 1080)` 给的是 `1920 × 1079`（设计面 1334:750 与 16:9 不是同一比例），
拿去 `configure`：

- `1920 × 1079` → `isConfigSupported` = **false**
- `1920 × 1078`（高取偶数）→ **true**

→ **导出尺寸必须自己向下取偶数**（H.264 的 4:2:0 要求）。这是 07 落地时一定会撞上的一条，且失败形态只是「不支持」，不会报错指路。

### 5.3 编码吞吐（1080p / 60 帧 / 8 Mbps）

| codec | 耗时 | fps | 产出码率 |
| --- | --- | --- | --- |
| `avc1.640028` · quality | 563 ms | **106.6** | 13.7 Mbps（码率上限没兜住，合成图太吵） |
| `avc1.640028` · realtime | 629 ms | 95.5 | 12.3 Mbps |
| `vp09.00.10.08` | 499 ms | **120.2** | 9.1 Mbps |
| `vp8` | 904 ms | 66.4 | 7.8 Mbps |
| `av01.0.04M.08` | 597 ms | 100.5 | 3.7 Mbps |
| `avc1.640028` · 720p | 275 ms | 218.3 | 14.1 Mbps |

（含每帧的合成图绘制与 `VideoFrame` 快照；编码器 `encode()` 本身的入队成本只有 0.55–1.24 ms/帧，见下。）

### 5.4 端到端：仿真场出帧 + 编码

每帧 = 出帧 → `new VideoFrame(canvas)` → `encode`（队列 >6 时让出）；90 帧，最密窗口：

| 场景 | 出帧 | 快照（含强制光栅） | 编码入队 | 合计 fps | 相对 60fps 实时 |
| --- | --- | --- | --- | --- | --- |
| H.264 1080p（1,078） | 0.41 ms | **62.07 ms** | 0.93 ms | **15.8** | **0.26×** |
| VP9 1080p（1,079） | 0.42 ms | 62.29 ms | 1.11 ms | 15.7 | 0.26× |
| H.264 720p | 0.32 ms | 22.36 ms | 0.66 ms | 42.8 | 0.71× |
| H.264 540p | 0.26 ms | 13.80 ms | 0.55 ms | 68.5 | 1.14× |

- **瓶颈是「快照」这一步（强制光栅 + 拷一份给编码器）**，编码器本身几乎免费。
- 这台软光栅机器上 1080p/60 离线逐帧**达不到实时**（0.26×）；720p 0.71×、540p 才过 1×。
- 但**这是无 GPU 的最坏情况**：真机 GPU 光栅下光栅成本通常低一个量级，1080p 大概率进得了实时。
  → 07 的进度 UI 口径：**进度按帧数走，不要按「等于歌曲时长」估**（本环境实测 1080p 会是时长的 ~4 倍）；导出规格给**分辨率档**（1080p / 720p）让用户挑，比硬钉 1080p 稳。

### 5.5 封装库（依赖体积）

| 包 | 版本 | ESM 单文件 | gzip | 备注 |
| --- | --- | --- | --- | --- |
| `mp4-muxer` | 5.2.2 | 69,011 B | 14,345 B | 音频 codec 类型为 `'aac' \| 'opus'`；视频 avc/vp9/av1 |
| `webm-muxer` | 5.1.4 | 64,944 B | 11,825 B | codec 是自由字符串（`V_VP9` / `A_OPUS` / `V_AV1`…） |

两个包都是 0 依赖、单文件 ESM（min 后 12–14 KB gzip）——**引依赖的代价很小**，不必为了「零依赖」自己写 EBML / ISOBMFF。
（对照：`mediabunny` 这类全能库 tarball 2.1 MB，本场景用不上。）

## 6. MediaRecorder + `captureStream` 对照（存档）

本 effort 已定离线逐帧，这一节只留数字，防以后有人重新拍板时无据。以仿真场画布 `captureStream(60)` 实时录 5 秒：

| mime | 实际绘制帧率 | 5 s 产出 |
| --- | --- | --- |
| `video/webm;codecs=vp9` | 24.7 fps | 1.08 MB（1.7 Mbps） |
| `video/webm;codecs=vp8` | 25.3 fps | 1.67 MB（2.7 Mbps） |
| `video/mp4;codecs=avc1.640028` | 19.3 fps | 0.94 MB（1.5 Mbps） |

- `MediaRecorder.isTypeSupported` 对本表全部 mime 返回 true（含 `video/mp4`）——**可用，但画质 / 帧率不由我们控制**。
- 录制侧要 60 fps，前提是画面本身就画得出 60 fps；本环境 1080p 只能 ~20–25 fps（与 §5.4 的 15.8 fps 同一瓶颈），
  **掉的是绘制的帧，不是录制方式的锅**。
- 另一条结构性缺陷：录制必须**实时播放一遍**（导出耗时 ≥ 歌曲时长），且键音/BGM 走的是播放器而不是 `OfflineAudioContext`，
  与 07 的「离线音轨」口径对不上。

## 7. 复算命令

```bash
# 1. 起 dev server（唯一入口）
bash scripts/dev.sh

# 2. 全量实测（约 3–5 分钟；JSON 落在指定路径）
node scripts/measure-export-limits.mjs --json=/tmp/export-limits.json

# 只跑某一节：--only=env|limits|sheet|sim|codecs|recorder
node scripts/measure-export-limits.mjs --only=limits
node scripts/measure-export-limits.mjs --only=codecs

# 换语料（3 分钟档 / 5 分钟档各自可指定）
node scripts/measure-export-limits.mjs \
  --chart=docs/resource/SampleChartCode/Official/684_SP.json \
  --chart5=docs/resource/SampleChartCode/Community/220693.json
```

探针脚本 **`scripts/measure-export-limits.mjs` 保留在本仓**（票面允许报完即删，但它是本笔记「复算命令」的本体，
删了这份笔记就不可复核；`scripts/README.md` 已把它登记为「验收 / 取证」类）。

**真机 Electron 复验**（本工作区跑不了 Electron，见 §1）——在有 GTK 的机器上：

```bash
npm run electron:dev          # 起 Vite + Electron
# 然后在窗口里开 devtools 执行同一组探针，或直接：
URL=http://127.0.0.1:5173/ node scripts/measure-export-limits.mjs --only=env,codecs
# 关注三处与浏览器的差异：① Chromium 版本（Electron 38 = 140）；
# ② 光栅后端（真机应是有 GPU 的 ANGLE，不是 SwiftShader）；③ mp4a.40.2（AAC）是否为 true。
```

## 8. 回填指向

- **票 03**：**无新增结论，只有两笔补漏**（03 已按公式复算并写进代码注释，语料比本票强，见 §2 / §3 的抬头）：
  ① `SHEET_LIMITS`（65,535 / 2^28）与 `planSheetExport` 的边界（63 / 72 / 226 面板）由**真分配验证**逐条坐实，
  常量不用改；② **超限行为是全程静默的**（`toBlob` 回调 `null`）与**峰值 RSS 增量 500 / 735 MB、端到端 1.0 / 2.4 s**
  是 03 没测过的两个数 —— 票面「面板位图淘汰口径待 06 压测」据此有了量级。
- **票 07**：容器 / 编码 / 依赖 / 性能口径见 §5 与 §0 的三条硬结论；进度 UI 口径见 §5.4（按帧数走、给分辨率档）；
  「能不能离开主线程」见 §4 末（可行，但精灵要补 `ImageBitmap` 通路）。

## 9. 未测 / 待真机复验

1. **Electron 38（Chromium 140）上的同一组数字** —— 本工作区缺 GTK，跑不起来（§1）。
2. **GPU 光栅下的单帧成本** —— 本环境是 SwiftShader 软光栅，§4 / §5.4 的 fps 是下界。
3. **AAC（`mp4a.40.2`）在真机 / macOS / Windows 上是否为 true** —— Chromium 各平台的音频编码器不一样，本环境的 false 不能直接外推。
4. **音频侧端到端**（`OfflineAudioContext` 渲染 BGM + 键音 → `AudioEncoder`）：本票只验了 Opus 单段可编码，
   整条音轨的渲染耗时与内存留在 07 实测。
