# 255 · Ctrl+滚轮缩放步长

Type: feature
Status: resolved（2026-11-25 已实现并锁测，待页面验收）

## 来源

用户 2026-11-25：启动后从 100% 滚到做谱常用的 ~200% 偏慢；若改倍率，只动画布 Ctrl+滚轮。缩放胶囊「+」「-」保持原 ±0.1 精调。长按连发先不做。

## 症状与根因

画布 Ctrl+滚轮每事件乘 1.1 / 0.9（不互为倒数，往返会漂）。鼠标一格一事件时 100% → ~200% 要 7～8 格。工具栏 ± 已是 ±0.1，与滚轮无关。

## 定案（用户 2026-11-25）

- Ctrl+滚轮放大 **1.15**，缩小 **1/1.15**（5 格 ≈ 201%）。
- 缩放胶囊「+」「-」与胶囊悬停滚轮仍 ±0.1；**不做**长按连发。
- 不改默认 100%、不持久化缩放、不叠「持续滚轮再加速」（票 248 已否）。

## 修法

`wheelScroll.ts` 抽出 `ctrlWheelZoomFactor`；`FinalVirtualCanvas.handleWheel` 改用它。工具栏不动。

## 锁测

- `tests/unit/chart/canvas/WheelScrollBoost.test.ts`：1.15 / 倒数 / 往返 = 1 / 5 格 ≈ 201%。
- `tests/unit/chart/canvas/CanvasWheelInvert.test.ts`：Ctrl 分支调用 `ctrlWheelZoomFactor`，不再写死 0.9/1.1。
- 既有 `WorkspaceTopBarCluster.test.tsx` 继续锁胶囊 ±0.1。

## Comments

- 2026-11-25：Q1=OK（1.15 + 倒数），Q2=OK（不加长按）。
- 2026-11-25 评审收口：文件头补缩放；删冗余 / 旧 1.1 断言；`0.9:1.1` 锁收到 Ctrl 分支。定案标题、文件名、`## Answer` 不动。
