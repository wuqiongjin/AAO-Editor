# 62 · 社区谱面缺少 beat 0 BPM 被导入闸门误拒

Type: grilling
Status: resolved
Blocked by: —

## 来源与诉求

用户 2026-11-27 反馈：社区谱面 #263678 无法导入，报错「社区谱面代码过不了 Apply 闸门：谱面代码：谱面必须包含第 0 拍的 BPM 音符，无法应用」。要求先分析根因，并调查是否还有其他类似问题。

## 症状

- 新建工程 → 从社区谱面导入 `#263678`（カーネーションの咲く日に / SPECIAL / level 29），勾选默认的「同步导入谱面」时整笔失败；按社区导入设计，音频与封面一并不会建。
- 报错来自 `chartCode.needBpm0`，不是网络、素材或 JSON 解析错误。应用闸门在 `parseCodeText` 结构校验通过后才做这条判断，因此该谱面除 beat 0 BPM 外没有其它结构错误。

## 根因

1. **数据事实**：`#263678` 的 `post.chart` 里没有 `beat === 0` 的 BPM，只有 `{"bpm":165,"beat":1,"type":"BPM"}` 与 `{"bpm":150,"beat":2,"type":"BPM"}`（数组顺序 150 在前）。`toPostDetail` 将帖子 chart 原样 `JSON.stringify` 后交给 Apply，未做删改。
2. **闸门事实**：`src/chart/editing/ChartConverter.ts` 的 `hasBeat0Bpm` 只认 `beat === 0`；`src/project/projectCatalog.ts` 的 `applyChartCodeText` 在结构校验通过后额外执行它，失败即整份拒绝。
3. **规则来源**：这条规则是编辑器保底，不是外部格式要求——ADR-0008 §5「beat 0 的 BPM 线不可删除」+ basic-editor issue 08「应用时强制校验」。但 ADR-0014 §1.2 定义的 Apply 闸门硬拒绝清单里**没有**「缺少 beat 0 BPM」。官方导入与社区导入复用 `applyChartCodeText` 这个唯一入口后，编辑器内部规则被外溢到外部谱面导入。
4. **为什么没早发现**：现有压力测试语料 794 张（159 官方 SPECIAL + 24 位指定谱师、SPECIAL、level>30 的社区 635）全部含 beat 0 BPM；`#263678` 是 level 29，作者不在语料名单，正好落在抽样盲区。语料不能代表全社区。
5. **平台侧事实**：Bestdori 的 `sanitizeAll` 清洗清单没有「必须有 beat 0 BPM」，该帖已发布且 Sonolus 有对应 level，说明这是平台允许的合法数据。

## 内部能力现状（不是不能支持）

- `src/audio/AudioTiming.ts` 的 `getBpmEvents`：首拍缺省时补默认 120；统计与静态预览沿用同一口径。
- `src/chart/editing/NoteCodeOps.ts` 的 `hasBeat0BpmNote`：局部编辑只防止「原本有的第 0 拍 BPM 被删掉」，对原本没有的谱面不追究。
- 画布、发布、导出链路未发现「必须有 beat 0 BPM 音符」的硬假设；修复时需再全量核对一遍。

## 已拍板（2026-11-27，用户逐轮确认）

**Q1 = A1 · 导入口径与作用面**

- `applyChartCodeText` 不再要求 beat 0 BPM；所有“代码文本 → 谱面”入口（官方/社区导入、新增谱面粘贴）同口径。
- 编辑器保留“不能删掉已有 beat 0 BPM”的防丢失规则（见 Q3）。

**Q2 = B2 · 首条 BPM 之前的时间口径**

- 以首条 BPM（最小 beat）为时间原点：`time(首条 BPM) = 0`；之后按 BPM 段累加。
- 首条 BPM 之前的音符按首条 BPM 向前外推，得到负秒；**不夹到 0、不改 beat 数据**。与 Sonolus 实际一致（玩家从 0s 开始，负秒音符不可见且会扣血）。Bestdori 网页模拟器把这段夹到 0，两平台不一致，我们跟 Sonolus。
- 完全没有 BPM 时，时间换算仍按 `120@beat 0` 兜底；但按 Q2b，导入/Apply 会先拒绝“无 BPM”的谱面（legacy 工程仍可兜底）。
- 同步所有 120 回退点：`AudioTiming.getBpmEvents`、`ChartStats.bpmEventsOf`、`PasteBpmDecision.effectiveBpmAt`、`PreviewPage` / `sheetHeader` 的 BPM 展示。**推翻 issue 186 的“首条 BPM 之前按 DEFAULT_BPM”假定**，相关锁测一起改。

**Q2b = B + scope A · 至少一条 BPM**

- 谱面必须至少有一条 BPM（位置不限，可负拍）；不要求 beat 0。
- 强制执行面：官方/社区导入、`applyChartCodeText`、新增谱面粘贴（无 BPM → 拒绝）；完整代码编辑器与画布删除不阻断，改为「缺 BPM 就补 / 重置出 `DEFAULT_BPM`」。
- 错误文案：`chartCode.needBpm`（无 BPM）与 `chartCode.emptyChart`（空 `[]`）分开；`needBpm0` 已废除（2026-11-27 修正）。

**Q3 = C1 · 导入后完整代码编辑器二次 Apply（2026-11-27 已被下方修正推翻）**

- 原本有 beat 0 BPM，代码删掉 → 仍拒绝（`needBpm0`）。
- 原本没有 beat 0 BPM、代码非空且至少一条 BPM → 允许应用，不注入、不补 beat 0。

**Q3 修正（2026-11-27，用户重新对齐）**

- beat 0 不再特殊：**允许删除 beat 0**；删掉后时间原点自动变成剩余 BPM 中 beat 最小的那条。
- 编辑器唯一的硬要求 = 应用后**至少一条 BPM**。若一条都没有（含空文本 / `[]` / 只删了唯一一条），**强制插入** `beat 0, bpm = 120` 再应用并刷新代码；不再弹 `needBpm` / `needBpm0` 拒绝。
- 外部来源（导入 / 新增谱面）不变：`[]` → `emptyChart`、非空无 BPM → `needBpm`。

**Q4 = D1 + Q4b**

- 官方/社区导入的 `[]` 仍拒绝，改用 `chartCode.emptyChart`。
- 完整代码编辑器：空文本 / `[]` / 非空但无 BPM，点击应用都强制插入默认 BPM（`120@0`）并刷新代码；这是显式“清空 = 重置”，不算擅自补 beat 0。
- 新增谱面粘贴 `[]` 与空文本同义：建默认 BPM 空谱。

**Q5 = E1**

- 本 issue 只修 #263678 的闸门 + Q2 时间口径 + 回归；语料盘点**暂不建研究 issue**，范围最后与用户确认（用户倾向 `level > 30`），不阻塞本票。

## 实现落点

- `src/project/projectCatalog.ts`：`applyChartCodeText` 去掉 beat0 校验；新增 BPM 校验；`[]` 返回 empty 标记 / 默认空谱；`createOfficialProject` 增加 `chartProvided` 并在“来源给了谱面但解析为空”时拒绝；`addChartToProject` 的 `[]` 落默认空谱。
- `src/chart/editing/ChartConverter.ts`：新增 `hasBpm` / `hasAnyBpmNote`（与 `hasBeat0Bpm` / `hasBeat0BpmNote` 同层）。
- `src/pages/projects/chartImport.ts`：传入 `chartProvided = chart != null && !chart.degraded`。
- `src/chart/components/code-editor/ChartCodeEditorModal.tsx`：beat 0 可删；应用后无 BPM（含空 / `[]`）→ 强制插入默认 `120@0` 并刷新文本；不再有 BPM 阻断提示。
- `src/audio/AudioTiming.ts`：`getBpmEvents` 只在完全无 BPM 时补 `120@0`；有 BPM 时首条 BPM 即原点。
- `src/chart/analysis/ChartStats.ts`：`bpmEventsOf` 同步。
- `src/chart/patterns/PasteBpmDecision.ts`：首条 BPM 之前返回首条 BPM（无 BPM 才 120）。
- 画布 / 音符代码：beat 0 不再特殊（有其它 BPM 时直接删）；`SelectionEditing` 删除最后一条 BPM → 重置 `DEFAULT_BPM`；`NoteCodeOps.applyNoteCode` 的最后 BPM 防丢失。
- i18n：新增 `chartCode.emptyChart`、`chartCode.needBpm`（zh-CN / en）。

## 锁测

- `tests/unit/project/CommunityImport.test.ts`：#263678 真实载荷（`165@1` / `150@2`，数组顺序 150 在前）导入成功、notes 保留、`chartCodePristine=true`、源文本不改写；`[]` → `emptyChart`；非空无 BPM → `needBpm`；仅负拍 BPM → 成功。
- `tests/unit/project/projectCatalog.test.ts`：`applyChartCodeText` 接受无 beat0 但有 BPM；`[]` → 默认空谱（addChart）/ empty 标记；无 BPM 拒绝；`createOfficialProject` 的 `chartProvided` 空谱拒绝。
- `tests/unit/audio/AudioTiming.test.ts`：首条 BPM > 0 → 不补 120，`time(首条)=0`；无 BPM → `120@0`；负首拍；同拍多值（后者生效）。
- `tests/unit/chart/geometry/BpmTimeline.test.ts`：删掉“首事件不在 0 拍补 120”的旧断言，改为首事件即原点。
- `tests/unit/patterns/PasteBpmDecision.test.ts` 与 `tests/unit/chart/editing/PatternPaste.test.ts`：首条 BPM 之前取首条 BPM，不再是 `DEFAULT_BPM`。
- 代码编辑器：空 / `[]` / 非空无 BPM → 插入默认 `120@0`（注入标记 + 文本刷新）；删 beat 0 且还有其它 BPM → 允许；删光所有 BPM → 插入默认。
- 画布删除：删 beat 0（还有其它 BPM）→ 直接删；删最后一条 BPM → 重置 `DEFAULT_BPM`；`applyNoteCode` 最后 BPM 防丢失。
- 静态：`tests/static/NoWindowAlert.test.ts` 若新增 toast 调用需同步计数；`ChartCodeParseOnce` 保持。

## Comments

### 2026-11-27 调查记录

- 真实数据取自 `https://bestdori.com/api/post/details?id=263678`：`diff=4, level=29`；BPM 仅 `beat 1 = 165`、`beat 2 = 150`，无 `beat 0`。
- 压力测试语料与覆盖口径见 `docs/research/chart-compatibility-stress-test.md`、`scripts/fetch-stress-test-charts.mjs`（24 位指定谱师 + SPECIAL + level>30）。
- 本次未改代码。
- 建议下一步：先扩语料盘点 level≤30 社区帖的「缺 beat 0」比例，再按 Q1–Q4 拍板。

### 2026-11-27 拍板与补充证据

- **Q2 实测**：Bestdori 网页模拟器 `ToolChartSimulator` 的 `timings` 以首条 BPM 为时间原点（首条 BPM 的 `time = 0`）；对 #263678，旧 120 口径与平台差 **0.5s**（不是 64–136ms）。
- **Q2b 证据**：Bestdori 编辑器在 timings 为空时会自动补 `{type:"BPM",bpm:bpmBpm||120,beat:0}`（`CommunityChartsNew` bundle），支持“至少一条 BPM”的数据不变量。
- **Q2a 口径**：Sonolus 实际玩家从 0s 开始，负秒音符不可见且会直接扣血；因此首条 BPM 之前的音符保留负秒，不夹 0。Bestdori 网页模拟器夹 0，两平台在此不一致，本票跟 Sonolus。
- **Q4 证据**：Bestdori 发表前端只校验 `userChart` 数组非空（`CHART_INVALID`）；`sanitizeAll` 不补 beat0。空谱面在有效社区帖中不应存在，导入继续拒绝。
- **服务端保留项**：`POST /api/post` 是否另有“无 BPM”校验未实测；“至少一条 BPM”按本地数据有效性规则执行（Q2b=B）。
- 已按 Q1=A1 / Q2=B2 / Q2a=A / Q2b=B+scopeA / Q3=C1 / Q4=D1+Q4b / Q5=E1 开始实现。

## Answer

已按拍板全部实现（2026-11-27）。

**导入 / 新增谱面**

- `src/project/projectCatalog.ts`：`applyChartCodeText` 去掉 `hasBeat0Bpm`，改为 `hasBpm`（至少一条，位置不限）；空文本 / `[]` 返回 `empty` 标记 + 默认空谱；`createOfficialProject` 对 `chartProvided && empty` 拒绝 `chartCode.emptyChart`；`addChartToProject` 的 `[]` 落默认空谱。
- `src/pages/projects/chartImport.ts`：传 `chartProvided = chart != null && !chart.degraded`。
- `#263678` 真实载荷（`150@2` 在前、`165@1` 在后）导入成功，源文本保真（`chartCodePristine = true`）。

**时间口径（首条 BPM = 原点）**

- `AudioTiming.getBpmEvents`：只在完全无 BPM 时兜底 `120@0`；有 BPM 时首条即 `time = 0`，之前外推负秒、不夹 0。
- 同步 `ChartStats.bpmEventsOf`、`BpmPredecessor.indexOfFirstBpm`、`PasteBpmDecision.effectiveBpmAt` / `buildPatternPastePayload`；BPM 展示（Preview / sheetHeader / 视频导出）全部经 `getBpmEvents`，无第二套回退。

**编辑器 / 画布**

- `ChartConverter` 新增 `hasBpm` / `hasAnyBpmNote` / `defaultChartCode` / `ensureChartCodeBpm`（完整代码应用前的 BPM 保底：有 BPM 原样应用；一条都没有 → 插入 `120@0` 并标记 `injected`）。
- `ChartCodeEditorModal`：允许删 beat 0；应用时按 `ensureChartCodeBpm` 保底，`injected` 时把代码文本刷新成实际应用的谱面（空文本 / `[]` / 非空无 BPM 同一路），不再有 BPM 阻断提示。
- `SelectionEditing.deleteSelection`：beat 0 不再特殊，有其它 BPM 时直接删；删最后一条 BPM → 重置 `120@0`。
- `NoteCodeOps.applyNoteCode`：删 beat 0 允许；仅当编辑会让谱面失去最后一条 BPM → `noteCode.lostBpm` 拒绝回写。
- ADR-0008 §5 / ADR-0014 §1.2 已同步口径。

**验证**

- 新增 / 更新锁测：`ChartConverter`（`ensureChartCodeBpm`：空 / 无 beat0 / 删 beat0 / 无 BPM 注入）、`SelectionEditing`（beat0 直删、最后一条重置）、`NoteCodeOps`（beat0 可删、最后一条 `lostBpm`）、`ToolActionMatrix`、`ChartImport` / `OfficialImport`、静态接线（`ChartCodeParseOnce` / `NoWindowAlert` / `ChartCodeNoteViewApplyToast`）。
- 全量 `npx vitest run`：478 文件 / 5479 用例全部通过；`npx tsc -b` 通过。`npm run test:types` 仍报与本次无关的既有测试类型错误（`SlideBandGeometry` / `NoteSkin` / `ShortcutIndexFilter` 等，未触碰）。
- 语料盘点（Q5）：暂不建研究票；范围最后与用户确认（用户倾向 `level > 30`），不阻塞本票。

### 审查修复（2026-11-27，code-review 两轴）

- **needBpm0 优先**：`decideChartCodeApply` 把“原有 beat 0 被删”提到“无 BPM”之前，符合 Q3 字面（原有 beat 0、代码删光 → `needBpm0`；原本没有 → `needBpm`），单测同步。
- **ADR 同步**：ADR-0023 §1 去掉“谱面必有 beat 0”，补“落点前无 BPM 取首条”；ADR-0010 关键事实与状态行补“时间原点 = 首条 BPM”；ADR-0014 §1.2 把空代码例外前置；CONTEXT 术语表新增「时间原点」。
- **补锁测**：`CommunityImport` 首条 BPM 在负拍可导入；`AudioTiming` 负首拍（`t(首条)=0`、beat 0 为正秒）与同拍多值后者生效。
- **去重**：`SelectionEditing` 复用 `hasAnyBpmNote`；弹窗空代码文本复用 `getDefaultBPMCode()`。
- **命名**：`AppliedChartCode.empty` → `emptyInput`（避免与“谱面为空”混淆）；map 行去掉测试数字 / 文件清单，只留决策指针。

### 二次对齐（2026-11-27，推翻 Q3=C1 与 needBpm0）

- 用户指出「谱面代码编辑器本来就该支持没有 beat 0 的代码」，确认修正口径：**beat 0 不再特殊**，编辑器只保证“应用后至少一条 BPM”；缺 BPM 时强制插入 `120@0`，不阻断。
- 连带统一：画布删除 beat 0（有其它 BPM）→ 直接删；删最后一条才重置 `120@0`；音符代码删 beat 0 允许，仅保留最后一条 BPM 的 `lostBpm` 防丢失。
- 废除 `needBpm0` / `noteCode.lostBpm0` 及其 i18n 文案；`decideChartCodeApply` → `ensureChartCodeBpm`（返回 `injected` 供弹窗刷新文本）。
- 外部来源（导入 / 新增谱面）仍拒绝无 BPM；`[]` 仍拒绝（`emptyChart`）。
- 上一节「needBpm0 优先」及「保留 had-beat0」的说法已被本节推翻，以本节为准。
