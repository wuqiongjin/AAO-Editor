# 134 · 一份 ChartGeometry，两处生命周期并成一处

Type: chore
Status: done
Blocked by: —

## 来源

2026-09-21 `improve-codebase-architecture` 评审候选 3「一份 ChartGeometry，两处生命周期并成一处」（Worth exploring）。
续作 [issue 104](./104-倒流区时间轴与几何.md)：反查政策已收进 `ChartGeometry` / `BpmTimeline`，但滚动模型与画布仍各造一份，复用规则不同；HUD 拍号仍旁路 `AudioTiming.secondsToBeat` 每次 new 秒域时间线。

## 症状

- `useScrollModel`：`notes` 一变就 `new ChartGeometry`。
- `FinalVirtualCanvas`：BPM 内容 / 秒长 / surface / 纵向比例未变才复用（issue 35 F2）。
- HUD `playheadBeat` 与顶栏 `currentRegionBpm` 再建秒域时间线。
- 同一次滚动的判定线高度可以来自两份几何。

## 本轮实现口径（用户 2026-09-21 确认推荐项）

1. 所有者 = Editor 侧 `useChartSpace`：复用规则与画布同款；返回 `geometry` + `chartEndKey`。
2. `useScrollModel` 只 `configure` 注入的 geometry；画布收 `geometry` prop。
3. HUD：`playheadBeat` 与顶栏 BPM 都读同一份 geometry（`beatOfSeconds` / `segmentIndexOfSeconds`）。
4. `AudioTiming` 秒域时间线留给音频调度，不删、不改 ADR-0010 取解。

## 锁测

- `obtainChartGeometry`：非 BPM 变化复用同一引用；BPM / 秒长 / surface / 比例变则 new。
- 倒流带 `beatOfSeconds` = 最大 beat 解（ADR-0010 附录 B 变体数字，与 issue 104 同谱）。
- 静态：生产应用几何只在 ChartSpace 一处 `new ChartGeometry({ seconds })`；画布 / scroll 不再各造；HUD 不调 `secondsToBeat`。
