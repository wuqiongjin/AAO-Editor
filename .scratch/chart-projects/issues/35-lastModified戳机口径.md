# 35 · lastModified 戳机口径 + 两个时间戳的定义立档

Type: bug
Status: resolved
Blocked by: —

## 来源

issue 31 验收现场（用户 2026-10-14）：刚自动创建的工程，详情页工程行「5 分钟前」与谱面行「3 分钟前」不一致——用户预期「工程打开的时间 = 最近打开的那张谱面的时间」。

## 定义（两字段语义此前无任何文档记录，本票立档）

- `ChartProject.lastOpened` = 工程**被创建或被明确打开**的最后时刻。写入仅：`createUnnamedProject`/`createBlankProject`/`duplicateProject` + `CurrentProjectSession.open()`；ensure 跨刷新恢复**不写**（`CurrentProjectSession.ts:91-98`）。兼启动台默认排序键与 hero 选中锚。
- `ProjectChart.lastModified` = 谱面**记录最后一次被写入**的时刻（≠最后编辑）：明确谱面操作（增/复制/完成切换/信息编辑）+ 工作台防抖落盘每次 `buildProject()` 无条件重戳（`useChartProjectPersistence.ts:175`）。
- 模型无「谱面打开时间」：`open(projectId, chartId)` 不记录何时打开了哪张——上述等式在存储里**无法求值**，不是「有时不相等」。

## 症状与根因

谱面行「N 分钟前」被读成「上次编辑」，实际口径是「上次落盘」：不改音符的依赖抖动（时长/音频同步、切 tab flush，`useChartProjectPersistence.ts:286-316`）也重戳——误导用户，且污染 hub「最近修改」排序键（`projectLastModified` = max(charts.lastModified)）。

## 修法

`buildProject()` 改条件戳：当前谱面的 notes 或保真字段（`appliedChartCodeText`/`chartCodePristine`）相对已载入记录**真变**才戳 `Date.now()`，否则沿用记录里的 `lastModified`；时长/音频/切 tab flush 不戳。定义如上立档，并同步一句进 CONTEXT.md。

## 锁测

1. 扩 `tests/unit/project/ChartProjectPersistenceMerger.test.ts` / `tests/static/ChartProjectPersistence.test.ts`：仅时长/音频变化触发落盘 → `lastModified` 保持旧值；notes 真变 → 重戳（撤掉条件判断应立刻红）。
2. 定义立档无行为面，随票正文 + CONTEXT.md 存档。

## Comments

- 2026-10-14 落地：新增纯逻辑模块 `src/project/chartModifiedStamp.ts`（`stampChartModified` + `chartNotesModified`）——notes / 保真字段（`appliedChartCodeText`/`chartCodePristine`）相对记录**真变**才戳 `Date.now()`，否则沿用记录里的 `lastModified`；比较口径是**记录内容级** JSON 值深比较（键序无关、显式 `undefined` 视同缺席的往返容差），刻意不复用 `NotesEqual`（历史去专用，忽略 `source`/`spanParams`/`charge`，拿来当戳机判据会把只改保真源数据的落盘误判成无变化）。`useChartProjectPersistence.buildProject()` 改经 `stampChartModified` 落盘，hook 内不再出现 `lastModified` 字样。
- 设计口径（链式基线）：`projectRef` 每次 build 更新成上一次产物，故「防抖窗口内编辑→撤销→只落一次盘」不重戳（内容回到记录原样），而「落盘之后的撤销」仍重戳——盘上已是改后的内容，撤回去是真实的内容变化。已按此拆两条用例锁住。
- 存量锁同步：`tests/static/ChartCodeFidelityWiring.test.ts` 原断言保真两扁平字段的映射写在 hook 内——映射随条件戳收口到 `chartModifiedStamp.ts`，该锁改指新模块 + 补「hook 经 `stampChartModified` 落盘」断言（接线意图不变：记录形状不变、映射在边界做）。
- 锁测：`tests/unit/project/ChartProjectPersistenceMerger.test.ts` 新增 `stampChartModified` describe 10 条（无变化沿用 / notes 真变 / 保真两字段各自变与都没动 / fidelity 缺省清空算变 / 防抖内撤销不戳 / 落盘后撤销仍戳 / source-charge-spanParams 算变 / 键序与显式 undefined 容差 + 显式 0 算变 / 引用短路 / 连续 flush 链）；`tests/static/ChartProjectPersistence.test.ts` 新增 issue 35 describe 4 条（hook 无 `lastModified` 字样 / 必经 `stampChartModified` / 模块保留条件判断 / 判据含保真两字段）。
- 变异检测：把模块里的条件判断改回无条件 `input.now` → 单测 6 条立刻红（撤条件即红，符合锁测要求），已恢复。
- 立档：CONTEXT.md「谱面长度与谱面工程」节新增「最近打开 / 最近修改」两行（定义 + 模型无「谱面打开时间」的告诫），本票正文即存档。
- 门禁：全量 `vitest run` 260 文件 / 3082 用例全绿；`npx tsc -b` 零错；`npm run test:types` 72 错 = 干净树基线原值（首轮跑出 75 = 新增 3，全是新测试数组缺 `ChartNote[]` 标注的字面量收窄问题，补标注后回基线）；eslint 五个触及文件干净。
