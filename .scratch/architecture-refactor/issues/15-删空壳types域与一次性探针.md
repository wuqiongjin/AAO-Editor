# 15-删空壳types域与一次性探针

Type: chore
Status: resolved（2026-11-07 单提交落地；Q1–Q5 按推荐口径执行，门禁增量比对见 Comments）

> **来源**：2026-11-06 第三轮「目录结构深化评审」候选 02 / 04。
> **性质**：两件都是删除测试成立、零行为的清理；**不改目录结构、不改任何行为、不改 ADR / `CONTEXT.md`**。候选 01 + 05 另开票 16，候选 06 评审自判 Speculative「不动」，均不在本票。

## 锁测（净值网）

- 无行为变化，无需新增断言：`npm test` / `npm run test:types` / `npm run lint` / `npm run build` 四连门禁；基线引票 14 `Comments`（396 文件 / 4369 用例全绿、`npm run build` 全绿），**开工后按 HEAD 实测更正**，基线红用 `git archive HEAD` 干净副本比对增量。
- #1 唯一可能顶红的是类型门禁（`EditingProvider.tsx` 的一条 import），以 `npx tsc -b` 验证；#2 以全仓检索验证 `inbound = 0` 后删除。
- 两件互不依赖，一张票内按 #1 → #2 顺序落，可单提交（票 13 复核后的单提交先例）。

### #1 删掉 `src/types/` 空壳顶层域

- **症状**：`src/types/chart.ts`（288 B，只有 `ChartPosition`）+ `src/types/index.ts`（80 B，零消费者 barrel）独占一个顶层域，注释声称「跨 Editing/UI/画布/几何全栈复用」。
- **根因**：实测 `ChartPosition` 唯一消费者是 `src/app/providers/EditingProvider.tsx:5`，该处同时 import `src/chart/types.ts`，两条进口指向同一概念。全仓检索 `src/types` 只命中这 3 处，无静态锁引用。
- **修法**：`ChartPosition` 并进已有的 `src/chart/types.ts`，删整个 `src/types/`，改 `EditingProvider.tsx:5` 一条 import 指向 `chart/types`。注意 `chart/types.ts` 现无同名导出，不冲突。
- **Status**：已做（2026-11-07，详见 `## Answer`）。

### #2 删掉 `scripts/` 零引用一次性探针

- **症状**：`scripts/first-note-hitch-probe.mjs`（8 KB）在 `scripts/README.md` 的表格里未列，`docs/research/` 与 `tests/` 均未引用；`scripts/README.md:109` 自述「一次性探针在迭代后已删除，不必长期留在本目录」。
- **根因**：全仓检索 `first-note-hitch-probe` 只命中脚本自身注释，inbound = 0；`tests/static/` 里 `scripts/` 相关的 19 处锁无一处指向它。
- **修法**：只删这一件。`scripts/measure-export-limits.mjs` **保留**（`docs/research/chart-preview-export-limits.md:267` 指定为复算入口），其硬编码 `/src/...` 绝对路径另记账、不在本票。
- **Status**：已做（2026-11-07，详见 `## Answer`）。

## 不在范围

- 候选 01 / 05（票 16）、候选 06（`tests/dom/pages/` 32 平铺，删除测试不成立）。
- `scripts/`「路径真相只留一份」（上一轮评 Speculative，`map.md:40`）、`tests/static/` 全量行为化（票 13 Q4 已否决）。
- `src/app/` 目录结构整改（本轮结论：不单开一轮；定义漂移 / 活注释回写随票 16 同批处理）。
- 任何文件重命名、目录搬迁、ADR / `CONTEXT.md` 回写。

## Answer

两件删除按 #1 → #2 顺序落地，零行为变化、零新增断言、未动 `tests/`：

- **#1**：`ChartPosition` 定义连同原注释原样并入 `src/chart/types.ts` 文件头（`chart/types.ts` 原无同名导出，实测无冲突）；`EditingProvider.tsx:4`/`:5` 两条进口合成一条 `import type { ChartNote, ChartPosition, SelectionItem } from '../../chart/types'`；删除 `src/types/chart.ts`、`src/types/index.ts` 及空目录 `src/types/`。删后全仓检索 `types/chart` / `src/types` 在 `src`/`tests`/`scripts`/`docs`/配置里 **0 命中**。`export type Position = ChartPosition` 死别名与文件头失实注释按 Q1 保留，留给票 16「定义漂移 / 活注释回写」同批处理。
- **#2**：删除 `scripts/first-note-hitch-probe.mjs`（HEAD 实测 8275 B）。`scripts/measure-export-limits.mjs` 保留，`scripts/README.md` / `docs/research/` / issue 167 均未点名被删脚本、无悬空引用，按 Q2 不留档、不扩出新增文档。

**门禁（2026-11-07 HEAD 实测，四连 + `npx tsc -b`，改前/改后逐项比对增量）**：

| 门禁 | 改前 HEAD | 改后 | 增量 |
| --- | --- | --- | --- |
| `npm test` | 400 文件 / 4395 用例全绿 | 400 / 4395 全绿 | 0 |
| `npx tsc -b` | 0 错误 | 0 错误 | 0 |
| `npm run build` | 全绿 | 全绿 | 0 |
| `npm run test:types` | exit 2 / **114 条** error（存量红） | 114 条，逐行 diff **完全一致** | 0 |
| `npm run lint` | exit 1 / **36 errors + 57 warnings**（存量红） | 36 + 57，逐行 diff 除一行行号位移外完全一致 | 0 |

`lint` 唯一差异为 `EditingProvider.tsx` 既有 `react-refresh/only-export-components` warning 行号 `217:17 → 216:17`（删一行 import 所致），非新增问题。存量红不顺手修、不追求四连全绿（Q3）。

## Comments

- 2026-11-07 用户问「先创建对应的 issue？」后按上轮两批分组开本票与票 16。本票只做现状核对与修法记录：**未拍板、未 grill、未开工**，源码与测试零改动；`map.md` Frontier 同步加一行指针。（开票时的历史记账，按 `issue-tracker.md:50` 保留不回改。）
- 2026-11-07 开工前核对 + grill 一轮，Q1–Q5 用户全按推荐口径拍板（范围定案后转 `claimed`）。核对结论：票面两件的 inbound = 0 与修法均成立；`tests/static/` 里 `scripts/` 引用实测 **32 处**（票面写 19 处锁），逐条核对无目录清单/计数锁、无一处指向被删脚本，删除测试仍成立；`src/types` 在 `.scratch/` 的 4 个文件里出现，均为历史票事实存档（含 `basic-editor/48` 记录当初抽出该域的步骤），不是源码引用，按 `issue-tracker.md:50` 不回改。
- 2026-11-07 **基线实测更正**（票面锁测段引票 14 的 396 文件 / 4369 用例为上一轮数字）：HEAD 实测 `npm test` **400 文件 / 4395 用例全绿**、`npx tsc -b` 与 `npm run build` 全绿；`npm run test:types` 114 条 error、`npm run lint` 36 errors / 57 warnings 为 HEAD 既有存量红。票 14 `## Comments` 实测为 **114 条 / 35 errors / 57 warnings**（其 `:20` 引票 13 `:88` 的 115 条 / 25 error 是更早的旧基线、非实测）：本轮 `test:types` 条数未变、`lint` 多 1 条 error，均为改前 HEAD 既有、非本票引入。以改前 HEAD 实测为基线、改后逐行 diff 求增量；票 14 已记 `git archive HEAD` 副本无 `.git` 会让仓库元数据相关用例中断，故不跑副本全量。
- 2026-11-07 双轴评审（Standards / Spec）后修 1 处：上条基线更正原先误把「票 14 记 115 条 / 25 error」当作票 14 实测并称「已漂移」（实为票 14 引票 13 的旧基线，且 114 条未漂移），按票 14 `## Comments` 实测数字改正。Standards 轴另提「`map.md` 的 `Decisions so far` 未补 resolve 指针（`issue-tracker.md:70`）」按票 14 `:70` 误读项先例放行：该条要求 resolve 时更新 map 指针，票 12 / 13 / 14 落地均只回写 Frontier 一行；`map.md:48` 明确 map 只做决策索引、实现流水账留票内，本票零新增决策且 Q4 用户拍板的就是「Frontier 指针一并回写」，不为纯删除清理往 Decisions-so-far 添记账。Spec 轴的「单提交未落地」为复核时序（评审在提交前跑），提交后消解。
- 2026-11-07 按 Q4 单提交落地：`Status: resolved`、`## Answer`、本段 Comments、`map.md` Frontier 指针回写，连同上一轮未跟踪的票 16 文件成对入库（票 16 内容一字未改，仍 `open` / 待 grill）。继续用 `fix/basic-editor/macOS-210-213`，不另切分支。
