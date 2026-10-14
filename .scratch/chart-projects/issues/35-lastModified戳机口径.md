# 35 · lastModified 戳机口径 + 两个时间戳的定义立档

Type: bug
Status: open
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
