# 36 · relTime 定时刷新

Type: feature
Status: resolved
Blocked by: —

## 来源

issue 31 验收现场（用户 2026-10-14，认可）：页面上的「N 分钟前」不随时间走，切走再切回来才变。

## 症状与根因

`relTime(at, now = Date.now())` 渲染时求值一次，hub/详情两页无定时器驱动重渲染（`src/pages/projects` 无 setInterval/rAF）；旧「刚刚」档 0–59 分钟无差别所以不可见，31 的分钟档让它显形。

## 修法

单一共享 ticker：`NowProvider` context + `useNow(30_000)`（一个 timer 服务全部消费方，别一处一个）；`relTime` 调用点改传 tick 出的 `now`（函数已带默认参，31 锁测即注入式）。消费方今天只有 hub/详情，按 YAGNI 不上收全图。

## 锁测

1. `tests/dom/`：renderHook + fake timers 锁「到 tick 重渲染」「多消费方共享同一 timer」（撤共享应红）。
2. 静态断言锁 `relTime` 调用点全部传入注入 now（防回溜 `Date.now()` 默认参）。

## Comments

- 2026-10-14 落地：新增 `src/app/providers/NowProvider.tsx`（`NowProvider` + `useNow` + `NOW_TICK_MS = 30_000`）——整个应用一个 `setInterval`，context value 一涨全部消费方一起重渲染；挂 `ProviderTree` 最内层（无依赖；context 只重渲染**消费方**，不碰工作台其余部分）。hub 2 处 / 详情 3 处 `relTime` 全部显式传 `now`；`tests/support/providers.tsx` 的 `TestProviders` 补 `NowProvider`，`renderWithProviders` 的页面测试直接可用。
- 口径：间隔是**共享 ticker 的属性**（模块常量），不做 `useNow(interval)` 形参——消费方各自传间隔会拆出多个 timer，与「一个 timer 服务全部消费方」相悖；将来要换节奏改 `NOW_TICK_MS` 一处。
- 锁测：`tests/dom/RelTimeTicker.test.tsx` 3 条（到 tick 重渲染 / 多消费方共享同一 timer / 卸载即停表）；`tests/static/RelTimeInjectedNow.test.ts` 5 条（调用点两参且第二参为 `now` / 有调用点的文件 `now` 来自 `useNow()` / 工程两页无 `setInterval`·`rAF`（根因侧）/ `ProviderTree` 挂 `NowProvider` / 扫非空防静默放行）。
- 变异检测：`useNow` 收回调用点各自建 timer → dom 锁 3 条红 2；调用点少传 `now`、本地 `const now = Date.now()` 顶替、页面自建 `setInterval` → 静态锁逐条红。均已恢复。
- 门禁：全量 `vitest run` 262 文件 / 3090 用例全绿；`npx tsc -b` 零错；eslint 触及文件 0 error（`react-refresh` warning 为全仓 Provider 既有形态）。
