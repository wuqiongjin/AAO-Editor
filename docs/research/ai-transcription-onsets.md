# 辅助采音：从音频得到「这一时刻有一个音」

> 只陈述一级来源可核对的事实，**不拍板**采用哪家库、也不推导产品应如何接采音标记。

本编辑器侧相关事实：`AudioEngine.load()` 在渲染进程用 `AudioContext.decodeAudioData` 得到 `AudioBuffer` 并挂在 `this.buffer`（见 `src/audio/AudioEngine.ts`）。

---

## 1. 从音频得到时刻：现成做法与一级来源

起音（onset）检测的标准流水线是两步：**算起音检测函数（ODF / novelty）→ 在 ODF 上做峰检测**，再把帧索引换成**秒**。Essentia 教程原文：

> Onset detection consists of two steps: Compute an onset detection function (ODF)… Decide onset locations… based on the peaks…  
> — [Essentia · Onset detection tutorial](https://essentia.upf.edu/tutorial_rhythm_onsetdetection.html)

### 1.1 经典谱域 ODF + 峰拾取（不依赖 BPM）

| 做法 | 输出 | 一级来源（库文档 / 论文） |
| --- | --- | --- |
| **Spectral flux / HFC / complex / phase 等 ODF + 峰拾取** | 起音时刻（秒或样本） | 方法族综述与比较：[Dixon, *Onset Detection Revisited*, DAFx-06](https://dafx.de/paper-archive/2006/papers/p_133.pdf)；复域：[Bello et al., IEEE SPL 2004](https://ieeexplore.ieee.org/document/1300607)（Essentia `OnsetDetection` 引用同一文献） |
| **aubio `aubio_onset` / CLI `aubioonset`** | `aubio_onset_get_last_s()` / 控制台打印**秒** | [aubio onset.h](https://aubio.org/doc/latest/onset_8h.html)；ODF 方法与论文指针：[specdesc.h](https://aubio.org/doc/latest/specdesc_8h.html)；CLI：[aubio manual · onset](https://aubio.org/manual/latest/cli.html)（`energy|hfc|complex|phase|specdiff|kl|mkl|specflux`） |
| **Essentia `OnsetDetection` → `Onsets`** | `Onsets` 输出 `onsets`，单位 **[s]** | [OnsetDetection](https://essentia.upf.edu/reference/std_OnsetDetection.html)（`hfc|complex|complex_phase|flux|melflux|rms`）；[Onsets](https://essentia.upf.edu/reference/std_Onsets.html)；教程同上 |
| **Essentia `SuperFluxExtractor`** | `onsets`（起音时刻） | [SuperFluxExtractor](https://essentia.upf.edu/reference/std_SuperFluxExtractor.html)；算法论文：[Böck & Widmer, *Maximum Filter Vibrato Suppression for Onset Detection*, DAFx-13](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf) |
| **librosa `onset_strength` → `onset_detect`** | `units='time'` 时为**秒** | [onset_detect](https://librosa.org/doc/latest/api/generated/librosa.onset.onset_detect.html)；[onset_strength](https://librosa.org/doc/latest/api/generated/librosa.onset.onset_strength.html)（默认 spectral flux；`max_size` 路径对应 SuperFlux 的 max-filter，并引用 DAFx-13） |
| **madmom 谱域 / RNN / CNN + `OnsetPeakPickingProcessor`** | 峰拾取返回 **Detected onsets [seconds]** | [madmom.features.onsets](https://madmom.readthedocs.io/en/v0.16.1/modules/features/onsets.html)（`SpectralOnsetProcessor`、`RNNOnsetProcessor`、`CNNOnsetProcessor`、`OnsetPeakPickingProcessor`）；RNN 论文：[Böck et al., DAFx-12](https://www.dafx.de/paper-archive/2012/papers/dafx12_submission_4.pdf) |

### 1.2 浏览器内可直接接到 `AudioBuffer` 的现成路径

| 做法 | 说明 | 一级来源 |
| --- | --- | --- |
| **Essentia.js `SuperFluxExtractor`** | 官方离线示例：解码 → `arrayToVector` → `SuperFluxExtractor` → `onsets` | TISMIR 论文 Listing 1：[Correya et al., *Audio and Music Analysis on the Web using Essentia.js*](https://doi.org/10.5334/tismir.111)；上手：[Getting started](https://mtg.github.io/essentia.js/docs/api/tutorial-1.%20Getting%20started.html)（`audioBuffer.getChannelData(0)` → `arrayToVector`） |
| **自写峰拾取 + Meyda `spectralFlux`** | Meyda **只提供**帧级 `spectralFlux` 特征，**不是**完整起音检测器；需自行阈值/峰拾取 | [Meyda audio features · Spectral Flux](https://meyda.js.org/audio-features.html) |

### 1.3 与「完整起音时刻」相邻、但本票问题边界外的能力

- **Beat / tempo（拍点 / BPM）**：aubio 将 `onset` 与 `beat` / `tempo` 列为**不同**子命令（[CLI](https://aubio.org/manual/latest/cli.html)）。那是节拍网格，不是本票要的「事件起音时刻」。
- **原生 aubio / librosa / madmom**：一级文档面向 C/Python 原生栈，**不是**浏览器内 API；要在浏览器用等价算法，一级文档里明确落地的是 Essentia 的 Wasm 端口（Essentia.js），或自实现 ODF+峰拾取（例如在 Meyda `spectralFlux` 之上）。

---

## 2. 输出是时刻，还是必须先有 BPM / 节拍网格？

**起音检测输出的是时间轴上的时刻；API 参数里不要求 BPM 或拍网格。**

证据：

1. **Essentia `Onsets`**：输出写明 `the onset positions [s]`；参数为 `alpha` / `delay` / `frameRate` / `silenceThreshold`，**无 BPM**（[Onsets](https://essentia.upf.edu/reference/std_Onsets.html)）。
2. **aubio**：ODF + silence / peak threshold / **minimum inter-onset interval**；`aubio_onset_get_last_s()` 取秒（[onset.h](https://aubio.org/doc/latest/onset_8h.html)）。CLI 的 `onset` 与 `beat`/`tempo` 分立（[CLI](https://aubio.org/manual/latest/cli.html)）。
3. **librosa `onset_detect`**：输入 `y`/`sr` 或 `onset_envelope`；`units='time'` 得秒；kwargs 是峰拾取参数，**无 BPM**（[onset_detect](https://librosa.org/doc/latest/api/generated/librosa.onset.onset_detect.html)）。
4. **madmom `OnsetPeakPickingProcessor`**：返回 `Detected onsets [seconds]`；参数为 threshold / combine / fps 等，**无 BPM**（[madmom onsets](https://madmom.readthedocs.io/en/v0.16.1/modules/features/onsets.html)）。
5. **SuperFluxExtractor**：输入 `signal` + `sampleRate`/帧参数/阈值；输出 `onsets`（[文档](https://essentia.upf.edu/reference/std_SuperFluxExtractor.html)）。

因此：与本编辑器「采音标记不读谱面 BPM」在接口形态上是对齐的——经典起音管线本身就不读 BPM。BPM/拍跟踪是**另一类**算法（aubio `beat`/`tempo`、Essentia BeatTracker* 等）。

---

## 3. 浏览器里、已有 `AudioBuffer` 时能不能跑？要不要进程外？

### 本仓库

`AudioEngine.load()`：

```149:156:src/audio/AudioEngine.ts
  async load(file: File): Promise<void> {
    const ctx = this.ensureCtx();
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    this.buffer = decoded;
    ...
  }
```

PCM 已在渲染进程的 `AudioBuffer` 里。

### Web 平台能力

- `AudioBuffer.getChannelData(channel)` 返回该声道的 `Float32Array` PCM（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData)）。

### 浏览器内（不必进程外）

- **Essentia.js**：官方文档用 `getChannelData` → Wasm 向量 → 算法（含起音）；昂贵计算建议放 **Web Worker / AudioWorklet**，但仍是**同一浏览器进程侧**，不是必须把音频送到独立本机进程或服务器（[Getting started](https://mtg.github.io/essentia.js/docs/api/tutorial-1.%20Getting%20started.html)；TISMIR [§4.1 Offline analysis](https://doi.org/10.5334/tismir.111)）。
- **Meyda**：官方 Web Audio 指南在浏览器里对 `AudioContext` 源做帧特征（含 `spectralFlux`）（[online Web Audio guide](https://meyda.js.org/guides/online-web-audio.html)）——仍需自行完成「峰 → 时刻」。

### 通常需要进程外 / 非浏览器运行时的

- **librosa、原生 Essentia Python、aubio、madmom**：一级文档与发行形态是原生库；若坚持用它们的现成实现，需要 **Node/原生扩展、本机子进程或远端服务**，而不是直接在 `AudioBuffer` 上调用同名 API。  
  （madmom 的 RNN/CNN 还依赖预训练权重与 Python 栈，见 [madmom onsets](https://madmom.readthedocs.io/en/v0.16.1/modules/features/onsets.html)。）

**结论（事实层）**：对已解码的 `AudioBuffer`，**可以**在浏览器内用 Wasm MIR 库（Essentia.js 文档路径）或自写 ODF+峰拾取跑完整「时刻列表」；**不是**物理上必须送出进程。选择原生 Python/C 库则另当别论。

---

## 4. 延迟量级（几分钟歌、用户只圈约十几秒）

量级应相对**被分析的样本长度**（圈选切片），不是整曲时长——一级文档的算法都吃 PCM 片段。

| 路径 | 一级来源能说的量级 | 对「过一会儿标出来」（约十几秒切片） |
| --- | --- | --- |
| **经典 ODF + 峰拾取 / SuperFlux** | SuperFlux 论文称算法因果，**offline 与 online real-time 皆可**（[DAFx-13 PDF](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf) abstract）。Essentia 对 complex 建议 hop 512 @ 44.1 kHz → **约 11.6 ms** 时间分辨率（[OnsetDetection](https://essentia.upf.edu/reference/std_OnsetDetection.html)） | 计算上属于「实时族」；墙钟延迟通常远小于切片时长（见下行浏览器基准的外推） |
| **Essentia.js 通用特征（浏览器 Wasm）** | 对 **30 s** 音频，多数算法墙钟 **0.46–3.48 s**（约为输入时长的 **1.5–6.8%**）；个别特征更慢（MFCC / pYIN 最差可达约输入时长的 29–55%）（[TISMIR §7.1](https://doi.org/10.5334/tismir.111)）。论文**未单独公布** SuperFluxExtractor 毫秒数，但同属帧级谱处理管线 | 若近似线性外推到 **~15 s**，多数谱特征级工作往往在**亚秒～数秒**；需实测具体算法 |
| **Essentia.js + 大型 TF.js 模型端到端** | 30 s 上，部分模型端到端可达输入时长的 **12–94%**，个别更慢（[TISMIR §7.2](https://doi.org/10.5334/tismir.111)） | 这不是「轻量起音 ODF」；若误用重模型做采音，**可能做不到「过一会儿」** |
| **madmom CNN/RNN** | 文档给出激活函数 @ 100 fps + 峰拾取得秒；**无**浏览器墙钟基准 | 需原生栈；延迟取决于机型与是否批处理，不能从官方 docs 写成「一定亚秒」 |
| **把整曲或切片送到进程外 / 远端** | TISMIR 明确**未**把「加载音频 / 网络」计入基准，因受连通性影响（[§7](https://doi.org/10.5334/tismir.111)） | **网络 RTT + 编解码/上传**可轻易压过本地 ODF；「只圈十几秒却上传整首几分钟」会无意义地放大等待 |

**明显更难做到「过一会儿就标出来」的**（据一级来源）：

1. 依赖**大模型端到端**且墙钟可接近音频时长量级的路径（TISMIR §7.2）；  
2. **必须出浏览器**且经网络的路径（延迟不可由 ODF 复杂度单独保证）；  
3. 对**整首**而非圈选切片做重分析（算法输入长度决定工作量；官方基准按给定片段计时）。

---

## 5. 误检通常差在哪里？

下列均来自论文/官方文档的机制描述；**不编造准确率百分比**。论文中带测试集的定量结论单独标明。

1. **振音 / 颤音（vibrato）→ 多标（假阳性）**  
   普通 spectral flux 会把振音造成的谱峰移动当成新起音；SuperFlux 用最大滤波跟踪谱轨迹抑制。论文称在振音重的材料上，假阳性可减少 **最多约 60%** 且不额外漏检；数据集：混合 25,927 / 小提琴 7,677 / 歌剧人声 1,448 个起音（[DAFx-13](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf)）。

2. **软起音（长 attack）→ 漏标**  
   SuperFlux 引言：打击类起音相对成熟；**软起音、振音、tremolo** 仍是难点；能量/幅度法对木管、弓弦等慢攻击不友好（同 PDF §1）。

3. **定义本身模糊 → 标注与算法都难对齐**  
   Dixon：复调里「同时」音符可错开数十毫秒；长笛等长 attack 难以定义唯一物理起音时刻（[DAFx-06](https://dafx.de/paper-archive/2006/papers/p_133.pdf) §1）。

4. **ODF 选择偏差**  
   - Essentia：`hfc` 偏打击；教程示例中 `hfc` 更吃 hi-hat，`complex` 也能标到 kick（[教程](https://essentia.upf.edu/tutorial_rhythm_onsetdetection.html)）。  
   - `complex_phase` 文档写明：对弓弦等音调更好，但 **tends to over-detect percussive events**（[OnsetDetection](https://essentia.upf.edu/reference/std_OnsetDetection.html)）。

5. **阈值 / 静音 / 最小间隔 → 多标↔漏标权衡**  
   aubio CLI：降低 onset threshold → **更多**起音；提高 → 减少；`-s` 静音阈、`-M` 最小起音间隔直接砍掉密峰（[CLI · aubioonset](https://aubio.org/manual/latest/cli.html)）。这是参数敏感，不是「库坏了」。

6. **打击 vs 非打击的难度不对称**  
   SuperFlux 脚注引用 MIREX 结果称：当代算法在**打击声**上 F-measure **可大于 0.95**（[DAFx-13](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf) 注 1，指向 MIREX 2012 AOD）。**不要**把该数字套到混合流行/游戏曲或软起音材料上——一级来源限定在 percussive 场景。

---

## 6. 与本票问题的直接对应（仍不拍板）

| 问题 | 事实摘要 |
| --- | --- |
| 可靠现成做法？ | ODF（flux/HFC/complex/…）+ 峰拾取；SuperFlux；可选 RNN/CNN 激活 + 峰拾取。一级来源见 §1。 |
| 要不要 BPM？ | **不要**。输出是秒级时刻（§2）。 |
| 浏览器 + `AudioBuffer`？ | **可以**：`getChannelData` + Essentia.js（或自写峰拾取）。原生 librosa/aubio/madmom 则通常要进程外（§3）。 |
| 十几秒圈选延迟？ | 经典/SuperFlux 属实时族；Essentia.js 多数谱特征对 30 s 仅需数秒级墙钟 → 十五秒切片通常可「过一会儿」。重 ML 端到端或整曲出站传输则可能做不到（§4）。 |
| 误检差在哪？ | 振音多标、软起音漏标、复调/长 attack 定义糊、ODF 与阈值偏好（§5）。 |

本文不讨论智能制谱是否应消费这些标记（见 wayfinder 票 03）。
