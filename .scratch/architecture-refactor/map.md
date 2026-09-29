# Map: 仓库目录分层与能力解耦

> Effort: `architecture-refactor` · 2026-09-26

## Destination

走到尽头 = 仓库目录结构清晰分层：
1. `src/project/` 成为独立顶层域，`ProjectsPage.tsx` 完成子组件拆解，工程 UI 组件下沉到 `src/project/ui/`；
2. `src/pages/` 统一收拢所有路由页面，解决 `Editor.tsx` 与工作台组件的反向循环依赖；
3. `visual/` 与 `chart/rendering/` 合并为统一渲染基元层 `src/rendering/`；
4. `src/preview/` 确立独立目录骨架与类型契约，为静态长图 / 视频预览提供扩展基底（upload 骨架归 `bestdori-integration` 实现票，见 Fog）；
5. 全量自动化测试无损全绿（2026-09-29 基线：164 文件 / 1919 用例）。

## Notes

- **每次会话必读**：`CONTEXT.md`，以及当前具体 issue 关联的对应 ADR（如 01 关联 ADR-0015，见各票正文）。
- 纯架构收敛：不改变现有任何用户交互行为与谱面存储格式。
- 保证测试看守：每个文件迁移与路径调整，同步修正单测导入与路径引用。
- **2026-09-29 复核**：四票自开出后均未开工，期间 `chart-projects` 一路推进（`src/chart/project/` 增 4 文件、`ProjectsPage.tsx` 涨到 1056 行、`src/pages/WorkspacePage/WorkspacePage.tsx` 成死文件）。本图四票已按当前仓库重写「现状核对 / 落点 / 锁测」，可直接领。
- **与在飞工作协调**：`chart-projects` 的 06（谱面状态）/ 24（当前工程语义）还会摸 `ProjectsPage` 与 `src/chart/project/`；01 票开工前先确认这两张没有在飞改动，避免同一文件双写。
- 类型门禁口径：仓库**没有** `npm run typecheck` 脚本，用 `npx tsc -b`（与 `npm run build` 同口径）；`tests/` 不进类型门禁（见 `tests/README.md`「已知欠账」）。

## Decisions so far

- [架构方案选型与目录定案]：经过 `/grill-me` 深度梳理，确立“方案 A：域驱动收敛”；页面层统一收敛至 `src/pages/`；`project` 提升为顶层域；拆解 700 行的 `ProjectsPage` 并将工程 UI 下沉至 `src/project/ui/`；未来预览与上传走独立模块。
- 拆分 4 张递进任务票，放入 `.scratch/architecture-refactor/` 闭环跟踪。
- [2026-09-29 复核]：确认整改仍必要、且痛点加重——工程域倒置（`src/chart/project/` 被 `app` / `ui` / `audio` / `pages` 反向引用）、`chart ↔ pages` 双向依赖、`visual ↔ chart/rendering` 互相 import、`ProjectsPage` 1056 行、`pages/WorkspacePage/WorkspacePage.tsx` 死文件。四票顺次执行，每票纯搬迁不改行为，全量 1919 用例当净值网。
- [2026-09-29 口径补丁]：票内类型门禁由不存在的 `npm run typecheck` 改为 `npx tsc -b`；04 票收窄为 preview 一域（upload 段移出，随 `bestdori-integration` 实现票）。

## Frontier

- [01 project域独立与工程页拆解](./issues/01-project域独立与工程页拆解.md) — 待领（Status: open；2026-09-29 现状已重核）
- [02 pages统一收敛与工作台解耦](./issues/02-pages统一收敛与工作台解耦.md) — Blocked by: 01
- [03 渲染层收敛为rendering](./issues/03-渲染层收敛为rendering.md) — Blocked by: 02
- [04 preview扩展骨架](./issues/04-preview扩展骨架.md) — Blocked by: 03；视频段另待定案（见 Fog）

## Fog

- 静态预览分栏导出算法与离屏 Canvas 大图尺寸上限待具体实现时验证。
- 视频录制导出方案（WebCodecs vs MediaRecorder vs Electron 后台合成）待后续特性定案。
- upload 骨架已从 04 移出：等 `bestdori-integration` 开实现票（ADR-0011 三期递进：网络 IPC → 谱面浏览 → 登录/上传），目录分层随那张票一次定。当前 `src/upload/bestdori/sanitizeChart.ts` 只有单测消费者、无生产调用，不值得先立空壳。
- 04 的 preview 视频段先决条件：`docs/adr/` 尚无静态导出/视频预览的架构约定，方案未拍板 → 该段开工前先 grill；静态长图段可直接做骨架。（04 已收窄为 preview 一域，upload 段见上一条。）
