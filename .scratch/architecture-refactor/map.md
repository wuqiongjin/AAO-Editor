# Map: 仓库目录分层与能力解耦

> Effort: `architecture-refactor` · 2026-09-26

## Destination

走到尽头 = 仓库目录结构清晰分层：
1. `src/project/` 成为独立顶层域，`ProjectsPage.tsx` 完成子组件拆解，工程 UI 组件下沉到 `src/project/ui/`；
2. `src/pages/` 统一收拢所有路由页面，解决 `Editor.tsx` 与工作台组件的反向循环依赖；
3. `visual/` 与 `chart/rendering/` 合并为统一渲染基元层 `src/rendering/`；
4. `src/upload/` 与 `src/preview/` 确立独立的目录骨架与类型契约，为未来能力提供扩展基底；
5. 全量自动化测试（1570+ 条）无损全绿。

## Notes

- **每次会话必读**：`CONTEXT.md`，以及当前具体 issue 关联的对应 ADR（如 01 关联 ADR-0015，见各票正文）。
- 纯架构收敛：不改变现有任何用户交互行为与谱面存储格式。
- 保证测试看守：每个文件迁移与路径调整，同步修正单测导入与路径引用。

## Decisions so far

- [架构方案选型与目录定案]：经过 `/grill-me` 深度梳理，确立“方案 A：域驱动收敛”；页面层统一收敛至 `src/pages/`；`project` 提升为顶层域；拆解 700 行的 `ProjectsPage` 并将工程 UI 下沉至 `src/project/ui/`；未来预览与上传走独立模块。
- 拆分 4 张递进任务票，放入 `.scratch/architecture-refactor/` 闭环跟踪。

## Frontier

- [01 project域独立与工程页拆解](./issues/01-project域独立与工程页拆解.md) — 待领（Status: open）
- [02 pages统一收敛与工作台解耦](./issues/02-pages统一收敛与工作台解耦.md) — Blocked by: 01
- [03 渲染层收敛为rendering](./issues/03-渲染层收敛为rendering.md) — Blocked by: 02
- [04 upload与preview扩展骨架](./issues/04-upload与preview扩展骨架.md) — Blocked by: 03

## Fog

- 静态预览分栏导出算法与离屏 Canvas 大图尺寸上限待具体实现时验证。
- 视频录制导出方案（WebCodecs vs MediaRecorder vs Electron 后台合成）待后续特性定案。
