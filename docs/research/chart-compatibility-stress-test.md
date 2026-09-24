# 谱面兼容性压力测试调研

- 调研快照：2026-09-24
- 范围：`docs/resource/StressTestChart/` 共 **794** 份 JSON（官方 SPECIAL 159 + 社区 SPECIAL `level>30` 635）。抓取脚本 `scripts/fetch-stress-test-charts.mjs`，SHA-256 manifest 为同目录 `index.json`（`retrievedAt: 2026-09-24T03:53:36.470Z`，`server: jp`，`failed: 0`，本次复算 hash 0 mismatch）。谱面本体与逐文件机器汇总都不进仓库；需要明细时本地跑 `npx vite-node scripts/analyze-stress-test-charts.ts`（写出 `.cache/`）。
- 2026-09-23 曾对 11 份 `SampleChartCode` 做过闸门盘点。那批几乎都是「社区帖风格」数组（无 `System`/`Long`/`charge`），**不能代表官方 `/api/charts/{id}/special.json` 原样**；结论以本文全量语料为准。
- 证据标记：`[已实测]` 本次对仓库文件和当前函数的直接执行；`[建议后续实测]` 未做真实 UI / 工程重载 / 画布像素验收。

## 结论先行

1. **当前应用闸门会整份拒绝 250/794 张（31.5%）。** 544 张社区谱可通过；**官方 SPECIAL 159/159 全部被拒**。拒绝字段组合：`type` 106 张、`lane` 91 张、`lane+type` 52 张、`type+width` 1 张。入口仍是 `ChartCodeEditorModal.handleApply()` → `validateChartCodeJSON()`，任一错误即整份不写入画布。
2. **官方谱被拒的第一原因是 `System`，不是越界 lane。** 159 张官方每张都有 `type: "System"`（共 620 条：BGM 文件名 + `cmd_fever_*`）。`validateChartCode()` 的 `default` 分支把它们当 unknown type。绕过闸门时 `convertChartCodeToNotes()` 没有 `System` 分支，对象被静默丢掉；`convertNotesToChartCode()` 也对内部 `System` `break`。这直接打中 ADR-0014 的 opaque 保留，不再是合成用例。
3. **越界 lane 仍然全部是 hidden connection。** 143 张、8791 个越界 lane；顶层 0、可见 connection 0。范围 `-0.5..6.5`。社区因此被拒 91 张；官方另有 52 张在 `System` 之外叠加 lane 错误。
4. **官方 SPECIAL 还系统性地携带 11 份样本里没有的字段：** `Long`（158 张 / 6299 条，校验已接受，导出写成 `Slide`）、`charge: true`（158 张 / 顶层 4208 + connection 482，校验忽略、转换丢失）、`skill: true`（322 张 / 2380 处）、`Directional.width` 4–7（仅 `Official/786_SP.json` 24 个，当前 `1..3` gate 拒绝）。单 connection Slide 也真实出现在 `786_SP`（52 条）。
5. **issue 153 的语义定案不需要改；实现优先级必须改。** 11 份快照把 `System`/`Long`/`charge`/`skill`/width>3/单点 Slide 标成「仅合成」。全量语料推翻这一点。153 可解除 `Blocked by: 154`。UI/工程/画布闭环仍未做，应作为 153 实现后的验收，而不是继续阻塞本调研票。

## 1. 方法与语料

### 1.1 语料如何构成

`[已实测]` `index.json`：

| 子集 | 筛选 | 张数 | 来源 URL 形态 |
| --- | --- | ---: | --- |
| Official | Bestdori 官方曲目中带 SPECIAL 难度的谱面数组 | 159 | `https://bestdori.com/api/charts/{songId}/special.json` |
| Community | 24 位谱师、`diff=special`、`level>30` | 635 | `https://bestdori.com/api/post/details?id={postId}`（只存谱面数组） |

与 11 份样本的关系：

- 本语料**不含** Expert 等非 SP 文件（`30_EX`、`37_EX`、`EXIST`、`HOHSSP`），也不含未过 `level>30` 的社区帖（例如负 BPM 标杆 `150030`）。那些仍以 SampleChartCode 快照为准。
- 重叠例：`Official/689_SP.json`、`Community/dzilas/202895.json`、`Community/CityTing/220693.json` 同时存在于两套目录。

### 1.2 实测链路

与代码弹窗 Apply 闸门一致：

```text
JSON.parse
→ validateChartCodeJSON()
→ hasBeat0Bpm()
→（记录用，不论闸门）convertChartCodeToNotes()
→ convertNotesToChartCode()
→ maxNoteEndSeconds()
```

794 份全部 JSON 语法合法、全部含 beat 0 BPM、转换函数对全部文件可跑完（闸门拒绝的文件仍能绕过 convert）。没有 Playwright、没有写工程文件。

## 2. 全量盘点

### 2.1 类型与字段

`[已实测]` 合计 **1,007,454** 个顶层对象、**2,753,405** 个 Slide/Long connections：

| 来源 | 张数 | 对象 | BPM | Single | Directional | Slide | Long | System | connections | hidden |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Official | 159 | 102,965 | 219 | 76,155 | 8,271 | 11,401 | 6,299 | 620 | 128,369 | 83,525 |
| Community | 635 | 904,489 | 6,474 | 673,352 | 91,348 | 133,315 | 0 | 0 | 2,625,036 | 2,247,845 |
| **合计** | **794** | **1,007,454** | **6,693** | **749,507** | **99,619** | **144,716** | **6,299** | **620** | **2,753,405** | **2,331,370** |

字段：

- 顶层已知：`beat`, `bpm`, `connections`, `direction`, `flick`, `lane`, `type`, `width`, `skill`，以及官方的 `charge`、`System.data`。
- connection 已知：`beat`, `lane`, `hidden`, `flick`, `skill`，以及官方的 `charge`。
- **没有**社区谱出现未知字段。官方未知-相对-当前转换器的字段就是 `System`（含 `data`/`beat`）和 `charge`。
- 没有未知 `type` 字符串（`System`/`Long` 都是 Bestdori 一等类型；当前编辑器只把 `System` 当 unknown）。
- `flick` / `hidden` / `charge` / `skill` 的真实值都是显式 `true`，未见显式 `false`。
- `direction` 只有 `Left` / `Right`。
- 全部有 beat 0 正 BPM；没有 `bpm = 0`，没有末条负 BPM，没有 beat 0 负 BPM，没有 `beat < 0`。

`System.data` 形态：每张官方谱一条 BGM 文件名（`bgm001.wav` 等），以及 158 张带 `cmd_fever_ready.wav` / `cmd_fever_start.wav` / `cmd_fever_end.wav`。Bestdori `System` handler 是 no-op；编辑器目标是 opaque 保留、不渲染。

### 2.2 数值范围

| 量 | 语料范围 | 备注 |
| --- | --- | --- |
| beat | `0..48205` | 最大在 `Community/xiwenlejianXLR/92251.json` |
| lane（顶层+connection） | `-0.5..6.5` | 非整数 **1,946,517**；越界 **8,791**，全 hidden |
| BPM | `-1000..15000` | 负值 44 张 / 1543 条；最小 `Community/SohnFGS306/202055.json`，最大 `Community/xiwenlejianXLR/138694.json` |
| Directional.width | `1..7` 整数 | `1`: 31013，`2`: 43602，`3`: 24980，`4`: 4，`5`: 12，`6`: 4，`7`: 4；后四档全部 `Official/786_SP.json` |
| `maxNoteEndSeconds` | 最长 ≈ 715.3s | `Community/SohnFGS306/185312.json`；语料末端普遍 ≫ 无音频默认 30s |

规模（connections 最多）：`Community/CityTing/176168.json` 41,666 connections（单 Slide 最多 2,124）；对象最多：`Community/CityTing/172897.json` 与 `172898.json` 各 5,904 对象。

### 2.3 Slide / Long 结构

- 同拍 connection 组：**11,540** 条 Slide、**176,035** 组。社区为主。
- 非单调（相邻 connection beat 下降）：**2 条 Slide**。`Community/Lightness/189225.json` `$[2275]` 是 `338.333…37 → 338.333…3` 的浮点抖动；`Community/YukiYurei/190118.json` `$[126]` 是 hidden 点 `72.883… → 72.875`（约 0.008 拍回退）。没有大幅度倒序滑条。
- 退化 Slide：仅 `Official/786_SP.json` 有 **52** 条单 connection / 单可见点 Slide。没有空 Slide、没有全 hidden、没有首尾 hidden 作为独立计数（该文件的单点条即首即尾）。
- Long 与 Slide 在官方谱并存；社区本语料为 0 条 Long。

越界代表路径（与 11 份快照一致的模式，hidden 曲线探出轨道）：

- `Official/689_SP.json`：102 个 hidden OOB，范围与样本快照相同。
- `Community/dzilas/202895.json`：与样本 `Community/202895.json` 同源帖。
- 社区新出现的更宽范围：`Community/CityTing/162976.json` 等 `laneMin = -0.5`。

## 3. 当前 parse / validate / convert

### 3.1 闸门

`[已实测]` `checkLane()` 对顶层和 connection 统一 `0..6`，不区分 hidden。unknown type 走 `default`。Directional `width` 必须 `1..3`。

| 闸门结果 | 张数 | 构成 |
| --- | ---: | --- |
| 通过 | 544 | 全部是社区谱（635 张里的 85.7%） |
| 拒绝 `type`（System） | 106 | 官方、无 OOB lane |
| 拒绝 `lane` | 91 | 社区 hidden OOB |
| 拒绝 `lane`+`type` | 52 | 官方 System + hidden OOB |
| 拒绝 `type`+`width` | 1 | `Official/786_SP.json`：System + 24 个 width 4–7 |

官方 0 通过。社区失败全部是 lane，没有社区 System。

依据：`src/chart/editing/ChartConverter.ts` 的 `checkLane` / `validateChartCode` / `validateChartCodeJSON`。

### 3.2 转换保真（绕过闸门）

`[已实测]` 794 张 convert 均未抛错。`convertNotesToChartCode()` 会按首 beat 稳定排序，因此几乎所有文件顶层顺序都会变（官方原数组按谱面时间穿插 `System`/`Long`，本就不保证「已按导出键排序」）。

内容层丢失与 11 份快照不同，是**真实发生**的：

| 丢失/变形 | 证据 | 当前代码 |
| --- | --- | --- |
| `System` 整条消失 | 159 张官方 / 620 对象 | convert 无 `case "System"`；导出 `break` |
| `charge` 消失 | 158 张官方 | convert 只抄 `beat/lane/flick/skill/hidden` |
| `Long` → 导出 `Slide` | 158 张 / 6299 条 | 校验当 Slide 别名；序列化固定写 `"Slide"` |
| 未知字段（若再出现） | 本语料除 `charge`/`System` 外没有 | 同样不会被抄回 |

社区通过闸门的 544 张：标准字段值可往返；顺序仍会按 beat 重排。这与样本快照里 `150030`/`220693` 的观察同类，只是官方 API 谱让「字段丢失」从假想变成默认路径。

另存为 / 工程文档今天仍以内部 `notes` 为真相（`exportChartCodeSaveAs(notes)`、`ChartProject.doc.notes`）。对这 794 张意味着：只要走当前 Apply，官方谱会先被拒；若将来放行而不做源数据层，Apply 成功也会丢掉 System/charge。

## 4. 真实出现 vs 仅合成

对照 11 份快照的分类表，**加粗行是本次被推翻或升级的项**。

| 配置 | 本语料 | 当前行为 | 分类 |
| --- | --- | --- | --- |
| **`type: "System"`** | **159/159 官方，620 条** | 整份拒绝；convert 丢对象 | **真实且当前阻塞（官方默认）** |
| **`charge: true`** | **158 官方，4690 处** | 校验忽略；convert/export 丢失 | **真实且当前丢失** |
| **`type: "Long"`** | **158 官方，6299 条** | 校验接受；导出变 `Slide` | **真实；类型身份丢失** |
| **`skill`** | **322 张，2380 处（含 Long connection）** | 转换保留 | **真实且已通过纯逻辑** |
| connection lane 越界 | 143 张，8791 个，全 hidden，`-0.5..6.5` | `checkLane` 整份拒绝 | **真实且当前阻塞** |
| lane 小数（轨道内） | 1,946,517 个 | 有限 `0..6` 小数可通过 | **真实且已通过纯逻辑** |
| **Directional width 4–7** | **`Official/786_SP.json` 24 个** | `1..3` 拒绝 | **真实且当前阻塞（单曲）** |
| **单 connection Slide** | **`Official/786_SP.json` 52 条** | issue 106 已放行 | **真实；画布按单键投影** |
| 同拍 connections | 11,540 条 Slide / 176,035 组 | 稳定排序保数组序 | **真实且已覆盖纯函数** |
| 非单调 connection | 2 条，幅度极小 / 浮点 | 校验放行；显示层会排序 | **真实但极稀；仍建议合成大倒序** |
| 负 BPM | 44 张，1543 条，`-1000..15000` | 边界合法则放行 | **真实且当前已支持** |
| 顶层越界 lane | 0 | 合成仍会被拒 | 仅合成边界 |
| 可见 connection 越界 | 0 | 同 `checkLane` | 仅合成边界 |
| hidden 首尾 / 空 Slide | 0（单点条不算首尾 hidden） | 106 口径放行 | 仅合成边界 |
| 负 beat | 0 | 校验放行；画布未投影到 beat0 | 仅合成边界 |
| `direction: "Other"` | 0 | 当前拒绝 | 仅合成边界 |
| `bpm = 0` / 末条负 BPM / beat0 负 BPM | 0 | 继续拒绝 / 边界拒绝 | 仅合成；ADR-0010 硬边界不变 |
| 显式 `false` | 0 | truthy 序列化会丢 | 仅合成边界 |
| 完全未知 `type` 字符串 | 0（`System` 已是已知 Bestdori 类型） | 与 System 同一 `default` | 合成仍要覆盖真正的生僻 type |

11 份快照仍然有用：Expert 非 SP、`HOHSSP` 越界、`150030` 负 BPM+超大 Slide。它们是本 SPECIAL 语料的**补集**，不是被取代。

## 5. 对 issue 153 / ADR-0014 的范围建议

ADR-0014 的两层模型和 opaque `System` **没有被推翻**，但实现顺序应按真实阻塞排序：

1. **P0 官方能打开：** 合法 JSON 中的 `System` 进入源数据、不渲染、Apply 不因它整份失败；工程重载/另存为保留 `data`/`beat`。没有这一步，159 张官方 SP 一张都进不了编辑器。
2. **P0 hidden OOB lane：** 143 张真实阻塞；投影到轨道外 X；拖拽再落入 `0..6`。范围至少覆盖 `-0.5..6.5`。
3. **P0 `charge` 保真：** 官方 Fever 段大量 `charge: true`；一对一操作保留，形态变化操作可按 ADR 丢弃。
4. **P1 `Long` 身份：** 画布按 Slide 投影，不放置 Long。无形态变化往返必须保留 `"Long"`；形态变化（加结点/拆条/合并/弯/SP）重建为 Slide。不要把直 hold 的 Slide 自动改成 Long。
5. **P1 `Official/786_SP.json`：** 同时覆盖 width 4–7、单点 Slide、System、charge。建议作为官方阻塞验收夹具，比再合成 `width=4.25` 更贴近真实（真实 width 目前都是整数；小数 width 仍要合成）。
6. **P1 规模：** 社区 CityTing 4 万+ connections、beat 到 48205、BPM ±1000/15000。现有 `ChartCodeScale` / 负 BPM 单测的数量级不够。
7. **仍合成：** `beat<0`、顶层 OOB、可见 OOB、`direction:"Other"`、width 小数/负值、空/首尾 hidden、真正大幅非单调、完全生僻 type、显式 false。**不要**因为语料未出现就从 153 删掉。
8. **上传清洗不在 153：** Bestdori 社区 `sanitizeAll`（丢 System、剥 charge）是未来上传票；Apply/工程/另存为走源数据保真。

不建议改 ADR 决策正文。建议在 ADR-0014 末尾挂本报告为证据，并给 153 实现票（若另拆）把上述 P0 列为阻塞验收，而不是只测 11 份社区风样本。

Fixture / manifest：

- 不可变源：`docs/resource/StressTestChart/index.json`（794 条 path/url/sha256/bytes）。
- 实现后最低回归不必跑 794 张 UI，但至少要锁：任意 1 张官方（含 System+Long+charge）、`Official/689_SP.json`、`Official/786_SP.json`、1 张社区 OOB、1 张高连接数社区谱；11 份 SampleChartCode 继续作 Expert/`150030` 补集。
- 不要把线上接口当 CI fixture。

## 6. 未做与 154 收口

`[建议后续实测]` 仍包括：代码弹窗 Apply 时序、工程保存/重载、Electron 另存为字节、画布像素与命中、`150030`/4 万连接的交互卡顿。这些是 **153 实现的验收**，不是「还不知道真实谱面长什么样」。

**判断：154 可以 resolved；153 解除 Blocked by 154。** 依据是 794 张已有可复核的盘点、拒绝路径（文件 + 字段 + `validateChartCode` 入口）和「真实 vs 合成」分类；11 份快照作为 Expert/负 BPM 补集保留，不再当作官方格式的代表。
