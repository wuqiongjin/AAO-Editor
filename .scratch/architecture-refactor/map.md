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
- [2026-09-29 06 落地（候选 2）]：`ChartProjectRecord.ts` = 记录形状 + 一份字段表（`RECORD_FIELDS` 两个方向，`satisfies` 看守，字段集从 `ChartProject` 派生）+ 唯一写入口 `mutateProject`；五处整记录读-改-写（ProjectsPage ×2 / ChartSwitcher / projectAudio / WorkspacePage 复制谱面）+ `CurrentProjectSession.open` 全部改走它，次序约束从注解变成代码，并有 `tests/static/ProjectWriteEntryWiring.test.ts` 防回潮。存储形状零迁移（wire 仍带 present、IDB 仍内联 Blob）。跨进程双份实现不改走共享模块（无构建通道），由 `ProjectRecordCrossProcess.test.ts` 同口径锁守。门禁 176 文件 / 1994 用例 + `tsc -b` + `build` 全绿。候选 3 起可领。
- [2026-09-29 候选 1 grill 定案]：① module = `src/chart/editing/ChartConverter.ts` **原地换接口**，不搬文件、命名沿用 CONTEXT 既有词；② 新入口 `parseCodeText(text) → { code, errors }`：**一次 parse** + 结构校验，**校验与转换分离**（要 notes 的调用方自己 `convertChartCodeToNotes`），删 `validateChartCodeJSON` 与 `parseChartCodeFromJSON`；③ 保真（`text` + `pristine`）收成 state 的一个字段、与 notes **同一次 `setState`** 写（原子、无法绕过）、**不进快照栈**——撤销 / 重做照旧作废但不还原旧值（当前值语义，与今天一致）；④ 对象视图只共享解析原语，空文本保底与 `hasBeat0Bpm` 策略留调用方；⑤ Bestdori 清洗**不接线**（调用方是上传票，现在接就是按猜测设计，照 03 票 YAGNI 先例）；⑥ 允许改写被顶红的静态断言，但同票必须补等价行为锁测。
- [2026-09-29 候选 3 口径（用户拍板）]：① `renderFrameAt(target, chart, T)` **不落本票**（唯一调用者 `chart-preview/01` 未开工，照 04⑤ / 06⑤ 先例不预埋）；② `frameFor(target, view)` 的 view 取**最小面** = 现 `RenderCtx` 去掉 target 拥有的 `surface`/`dpr`，不顺手搬组件派生计算。
- [2026-09-29 候选 4 口径（用户 2026-09-29 拍板 · 二选确认）]：按 review 的 after 面抽会话 module（含播放 RAF），音频与持久化不进会话；`seconds` 以 `onSecondsChange` 回调兑现（PlaybackContext 仍是唯一真相源，不造第二份、不做直通字段 —— 08 复审 Middle Man 先例）。

## Frontier

- [01 project域独立与工程页拆解](./issues/01-project域独立与工程页拆解.md) — 已解决（2026-09-29 落地；工程域升 `src/project/`、UI 下沉 `src/project/ui/`、ProjectsPage 1056→361 行）
- [02 pages统一收敛与工作台解耦](./issues/02-pages统一收敛与工作台解耦.md) — 已解决（2026-09-29 落地；六页收进 `src/pages/` 子目录、工作台装配进 `src/pages/workspace/`、chart 不再反依 pages）
- [03 渲染层收敛为rendering](./issues/03-渲染层收敛为rendering.md) — 已解决（2026-09-29 落地；visual + chart/rendering → src/rendering，25 件四桶归位）
- [04 谱面代码解析侧收口](./issues/04-谱面代码解析侧收口.md) — 已解决（2026-09-29 落地：`ChartConverter` 出唯一入口 `parseCodeText` + 解析原语 `parseCodeRaw`（全文件唯一一处 `JSON.parse`），删 `validateChartCodeJSON` / `parseChartCodeFromJSON`，三处二次 parse 全消；05 票 Blocked by 已解除）
- [05 谱面代码文本生成与保真收口](./issues/05-谱面代码文本生成与保真收口.md) — 已解决（2026-09-29 落地：序列化出一份两个具名入口 `chartCodeProjectionText` / `chartCodeExportText`；保真并入编辑态单一 state 字段 + `ChartEditingState` 一个 commit 作废点；弹窗 / 另存为 / 落盘 / 恢复四处改走新入口。候选 1「谱面代码只从一个口进出」收口完成）
- [06 工程记录单映射与单写入口](./issues/06-工程记录单映射与单写入口.md) — 已解决（2026-09-29 落地：新增 `src/project/ChartProjectRecord.ts` 拥有记录形状与一份字段表映射（wire / IndexedDB 两表示共用），唯一写入口 `mutateProject`（flush → get → fn → save → notify）收编五处读-改-写 + 会话 open；跨进程闸门改用同口径锁测防漂移。复审后补：字段表编译期看守、接线锁。候选 2「工程记录只有一份映射与一条写入口」收口完成）
- [07 工程id白名单非字符串漏判](./issues/07-工程id白名单非字符串漏判.md) — 已解决（2026-09-29，随 06 同批落地：渲染侧补 `typeof` 兜底，与主进程 `safeProjectId` 判决逐条对齐；跨进程语料锁看守）
- [08 渲染帧构建者与缓存有主](./issues/08-渲染帧构建者与缓存有主.md) — 已解决（2026-09-29 落地：新增 `src/rendering/RenderTarget.ts`（surface/dpr + 两层离屏缓存实例的所有者、`renderFrame` 一次调用出帧）与 `src/rendering/rasterScale.ts`（`resolveCanvasDpr` / `bufferSizeFor` 唯一处）；两层缓存改 `createStaticLayerCache()` / `createNoteLayerCache()` 实例，模块级单例删除；`renderChart(target, view)` 签名收紧 + 唯一装配处 `frameFor(target, view)`；工作台画布成为 target 之一（只组装 view）。行为零变化，复审后补：出口闭环、注释对齐、blit 尺寸收口、锁测补强；门禁 179 文件 / 2008 用例 + `tsc -b` + `build` 全绿。候选 3「一帧只有一个构建者，缓存有主」收口完成）
- [09 谱面视口会话从页面里搬出来](./issues/09-谱面视口会话从页面里搬出来.md) — 已解决（2026-09-29 落地：视口装配收进 `src/playback/useChartViewSession.ts`，页面 684→606 行；静态断言随宿主改锚 + `ChartViewSessionWiring.test.ts` 防回潮；候选 4 收口完成，待用户页面验收）
- 【第二轮其余候选 · 未开票】候选 5「音频：解码结果与谱面时长各只有一份」（dir 4+3，Worth exploring）· 候选 6「桥接探测收成一个平台接缝」（dir 1，Speculative；调用方是 Bestdori 网络面，届时再领）（候选 4 已开票 [09](./issues/09-谱面视口会话从页面里搬出来.md) 并落地，见上行）

## Fog

- upload 骨架不属本图：随 `bestdori-integration` 实现票一次定（ADR-0011 三期递进：网络 IPC → 谱面浏览 → 登录 / 上传）。
