# 36 · relTime 定时刷新

Type: feature
Status: open
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
