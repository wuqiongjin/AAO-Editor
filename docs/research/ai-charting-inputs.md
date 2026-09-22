# 智能制谱吃什么输入：音频、起音时刻、BPM、轨道

> 对应票：[03 · 智能制谱的输入是否包含采音标记](../../.scratch/ai-enhancement/issues/03-智能制谱的输入是否包含采音标记.md)  
> 范围：只调研、不改产品代码。建议单独标出。  
> **不决定**「因此地图改成制谱被采音挡住」。

术语以 [`CONTEXT.md`](../../CONTEXT.md) 为准：采音标记 = 音频秒上的非音符标记；智能制谱产出 AI 提案（内部是谱面代码）；BPM 自动识别是固定程序、可被制谱内部调用。

---

## 0. 先把两件事拆开

| 层面 | 问题 | 结论（见 §4） |
| --- | --- | --- |
| **用户流程** | 要不要先跑「辅助采音」、先有一批采音标记？ | **不要**（地图既定事实 + 一级来源里的生成器都以音频为主入口） |
| **程序内部** | 生成管线里会不会出现一批「何时有音」的时刻？ | **经常会**（两段式：先起音/放置，再选轨/选型）；也可以端到端直接从频谱出 token。有内部时刻 **≠** 必须读用户的采音标记 |

---

## 1. 已发表自动制谱通常吃什么

按「只吃音频 / 先起音再生成 / 还要 BPM·拍点」分开写。来源均为作者原文或系统官方发布方法。

### 1.1 只吃（或主吃）原始音频 → 频谱特征

| 系统 | 输入 | 输出相关 | 来源 |
| --- | --- | --- | --- |
| **Dance Dance Convolution (DDC)** | 解码后的音频 → 多尺度 Mel 频谱；另加难度 one-hot | 先对每帧预测「是否放步」概率，峰拾取得时间戳；再另模选箭头 | [Donahue, Lipton, McAuley, ICML 2017 PDF](http://proceedings.mlr.press/v70/donahue17a/donahue17a.pdf) |
| **TaikoNation** | 任意歌曲音频 → 23 ms 段 Mel；与历史音符一起喂 LSTM | 同时预测后续若干时刻的「有无音符 + 类型」 | [Halina & Guzdial, FDG 2021](https://dl.acm.org/doi/fullHtml/10.1145/3472538.3472589) |
| **Onsets and Frames（钢琴转写）** | 原始音频 → Mel 频谱 | 88 键上的起音 + 帧激活（音高直接来自声学） | [Hawthorne et al., arXiv:1710.11153](https://arxiv.org/abs/1710.11153) / [ISMIR 2018 PDF](https://archives.ismir.net/ismir2018/paper/000019.pdf) |

DDC 原文写明任务是 *Given a raw audio track, the goal is to produce a new step chart*，并把问题拆成 *step placement*（何时）与 *step selection*（何键）；placement 吃频谱，**不**要求用户预先提交起音列表（见上 PDF §1、§3–§4）。

### 1.2 先做起音（或放置）检测，再生成轨道/样式

| 系统 | 流水线 | 来源 |
| --- | --- | --- |
| **DDC** | 频谱 → 放置概率 → 峰拾取得时间戳 → 条件 LSTM 在**给定时间戳序列**上选步型 | 同上 ICML 2017 |
| **GenéLive!** | Mel + **beat guide** + 难度 → **onset 模型**（何时有 note）；完整 chart 还有 *sym* 子模型决定 tap/flick 等动作；论文明确「本文聚焦 onset」 | [Takada et al., AAAI 2023 / arXiv:2202.12823](https://arxiv.org/abs/2202.12823)（HTML：[ar5iv](https://ar5iv.labs.arxiv.org/html/2202.12823)） |
| **TCP (Time-based Chart Partitioning)** | 原始音频 + 元数据（含 BPM、offset）+ 难度 → CRNN **onset** → **beat snapping** → 用人类谱面库做 **pattern matching** 填 note type / 轨 | [Hanzen, Halina, Guzdial, AIIDE 2025](https://doi.org/10.1609/aiide.v21i1.36808) |

这类管线在程序里**会**持有一批时刻（峰拾取或 onset 头输出），但时刻是模型从音频算出来的，不是用户采音标记。

### 1.3 还要 BPM / 拍点 / 节拍网格

| 系统 | BPM / 拍点怎么用 | 来源 |
| --- | --- | --- |
| **GenéLive!** | *Beat guide*：由歌曲元数据里的 **BPM + 拍号** 算出与音频帧对齐的三值序列（小节首拍=2、其它拍=1、非拍=0），与 Mel **一并输入** BiLSTM | [arXiv:2202.12823 §4.3](https://arxiv.org/abs/2202.12823)；官方推理入口要求 `bpm_info`（见 [KLab/AAAI-23.6040 README](https://github.com/KLab/AAAI-23.6040)） |
| **Beat-Aligned Spectrogram-to-Sequence** | 把 Mel **按拍对齐**（hop = 1/48 beat）；训练/推理在拍网格上产出时间 token + 动作 token；消融表明不对齐会严重掉点 | [Lee et al., arXiv:2311.13687](https://arxiv.org/abs/2311.13687) |
| **TCP** | 元数据含 BPM 与毫秒 offset；onset 后再 **beat snapping** 到小节细分 | [AIIDE 2025 DOI](https://doi.org/10.1609/aiide.v21i1.36808) |
| **DDC 数据侧** | 训练用的 StepMania pack 自带 tempo / click；放置模型本身吃的是频谱+难度，选步时再喂 *beat phase*、拍间 Δ | [ICML 2017 PDF](http://proceedings.mlr.press/v70/donahue17a/donahue17a.pdf) §2、§4.4 |

对本编辑器：智能制谱「内部使用 BPM 自动识别，并在范围开头写下一条 BPM」（[`CONTEXT.md` AI 增强表](../../CONTEXT.md)）与 GenéLive / 拍对齐流派「要拍网格」一致；BPM 来自固定程序或元数据，不必来自采音标记。

### 1.4 小结（问题 1）

- **主入口几乎都是音频（Mel / STFT）**，不是用户手标的时刻表。  
- **两段式**系统在内部把「时刻」算出来再交给选型/选轨。  
- **拍对齐 / beat guide** 系统额外要 BPM（或等价拍网格）；这与本产品「制谱内部调 BPM 自动识别」同构。  
- 钢琴 AMT（Onsets and Frames）也是音频进、起音+音高出；与音游「轨」语义不同，见 §2。

---

## 2. 第一刀：单键需要 beat + lane——lane 从哪来？

本编辑器单键：`beat` + `lane`（`0..6`）+ `type: "Single"`（见 §5）。  
采音标记只有**音频秒**，没有 lane（[`CONTEXT.md`](../../CONTEXT.md)）。

### 2.1 音游文献里「轨 / 键 / 动作」怎么来

| 来源 | 做法 | 能否只靠「何时有音」得到轨 |
| --- | --- | --- |
| **DDC step selection** | 在**已定时间戳**上，用 LSTM 对 256 种箭头组合建模；条件含历史步、beat phase、距上一/下一拍；**不**从该帧频谱直接「听出」该踩哪只脚 | 否——时刻已知后还要单独选型模 |
| **GenéLive!** | Onset 与 *sym*（动作类型）分开；本文只做 onset；后续动作含与情感/歌词/编舞相关的修改 | 否——轨/动作是第二段 + 人工修订 |
| **TCP** | Onset 之后靠人类谱面片段 **pattern matching** 填 note type | 否——轨来自模式库，不是 onset 本身 |
| **拍对齐 seq2seq** | 同一序列里同时出时间 token 与 action token（哪几键按下/长按等） | 否「只靠时刻」——但可 **端到端** 从对齐后的频谱一次产出轨 |
| **TaikoNation** | 同时预测时刻与 don/ka 等类型（与历史音符耦合） | 否「只靠时刻」——类型与放置联合学 |

DDC 原文还写明：*While not every onset in our data corresponds to a DDR step, every DDR step corresponds to an onset*——起音是放置的**必要但非充分**条件；步进模式是编舞语义，不是声学音高的一一映射（[ICML 2017](http://proceedings.mlr.press/v70/donahue17a/donahue17a.pdf) §1）。

### 2.2 对比：钢琴音高确实能从音频来

Onsets and Frames 对每个钢琴键预测起音/激活——「哪一键」≈ 频谱上的音高，有物理对应（[arXiv:1710.11153](https://arxiv.org/abs/1710.11153)）。  
BanG Dream 七轨**没有**这种「第 k 轨 = 第 k 个半音」的声学定义；lane 是玩法编排。

### 2.3 第一刀还缺什么（相对「只有一批时刻」）

若实现上只有 onset 时刻列表（无论来自内部检测还是采音标记）：

1. **lane（0..6）**——必须另有：选型/选轨模型、拍对齐 seq2seq、pattern 库、或显式约定（启发式）。一级来源里**没有**「时刻 → 七轨」的声学闭式解。  
2. **beat**——时刻是秒；要写成谱面代码的 `beat`，需要范围内的 BPM（及与范围起点的对齐）。产品已规定制谱内部做 BPM 自动识别（[`CONTEXT.md`](../../CONTEXT.md)）。  
3. **难度/密度**——DDC / GenéLive / TCP 都把难度当条件；第一刀若固定「尽量贴音」仍需隐式密度策略。

**建议（标建议）**：第一刀生成器输入定为**选定范围音频** + 内部 BPM 识别结果；时刻用内部 onset/放置头或端到端模型产出，**不要**把用户采音标记当硬前置。lane 用「选轨模 / 联合解码 / 临时启发式」之一补齐——依据 DDC 两段式与 TCP pattern 段（上表链接）。此建议**不**推导「制谱 blocked by 采音」。

---

## 3. 从「单键 + BPM」到「合理谱面」：输入会否变多？

目标合理谱面还含：滑键、技能键、方向键、滑条（地图 Destination）。

| 元素 | 音频里有没有直接证据 | 文献/产品里通常怎么来 |
| --- | --- | --- |
| 更多击打时刻 / 更密 | 有（onset 密度、难度条件） | 难度条件改变放置阈值（DDC、GeneLive） |
| 滑键 `flick` | 无稳定声学标签 | GenéLive 把 tap/flick 等归 *sym*；业务上还靠人工按情感/歌词改（[arXiv:2202.12823](https://arxiv.org/abs/2202.12823) §2.3） |
| 技能键 `skill` | 无（玩法/企划约定） | 本仓库字段是标记位，不是声学特征（§5） |
| 方向键 + `length` 1..3 | 无「左/右/宽度」声学定义 | 同选型/pattern；需额外离散类 |
| 滑条 / 长条（多结点、可 hidden） | 可部分对应「持续音/长音」，但不等于绿条几何 | TCP / osu!mania 区分 short vs long；长键要 **offset/时长** 或第二点；SP 曲线不在本期关闭条件（地图 Out of scope） |
| BPM 事件 | 速度可估，负 BPM/倒流是作者轴产物 | 产品禁止制谱写负 BPM（[`CONTEXT.md`](../../CONTEXT.md)） |

**结论**：到合理谱面时，管线几乎必然要 **更多输出类别**（flick/skill/方向/滑条结点），并常要 **更强拍网格与 pattern/历史上下文**；这些增量里很大一块是**约定与模型**，不是多喂一批用户采音标记就能补上的。

---

## 4. 用户要不要先采音 × 程序要不要一批时刻

| | 回答 |
| --- | --- |
| **用户要不要先做辅助采音？** | **不要。** 地图既定：使用上互不要求先后。一级来源生成器入口是音频（± BPM/难度/元数据），不是用户 onset 表。 |
| **程序要不要一批时刻？** | **取决于架构，常见为「要（内部算）」**：两段式（DDC、GeneLive onset、TCP）会先有时间戳再选轨；端到端（TaikoNation、拍对齐 Transformer）可不落成独立「采音标记」对象，但仍在隐空间/token 里表示事件时刻。 |
| **二者矛盾吗？** | **不矛盾。** 内部时刻 ≠ 用户可见的采音标记；也 ≠ 必须读取辅助采音的产物。 |

**建议（标建议）**：实现上允许制谱**内部**做与辅助采音同类的起音检测并自用；产品上继续「圈音频 → 提案」。是否**可选地**吸收用户已有采音标记当先验，属未决增强，**不能**据此把地图改成制谱 blocked by 采音（本票禁止该决策）。

---

## 5. 对照本仓库：提案最少要有哪些字段

权威：[`CONTEXT.md`](../../CONTEXT.md)（术语）+ [`src/chart/editing/ChartConverter.ts`](../../src/chart/editing/ChartConverter.ts)（代码形态与校验）+ [`src/chart/types.ts`](../../src/chart/types.ts)（内部音符）。

### 5.1 BPM（谱面代码）

```ts
{ beat: number; type: "BPM"; bpm: number }
```

- 校验：`beat` 有限；`bpm` 有限且 **≠ 0**；负 BPM 允许（倒流），但整份谱面另有边界（beat 0 的 BPM 不得为负；最后一条 BPM 须为正）——见 `validateChartCode` / `checkBackflowBoundaries`。  
- 产品口径：智能制谱在**范围开头**写一条**正** BPM，不制造倒流（[`CONTEXT.md`](../../CONTEXT.md)）。  
- `hasBeat0Bpm`：整份谱面期望存在 `beat === 0` 的 BPM；范围提案若只覆盖片段，与「范围开头一条」对齐时需换算到作者轴 beat（BPM 识别票负责细节）。

### 5.2 单键 Single（谱面代码）

```ts
{ beat: number; lane: number; type: "Single"; flick?: boolean; skill?: boolean }
```

- 校验：**必填** `beat`、`lane`；`lane ∈ [0, 6]`；不得带 `connections`。  
- 第一刀可不写 `flick` / `skill`。  
- 内部 `SingleNote` 同构（`src/chart/types.ts`）。

### 5.3 提案要能校验并通过画布

最少集合（第一刀）：

1. 至少一条范围内的 `{ type:"BPM", beat, bpm>0 }`（口径：范围起点处）。  
2. 零或多条 `{ type:"Single", beat, lane }`，lane 合法。  
3. 经 `convertChartCodeToNotes` 可变成 `ChartNote[]`，才能进现有画布/几何。

示例形态（与 Bestdori 实测及转换器一致，参见 [docs/research/bestdori-api.md](./bestdori-api.md)）：

```json
[
  {"type":"BPM","bpm":185,"beat":0},
  {"type":"Single","lane":5,"beat":10}
]
```

采音标记**不进**谱面代码，故**不是**校验或画布绘制的必需字段。

---

## 6. 总表（给实现的只读结论）

| 问题 | 结论 |
| --- | --- |
| 用户先采音？ | 否 |
| 程序要时刻？ | 常见内部要；端到端可不暴露为采音标记 |
| 只靠时刻够不够出单键？ | 不够——缺 lane（及秒→beat） |
| BPM？ | 制谱内部识别；拍对齐类方法还依赖拍网格 |
| 合理谱面额外？ | 类型/时长/约定为主，不是多一份用户采音 |

---

## 来源清单（一级）

1. Donahue, Lipton, McAuley — *Dance Dance Convolution* — [PMLR PDF](http://proceedings.mlr.press/v70/donahue17a/donahue17a.pdf)  
2. Takada et al. — *GenéLive!* — [arXiv:2202.12823](https://arxiv.org/abs/2202.12823)，代码说明 [KLab/AAAI-23.6040](https://github.com/KLab/AAAI-23.6040)  
3. Lee et al. — *Beat-Aligned Spectrogram-to-Sequence…* — [arXiv:2311.13687](https://arxiv.org/abs/2311.13687)  
4. Hanzen, Halina, Guzdial — *Time-based Chart Partitioning* — [doi:10.1609/aiide.v21i1.36808](https://doi.org/10.1609/aiide.v21i1.36808)  
5. Halina & Guzdial — *TaikoNation* — [ACM DL](https://dl.acm.org/doi/fullHtml/10.1145/3472538.3472589)  
6. Hawthorne et al. — *Onsets and Frames* — [arXiv:1710.11153](https://arxiv.org/abs/1710.11153)  
7. 本仓库 — `CONTEXT.md`、`src/chart/editing/ChartConverter.ts`、`src/chart/types.ts`
