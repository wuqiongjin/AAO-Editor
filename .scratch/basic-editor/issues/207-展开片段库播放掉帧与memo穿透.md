# 207 · 展开片段库播放掉帧与memo穿透

Type: bug
Status: resolved

## 来源

用户问题反馈：展开「片段库」时感觉有明显掉帧，特别是在播放的时候。

## 症状与根因

1. **播放中 12.5Hz 级联全量重渲（主要根因）**：
   - **症状**：在片段库抽屉展开状态下播放谱面，画面出现周期性微顿挫/掉帧。
   - **根因**：
     - `usePlaybackCoordinator` 在播放 RAF 中每隔 80ms (`PLAYBACK_HUD_PERIOD_MS`) 调用一次 `setCurrentSeconds`，触发 `WorkspacePage`（`Editor`）因消费 `usePlayback()` 而每秒重渲约 12.5 次。
     - Issue 188 本意通过 `memo(PatternLibraryDrawer)` 拦截该重渲，但在 Issue 193（commit `670fe161`）中，`WorkspacePage.tsx` 向 `PatternLibraryDrawer` 传入了裸内联箭头函数 `onExitPaste={() => { if (ui.patternPaste) ui.setArmedTool(null); }}`。
     - 内联函数每 80ms 产生新引用，导致 `memo(PatternLibraryDrawer)` 浅比较恒失败；抽屉每秒重渲 12.5 次，每次重复执行 `filterPatternsByName`、`sortPatterns`、全量卡片重新计算 `patternStats`（每次无缓存遍历该片段所有 Note 及 Slide 结点）以及重渲染所有卡片 DOM 和子组件。
     - 子组件 `PatternThumbnail` 未包装 `React.memo`，抽屉重渲时每个缩略图的组件函数均跟随执行 Hooks 与虚拟 DOM 协调。

3. **全应用 Context 广播与保活页面级联重渲（常数级固定卡顿根因）**：
   - **症状**：即使消除了随片段数量增加的 $O(N)$ 计算与绘制消耗，点击抽屉开关时，依然有固定的 ~100ms 冻结（50 个片段和 100 个片段体感相同）。
   - **根因**：
     - `setPatternDrawer({ open })` 调用最顶层 `ConfigProvider` 的 `setSettings`，更新了全仓根配置 `settings`；
     - `ConfigContextValue` / `UIContextValue` / `EditingContextValue` 的 `value` 原先均为未做 `useMemo` 包装的对象字面量，每次渲染都生成新引用；
     - `AppShell` 内部 `PAGE_IDS.map(...)` 常驻保活挂载全应用所有 7 个页面，且 `PageSlot` 未做 `memo`，同时每个后台页面（`ProjectsPage`、`SettingsPage`、`ShortcutsPage`、`AssetsPage`、`PreviewPage` 等）均直接订阅了 `useConfig()`；
     - 抽屉开合瞬间，React 向整棵树所有组件广播 Context 更新，导致 6 个本处于失活隐藏状态的庞大后台页面全部在同一帧被唤醒重渲；
     - 每个 `PatternThumbnail` 原先均独立调用 `useConfig()` 订阅 `settings.visual?.noteSkin`，产生了 50+ 个微观 Context 订阅。

## 修法

1. **P0 根治播放掉帧（稳定引用，恢复 memo 隔离）**：
   - 在 `src/pages/workspace/WorkspacePage.tsx` 中，将 `onExitPaste` 用 `useCallback` 包装为稳定引用，确保传给 `PatternLibraryDrawer` 的所有 props 在播放中引用恒定，彻底阻断 80ms 时钟向抽屉及其卡片扩散。
   - 将 `PatternThumbnail` 与单个卡片使用 `React.memo` 包装，提供第二道防线。
2. **P1 消除 $O(N)$ 随片段量膨胀的卡顿（消灭 Layout Thrashing 与软光栅开销）**：
   - 尺寸固定 88×56 消除 `useEffect` 读取尺寸的强制同步重排；
   - 移除每张卡片独立的 `ResizeObserver`；
   - 引入 `IntersectionObserver` 懒绘制与 `requestAnimationFrame` 异步排队；
   - 建立 `WeakMap` 缓存（Stats / BpmRange / ThumbnailScene）与 `content-visibility: auto`。
3. **P2 根治 $O(1)$ 常数级全局级联重渲（后台保活页隔离与 Context 引用稳定）**：
   - 在 `src/pages/PageRegistry.tsx` 中将 `PageSlot` 包装为 `React.memo`，并在内部引入 `InactiveConfigBoundary`：在 `active: false` 时冻结 `ConfigContext` 引用，彻底切断工作台抽屉开合向 6 个后台页面的重渲传播；
   - 在 `AppShell.tsx` 中使用 `useMemo` 稳定 `navValue`；
   - 在 `ConfigProvider.tsx`、`UIProvider.tsx`、`EditingProvider.tsx` 中全面使用 `useMemo` 稳定 context value，避免无关属性变更打穿下游订阅者；
   - 将音符皮肤解析提升至抽屉顶层，批量将 `icons` 下传给卡片缩略图，消除数十个缩略图对 `ConfigContext` 的零散订阅。
4. **P3 静态与运行时测试看守**：
   - 静态防退化断言与 DOM 隔离测试。

## 锁测

1. **静态防退化断言**：`tests/static/PlaybackRafHud.test.ts` 新增对 `WorkspacePage.tsx` 传递给 `PatternLibraryDrawer` 的 props 不得包含内联匿名函数（`on\w+=\{\s*\([^)]*\)\s*=>`）的断言。
2. **DOM 渲染隔离测试**：`tests/dom/workspace/PatternLibraryDrawer.test.tsx` 新增：
   - `PatternThumbnail` 与 `PatternCard` 必须经 `React.memo` 包装（`$$typeof === Symbol.for('react.memo')`），且传递稳定回调以保证单张卡片状态变化时不牵连其他卡片重渲；
   - 父组件播放秒数高频更新时，稳定 props 的 `PatternLibraryDrawer` 不发生多余重渲染（render 计数稳定拦截）；
   - `IntersectionObserver` 懒绘制接入验证；
   - `InactiveConfigBoundary` 拦截验证：在后台保活挂载（`active: false`）的页面在工作台抽屉开合时不受 Config 广播波及而发生重渲。

## Answer

已彻底解决展开片段库在播放时的 12.5Hz 级联重渲、随片段数增加的 $O(N)$ 级卡顿、以及固定耗时的 $O(1)$ 常数级卡顿：
1. **阻断播放 12.5Hz 级联穿透**：
   - 在 `WorkspacePage.tsx` 中使用 `uiRef` 配合 `useCallback` 稳定 `handleExitPaste` 函数引用，修复了 Issue 193 引入的内联箭头函数导致的 `PatternLibraryDrawer` memo 击穿。
2. **消灭随片段数膨胀的 $O(N)$ 卡顿（50 个与 100 个同等轻量）**：
   - **消除强制同步重排（Layout Thrashing）**：缩略图容器尺寸在 CSS 中固定为 88×56，废除在 `useEffect` 中批量读取 `canvas.clientWidth/clientHeight` 再写 `canvas.width/height` 的布局扰动；
   - **移除无效 ResizeObserver**：卡片缩略图本身固定宽高、不随抽屉拉伸而变宽，彻底移除卡片上逐实例挂载的数十个 `ResizeObserver`，避免拖宽和开合时密集触发全量重绘；
   - **可视区懒绘制（IntersectionObserver）**：引入带 `rootMargin: '120px 0px'` 的视口观察者，只有当前及即将滚动到视口内的卡片才挂载绘制任务，视口外卡片仅保留轻量 DOM 骨架，打开抽屉瞬间不再全量跑 Canvas 软光栅化；
   - **绘制任务异步排队（requestAnimationFrame）**：将进入视口卡片的绘制推入下一动画帧，首帧 100% 留给抽屉 CSS 滑入动画与谱面播放 RAF，杜绝点击瞬间主线程卡死导致的几十帧暴跌；
   - **全链路 WeakMap 引用缓存**：对 `patternStats`（音符数与跨度）、`patternBpmRange`（BPM 极值）以及 `buildPatternThumbnailScene`（几何场景图）分别建立以 Pattern 实例为键的 `WeakMap` 缓存，计算复杂度降至 $O(1)$；
   - **卡片级 memo 隔离与浏览器 CSS 虚拟化**：将列表项提取为独立 `PatternCard`（`memo`），并在 CSS 中为 `.pld-card` 配置 `content-visibility: auto; contain-intrinsic-size: auto 68px;`，让渲染引擎自主跳过视口外内容布局与绘制。
3. **彻底根除 $O(1)$ 固定常数级卡顿（消灭全应用后台级联重渲）**：
   - **后台保活页冻结（`InactiveConfigBoundary`）**：在 `src/pages/PageRegistry.tsx` 中为保活挂载的页面增加失活配置边界，当 `active: false` 时直接向子树传递冻结的 Context 引用，彻底阻断抽屉开合对工程管理、全局设置、快捷键、素材库、音频等 6 个后台失活页面的被动重渲；
   - **稳定根 Context 引用**：对 `ConfigProvider`、`UIProvider`、`EditingProvider` 和 `AppShell` 的 `navValue` 建立完备的 `useMemo` 记忆化，防止无关联属性（如抽屉开合布尔值）污染整个应用树；
   - **抽屉级图标集下传**：由 `PatternLibraryDrawer` 单一解析当前音符皮肤并下传 `icons`，解除了每个卡片缩略图对 `useConfig()` 的直接依赖，消除 50+ 个分散 Context 订阅者。
4. **测试看守**：
   - `tests/static/PlaybackRafHud.test.ts` 静态守卫防内联退化；
   - `tests/dom/workspace/PatternLibraryDrawer.test.tsx` 覆盖高频 tick 拦截、懒绘制及失活页面防重渲验证；
   - 全库 380 个测试文件、4275 个测试用例及 `npx tsc -b` 全量通过。
