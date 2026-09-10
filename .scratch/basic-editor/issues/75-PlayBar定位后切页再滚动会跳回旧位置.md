# 75 · PlayBar 定位到 B 后，切页再滚动画布会跳回旧位置 A

Type: bug
Status: resolved（2026-09-10 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-10 清单 #5。

## 症状

播放位置记为 A → 用 PlayBar 拖到 B → 切到其它页面再切回 → 初始还在 B，**但一滚动画布立刻跳回 A**。

## 根因（已定位）

1. **主因**：`seek()`（`src/playback/usePlaybackCoordinator.ts:130-144`）只写引擎 + `setCurrentSeconds` +
   `canvas.setScrollY(targetY)`，**不同步 DOM `chartAreaRef.scrollTop`**；而播放 RAF 循环（:99-108）是
   画布与滚动条**两边都写**的 → seek 后两个真相源分裂（画布 = B，滚动条仍 = A）。
   此后任意一次容器 scroll 事件走 `Editor.tsx:248-260`，用**陈旧的 A 位 scrollTop** 反算
   `canvasScrollY` 并 `canvas.setScrollY(A)` → 跳回 A。
2. **次因**：`PlaybackScrollModel.noteScrollObserved`（:139-143）在 pending 重锚期**跳过**刷新
   `anchorSeconds` → seek 出来的 B 进不了锚点；`takePendingReAnchor`（:148-158）于是按旧锚点 A 重算
   （且 `maxScroll<=0` 时静默清 pending，下次才发作）。
3. **排除项**：页面是**保活挂载**（`AppShell.tsx:52-54` / `PageRegistry.tsx` 恒渲染，非激活页仅
   `opacity:0`），不是"切页卸载丢状态" —— 别往那个方向查。

## 修法

- `seek()` 补写 `container.scrollTop`，与 RAF 循环同口径
  （`model.canvasScrollYToScrollTop(targetY, maxScroll)`，同样加 0.5px 阈值防抖）；
  把这段「秒 → {scrollY, scrollTop}」抽成 `PlaybackScrollModel` 上的纯函数，好单测。
- 次因建议**先不动**，主因修完实测再评估是否一并修（避免在未复现的路径上改状态机）。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/playback/PlaybackScrollModel.ts` | 新增 `scrollTargetForSeconds(sec, maxScroll)` 纯函数（RAF 与 seek 共用） |
| `src/playback/usePlaybackCoordinator.ts` | RAF 循环改调用它；`seek()` 补写 `scrollContainerRef.current.scrollTop` |

## 锁测

- `tests/unit/PlaybackScrollModel.test.ts`：给定 seconds → `{scrollY, scrollTop}` 与 RAF 路径逐点一致（含钳制与边界）。
- **静态源码断言**（照 `EditorAudioSessionRefactor.test.ts` 惯例）：`usePlaybackCoordinator` 的 `seek`
  必须写 `scrollContainerRef.current.scrollTop`，防止回归成只推画布。
- 手工：A → PlayBar 拖到 B → 切页 → 切回 → 滚动，停在 B 不回 A（这是 DOM 时序，单测覆盖不到）。

## Comments

- 2026-09-10 实现（只修主因）：`PlaybackScrollModel` 新增 `scrollTargetForSeconds(sec, maxScroll)`
  → `{ scrollY, scrollTop }`，RAF 循环与 `seek()` 共用同一口径；
  `seek()` 补写 `container.scrollTop`（带 0.5px 防抖守卫，与 RAF 同款）。
  `jumpToMarker` 走的是 `startPlaybackLoop`（RAF），自动跟着受益，无需额外改。
- 次因（`noteScrollObserved` 在 pending 重锚期跳过刷新 `anchorSeconds`）**按票内计划未动**，
  留待主因验收后再评估。
- 锁测：`PlaybackScrollModel.test.ts` 新增 5 例（`scrollTargetForSeconds` 同口径 / 反解一致 /
  超界钳制 / `maxScroll<=0` 归 0）；新增 `tests/unit/PlaybackSeekScrollSync.test.ts`（6 例静态源码断言）：
  `seek` 必须调用 `scrollTargetForSeconds` 且写 `container.scrollTop`（含 0.5 守卫），
  RAF 循环同样保留该写入 —— 防"组件又只推画布"的回归（组件接线单测盖不到）。
  tsc 0 / 787 测试全绿。
