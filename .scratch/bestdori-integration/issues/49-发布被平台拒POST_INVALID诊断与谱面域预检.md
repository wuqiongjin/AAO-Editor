# 49 · 发布被平台拒（POST_INVALID）：Directional width 域外值未拦截 + 诊断缺载荷信息

Type: bug  
Status: resolved  
Blocked by: —

## 来源

用户 2026-10-22 实测发布（官方曲 268「One Extra Large! Garupa☆Pico」，bandori 渠道，diff 0 / level 1，  
自制测试谱 59 对象）报错：

```
2026-10-22T15:17:34.813Z ERROR [community] 平台拒绝了请求（POST_INVALID） {"kind":"invalid-response","httpStatus":200,"platformCode":"POST_INVALID"}
```

## 根因（用户 2026-10-22 实锤）

**Directional 的 `width` 超出平台值域**。测试谱 57 个 Directional 全部 `width: 5`（lane 到 5，  
超 0..6 边界）；用户把 width 改回合法值后发布成功。

调查过程（离线复现 + 在野对照，未发写请求，详见 Comments）排除了清洗 / 体积 / 小数 lane / br 块，  
最后锁定 width。平台值域现状认知：

- 官方谱实测（413 SP）width 只出现 **1 / 2 / 3**；本仓 `src/chart/types.ts` 注释也是「组合长度 (1-3)」，  
  键音分档（`KeySound`）只做了 1..3 档；
- 用户实测：**width 5 → `POST_INVALID`，合法值 → 通过**（2026-10-22）。

## 症状背后的两个缺陷

1. **发布链路不拦谱面域外值**：width 5 是外部粘进来的（编辑器画布只会画 1..3），  
   `precheckPublish` 只查字段填没填、不查谱面内容域，域外值一路走到 POST，  
   被平台用粗错误码拒掉，界面文案还不指因（口径如此），用户拿到零可行动信息。
2. **诊断缺载荷信息**：trail 只记 `upload-start` / `upload-end`，不带任何载荷统计，  
   事后只能像本票这样离线复现载荷逐项排除。

## 用户诉求与反馈（2026-10-23，**提出想法，未定案**）

平台错误码不指因、不可依赖 → 自己做内部拦截（以下为**本轮实现口径（待验收）**，落地后由用户验）：

1. **最终上传前先跑内部校验，过了才发**（custom 渠道尤其重要：流程是  
   上传音频/封面 → 发帖，校验必须卡在**上传之前**，否则白传一次音频；bandori 渠道无上传，  
   校验不过 = 一个字节的网络都不发）。
2. **内部校验要能点名具体原因**（哪条音符、哪个字段、期望值），失败不发请求。
3. **谱面代码弹窗给 WARNING**；**发布弹窗点发布时是报错（硬拦）**。
4. **工程详情页不标**（无落点）、**画布不给提示**（width 这类值本来就不可能直接在画布上放置，  
   只能改代码改出来）。

对 Q 的回答（用户 2026-10-23）：

- **width 值域 = 1..3**，4 也不行（不用再为 4 留口子）。
- **lane 不进规则集**（先别管）—— 见下方在野证据，社区谱确实带越界 lane。

## 现状事实（架构 + 在野证据，2026-10-23 查证）

- `validateChartCode` 的 `ValidationError[]` 是「**errors 非空即拒**」模型：导入 / 应用 /  
  对象视图 Apply 全靠它，往这里塞警告会把合法谱面挡在门外 → **警告必须另起通道**（如  
  `ValidationResult.warnings`），不得复用 `errors`。
- `width` 目前**完全没有校验**；`lane` 只查「有限数字」、**越界放行**（ADR-0014）。
- `precheckPublish` 只查字段填没填 + 谱面非空，不查谱面内容域。
- `publishChart` 顺序：预检 → sanitize →（custom）上传音频/封面 → 发帖 → 写记录。
- **lane 越界的在野证据（社区谱，2026-09-24 压力测试，794 张 SPECIAL）**：  
  143 张社区谱含 8791 个越界 lane，范围 `-0.5..6.5`，**全是 hidden connection**（顶层 0、可见 0）。  
  这些谱面都在社区上发布着 → **平台接受越界 lane**，规则集不收 lane。（来源  
  `docs/research/chart-compatibility-stress-test.md`；注意：官方谱与社区谱不同口径，本票只认社区证据。）

## 已定（用户 2026-10-23）

- **Q1 width 规则**：硬拦 `∉ 1..3`（用户答 4 也不行）；点名到音符 + 字段 + 期望值。
- **Q3 硬拦呈现**：`PublishFailure` **扩一档 `chart-invalid`，带明细列表**（可列多条、点名到音符），  
  不并入 `missing` 的 `chart` 档只说一句（用户同意推荐）。

## 清单本身的口径（不是待拍板项）

这张票要建的**就是**这张「平台收什么、不收什么」的规则清单，本轮往里放**一条**：
Directional `width` 必须是 1 / 2 / 3。其余候选（`direction` 值域、Slide 结点数、BPM 值域）
**没有证据可判**，既不在本轮清单里，也不拿来问——等真被平台拒了或有在野社区语料证据，
按同一份机制往里加一条。

进清单的判据写死在机制里、不靠猜：**要么有实测（真发帖撞到），要么有在野证据（已发布社区谱里出现过该值）**。
lane 是现成的反例：差点被写进清单，结果已发布社区谱 143 张都带越界 lane，平台是收的——
没证据就拦，只会误伤能发的谱面。

## 实现落点

- 规则函数（纯函数，复用给「发布硬拦」与「代码警告」两条通道，口径只此一份）。
- `src/community/bestdori/publish.ts`：`precheckPublish` 接入规则（在上传之前）。
- `src/chart/editing/ChartConverter.ts`：`ValidationResult` 加 `warnings`；  
  `ChartCodeEditorModal` 渲染警告区块。
- `publishChart` 发帖前 trail 记载荷统计 meta（对象分桶 / 字节数 / song 形态 / diff / level /  
  content 块数 / width 分布）；不记请求体原文（凭据红线同口径：只记统计不记内容）。

## 锁测（落实现票时展开）

- `precheckPublish` 域外 width 用例（点名到音符）；`publishChart` 校验不过时不发请求  
  （含 custom 渠道「未上传音频」断言）；`validateChartCode` warnings 与 errors 分道  
  （width 5 只出警告、不拒导入/应用）；trail meta 断言。

## Comments

### 2026-10-22 · 调查记录（根因实锤前）

- 离线复现：读本机工程 JSON → `convertNotesToChartCode` + `sanitizeChartForBestdoriUpload`，  
  得 59 对象 / 26.8KB / 键集合干净（`beat,bpm,connections,direction,lane,type,width`）。
- 排除项（在野证据）：谱面未清洗（管道已剥）；体积（通过样本 43KB）；小数 lane / beat  
  （原帖 [68871](https://bestdori.com/community/charts/68871) 同曲在线，946 处小数 beat）；  
  content br 块（真实帖子列表响应里就有）。
- 本机无任何成功上传记录 → 非回归，是发布链路第一次真机实测。

### 2026-10-22 · 用户实锤

用户把 Directional width 改成合法值后发布成功，根因定案为 width 域外。Q「实锤实验怎么做」  
已消（用户自测完成）；本票转为按「修法」节的 Q1–Q3 落实现。

### 2026-10-24 · 落地记录

**规则清单**（`src/chart/editing/ChartDomainRules.ts`，纯函数 `checkChartDomainRules`，两条通道  
复用同一份）：本轮只收一条——Directional `width` 必须是**整数** 1/2/3。整数口径的证据：语料里  
真实 width 全为整数、社区谱无 >3（4–7 只出现在官方 786_SP，stress-test 对照表）+ 用户实测  
width 5 被拒。lane 不进清单（在野反例锁定：越界 lane / direction "Other" / 单结点 Slide 零警告）。  
清单判据（实测或在野证据）写在模块头，后续加规则按同一份机制。

**发布硬拦**（`publish.ts`）：`precheckPublish` 对**清洗后**的谱面（真正发出去的那份）过清单，  
结果放新字段 `chartIssues`——与 `ok` / `missing` **分道**（弹窗按钮不因警告禁用，用户口径  
「点发布时报错硬拦」）。`publishChart` 在任何网络之前（custom 含上传音频）先查  
`chartIssues` → `PublishFailure` 新档 **`chart-invalid`**（带明细列表，可列多条、点名到音符；  
`missing-fields` 让位）。弹窗（`PublishDialog`）失败区渲染明细 `ul`（前 8 条 + 「另有 N 处」，  
复用 `formatValidationError`）。

**代码警告**（弹窗 WARNING，不硬拦）：`ValidationResult` 加 `warnings`（复用 `ValidationError`  
结构、语义分道——「errors 非空即拒」的闸门不看它）；`validateChartCode` 对已被 errors 点名的  
同处去重；`parseCodeText` / `validateNoteViewCodeText`（返回形状 `{errors, warnings}`）透传；  
`ChartCodeEditorModal` 完整视图与对象视图都渲染警告区块（warning 色系，前 8 条折叠，  
应用可用性只看 errors——width 5 只警告、不拒导入/应用）。工程详情页未标、画布未提示（按口径）。

**诊断载荷统计**（trail）：`publishChart` 发帖前记 `post-payload` 事件，meta =  
`bytes / chartBytes / objects`（type 分桶）/ `widths`（width 分布——票 49 根因一眼可见）/  
`song / diff / level / contentBlocks`；**不记请求体原文**（凭据红线同口径；锁测把 meta 键锁死）。

**锁测**（全绿）：

- `tests/unit/chart/code/ChartDomainRules.test.ts`（新）：值域 1..3 与整数口径逐条点名；  
  lane / direction 变体 / 单结点 Slide **不误伤**；Slide 结点无 width 不误报；脏输入不抛。
- `publish.test.ts`：width 5 → `chart-invalid` 带明细且**零网络**（custom 连音频都不传、  
  bandori 不发帖）；谱面域先于缺字段；`ok` 不含警告（按钮不禁用）；trail meta 锁键  
  （bandori + custom 两渠道）。
- `ChartCodeValidation.test.ts` / `ParseCodeText.test.ts` / `NoteCodeOps.test.ts` /  
  `ChartConverter.test.ts`：warnings 与 errors 分道（width 5 `valid` 仍 true、应用放行）、  
  去重、透传、对象视图整条 Directional 警告。
- `tests/static/PublishEntryWiring.test.ts`：`chart-invalid` 档 + 明细渲染 +  
  `chartIssues` 与 `ok` 分道的接线断言。

全量 `npx vitest run`：3598 条，除 `RendererPerf`（perf 计时器在满载并行下的既有偶发，  
单跑通过、与本国面无关）外全绿；`tsc -b` 干净（`test:types` 的存量错误在 Shortcut / Preview  
等域，HEAD 上即有）。

### 2026-10-24 · 评审回修（code-review 两轴，提交前处理）

- **Spec·硬拦明细序号改按用户坐标**（评审实锤，最重要一处）：`precheckPublish` 原对**清洗后**  
  数组跑规则，sanitize 丢 System 会使「音符 N」与用户谱面代码位置错位、且与代码弹窗警告  
  不同坐标。改为对**原始** `input.chartCode` 跑（sanitize 只丢 System/未知 type、不碰  
  Directional，点名结果等价）；新增锁测：System 在前时 `noteIndex` 必须落在原始坐标（3 非 2）。
- **Spec·载荷统计字节数**：`bytes / chartBytes` 原 `string.length`（UTF-16 码元数，含中文低估），  
  改 `TextEncoder` 记 UTF-8 字节（新增 `utf8ByteLength`）。
- **Standards·证据口径**：规则清单头注释「已发布社区谱 143 张」改为准确口径——**社区 91 张**  
  （语料合计 143 = 社区 91 + 官方 52，官方在 System 之外叠加 lane 错误，研究文档原文）。  
  本票「现状事实」节的「143 张社区谱」系当初转述失真，规则判据以社区 91 张为准；平台接受  
  越界 lane 的证据（已发布社区谱存在）不受影响。
- **Standards·map.md 记账粒度**：删「锁测全绿」流水账（map 只做决策索引）。
- **Standards·CSS**：`.pp-publish__issues` 与 `.pp-publish__missing-box ul` 的四条共享声明  
  合并选择器（沿同文件 `.ppc-fact__plain, .ppc-miss` 先例）。
- **评审后不修**（判断题，留票）：三处「前 N 条折叠」同形 JSX 与 `MAX_VISIBLE = 8` 常量  
  （跨文件提取的耦合 > 去重收益）；`countChartObjects` / `directionalWidthDistribution` 的  
  tally 形状合并（两个具名函数比参数化可读）；`warnings` / `chartIssues` 双名（spec 要求  
  分道，各自语境注释已说明）。

回修后：publish + chart/code + PublishEntryWiring 相关 213 条全绿，`tsc -b` 干净。

**真机待验（单测覆盖不到）**：

1. 粘一份带 `width: 5` 的谱面代码 → 弹窗出现黄色警告区块（点名音符与期望值），应用照常成功。
2. 该谱面点发布 → 确认后发布弹窗红字「谱面包含平台不接受的值…」+ 明细列表，网络面板无任何请求。
3. 改回合法值 → 发布走通；trail（诊断包）里有 `post-payload` 一条，widths 分布可见。

### 2026-10-24 · 验收回修（用户口径：告警去平台化）

用户验收四条（附截图）：

1. 弹窗标题「平台值域警告」起名抽象——未来加非值域告警还得改名 → 改通用 **「警告（共 N 处）」**（`chartCode.warningsTitle`）。
2. 提示行「这些问题不阻止编辑与应用，但发布到社区时会被平台拒绝…」纯啰嗦——用户不看也记不住，发布被拒自然知道 → **整行删**（`chartCode.warningsHint` 删除）。
3. 明细行啰嗦（平台括号 +「期望：1-3」与 reason 重复）→ 复用 errors 通道同字段既有文案（`validate.widthRange`「方向滑键音符 width 必须在 1-3 范围内」），去掉平台括号，**不设 expected**（`validate.widthDomain` 删除）。
4. 发布弹窗报错同样去平台 → 改 **「谱面包含不合法的值，未能发布，明细如下：」**（`projects.publish.err.chartInvalid`，zh/en 同步）——软件自己拦的，不替平台代言。

**架构定案**：谱面代码编辑器 / chart 域不出现「平台」概念——width 1..3 本就是编辑器自己的域模型事实（`types.ts`「组合长度 (1-3)」、画布只产 1..3、键音分档 1..3）；平台证据只留在发布链路（`publish.ts`，社区域）与本票记录里。`ChartDomainRules` 头注释重写为谱面域口径（扩充判据「实测或在野证据」保留为维护者口径）。锁测加守卫：图域规则 reason 不得含「平台/社区/发布」，且 expected 恒缺省。

并发说明：本轮与票 50 会话并行——其 `feat(bestdori-integration-50)`（ddfc687）基于本票提交（e04a2f4）落地，PublishDialog 告警区块 / 重试已把 `chart-invalid` 整合进新 UI（retryable 集合正确排除确定性拦截）；本轮去平台化改动叠于其上，暂未提交（避免与对方 amend 竞态）。回修后 chart/code + publish + static 共 746 条全绿，`tsc -b` 干净；全量仅剩并行满载下的计时型 flake（perf 比例 / dom，单跑稳定通过）。

### 2026-10-24 · 验收追问：警告常驻（打开即显示，不等编辑）

用户实测：打开弹窗不显示警告，随手编辑一下才冒出来。根因在打开路径——两段式填充  
（issue 102）的 `resetDraft` 只重置校验状态、不跑校验，第一次校验挂在输入防抖之后。  
定案（用户口径「让它一直常驻」）：**打开即校验一次**——`regenerateDraft` 的空闲回调  
在 `resetDraft` 之后补一次 `validateCode(text)`，与两段式同相（不占首帧，不动「打开  
不同步跑全量重活」的静态锁 `ChartCodeModalResponsiveness`）；完整视图与对象视图一致  
（整条 Directional 的 width 5 打开即点名）。代价 = 每次打开多付一次 `parseCodeText`  
（与敲一个字的防抖校验同量级）；「用画布刷新」同路径自动带上。画布投影本就应是合法  
谱面，这次校验的增量主要是 warnings（外部粘进来的域外值，画布自己产不出来）。

### 2026-10-24 · 验收追问 2：谱面文本优先，告警不占加载关键路径

用户指出加载时间敏感：警告校验不能挡谱面文本上屏。**首轮实现没考虑这个**——校验与文本落在  
同一个 `startTransition` 里，解析挡在关键路径上。已改：填充 transition 只落文本；打开校验改挂  
既有防抖任务（`validationTask.schedule(() => validateCode(text))`）——文本先上屏、约 250ms 后  
警告补跑；用户立即开始打字时，待跑的打开校验被编辑校验自动替换（DebouncedTask 连发折叠语义），  
取消仍归 `regenerateDraft` 开头的 `cancel` 与卸载清理。

报错展示形态的未来整改（不完整展示、状态图标化）＝ basic-editor 票 [107](../../basic-editor/issues/107-非单调点序规范化.md)  
（谱面状态图标三态 + 报错区整块搬迁进明细弹窗）；本票的 warnings 通道是其「软告警」清单的候选软项，  
已在该票挂交叉引用。
