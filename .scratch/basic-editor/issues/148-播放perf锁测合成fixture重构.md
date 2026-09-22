# 148 · 播放 perf 锁测：抽合成 fixture，去掉「缺本地谱面就 skip」

Type: chore
Status: resolved（2026-09-22 实现 + 全量测绿）
Blocked by: —

## 来源

默认 `npm run test` 会 **skip 3 条** `tests/perf/` 用例：两份文件在仓库根找不到可选的本地谱面 JSON 时整组 `describe.skipIf`。CI 与多数开发者环境因此**锁不住** issue 138/139/140 里约定的播放帧 / 高倍倒流 SP 成本基线；真谱对照仍依赖每人自备文件或 `scripts/fetch-bestdori-chart.mjs`，与「测试应离线、默认可重复」不一致。

## 症状

- `tests/perf/PlaybackFrameBaseline.test.ts`：播放帧静态层「仅 scrollY 变不重建」等断言，缺文件时 skip。
- `tests/perf/HighZoomBackflowSpCost.test.ts`：高倍（es=3）折返视口扫描线成本、播放热身后瓦片 blit 约束，缺文件时 skip。
- 同主题下 **已有** 不 skip 的锁测：`tests/perf/SpBandRasterClip.test.ts`（合成 8 臂 fold 几何 + 瓦片 clip 像素预算），但未覆盖「整层 `drawNotesLayer` / 静态层缓存」与「高倍播放队列」两条链路。

## 根因

138/139/140 落地时把「真谱形状」当作可选验收锚点，perf 锁测直接读本地完整谱面；谱面代码不入库（版权与版本漂移），导致默认测试矩阵留空档。

## 修法（本轮实现口径，待验收）

1. **抽共享合成 fixture**（`tests/support/` 或 `tests/perf/fixtures/`）：  
   - 倒流区 SP 带：复用 / 对齐 `SpBandRasterClip` 的 8 臂折返几何与 clip 口径；  
   - 播放 perf：程序生成**最小** chart code（负 BPM 小段 + 必要 Slide/Long SP 区 + 足够音符密度），满足 139「scrollY 扫多帧、静态层命中」与 140「es=3 playing + 瓦片队列」的测量条件，**不转载任何社区完整谱面**。
2. **改写上述两份 perf 文件**：默认用合成 fixture，`describe` 不再 `skipIf`；断言语义与对应 issue 锁测段对齐（可对照 138/139/140 票内表格与 `HighZoomTiles.test.ts`）。
3. **可选对照层（非默认 CI）**：保留「若存在某环境变量或仓库根约定文件名则多跑一组对比」的钩子（仅维护者本地）；不在票内、README、注释里写第三方帖子 ID；fetch 脚本仍只作手工工具。
4. **注释降噪**：相关测试头注释改为描述现象（倒流 SP 带、5s 折返视口、高倍播放），去掉对具体社区谱 ID 的引用（ADR 证据段不在本票范围）。

## 锁测

1. 全量 `npm run test`：**0 skip**（原 3 条 perf 变绿）；`SpBandRasterClip` / `HighZoomTiles` / `RendererPerf` issue 101 段保持通过。
2. 新增或扩展 fixture 单测（可选）：合成 chart 能 `convertChartCodeToNotes` + `ChartGeometry` 无校验拒收。
3. 单测锁不住真 60fps / GPU 观感 → 仍按 139/140 惯例交页面验收；本票只收敛 **node stub 回归网**。

## Answer

`tests/support/perfBackflowPlayback.ts`：ADR 附录 A BPM + 折返窗内「首尾可见 / 中间 hidden」长 SP + 单键密度。`PlaybackFrameBaseline` / `HighZoomBackflowSpCost` / `SpBandRasterClip` 共用；去掉 `skipIf` 与仓库根 JSON 依赖。本地真谱仍可用 fetch 脚本对照，已加入 `.gitignore`。

## Comments

- 2026-09-22 开票：行为不变（chore），目标是默认可重复的 perf 锁测，与 issue 129 测试分层一致。
- 2026-09-22 实现：合成 SP 需首尾可见结点（`displayConnections` 口径），否则 `isSpRegion` 为 0。
