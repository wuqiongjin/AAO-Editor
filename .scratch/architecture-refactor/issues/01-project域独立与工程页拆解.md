# 01-project域独立与工程页拆解

Type: chore
Status: open

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
