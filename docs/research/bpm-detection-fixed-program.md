# BPM 自动识别：固定程序能做到哪一步

> 调研票：`.scratch/ai-enhancement/issues/02-BPM自动识别能做到哪一步.md`  
> 范围：只记一级来源事实，不选型、不拍板产品行为、不改产品代码。  
> 功能口径（`CONTEXT.md`）：BPM 自动识别 = **固定程序**（不是模型）；写出正 BPM 音符；范围开头必有一条；不写负数 BPM、不制造倒流区。

术语对齐：作者轴 = beat；时间轴 / 播放时钟 = 秒（ADR-0010）；倒流区 = 谱面作者轴上负 BPM 事件造成的区间，不是音频属性。

---

## 1. 常速 BPM：一级来源里有哪些固定程序做法？输出是什么？

固定程序（onset / 自相关 / 动态规划拍追踪等）在一级文档里普遍给出两类输出，经常一起出现：

| 来源 | 做法概要 | 主要输出 |
| --- | --- | --- |
| [aubio `tempo`](https://aubio.org/doc/latest/tempo_8h.html) | 流式 tempo 对象；逐块喂 PCM，检测拍点 | **拍点时刻**（`aubio_tempo_get_last_s` 等）；**当前 tempo**（`aubio_tempo_get_bpm`，无一致值时为 `0`） |
| [Essentia `RhythmExtractor2013`](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html) | 包装 `BeatTrackerMultiFeature` / `BeatTrackerDegara`；要求输入 **44100 Hz** | **一个** `bpm`；`ticks`（拍点，秒）；另有 `estimates`、`bpmIntervals`（整段上的分布/间隔列表） |
| [Essentia 教程 · RhythmExtractor2013](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html) | 官方推荐离线用法；依赖**整轨统计**，不适合实时 | 同上；教程写明 `bpm` 是各拍间间隔 BPM 估计的**平均** |
| [Essentia `PercivalBpmEstimator`](https://essentia.upf.edu/reference/std_PercivalBpmEstimator.html) | Percival & Tzanetakis 2014 自相关/互相关 | **仅一个** `bpm`（无拍点列表） |
| [librosa `beat.beat_track`](https://librosa.org/doc/latest/api/generated/librosa.beat.beat_track.html) | Ellis 2007 动态规划三阶段：onset → tempo → 选拍 | **一个全局** `tempo` + **拍点**（帧/样本/秒）；无 onset 时估计 `0` BPM、空拍列表 |
| [librosa 动态拍追踪教程](https://librosa.org/doc/main/auto_tutorials/03-advanced/plot_dynamic_beat.html) | 默认假设近似常速；可容忍拍点小幅漂移 | 默认路径产出**单一** tempo |

对「用户圈定一段音频 → 常速一个数」：一级文档里**既有「一个 BPM 数」也有「一组拍点时刻」**；多数 beat tracker 二者兼有，纯 tempo 估计器（如 Percival）可以只有数。

论文锚点（库文档直接引用）：

- Ellis, D. P. W. (2007). Beat tracking by dynamic programming. *JNMR* — [librosa `beat_track` 引用](https://librosa.org/doc/latest/api/generated/librosa.beat.beat_track.html)
- Degara et al. (2012). Reliability-informed beat tracking — [Essentia `BeatTrackerDegara`](https://essentia.upf.edu/reference/std_BeatTrackerDegara.html)
- Percival & Tzanetakis (2014) — [Essentia `PercivalBpmEstimator`](https://essentia.upf.edu/reference/std_PercivalBpmEstimator.html)

**不做选型。** 上表只说明固定程序一级 API 的形态。

---

## 2. 变速：固定程序能不能给出「变速时刻 + 每段 BPM」？

### 一级来源里**能**做到的（但形态不是「干净的谱面 BPM 分段」）

1. **逐拍 / 逐帧的连续 tempo 曲线，不是离散变速点**  
   - librosa：`feature.tempo(..., aggregate=None)` 得到**每个时间帧**一个 tempo；再把该数组当作 `bpm=` 传给 `beat_track`（[动态拍教程](https://librosa.org/doc/main/auto_tutorials/03-advanced/plot_dynamic_beat.html)）。  
   - 同一教程写明：默认单 tempo「**不适合**剧烈变速（整段加速/减速或长时间渐变）」；动态估计默认在约 **8 秒**滑动窗上做，结果可呈「锯齿、不均匀台阶」，只是「粗略图景」。  
   - 结论形态 = **稠密时间序列**，不是「在秒 T 切一刀、前后各一个常速 BPM」。

2. **拍间间隔 / 直方图峰：说明「曲里出现过几种速率」，不标切换时刻**  
   - `RhythmExtractor2013` 输出 `bpmIntervals` 与 `estimates`（[API](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)）。  
   - 教程用 [`BpmHistogramDescriptors`](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html) 分析间隔分布，写明对 **varying tempo** 有用——得到的是直方图峰（例如第一/第二峰 BPM），**不是**变速发生的时间戳列表。

3. **从已有拍点列表里标「大宽放」区间（实验性）**  
   - Essentia [`BpmRubato`](https://essentia.upf.edu/reference/std_BpmRubato.html)：输入升序拍点秒，输出 `rubatoStart` / `rubatoStop` / `rubatoNumber`。  
   - 文档自评：**Quality: experimental (non-reliable, poor accuracy)**。  
   - 输出是 rubato **区间端点**（秒），**不**直接给出「每一常速段的 BPM 数值」作为一等输出。

### 一级来源里明确**做不到 / 不可当作可靠能力**的

| 声明 | 来源 |
| --- | --- |
| 默认固定程序 = 整段一个 tempo，不适合剧烈变速 | [librosa 动态拍教程](https://librosa.org/doc/main/auto_tutorials/03-advanced/plot_dynamic_beat.html) |
| `BpmRubato` 不可靠、精度差 | [Essentia `BpmRubato`](https://essentia.upf.edu/reference/std_BpmRubato.html) |
| `RhythmExtractor2013` 吃整轨统计，不做实时分段制谱语义 | [Essentia 教程](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html) |

**本功能规定不是模型**：Essentia 教程里的 [`TempoCNN`](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html)（TensorFlow 局部 BPM）属于模型推理，**不计入**本功能的可用填空。

**调研结论（事实边界，非产品决定）**：固定程序一级文档**没有**提供「可靠地找出变速发生时刻，并为每一段给出一个常速 BPM，可直接写成谱面 BPM 事件序列」的成熟能力。能拿到的是全局数、拍点、间隔分布、实验性 rubato 区间，或嘈杂的逐帧 tempo。缺口用机器学习填上不在本票范围。

---

## 3. 估计结果怎样落到编辑器的 BPM 音符？差哪一步？

### 编辑器侧事实（本仓库）

- 谱面代码里 BPM 是挂在 **作者轴 beat** 上的事件：`{ type: "BPM", beat, bpm }`（见 [`src/chart/types.ts`](../../src/chart/types.ts)；Bestdori 样本形如 `{"type":"BPM","bpm":185,"beat":0}`，见 [`docs/research/bestdori-api.md`](./bestdori-api.md)）。
- 秒 ↔ 拍由 `BpmTimeline` / `AudioTiming` 做**带符号**分段累加：`t = Σ Δbeat × 60/bpm`（[`src/audio/AudioTiming.ts`](../../src/audio/AudioTiming.ts)、[`src/chart/geometry/BpmTimeline.ts`](../../src/chart/geometry/BpmTimeline.ts)；规则见 [ADR-0010](../adr/0010-负数BPM与倒流区.md)）。
- 倒流区内「秒 → 拍」**多值**；空白处新增默认取**最大 beat 解**（ADR-0010 结论 5；`secondsToBeat`）。

### 识别侧输出（上一节）

固定程序输出的是：**正的 BPM 标量**和/或**播放时钟上的拍点秒**，不是作者轴上的 `beat`。

### 差的那一步

在「只知道音频秒、还不知道 beat」时，缺的是：

> **用当前谱面已有的 BPM 时间线，把范围起点（及若有的其它时刻）从播放时钟秒换算成作者轴 beat**，再在该 `beat` 上写入 `{ type: "BPM", bpm: 估计正值 }`。

没有这一步，识别结果无法挂进谱面代码坐标。  
「范围开头即使与前一条数值相同也要写一条」是产品规则（`CONTEXT.md`），不是库 API 的一部分——库只给出估计数；是否强制落笔由编辑器写事件决定。

本调研**不**决定：换算时是否允许读范围前 BPM、倒流多值如何处理、是否另建局部拍网格。智能制谱另有「不把范围前 BPM 当段内拍距 / 起点在倒流区则禁止」等口径；那些属于制谱票，不在此拍板。

---

## 4. 范围起点已在倒流区：识别本身还能否只听音频给出正 BPM？

**两件事必须分开：**

| | 倒流区 | 音频 BPM 识别 |
| --- | --- | --- |
| 是什么 | 谱面作者轴上自 `bpm < 0` 起到下一条 `bpm > 0` 的区间（[ADR-0010](../adr/0010-负数BPM与倒流区.md)；`CONTEXT.md`） | 对 PCM / `AudioBuffer` 样本跑固定程序 |
| 输入 | BPM 事件序列 | 波形振幅（与谱面无关） |
| 输出符号 | 可负（制谱器可写负值） | 一级 API 的 tempo/BPM 为**非负估计**（如 librosa 写明 non-negative；aubio 无一致值时为 `0`） |

因此：

1. **识别本身**：倒流不在音频里。只要圈定片段的 PCM 可喂给算法，固定程序仍可估计一个**正** BPM（或拍点）。范围起点是否落在倒流区，**不改变**「只听这段音频」这一输入。
2. **落谱 / 制谱**：把秒放到作者轴、是否允许在倒流起点调用智能制谱，是谱面几何与产品规则（ADR-0010、`CONTEXT.md` 智能制谱禁止句）。那是落地问题，不是「音频里听出倒流」。

产品既定：BPM 自动识别**不写负数、不制造倒流区**——这是写出规则，不是识别算法从音频里「避免倒流」。

---

## 5. 浏览器里对 `AudioBuffer` 跑这些算法：可行 vs 必须离线

### Web 平台本身

[MDN `AudioBuffer`](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer) 只暴露 `sampleRate` / `duration` / `getChannelData()` 等 PCM 访问；**没有** tempo / BPM API。浏览器要跑算法 = 自带实现或 WASM/JS 库读 `Float32Array`。

### 可在浏览器（WASM / JS）跑的一级路径

| 路径 | 事实 |
| --- | --- |
| [Essentia.js](https://mtg.github.io/essentia.js/docs/api/tutorial-1.%20Getting%20started.html) | 官方 WASM 后端绑到 Essentia standard 算法；示例：`audioBuffer.getChannelData(0)` → `arrayToVector` → 算法。文档建议重计算法放 **AudioWorklet / Web Worker**，勿堵主线程。 |
| Essentia.js 与 `RhythmExtractor2013` | 父库算法要求 **44100 Hz**（[API](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)）；整轨统计、**非实时**（[教程](https://essentia.upf.edu/tutorial_rhythm_beatdetection.html)）——浏览器里也是**离线段分析**，不是跟播实时。 |
| [aubio 官方 tempo API](https://aubio.org/doc/latest/tempo_8h.html) | C 库；社区有 Emscripten 打包（如 npm `aubiojs`），但对 `AudioBuffer` 的用法属于第三方封装，**不是** aubio.org 一级文档的一部分。 |

### 更自然走进程外 / 本机离线的路径

| 路径 | 事实 |
| --- | --- |
| librosa | Python API（[`beat_track`](https://librosa.org/doc/latest/api/generated/librosa.beat.beat_track.html)）；一级文档无浏览器运行时。典型 = 本机/服务器进程读文件或 PCM。 |
| Essentia 原生 C++/Python | 同上；与 essentia.js 是同一算法家族的不同宿主。 |
| Electron 主进程 / 子进程 | 本仓库已有桌面壳时，可把上述本机库放在渲染进程外——这是部署选项，非算法能力差异。 |

**小结**：对已有 `AudioBuffer`，**可行**的路径是取出 PCM → WASM（Essentia.js 等）在 Worker 里做**离线段分析**。librosa 等 Python 栈**必须**离线/进程外。Web Audio **原生**不能给出 BPM。

---

## 总表（对照票面五问）

| # | 问题 | 一级来源结论 |
| --- | --- | --- |
| 1 | 常速估计做什么、输出什么 | 固定程序可用；常见输出 = **一个 BPM** ± **一组拍点秒**（aubio / Essentia RhythmExtractor2013 / librosa beat_track；Percival 可仅 BPM） |
| 2 | 变速时刻 + 每段 BPM | **无**可靠、成体系的固定程序一级能力写成谱面分段；仅有逐帧曲线、间隔直方图、实验性 `BpmRubato`。不用模型填坑 |
| 3 | 落到 BPM 音符差哪步 | 差 **秒（播放时钟）→ beat（作者轴）** 换算；BPM 事件挂在 beat 上 |
| 4 | 起点在倒流区 | **听音频仍可估正 BPM**；倒流是谱面事。落笔/制谱另论 |
| 5 | 浏览器 `AudioBuffer` | PCM 可喂 WASM（如 Essentia.js + Worker）；无原生 BPM；librosa 等须进程外 |

本文不决定用哪家库，也不决定智能制谱的音符种类。
