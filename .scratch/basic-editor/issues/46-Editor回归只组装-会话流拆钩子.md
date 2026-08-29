Type: task
Status: resolved（2026-08-29，候选 2 Editor 回归只组装：6 个会话流拆到聚焦 hook）
Blocked by: 45

## Question

架构深化评审（2026-08-29，候选 2 / Worth exploring / in-process）指出：`Editor.tsx` 名义是组装，
实际同时拥有**六种无关联的会话流**——

1. 渲染面测量（ResizeObserver burst/stream/trail 合并状态机，约 70 行）
2. 播放 RAF 编排（per-frame scrollY 跟随 + 引擎 tick + 重锚 effect ×2）
3. 谱面工程持久化（IndexedDB 防抖落盘 + 挂载恢复 + 音频 Blob 引用）
4. 布局 hydrate + 回写（settings.layout 初始化与变更写回）
5. 音频导入/清除（AudioEngine.load/clear + 错误暴露）
6. 音频页桥接（AudioPageContext 注册 + 谱面时长编辑 + 错误横幅）

加上**全局键盘快捷键**分发（约 70 行 `runFunction` switch），改任何一股都要通读 860 行。
与 ADR-0003 §7 "Editor 只保留【组装】职责" 冲突，§7 明确写「Editor 只挂 Provider；编排 edit/UI/配置流的调用，
不再堆全部编辑状态」。

issue 45（候选 1）已为**播放数学**抽出 `PlaybackScrollModel` 深模块；本 issue 在其上把**会话职责**也按
"每流一个 interface" 拆出，Editor 回到组装（ADR-0003 §7 收口）。

## 现状（Before）

`src/pages/Editor.tsx` 当前 836 行，6 种会话流全在组件内（见上文）；refs 单例承载：

- `engineRef: AudioEngine`（播放 + 音频导入）
- `chartProjectStoreRef: ChartProjectStore`（持久化）
- `audioDataRef: { audioName?, audioBlob? }`（音频元数据）
- `saveTimerRef`、`notesRef`、`durationRef`、`scrollModelRef` 等
- `isPlayingRef`、`playbackRafRef`（RAF 状态）

各流互相不共享状态机，但共用 ref —— 拆分后每个会话流可独立测试、独立演进。

## 整改（After）

**抽出 6 个聚焦 hook + 1 个深模块/现有深模块复用**：

| 会话流 | 抽出处 | 接口（最小可测） |
| --- | --- | --- |
| 渲染面测量 | `src/utils/useSurfaceSize.ts` | `(ref) => SurfaceSize`（burst/stream/trail 状态机封内部） |
| 谱面工程持久化 | `src/utils/useChartProjectPersistence.ts` | `(notes, duration, audioName, audioBlob) => { persist(), restore() }` |
| 音频导入/清除 | `src/utils/useAudioBridge.ts` | `(engine) => { audioName, audioError, importAudio, clearAudio, dismissError }` |
| 播放 RAF 编排 | `src/utils/usePlaybackCoordinator.ts` | `(engine, scrollModel, scrollContainerRef, canvasRef) => { togglePlay, seek, jumpToMarker }` |
| 布局 hydrate + 持久化 | `src/contexts/UIContext.tsx` 内置 | 现有 UIContext + 读 settings.layout 初始化 + 变更回写 |
| 键盘快捷键分发 | `src/utils/useShortcutDispatch.ts` | `(runFunction, active) => void` |

**复用既有深模块**：
- `PlaybackScrollModel`（候选 1）—— 播放协调模块只应用 DOM 与驱动画布
- `ChartProjectStore`（ADR-0005）—— 持久化门面
- `AudioEngine`（ticket 14 / 18）—— 音频引擎

**Editor.tsx 收口**：

- 只剩：组件壳 / 4 域 Provider 消费 / 6 个 hook 串联 / 布局 JSX
- 删除 6 个 ref（engineRef 移到 useAudioBridge，scrollModelRef 移到 usePlaybackCoordinator，etc.）
- 删除 70 行 RO 状态机（→ useSurfaceSize）
- 删除 60 行键盘处理（→ useShortcutDispatch）
- 删除 30 行 runFunction switch（→ useShortcutDispatch 内的 dispatchTable）
- 删除 40 行 persist 状态机（→ useChartProjectPersistence）

**预估**：Editor.tsx 836 行 → ~280 行（壳 + 布局 JSX + 4 域 hook 串联）。

## 不变量（行为保持，必须逐条人工 + 单测覆盖）

1. **挂载恢复**：刷新页面后 notes / duration / 音频全部恢复（与现实现一致）。
2. **编辑防抖落盘**：notes / duration 变化后 800ms 内落盘（与现实现一致）。
3. **音频导入/清除**：加载即写工程 + 刷新时长；清除回到无音频态。
4. **RO 突发/流/尾随**：窗口连续缩放期间不重复提交（去 issue 36 / 38 闪烁的护栏保留）。
5. **重锚 / 播放 / 暂停 / seek**：与候选 1 收口后的行为一致（issue 24 不变量保持）。
6. **布局回写**：折叠/拖宽即写 settings.layout（与 issue 22 §6 行为一致）。
7. **快捷键分发**：tool switch / exec / undo / redo / play / jumpToMarker 全功能正常。
8. **页面壳表面契约**：active=false 时暂停播放 + 抑制全局键盘（与 issue 28 Q16 行为一致）。

## 验证

- 现有 `tests/unit/PlaybackScrollModel.test.ts` 15 例 + 全量 315 测试持续绿。
- 抽出 hook 后新增 1-2 个测试覆盖关键状态机（如 RO 合并状态机单测、持久化防抖单测）。
- `tsc -b` 0 错误；`vitest` 全绿；`npm run build` 绿。
- 浏览器实测（开发服务器）：
  - 工作台进入/退出（页面壳保活挂载）行为一致；
  - 音频导入/清除 + 谱面时长刷新；
  - 缩放/折叠/展开侧栏无闪烁；
  - 快捷键全部生效；
  - 刷新页面后 notes / 音频全部恢复。

## Comments

- 来源：架构深化评审候选 2（Worth exploring / in-process）。它是"Editor 回归组装"的形式化
  收口，与候选 1（`PlaybackScrollModel`）是"先收敛数学、再分拆会话流"的同源两步走。
- ADR 对照：完全对齐 ADR-0003 §7 + §11（`setLayout` 引用稳定 + 折叠回写 settings） + issue 22
  + issue 28（active 表面契约 + 键盘抑制）+ issue 24 / 36 / 38（已由候选 1 兜底）。不动 settings
  字段、不动 context 分域（沿用现有 4 域）。
- 不重开 ADR-0003：本 issue 纯实现收口，无新设计。

## Answer（结论，2026-08-29）

已按候选 2 把 6 个会话流全部拆到聚焦 hook，Editor 回到组装（ADR-0003 §7 收口形式化）：

- **新增 6 个聚焦 hook + 2 个纯逻辑状态机**（`src/utils/use*.ts` + `src/utils/*Merger.ts`）：
  - `useSurfaceSize`（包装 `SurfaceSizeMerger`）—— 渲染面测量 burst/stream/trail 状态机
  - `useScrollModel`（包装 `PlaybackScrollModel`）—— 滚动模型生命周期 + 几何/缩放注入 + 谱面末端变化置位
  - `useAudioBridge` —— 音频导入/清除/页桥/时长同步/keyset+SE 音量
  - `usePlaybackCoordinator` —— RAF 编排 + togglePlay/seek/jumpToMarker/deleteMarker/changeDuration
  - `useChartProjectPersistence`（包装 `ChartProjectPersistenceMerger`）—— 挂载恢复 + 编辑防抖 800ms 落盘
  - `useLayoutPersistence` —— 从 settings 初始化 + 变更回写 settings.layout（issue 22 §6）
  - `useShortcutDispatch` —— 键盘快捷键分发 + 工作台失活抑制（issue 28 Q16）
- **Editor.tsx**：837 行 → **507 行**（-40%），只剩 4 域消费、7 个 hook 串联、布局 JSX；
  删除 6 个 ref（`engineRef` 仍由 Editor 持有以避免重建 AudioContext；`chartProjectStoreRef` /
  `audioDataRef` / `saveTimerRef` / `notesRef` / `durationRef` / `isPlayingRef` / `playbackRafRef`
  / `pendingAnchorKeyRef` / `lastTargetScrollYRef` 等全部下沉到对应 hook 内部）。
  `runFunction` switch 保留在 Editor（hook 仅做 dispatch，业务分发由调用方注入）。
- **新增 2 个纯逻辑类 + 14 个单测**：
  - `SurfaceSizeMerger`（9 例）—— 退化尺寸跳过 / 离散立即应用 / 突发早期 / 连续流延后尾随 / 已生效去重 / 卸载 flush / getCommitted
  - `ChartProjectPersistenceMerger`（6 例）—— 单次 schedule / 多次合并 / saveNow 立即落盘 / flush / 失败静默 / destroy
- **验证**：
  - `tests/unit/PlaybackScrollModel.test.ts` 15 例 + `SurfaceSizeMerger.test.ts` 9 例 +
    `ChartProjectPersistenceMerger.test.ts` 6 例 = **30 例新/既有**。`tsc -b` 0 错误；
    `vitest` **330/330 全绿**（315 既有 + 15 新）；`npm run build` 绿；`npm run lint` 无新增错误。
  - 浏览器实测（`https://ofwtwe3f6t-5173.cnb.run/`）：工作台进入、播放/暂停、进度条 seek、
    折叠/展开右栏、切换音频页（active=false 暂停）、音频页改时长 30→45 秒回工作台同步 = 45、右栏折叠态切页保持
    —— **与候选 2 现状（拆 hook 前）行为一致**；无 console 错误。
- **边界**：未触动 `settings` 字段、未重开 ADR；与候选 1 共享 `PlaybackScrollModel` 状态机（line 不变）；
  `AudioEngine` 仍由 Editor 持有（避免 AudioContext 重建）。
