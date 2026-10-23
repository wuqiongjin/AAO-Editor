# 01 · 进工程详情的 DOM 测试与目录加载竞态（CI 门禁偶发红）

Type: bug
Status: resolved（2026-10-23 实现 + 锁测；待门禁连续绿）
Blocked by: —

## 来源与症状

2026-10-23 CNB 门禁报 `AccountBar.test.tsx`「详情视图：未登录 → 账号行写『登录』」失败：`Unable to find an element with the text: 甲工程`，DOM 停在 pending 骨架网格；本地全绿，非代码回归。`enterDetail()` 等「全部工程」标题后同步取 `.pb-grid` + `getByText('甲工程')`——标题在目录未就绪时也渲染（`ProjectHub.tsx:239`，不受 `ready` 门控），断言撞上首帧 `PendingGrid`。

## 根因

等的是 pending 态也存在的标题，不是就绪信号；能否等到还取决于两个宏任务的先后：React 渲染任务（Scheduler 0.26 在 Node 优先 `setImmediate`，check 相位）vs RTL `asyncWrapper` 的 `setTimeout(0)` 收尾让渡（timers 相位）。Node 中二者先后取决于入队时循环相位——本地 `immediate` 先跑故稳过，CI 相位翻转则让渡先解析，测试握住尚未被替换的 pending 网格（就绪时该节点被卸载，旧引用上永远等不到卡片）。

## 修法

`await screen.findByText('全部工程')` 一律换成 `await waitFor(() => expect(document.querySelector('.pb-card[data-project-id]')).not.toBeNull())`——**选择器必须带 `[data-project-id]`**：pending 占位卡的 class 也是 `pb-card`（`ProjectHub.tsx:55`），等裸 `.pb-card` 会在骨架态秒过、等于没等。共 **15 处 / 9 文件**，逐文件清单见 Comments 首条。

两条禁令：`await screen.findByText(<工程名>)` 会与 hero h2 撞 multiple-match（`getNodeText` 只取直接文本节点）；`await within(grid).findByText(...)` 握的节点就绪即被替换脱离文档。hero 钮那处（`WorkspaceEntryPoints` ①）改用 `await screen.findByRole('button', { name: /进入工作台/ })`——等就绪态元素本身。

## 锁测

上述文件 enterDetail 系列用例即锁测；相位翻转单测抓不到（本地单跑必然绿），替代验证 = 本地 30 连跑 + 相位翻转复现 + 门禁连续绿。

## Comments

- 2026-10-23 实现落点清单（15 处 / 9 文件）：`AccountBar.test.tsx`（enterDetail + Q11 用例）、`ProjectPublishGate.test.tsx`（enterDetail）、`ProjectsViewTransition.test.tsx`（openDetail）、`ProjectDetailAudioRow.test.tsx`（renderDetail，原注释「// 启动台就绪」已纠）、`ProjectListKeyboardNav.test.tsx`（openDetailOf + 一處内联）、`ProjectListSplitDrag.test.tsx`（openDetail）、`WorkspaceEntryPoints.test.tsx`（openDetail + ① hero 钮 + ② 播放钮）、`ProjectCreateCopyLanding.test.tsx`（openDetailOf + copyViaCardMenu + 一處内联）、`ChartDiffLevelInline.test.tsx`（renderDetail）。已复查无漏网：其余等标题点对着常驻元素（「空白新建」tile、官方/社区导入格）或后接 `waitFor`；`ProjectCoverFallback` 等 hero 文案「继续创作」是合法就绪信号；`ProjectDeleteConfirm` 等 hero heading，本就是正确范式。

- 2026-10-23 调查（未改代码）。本地复现不了：单文件 30 连跑、全量 3576 测、Node 22.12 三跑全绿；插桩 50 迭代显示 `findByText('全部工程')` 后网格 100% 就绪。
- 环境实测（vitest 4.1.11 + jsdom 30）：`setImmediate` / `MessageChannel` 均在；事件循环相位序 `microtask → immediate → timeout`。
- 判决实验：scheduler 模块加载前把 `setImmediate` 改道到 `setTimeout(0)`（等价于相位翻转），同一序列**精确复现 CI 报错**（`Unable to find an element with the text: 甲工程` + pending 网格 DOM）。
- 超售实验（64 workers / 8 核）复现不了——非负载问题，是相位问题。
- 源码依据（node_modules）：`react-dom/cjs/react-dom-client.development.js`（`ensureRootIsScheduled` → `scheduleImmediateRootScheduleTask` → `scheduleTaskForRootDuringMicrotask` → `scheduleCallback`）；`scheduler/cjs/scheduler.development.js`（`localSetImmediate` 优先于 MessageChannel）；`@testing-library/react/dist/pure.js`（`asyncWrapper` 的 `setTimeout(0)` 收尾）；`@testing-library/dom/dist/wait-for.js`（标题首帧即在，waitFor 同步 resolve）。
- 备选根治方向（未定案）：测试基建层提供统一 `enterProjectDetail(name)`（等 `[data-project-id]` → 点击）收敛全部调用点；或页面侧把标题也挂 `ready` 门控（会动产品行为，需单独评估，勿顺手改）。
- 2026-10-23 范围修订：开票时只列了 4 处，grep 全量后实为 **9 处 / 6 文件**（已回填「修法」）。该模式是系统性的——每个采纳 issue 29 骨架屏的页面都会催生新的「等标题→同步断言」实例，故本票按持续性的测试基建 effort 跟踪，而非一次性 bug。
- 2026-10-23 时间线：出事用例随 `cf0b2133`（2026-10-14）进门禁，10-23 首次红。单次样本无法区分「CI 环境漂移后必现」与「CI 上也偶发」——机制上按环境是全有全无，不是掷骰子。环境漂移源之一：`.cnb.yml` 门禁镜像写的是浮动 tag `node:22`，Node 小版本更新可静默改变这类时序行为（钉版本是独立议题，本票不顺手改）。
- 2026-10-23 范围再修订：实现前全量 grep，实为 **15 处 / 9 文件**（比上次回填的 9 处 / 6 文件又广——`ProjectCreateCopyLanding` 的 `cardOf` 三处、`ChartDiffLevelInline`、`WorkspaceEntryPoints` 的 hero/play 钮都漏在首轮清单外）。教训：这类枚举不能只 grep `getByText`，`getByRole` / `querySelector('.pb-card__play')` 等同款竞态要一并过。
- 2026-10-23 实现：15 处全部改为等 `.pb-card[data-project-id]`（`WorkspaceEntryPoints` ① hero 钮改为 `findByRole` 等按钮本身）。lint 0 错；9 个受影响文件 67 测全绿。
- 2026-10-23 验证（本票验收口径第 2 条）：**相位翻转复现脚本换用修复后的等待模式后通过**——同一翻转环境（scheduler 加载前把 `setImmediate` 改道 `setTimeout(0)`）下旧模式必现 CI 报错、新模式稳过。全量门禁与 AccountBar 30 连跑结果见下条。
- 有意留下（不属本票）：`ProjectNewSourceTabs.test.tsx:175` 的「复制工程」tile 禁用断言——该 tile 常驻且 pending 态也 disabled，断言恒真（测试强度问题，非竞态，不会红门禁）。要修另开轻票。
- 2026-10-23 验收汇总：全量门禁（`npm test` = vitest run）**3576 测全绿**；AccountBar 30 连跑 **0 失败**；9 个受影响文件 67 测绿；lint 0 错；相位翻转验证绿（旧模式同环境必现 CI 报错）。本票实现完毕，剩门禁在 CI 连续绿即可由用户关。
