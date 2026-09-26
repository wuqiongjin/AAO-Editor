# 01-project域独立与工程页拆解

Type: chore
Status: open

## 来源与目标

- **来源**：[ADR-0015](../../docs/adr/0015-歌曲级谱面工程与工程管理页入口.md) 将谱面工程升格为“一首歌的持久化容器（包含音频、封面、时长和 1..N 张谱面）”，但目前 `project` 相关的核心逻辑依然被嵌套在 `src/chart/project/` 之下，形成了领域概念倒置。
- **目标**：
  1. 将 `src/chart/project/` 提升为顶层领域 `src/project/`（包括 `ChartProject.ts`, `projectCatalog.ts`, `CurrentProjectSession.ts`, `workspaceProject.ts`, `useChartProjectPersistence.ts` 等）。
  2. 将跨工作台与工程管理页共用的 UI 组件（`ChartInfoDialog.tsx`、`ChartStatusIcon`、`ProjectMenuItem` 等）从 `src/pages/` 根部迁移至 `src/project/ui/`，彻底理顺调用层次。
  3. 将近 700 行庞大的 `src/pages/ProjectsPage.tsx` 拆解为结构清晰的子组件（`ProjectHub`、`ProjectDetail`、`NewProjectModal` 等），并移入 `src/pages/projects/`。

## 现状与重构落点

1. **移动并重构工程核心模块**：
   - `src/chart/project/` -> `src/project/`
     - `src/project/ChartProject.ts`（数据结构定义与校验）
     - `src/project/projectCatalog.ts`（增删改查、排序、复制等纯函数）
     - `src/project/CurrentProjectSession.ts`（活跃工程会话）
     - `src/project/workspaceProject.ts`（工程与工作台状态投影）
     - `src/project/useChartProjectPersistence.ts`（持久化钩子）
     - `src/project/ChartProjectPersistenceMerger.ts`
   - 同步调整 `src/app/providers/CurrentProjectProvider.tsx` 与相关测试路径。
2. **沉淀工程级 UI 资产至 `src/project/ui/`**：
   - 整合 `src/pages/projectUi.tsx` 与 `src/pages/ChartInfoDialog.tsx` -> `src/project/ui/`
   - 导出 `ChartInfoDialog`、`ChartStatusIcon`、`ProjectMenuItem` 等供工作台与工程页平级引用。
3. **拆解工程管理页**：
   - 新建 `src/pages/projects/`：
     - `ProjectsPage.tsx`（主路由与双视图调度：启动台 vs 详情）
     - `ProjectsPage.css`
     - `components/ProjectHub.tsx`（启动台视图 B：继续创作、新建入口、封面墙）
     - `components/ProjectDetail.tsx`（详情视图 C：左侧列表、右侧谱面与操作）
     - `components/NewProjectModal.tsx`（新建工程弹窗）

## 锁测要求

- 既有单元测试与平台测试保持 100% 通过：
  - `tests/platform/electron/ChartProject.test.ts`
  - `tests/platform/electron/ProjectStoreFs.test.ts`
  - `tests/unit/chart/project/projectCatalog.test.ts` -> 迁移到对应测试目录
  - `tests/unit/chart/project/workspaceProject.test.ts`
  - `tests/unit/chart/project/CurrentProjectSession.test.ts`
  - `tests/unit/chart/project/ChartProjectRecord.test.ts`
- 无新增运行时警告或循环依赖。

## Comments
