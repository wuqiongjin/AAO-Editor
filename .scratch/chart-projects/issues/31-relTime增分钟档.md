# 31 · 相对时间增「N 分钟前」档

Type: feature
Status: open
Blocked by: —

## 来源

用户 2026-10-14：「工程打开时间显示『刚刚』到底是多久？是否需要增加 xx 分钟前？（现在的『刚刚』感觉表达的跨度很大，现在这个时间跨度范围分为几类啊？）」

## 症状与根因

`relTime()`（`src/pages/projects/projectFormat.ts:14`）四档：`<1h`「刚刚」/ `<24h`「N 小时前」/ `<30d`「N 天前」/ `≥30d`「N 个月前」。「刚刚」实际覆盖 **0–59 分钟**——50 分钟前打开的工程也显示「刚刚」，这就是"跨度很大"的来源。5 个使用处（hub hero「上次打开」、hub 卡片副行、详情左栏行、谱面行 `lastModified`、上传记录）全仓无 `relTime` 单测。

## 定案（用户 2026-10-14）

- 「刚刚」收缩到 **<1 分钟**；**1–59 分钟 = 「N 分钟前」**；小时/天/月三档边界不动（四档变五档）。
- `lastOpened` 语义**维持现状**：创建/复制也写 now（`duplicateProject` / `createBlankProject` / `CurrentProjectSession.open()` 三处），「上次打开」措辞保留。理由：该字段同时是启动台默认排序键、hero 默认选中（`mostRecentlyOpenedId`）与启动恢复锚（issue 03/20），拆 created/opened 的牵连面撞未结论的 issue 24；一句文案的诚实度不值这个价。

## 修法

1. `projectFormat.ts`：加 `M = 60_000` 常量；`delta < M → justNow`；`delta < H → minutesAgo`（`Math.floor(delta / M)`）；其余三档不动。
2. i18n 两语言各加 `projects.time.minutesAgo`：「{{n}} 分钟前」/ "{{n}} minutes ago"。
3. 使用处自动跟随，无 UI / CSS 改动。

## 锁测

1. 新增 `tests/unit/project/projectFormat.test.ts`：五档边界逐条（0s / 59s / 60s / 59min / 60min / 23h / 24h / 29d / 30d / 60d），`now` 可注入（函数已带 `now = Date.now()` 默认参）。
2. 每一档边界各锁一条：加新档不许悄悄改旧档边界（撤掉任一边界断言应立刻红）。
