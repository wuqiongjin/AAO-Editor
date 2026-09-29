# 01-project域独立与工程页拆解

Type: chore
Status: resolved

> **2026-09-29 复核修订**：本票 2026-09-26 开出后未开工；期间 `chart-projects` 连续落地，原票的路径清单 / 行数 / 组件名已过时。本版按当前仓库重写「现状核对 / 目标结构 / 重构落点 / 锁测要求」；**目标口径不变**（工程域升顶层 + 工程页拆解 + 跨页 UI 下沉），仍是纯搬迁、不改任何行为。

## 来源与目标

- **来源**：[ADR-0015](../../docs/adr/0015-歌曲级谱面工程与工程管理页入口.md) 将谱面工程升格为“一首歌的持久化容器（包含音频、封面、时长和 1..N 张谱面）”。但工程域至今嵌在 `src/chart/project/` 之下，形成领域概念倒置，且被 `app` / `ui` / `audio` / `pages` 各层反向伸手引用。
- **目标**：
  1. `src/chart/project/` 提升为顶层领域 `src/project/`；
  2. 跨工作台与工程管理页共用的工程 UI 资产（`ChartInfoDialog`、`projectUi.tsx`）下沉到 `src/project/ui/`；
  3. 拆解 1056 行的 `src/pages/ProjectsPage.tsx`，收进 `src/pages/projects/`。

## 现状核对（2026-09-29）

### 一、工程核心：`src/chart/project/`（10 文件，1607 行）

| 文件 | 行 | 说明 |
| --- | --- | --- |
| `ChartProject.ts` | 447 | 数据结构 / store 契约 |
| `projectCatalog.ts` | 248 | 增删改查、复制、命名等纯函数 |
| `useChartProjectPersistence.ts` | 262 | 持久化钩子 |
| `CurrentProjectSession.ts` | 144 | 活跃工程会话 |
| ✦ `chartReadonlyGate.ts` | 122 | 已上传只读闸门（chart-projects 06） |
| `workspaceProject.ts` | 110 | 工程与工作台状态投影 |
| ✦ `exportChartCode.ts` | 72 | 谱面代码导出（票 118 落点） |
| ✦ `projectSort.ts` | 69 | 排序纯函数（票 19 #4） |
| ✦ `currentProjectPointer.ts` | 67 | 当前工程落盘指针（票 20） |
| `ChartProjectPersistenceMerger.ts` | 66 | 持久化合并 |

✦ = 原票开出后新增。**移动方式：整目录原样搬，不拆不改**（`exportChartCode` 与 Electron 另存链路相关，照搬）。

### 二、跨层消费面（域倒置的证据）

- `src/app/providers/CurrentProjectProvider.tsx` → `chart/project/{ChartProject,CurrentProjectSession}`
- `src/ui/ScopePicker.tsx` → `src/pages/projectUi`（`src/ui/` 反依 `src/pages/`，双层倒置）
- `src/audio/AudioPage.tsx` → `pages/projectUi` 的 `lockedChartLabels`
- `src/chart/Editor.tsx` → Toolbar / ChartSwitcher / projectUi / project 全套（02 票负责）
- `src/pages/**`、`src/pages/WorkspacePage/**`

### 三、工程页资产散在 `src/pages/` 根部

- `ProjectsPage.tsx` **1056 行**（原票写 ~700）、`ProjectsPage.css`
- `ChartInfoDialog.tsx`（82 行）、`projectUi.tsx`（62 行）
- ✦ `ProjectListSplit.tsx`（65 行，详情页左栏拖拽，票 23）
- ✦ `projectGridSelection.ts`（46 行，网格方向键纯函数，票 14/23）

### 四、`ProjectsPage.tsx` 内部结构（拆解落点照此对齐）

| 现符号 | 位置（约） | 说明 |
| --- | --- | --- |
| `ProjectsPage`（default） | 387 行起 | 双视图调度 + 全部 state / mutate / 弹窗编排 |
| detail 分支 | 663~830 行 | **整块内联在主组件里**：左栏工程列表 + `ProjectListSplit` + 右侧头部/谱面行/上传区 |
| `ProjectStartView` | 857~1056 | 启动台：hero、新建磁贴、排序、卡片网格、方向键 |
| `GuideBanner` | 844 | 0 工程引导横幅 |
| `NewProjectDialog` | 247 | 新建（空白 / 复制 / Bestdori 占位） |
| `EditInfoDialog` | 316 | 编辑工程信息 |
| `Cover` / `StatusBadge` / `DiffLevelBadge` / `Menu` | 90~241 | 只被本页消费的小件 |
| `effectiveTitle` / `relTime` / `formatDuration` / `sourceLabel` / `statusLabel` / `parseSource` / `deleteProjectNotice` | 55~246 | 格式化纯函数 |

### 五、基线

- `npm test`（2026-09-29）：**164 文件 / 1919 用例全绿**。
- 仓库**没有** `typecheck` 脚本；类型门禁 = `npx tsc -b`。`tests/` 不进类型门禁（口径见 `tests/README.md`）。

## 目标结构

```
src/project/                      ← src/chart/project/ 整体搬入
  ChartProject.ts  projectCatalog.ts  projectSort.ts  CurrentProjectSession.ts
  currentProjectPointer.ts  workspaceProject.ts  chartReadonlyGate.ts
  exportChartCode.ts  useChartProjectPersistence.ts  ChartProjectPersistenceMerger.ts
  ui/
    ChartInfoDialog.tsx           ← src/pages/ChartInfoDialog.tsx（含 parseLevel）
    projectUi.tsx                 ← src/pages/projectUi.tsx（保留文件名，纯搬）

src/pages/projects/               ← 工程管理页的家
  ProjectsPage.tsx                ← 现主组件：路由 + 双视图调度 + 弹窗编排
  ProjectsPage.css                ← 原名
  ProjectListSplit.tsx            ← 原名
  projectGridSelection.ts         ← 原名
  projectFormat.ts                ← 7 个格式化 / 标签纯函数
  components/
    ProjectHub.tsx                ← ProjectStartView + GuideBanner
    ProjectDetail.tsx             ← 现 detail 分支整块
    ProjectDialogs.tsx            ← NewProjectDialog + EditInfoDialog
    ProjectBits.tsx               ← Cover / StatusBadge / DiffLevelBadge / Menu
```

**提升规则（别过度抽象）**：只有**跨页有消费者**的才进 `src/project/ui/`——即 `ChartInfoDialog` 与 `projectUi.tsx` 现导出（`displayProjectName` 被 `ChartInfoDialog` / `ProjectsPage` / `ui/ScopePicker` 用；`ChartStatusIcon` / `ProjectMenuItem` 被 `WorkspacePage/ChartSwitcher` 用；`lockedChartLabels` 被 `AudioPage` 用；`untitledProjectLabel` 被 `Editor` 用）。页内小件（`Cover` / `StatusBadge` / `DiffLevelBadge` / `Menu`）留在页内，**不搬家**。

## 重构落点

1. **核心模块搬运**：`src/chart/project/` → `src/project/`；同步修 `src/app/providers/CurrentProjectProvider.tsx`、`src/audio/*`、`src/ui/ScopePicker.tsx`、`src/pages/**`、`src/chart/**` 的 import。
2. **UI 资产搬运**：`src/pages/{ChartInfoDialog.tsx,projectUi.tsx}` → `src/project/ui/`；全仓 import 改指 `src/project/ui/`。
3. **工程页拆解**：
   - 新建 `src/pages/projects/`，`ProjectsPage.tsx` 只留：双视图调度、state/handlers、弹窗编排（`dialogs`、`newButton`、`projectMenu` 三块 jsx 可原样留或随组件下沉）；
   - detail 分支先**原样整块**抽成 `components/ProjectDetail.tsx`（props 显式传 `sel/list/uploads/locked/...`），不在本票里再拆内部；
   - `ProjectStartView`+`GuideBanner` → `components/ProjectHub.tsx`；两个弹窗 → `components/ProjectDialogs.tsx`；小件 → `components/ProjectBits.tsx`；纯函数 → `projectFormat.ts`；
   - `ProjectListSplit.tsx` / `projectGridSelection.ts` 随页搬入 `src/pages/projects/`。
4. **测试目录对齐领域**：`tests/unit/chart/project/`（12 文件）→ `tests/unit/project/`（`tests/README.md`：unit 子目录镜像 `src/` 领域）。

## 锁测要求

**净值网**：迁移前后 `npm test` 与 `npx tsc -b` 必须全绿；除路径 / import / 文件位置外**不允许任何 diff**。

必须同步修改的测试（2026-09-29 逐条 grep 所得）：

- **import 路径类**（`@/src/chart/project/*` → `@/src/project/*`）：`tests/unit/chart/project/` 全部 12 文件、`tests/unit/audio/ProjectAudioScope.test.ts`、`tests/unit/chart/code/{ChartCodeSourceFidelity,ChartConverter}.test.ts`、`tests/dom/app/{CurrentProjectProvider,PageScopeLifecycle,ProjectSwitchAudioIsolation}.test.tsx`、`tests/dom/pages/*`（12 文件）、`tests/dom/workspace/ChartSwitcherAudioEntry.test.tsx`、`tests/platform/electron/{ChartProject,ChartCodeExportSaveAs}.test.ts`、`tests/support/{providers.tsx,memoryProjectBridge.ts}`。
- **字面路径类（static 断言读源码文本）**：`tests/static/ProjectsViewTransition.test.ts`、`ProjectsGridFluid.test.ts`、`ProjectsKeyboardGuard.test.ts`（读 `src/pages/ProjectsPage.tsx|.css`）；`ProjectDetailHeadLayout.test.ts`（读 css）；`EditInfoDialogNoRawInput.test.ts`、`DialogTokenWiring.test.ts`、`NoWindowAlert.test.ts`、`AudioManagementSingleSurface.test.ts`（读 `src/pages/ProjectsPage.tsx` / `src/pages/ChartInfoDialog.tsx`）；`WorkspaceEntrySingle.test.ts`（**断言 hit 集合恰为 `['src/pages/ProjectsPage.tsx']`**，新路径是 `src/pages/projects/ProjectsPage.tsx`）；`ChartProjectPersistence.test.ts`（读 `src/chart/project/useChartProjectPersistence.ts`）；`ReadonlyGateWiring.test.ts`（读 `.../useChartProjectPersistence.ts`）；`tests/unit/layouts/PageNav.test.ts`（读 `src/pages/PageRegistry.tsx` 与 `src/pages/ProjectsPage.tsx`）。
- **页面引用类**：`tests/dom/pages/*` 与 `tests/unit/layouts/PageNav.test.ts` 中 `@/src/pages/ProjectsPage` → `@/src/pages/projects/ProjectsPage`。
- **防回潮**：拆完后 `src/pages/projects/ProjectsPage.tsx` 行数应显著下降；`src/chart/` 下不得再出现 `project/` 目录、`src/pages/` 根部不得再出现工程资产（可在 `WorkspaceEntrySingle.test.ts` 同款 static 扫描里顺带断言，实现者自定）。

## Comments

- 2026-09-29 落地。三块搬迁全部完成，未拆任何内部结构、未改任何行为：
  - `src/chart/project/`（10 文件）→ `src/project/`；目录内对外部的相对 import 改指 `../chart/*`、`../audio/*`、`../i18n`（**仅路径**）。
  - `ChartInfoDialog.tsx`（含 `parseLevel`）、`projectUi.tsx` → `src/project/ui/`；消费方 `ui/ScopePicker`、`audio/AudioPage`、`chart/Editor`、`pages/WorkspacePage/ChartSwitcher` 改指新位置。
  - 工程页收进 `src/pages/projects/`：`ProjectsPage.tsx` **1056 → 361 行**（只留双视图调度 / state / handlers / 弹窗编排），其余拆为 `projectFormat.ts`（7 个纯函数）、`components/ProjectHub.tsx`（ProjectStartView + GuideBanner）、`components/ProjectDetail.tsx`（detail 分支整块，props 显式：`sel/list/currentId/listWidth/newButton/onHome/onSelect/onOpen/onEdit/onCopy/onDelete/onChartForm/onDeleteChart/onOpenAudio/mutate`）、`components/ProjectDialogs.tsx`（两个表单弹窗 + `NewSource`）、`components/ProjectBits.tsx`（Cover / StatusBadge / DiffLevelBadge / Menu）。
  - 测试目录：`tests/unit/chart/project/` 12 文件 → `tests/unit/project/`；全仓 `@/src/chart/project/*` → `@/src/project/*`、`@/src/pages/ProjectsPage` → `@/src/pages/projects/ProjectsPage`（36 + 12 + 1 文件）。
- **口径说明（三处判断，均不涉行为）**：
  1. `ProjectStartView` 组件名保留（文件按票面叫 `ProjectHub.tsx`）—— 改名不在"纯搬迁"口径内；`ProjectDetail` 因原为匿名内联块，按文件名取名。
  2. `updateChartInfo(p, {title: c.title, diff, level}, …)` 的 `title: c.title` 原样保留（票面禁改行为，未顺手清理）。
  3. 音频跳转的作用域对象仍在页面侧构造（`setActivePage('audio', { scope: { projectId: sel.id } })` 留在 `ProjectsPage.tsx`），详情视图只收 `onOpenAudio()` —— 保住 `AudioManagementSingleSurface` 那条字面量断言。
  4. `uploads` / `locked` 没有当 props 传（票面括号里列了），改由 `ProjectDetail` 从 `sel` 内部派生 —— 两者都是 `sel.charts` 的纯函数，传进来会让同一事实有第二份来源。
  5. `tests/README.md` 的 `unit/` 目录树同步更新（`chart/project/` → 顶层 `project/`，补 `pages/`）—— 唯一被本票改到的非代码文档。
- **static 锁测随文件归属重指**（不放松断言）：`ProjectsViewTransition`（`onClick={goHome}` → 详情侧 `onClick={onHome}` + `onHome={goHome}` 两处）/ `ProjectsGridFluid`（172+120 在 hub、96 在 detail）/ `ProjectsKeyboardGuard`（hub 网格与页面详情左栏**两份**守卫同时锁）/ `NoWindowAlert`（工程页 3 处 = 页面 2 + ProjectBits 1）/ `AudioManagementSingleSurface`（扫 `src/pages/projects/` 三个文件）/ `DialogTokenWiring`（新增 ProjectDialogs / ProjectBits 进零硬编码色值名单）/ `EditInfoDialogNoRawInput`（指向 ProjectDialogs）。
- **防回潮新增** `tests/static/ProjectDomainLayout.test.ts`（4 条）：`src/chart/` 下不得再有 `project/`、跨页 UI 必须在 `src/project/ui/`、`src/pages/` 根部不得再散落工程资产、页面主组件 < 500 行。
- **门禁**：`npm test` = **165 文件 / 1925 用例全绿**（基线 164/1919，+1 文件 +4 条新锁 +2 条 `it.each` 名单条目）；`npx tsc -b` 绿；`npm run build` 绿。
- **本机既有噪声（非本票引入，未处置）**：① `tests/perf/RendererPerf.test.ts` 在全量并行下偶发红（单跑 20 条全绿，基线首跑即红）；② `npx eslint` 在 `src/project/ChartProject.ts:276`（`_audio` 未用）与 `src/project/chartReadonlyGate.ts:49`（`as any`）有 2 处 error —— 逐行核对为 HEAD 旧路径下的同一份代码，随搬迁原样保留，清理属另一笔账。
- 未开工期间的在飞风险已核：`chart-projects` 06/24 无在飞改动（工作区干净）。
