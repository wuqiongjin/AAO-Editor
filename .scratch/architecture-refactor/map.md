# Map: 仓库目录分层与能力解耦

> Effort: `architecture-refactor` · 2026-09-26

## Destination

走到尽头 = 仓库目录结构清晰分层：
1. `src/project/` 成为独立顶层域，`ProjectsPage.tsx` 完成子组件拆解，工程 UI 组件下沉到 `src/project/ui/`；
2. `src/pages/` 统一收拢所有路由页面，解决 `Editor.tsx` 与工作台组件的反向循环依赖；
3. `visual/` 与 `chart/rendering/` 合并为统一渲染基元层 `src/rendering/`；
4. 全量自动化测试无损全绿（2026-09-29 基线：164 文件 / 1919 用例）。
5. 【第二轮 · 2026-09-29 追加】四个既定方向（Bestdori 集成 → 谱面预览 → 谱面工程完善 → AI 增强）的**地基结实**：既有模块的 deepening（interface 变深、缓存有主、记录只有一份映射、次序约束进代码），**不新增功能模块、不改目录**。

## Notes

- **每次会话必读**：`CONTEXT.md`，以及当前具体 issue 关联的对应 ADR（如 01 关联 ADR-0015，见各票正文）。
- 纯架构收敛：不改变现有任何用户交互行为与谱面存储格式。
- 保证测试看守：每个文件迁移与路径调整，同步修正单测导入与路径引用。
- **2026-09-29 复核**：三票自开出后均未开工，期间 `chart-projects` 一路推进（`src/chart/project/` 增 4 文件、`ProjectsPage.tsx` 涨到 1056 行、`src/pages/WorkspacePage/WorkspacePage.tsx` 成死文件）。本图三票已按当前仓库重写「现状核对 / 落点 / 锁测」，可直接领。
- **与在飞工作协调**：`chart-projects` 的 06（谱面状态）/ 24（当前工程语义）还会摸 `ProjectsPage` 与 `src/chart/project/`；01 票开工前先确认这两张没有在飞改动，避免同一文件双写。
- 类型门禁口径：仓库**没有** `npm run typecheck` 脚本，用 `npx tsc -b`（与 `npm run build` 同口径）；`tests/` 不进类型门禁（见 `tests/README.md`「已知欠账」）。
- 【第二轮口径 · 用户 2026-09-29 定】一次架构评审（`improve-codebase-architecture`）产出的**所有**整改一律落本 effort（不另开地图），编号从 04 续；候选全部是既有代码的 deepening，**不新增功能模块**。
- 【第二轮基线 2026-09-29】03 落地后实测：`npm test` **167 文件 / 1933 用例** + `npx tsc -b` 全绿。第二轮各票以此为净值网。

## Decisions so far

- [架构方案选型与目录定案]：经过 `/grill-me` 深度梳理，确立“方案 A：域驱动收敛”；页面层统一收敛至 `src/pages/`；`project` 提升为顶层域；拆解 700 行的 `ProjectsPage` 并将工程 UI 下沉至 `src/project/ui/`；未来预览与上传走独立模块。
- 拆分 3 张递进任务票，放入 `.scratch/architecture-refactor/` 闭环跟踪。
- [2026-09-29 复核]：确认整改仍必要、且痛点加重——工程域倒置（`src/chart/project/` 被 `app` / `ui` / `audio` / `pages` 反向引用）、`chart ↔ pages` 双向依赖、`visual ↔ chart/rendering` 互相 import、`ProjectsPage` 1056 行、`pages/WorkspacePage/WorkspacePage.tsx` 死文件。三票顺次执行，每票纯搬迁不改行为，全量 1919 用例当净值网。
- [2026-09-29 口径补丁]：票内类型门禁由不存在的 `npm run typecheck` 改为 `npx tsc -b`。
- [2026-09-29 01 落地]：工程域升顶层 `src/project/`（跨页 UI 进 `src/project/ui/`），工程页拆进 `src/pages/projects/`（主组件 1056→361 行）；新增 `tests/static/ProjectDomainLayout.test.ts` 锁落点。门禁 `npm test` 165 文件 / 1925 用例 + `npx tsc -b` 全绿。02 票的 Blocked by 已解除。
- [2026-09-29 02 落地]：`src/pages/` 收拢为唯一视图装配层（`workspace/` `audio/` `assets/` `settings/` `projects/` 子目录）；工作台页壳（原 `src/chart/Editor.tsx` + `src/pages/WorkspacePage/*`）迁入 `src/pages/workspace/` 并删死壳，`chart → pages` 与 `pages → chart` 双向依赖同时消解；新增 `tests/static/PagesConvergence.test.ts` 锁落点。门禁 `npm test` 166 文件 / 1929 用例 + `npx tsc -b` + `npm run build` 全绿。03 票 Blocked by 已解除。
- [2026-09-29 03 落地]：`src/visual/` + `src/chart/rendering/` 共 25 件合流为顶层 `src/rendering/`（顶层散文件 + `primitives/` / `pipeline/` / `skin/` / `hitTest/` 四桶），两个旧目录消失；引用单向到「渲染 → chart 数据/几何」，白名单外只留 `ui/CanvasSpriteIcon` 与 `i18n` 两个既有叶子依赖；`tests/unit/visual/` → `tests/unit/rendering/`，生成脚本 `REGISTRY_OUT` 同步；新增 `tests/static/RenderingConvergence.test.ts` 锁落点。
- [2026-09-29 第二轮开幕]：一次架构评审（`improve-codebase-architecture`）产出 6 个深化候选，全部服务四个既定方向的地基（Bestdori 集成 → 谱面预览 → 谱面工程完善 → AI 增强）。用户定案：**未来所有架构评审整改一律落本 effort**，编号从 04 续。本轮先领候选 1「谱面代码只从一个口进出」，拆 04 / 05 两票**顺次执行**（同摸 `ChartConverter.ts`，不并行）。
- [2026-09-29 候选 1 grill 定案]：① module = `src/chart/editing/ChartConverter.ts` **原地换接口**，不搬文件、命名沿用 CONTEXT 既有词；② 新入口 `parseCodeText(text) → { code, errors }`：**一次 parse** + 结构校验，**校验与转换分离**（要 notes 的调用方自己 `convertChartCodeToNotes`），删 `validateChartCodeJSON` 与 `parseChartCodeFromJSON`；③ 保真（`text` + `pristine`）收成 state 的一个字段、与 notes **同一次 `setState`** 写（原子、无法绕过）、**不进快照栈**——撤销 / 重做照旧作废但不还原旧值（当前值语义，与今天一致）；④ 对象视图只共享解析原语，空文本保底与 `hasBeat0Bpm` 策略留调用方；⑤ Bestdori 清洗**不接线**（调用方是上传票，现在接就是按猜测设计，照 03 票 YAGNI 先例）；⑥ 允许改写被顶红的静态断言，但同票必须补等价行为锁测。

## Frontier

- [01 project域独立与工程页拆解](./issues/01-project域独立与工程页拆解.md) — 已解决（2026-09-29 落地；工程域升 `src/project/`、UI 下沉 `src/project/ui/`、ProjectsPage 1056→361 行）
- [02 pages统一收敛与工作台解耦](./issues/02-pages统一收敛与工作台解耦.md) — 已解决（2026-09-29 落地；六页收进 `src/pages/` 子目录、工作台装配进 `src/pages/workspace/`、chart 不再反依 pages）
- [03 渲染层收敛为rendering](./issues/03-渲染层收敛为rendering.md) — 已解决（2026-09-29 落地；visual + chart/rendering → src/rendering，25 件四桶归位）
- [04 谱面代码解析侧收口](./issues/04-谱面代码解析侧收口.md) — 已解决（2026-09-29 落地：`ChartConverter` 出唯一入口 `parseCodeText` + 解析原语 `parseCodeRaw`（全文件唯一一处 `JSON.parse`），删 `validateChartCodeJSON` / `parseChartCodeFromJSON`，三处二次 parse 全消；05 票 Blocked by 已解除）
- [05 谱面代码文本生成与保真收口](./issues/05-谱面代码文本生成与保真收口.md) — 已解决（2026-09-29 落地：序列化出一份两个具名入口 `chartCodeProjectionText` / `chartCodeExportText`；保真并入编辑态单一 state 字段 + `ChartEditingState` 一个 commit 作废点；弹窗 / 另存为 / 落盘 / 恢复四处改走新入口。候选 1「谱面代码只从一个口进出」收口完成）
- 【第二轮其余候选 · 未开票】候选 2「工程记录只有一份映射与一条写入口」（dir 1+3，Strong）· 候选 3「一帧只有一个构建者，缓存有主」（dir 2，Strong；与候选 4 同一次 grill）· 候选 4「谱面视口会话从页面里搬出来」（dir 2+3，Worth exploring）· 候选 5「音频：解码结果与谱面时长各只有一份」（dir 4+3，Worth exploring）· 候选 6「桥接探测收成一个平台接缝」（dir 1，Speculative；调用方是 Bestdori 网络面，届时再领）

## Fog

- upload 骨架不属本图：随 `bestdori-integration` 实现票一次定（ADR-0011 三期递进：网络 IPC → 谱面浏览 → 登录 / 上传）。
