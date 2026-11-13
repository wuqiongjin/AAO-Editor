# 13-electronAPI 桥声明收拢

Type: chore
Status: resolved（2026-11-05 单提交落地并验收；原定两提交经用户复核合并，见 Comments）

> **来源**：2026-11-04 架构评审候选 2「收拢 `electronAPI` 的 15 份就近声明」（评 Strong / ports & adapters；产物 `architecture-review-20261104-193425.html`，未入库）。
> **前置已解除**：同评审 Top recommendation 是候选 1，理由是「先动它，02 的桥收拢与 07 的文本锁才有一条能测的 interface」；候选 1 已由票 12 落地（`e9d1137` / `91ea714`，2026-11-05 `resolved`）：`electron/` 收成 7 个能力域、装配根只调 15 个 `register*Ipc`、`preload.js` 留根位、35 条 IPC 通道集合逐字未变、门禁 391 文件 / 4344 用例全绿。票 12 `:97-101` 明确把候选 02 / 04 / 07 划在票外。
> 本票**行为不变**（Q1–Q6 已定案）：不改 IPC 通道名、不改 `preload.js` 暴露的形状、不改浏览器降级语义、不改 ADR 结论、不改 `CONTEXT.md`、不改用户可见交互与存储格式。

## 现状核对（2026-11-05 读码 + 全仓检索实测）

- `electron/preload.js` 仍是唯一桥：`contextBridge.exposeInMainWorld('electronAPI', {...})`，15 个命名空间 / 36 个方法 + `platform` / `versions` 两个标量，纯 JS 对象字面量、无类型声明。全仓 `*.d.ts` **0 个**，`src/types/` 只有 `chart.ts`。
- `src/` 中 `electronAPI` 实测 **18 文件 / 31 次**（评审 `:141` 记「18 个 src 文件 30 处消费」，多 1 次来自注释）。逐文件清单：
  - `src/project/`：`ChartProject.ts:237`、`ChartProjectRecord.ts:64-72`、`exportChartCode.ts:35`
  - `src/community/`：`electronTransport.ts:39-48`、`sessionPersistence.ts:29`、`assetCachePolicy.ts:30-32`
  - `src/chart/patterns/`：`PatternStore.ts:92-117`、`shareFile.ts:75-82`
  - `src/app/`：`appUpdate.ts:35-46`、`openExternal.ts:18-21`、`webNotice.ts:14-16`、`styles/theme.ts:9-11`
  - `src/diagnostics/`：`logger.ts:34-38`、`exportDiagnostics.ts:20`
  - 其它：`src/rendering/skin/backgroundSkin.ts:101-110`、`src/preview/static/saveBinary.ts:5,22`、`src/i18n/useApplyUiLanguage.ts:6-9`、`src/pages/settings/SettingsPage.tsx:67,84`
  - 形态一致：各自 `window as unknown as { electronAPI?: { <本域桥>?: ... } }` + 就近 interface（`ElectronProjectBridge` / `CommunityNetBridge` / `BackgroundSkinFileBridge` / `AppUpdateBridge` / `PreviewSaveBridge` 等），部分文件注释明写「本仓惯例：没有集中 d.ts」。
- `src/` 无 `platform/` / `bridge/` 目录，无任何统一 adapter 或桥类型声明被消费方 import（全仓检索 `*bridge*` 仅命中 `src/audio/useAudioBridge.ts` 的音频 hook，无关）。
- **三种运行时判定不是同一件事**，收拢时不能混：`src/app/webNotice.ts:14-17` 的 `hasDesktopRuntime()` 判「`window.electronAPI` 有没有」（任意一条桥，浏览器恒 false）；`src/community/electronTransport.ts:43-48,55-57` 的 `getCommunityNetBridge()` / `hasCommunityNet()` 判「按能力有没有 `communityNet`」，缺失时走 `unsupported-runtime` 降级（ADR-0011 §1/§2）；其余 16 个消费方按能力取桥。`hasDesktopRuntime()` 的消费方：`src/pages/settings/SettingsPage.tsx:204`；`hasCommunityNet()` 的消费方 3 处（`ProjectsPage.tsx:66`、`communityCapabilities.ts:35`、`AccountBar.tsx:81`）。
- **跨进程无共享构建通道**：`tests/platform/electron/ProjectRecordCrossProcess.test.ts:1-5` 记「渲染侧走 Vite/tsc、主进程走 `require .cjs`，双份实现有意保留，本测试不做合并，只让漂移必红」。因此「唯一声明」只能落在渲染侧，`preload.js` 那份形状仍独立存在。
- **净值网**：`tests/dom/` 16 个文件给 `window.electronAPI` 打桩做行为断言；`tests/static/` + `tests/platform/electron/` 共 6 个文件含 `electronAPI` 文本。其中会随「消费方源码不再出现 `electronAPI` 字面量」直接变红的断言共 **4 条**：
  - `tests/static/PreviewBinarySaveWiring.test.ts:47` `expect(saveBinarySrc).toMatch(/electronAPI/)`
  - `tests/static/PatternBackendWiring.test.ts:19` `expect(storeSrc).toMatch(/electronAPI[\s\S]{0,120}patternLibrary/)`
  - `tests/static/PatternBackendWiring.test.ts:57` `expect(shareFileSrc).toMatch(/electronAPI[\s\S]{0,160}patternLibrary/)`
  - `tests/static/CommunityDomainWhitelist.test.ts:88` `expect(impl).toMatch(/electronAPI/)`
  - 另 2 条锁的是 `preload.js` 本身（`AppLogWiring.test.ts:16`、`CommunityNetWiring.test.ts:68` 的 `exposeInMainWorld('electronAPI')`），只要 `preload.js` 不动就不受影响。
  - 需逐条复核的全树扫描类锁：`CommunityDomainWhitelist.test.ts:69,73,82`、`DiagnosticsExportWiring.test.ts:24,43-44,51-52`（`sourceFiles()` + import / 实现正则）。
- **上一张票留下的交接项**：票 12 `:34`「`ALLOWED_HOSTS` / `ASSET_SCHEME` / `PRODUCT_HOSTS` 三处互锁关系原样，归候选 02 / 04」；`:95` 把「3 组常量镜像仍靠互锁测试」记为已接受的债。`map.md:55` 另有第二轮未开票候选「桥接探测收成一个平台接缝」（Speculative，会碰 `hasDesktopRuntime` / `hasCommunityNet`）。

## 目标（评审的 after 面；实现口径见「定案与实现口径」一节）

一个渲染侧 adapter 持有桥的唯一类型声明，18 个消费方只经它进主进程，测试打在这一个 interface 上，而非各自源码文本；`preload.js` 与主进程网关的通道归属不变。评审 `:163` 明确：不要把 `CommunityTransport` 的单 adapter 扩成插件注册表。

## 待定项（开票时的问题清单；结论见「定案与实现口径」一节）

- **Q1 范围**：(A) 只收 18 个消费方的就近声明，`preload.js` 一行不动；(B) A + 顺带统一三组常量镜像（票 12 `:34` 的交接项）；(C) A + 顺带把两种运行时探测合成一个平台接缝（`map.md:55` 第二轮候选 6，Speculative，未开票）。三者工作量与风险递增，C 会同时碰 `tests/dom/` 的运行时判定断言。
- **Q2 adapter 落点与形态**：(A) 新增 `src/platform/` 顶层域持唯一声明 + getter；(B) 落在既有域内（如 `src/app/bridge/`），不新增顶层域；(C) 只在 `src/types/` 放一份类型，各域保留自己的 getter，收「形状」不收「取桥」。新增顶层域是否要配套 ADR / `CONTEXT.md` 回写也须一并拍板（票 12 Q14 曾撤回新增术语、不改 `CONTEXT.md`）。
- **Q3 跨进程口径**：唯一声明只在渲染侧、`preload.js` 由锁测守漂移（倾向；符合无共享构建通道的事实），还是先解决共享通道再做「一份声明给两边」。后者需先证明构建可行，可能超出 `chore` 边界。
- **Q4 源码文本锁**：(A) 允许改写上述 4 条文本断言，每条补等价行为断言（评审候选 7「the interface is the test surface」的方向）；(B) 正则一处不改，则消费方必须保留 `electronAPI` 字面量，本次收拢只能收类型、拿不到 07 的收益；(C) 先单独做候选 7，本票延后。注意票 12 `:92` 的「断言语义 / 正则 / 条数一处不改」是**该票票内**口径，不是仓库通用规范，本票须自行拍板。
- **Q5 降级守卫**：`unsupported-runtime`、`hasDesktopRuntime()`、`hasCommunityNet()` 三种判定与 ADR-0021（未打包/浏览器不得露出）、ADR-0023 §3（片段库独立存储、Electron 桥 + 浏览器 IndexedDB 双后端）是否原样保留并补 DOM 断言，还是随 adapter 一起改写。
- **Q6 节奏与分支**：是否沿用票 12 的先例（先 grill 定案 → 拆提交 → 每提交四连门禁），分支继续用 `fix/basic-editor/macOS-210-213` 还是另切（票 12 Q1 的「不另切」是该票自身拍板，非通用口径）。当前工作区干净，唯一未跟踪文件是评审 HTML；210–215 票全部 resolved/closed，无在飞改动冲突。

## 锁测（净值网，Q4 定案后细化）

- 基线（开票时引票 12 `:116`，开工后按 HEAD 实测更正）：`npm test` HEAD 基线 **393 文件 / 4358 用例**（最终 394 / 4369 扣除本票新增 1 文件 / 11 例推得；`git archive` 副本无 `.git`，仓库元数据相关用例会中断，故未跑副本全量）；`npm run test:types` **115 条**、`npm run lint` **25 个 error（文件+规则去重）** 为 HEAD 既有基线红，`git archive HEAD` 干净副本逐项比对**零新增**；`npm run build` 因 HEAD 基线 `tsc -b` 的 `src/rendering/pipeline/noteLayerCache.ts:762` 一条 TS2322（215 票遗留，副本同样报错）无法全绿，改以 `npx vite build` 验证产物构建成功。
- 行为侧：`tests/dom/` 16 个打桩 `window.electronAPI` 的测试断言语义原样全绿；`tests/platform/electron/` 21 个平台测试（票 12 时为 20，215 票新增 1 个）原样全绿。
- 静态侧：实测 **5 条**会红的文本断言逐条按 Q4 处理（4 条消费方字面量锁删除并补行为断言 + 1 条渲染域白名单精确扩充）；2 条锁 `preload.js` 的断言不动；全树扫描类锁逐条复核，不留假锁。
- `chore` 票同样要给锁测（`docs/agents/issue-tracker.md:37`）：先红的是 `tests/dom/app/ElectronBridge.test.ts` 导入尚不存在的 `@/src/app/electronBridge`（TDD 红），实现唯一声明处后转绿；4 条源码锁的等价行为断言逐条列在 Comments。
- **为何仍需文本锁**（DOM 行为测试盖不到的部分）：① `preload.js` 是主进程 `.cjs`，与渲染侧无共享构建通道（`tests/platform/electron/ProjectRecordCrossProcess.test.ts:1-5`），渲染侧测试无法 import 它，主进程暴露形状只能由 `AppLogWiring.test.ts:16` / `CommunityNetWiring.test.ts:68` 两条 `exposeInMainWorld` 文本锁守漂移；② `src/rendering/**` 的依赖方向是结构事实，行为测试抓不住「又反依 UI 组件层」这类回潮，`RenderingConvergence.test.ts` 的白名单锁必须保留，本票只对 `src/app/electronBridge` 精确放行一条。

## 不在本票范围（建议，已按定案确认）

- 评审候选 4（`scripts/` 路径真相）、候选 7 的全量文本锁行为化（Q4 只决定与本次收拢直接相交的那几条）。
- 删除 shallow leaf、回写 `.scratch/` 与 `docs/research/` 历史文本、任何文件重命名。
- `preload.js` 暴露形状、35 条 IPC 通道名、主进程网关归属；`CommunityTransport` 扩成插件注册表（评审 `:163` 否决）；ADR-0011 / 0021 / 0023 / 0003 结论变更；`CONTEXT.md` 词汇表变更。
- 浏览器 IndexedDB 后端与 Electron 桥的双实现合并（ADR-0023 §3 要求两条路都做）。

## 定案（用户 2026-11-05「同意推荐」）与实现口径

- **Q6 = 定案（用户 2026-11-05 拍板）**：沿用当前 `fix/basic-editor/macOS-210-213`，按票 12 先例拆提交，每提交跑 `npm test` / `npm run test:types` / `npm run lint` / `npm run build` 四连门禁；工作区干净、210–215 票全部 resolved/closed，无在飞改动冲突。
- **Q6 落地后复核（用户 2026-11-05）**：原定两提交落地后，用户指出第二提交只有票面与 `map.md` 两个文档文件、没有独立可回滚的中间态，拆分无收益，指示合并为单笔提交。本票按单笔落地，门禁仍按四连跑过两轮、结果不变（见 Comments）；票 12 的两提交先例不再当作本票形态的通用口径。
- **Q1 / Q2 / Q4 = 定案（用户 2026-11-05「同意推荐」）**；推荐理由与取舍保留如下：
  - **Q1 = A**：只收 18 个消费方的就近声明，`preload.js` 一行不动。常量镜像（票 12 `:34` 明记「归候选 02 / 04」）与运行时探测收口（`map.md:55` 第二轮候选 6，Speculative、调用方 Bestdori 网络面「届时再领」）留后续票；`src/app/webNotice.ts:5-7` 已明确「按运行时判」与「按能力判」是两种口径，不该顺手合并。一张 `chore` 同时碰跨进程常量、DOM 降级语义与三套锁测，会重演票 12 复核查出 4 处硬错误后叫停回退的局面。
  - **Q2 = 既有域内 adapter**：落单文件 `src/app/electronBridge.ts`（不新增顶层域），一个渲染侧模块持桥的唯一形状声明 + 带 `typeof window` 守卫的 `getElectronAPI()`；15 个桥 interface 集中声明并组装成 `ElectronAPI`，各域以 `export type { XxxBridge } from '…/electronBridge'` 转发既有类型名，18 个消费方只经它取桥。载荷形状仍归各域业务契约，adapter 只用 `import type` 引用、不复制第二份（开票初稿写「从 `ElectronAPI['xxx']` 派生」，双轴评审后按实际形态更正，见 Comments）。不新增顶层域、不动 `CONTEXT.md`（票 12 Q14 先例）。依据：ADR-0016 §3 的单向约束只管 `preview → rendering / chart / audio / playback`，不禁止各域 import `src/app/`；`src/community/externalLink.ts:23` 已有 community → app 先例；`tests/platform/electron/ProjectRecordCrossProcess.test.ts:1-5` 的无共享构建通道决定 adapter 只能在渲染侧。否决「新增 `src/platform/`」（会牵出 ADR / `CONTEXT.md` 回写，超出 `chore` 边界）与「只在 `src/types/` 放类型」（消不掉 18 处 `window as unknown as`，评审 `:152`「消费方只经它进主进程」拿不到）。
  - **Q4 = A**：只改写与本票直接相交的源码文本断言，每条补等价行为断言；2 条锁 `preload.js` 的断言不动；16 个 `tests/dom/` 打桩行为测试 + 21 个平台测试作净值网。不扩成候选 7（95 个 `tests/static/` 全量行为化评 Speculative，工期与风险远大）。否决「正则一处不改」：那样消费方必须保留 `electronAPI` 字面量，收拢只剩一半；票 12 `:92` 的口径只对该票有效。
- **Q3 / Q5 = 定案（用户 2026-11-05 随「同意推荐」确认）**：唯一声明只在渲染侧，`preload.js` 的形状由 `tests/static/AppLogWiring.test.ts:16`、`tests/platform/electron/CommunityNetWiring.test.ts:68` 与平台测试守漂移，不做跨进程共享模块；`hasDesktopRuntime()` / `hasCommunityNet()` / `getCommunityNetBridge()` / `unsupported-runtime` 三种判定原样保留并补 DOM 守卫断言，遵守 ADR-0011 §1/§2、ADR-0021、ADR-0023 §3。
- **原定两提交边界（落地后按上一条复核改单笔）**：第一提交 = 新增渲染侧 adapter（唯一形状声明 + `getElectronAPI()`）、18 个消费方改经它取桥、与本票直接相交的源码文本断言改写并补等价行为断言；第二提交 = 活文档 / 活注释回写、门禁结果与票面记账。每提交四连门禁，`test:types` / `lint` 的 HEAD 基线红只比对增量。合并后这两组改动进同一提交。
- **开工后复核补记（按实测更正）**：会顶红的是 **5 条**（开票时预估 4 条）：4 条消费方 `electronAPI` 字面量锁 + `tests/static/RenderingConvergence.test.ts:115-135` 的渲染域白名单（因 `backgroundSkin.ts` 新 import `src/app/electronBridge`）。`ElectronWindowChrome.test.ts:53-57` 未红——`theme.ts` 保留了 `syncElectronWindowChrome` 与 `windowChrome` 字面量；`PreviewBinarySaveWiring.test.ts:255-260` 等 import 方向锁也未红。`preview:saveBinary` 全仓原无行为测试，本票新建。逐条处置见 Comments。

## Comments

- 2026-11-05 用户确认继续推进候选 2 后开票。本票只做现状核对与待定项梳理：Q1–Q6 **未拍板**、未 grill、未开工，源码与测试零改动；`map.md` Frontier 同步加一行指针。
- 2026-11-05 开票时的判断依据：候选 1 已 resolved，前置顺序依赖解除；18 个消费方仍各自 inline cast、无统一 adapter，问题面与评审时一致；4 条源码文本锁会随搬迁变红，且跨进程无共享构建通道，故需先拍板范围与锁测口径再动手。
- 2026-11-05 用户就 Q1/Q2/Q4 问「你的推荐是什么」，Q6 明确拍板「当前分支 + 拆提交」。据此新增「定案与实现口径」节：Q6 记为用户定案，Q1/Q2/Q4 记为 AI 推荐口径待验收（`issue-tracker.md:51`），Q3/Q5 记为本轮实现口径待验收；落点推荐前复核了 ADR-0016 §3 与 `src/community/externalLink.ts:23` 的既有跨域 import 先例。本票仍未开工，源码与测试零改动。
- 2026-11-05 用户回「同意推荐。开工」，覆盖上一轮回复里的 Q1/Q2/Q4 具体推荐与 Q3/Q5 默认口径，故本节按 `issue-tracker.md:51` 标为定案（用户 2026-11-05）；Q6 在此前已单独拍板。Status 转 `claimed` 开工，源码零改动状态结束。上述三条是开票 / 推荐阶段的历史记账，按 `issue-tracker.md:50` 保留不回改。
- 2026-11-05 TDD 红→绿：先写 `tests/dom/app/ElectronBridge.test.ts`（jsdom，9 例），红在 `@/src/app/electronBridge` 不存在；实现唯一声明处后转绿。随后改造 18 个消费方（删 15 份就近 interface / inline cast，改经 `getElectronAPI()`；保留各域 getter 的 null / undefined / Partial / typeof 语义与 web 降级），`electron/preload.js` 零改动，`src/` 中 `window as unknown as { electronAPI` 只剩 adapter 一处。
- 2026-11-05 锁的逐条处置（Q4=A）：
  1. `PreviewBinarySaveWiring.test.ts:47` 删 `/electronAPI/` → `ElectronBridge.test.ts` 的 `saveBinaryAs` 有桥走桥 / 无桥 `a.download`。
  2. `PatternBackendWiring.test.ts:19` 删 `/electronAPI…patternLibrary/` → `autoDetectPatternBackend()` 有桥选文件后端 / 无桥选 IndexedDB 后端。
  3. `PatternBackendWiring.test.ts:57` 删同型正则 → `savePatternLibraryFile()` 有桥递 `{json,suggestedName}` 给 `saveAs` / 无桥降级下载。
  4. `CommunityDomainWhitelist.test.ts:88` 删 `/electronAPI/` → `ElectronCommunityTransport` 有桥把请求递给桥、无桥抛 `unsupported-runtime`；`impls).toEqual([TRANSPORT_IMPL])` 与 `/communityNet/` 等断言原样保留。
  5. `RenderingConvergence.test.ts` 白名单精确加 `/^src\/app\/electronBridge$/`，原「不反依 UI 组件层」约束不动；双轴评审后把注释里的「平台接缝」改为「桥声明模块」，避免与 `map.md:55` 第二轮候选 6 混淆。
  两条锁 `preload.js` 的 `exposeInMainWorld` 断言（`AppLogWiring.test.ts:16` / `CommunityNetWiring.test.ts:68`）一处未动。
- 2026-11-05 双轴评审（Standards / Spec）后修 4 处事实偏差：① adapter 内联的 4 组载荷形状（`SaveBinaryRequest` / `LogWritePayload` / `DiagnosticsExportPayload` / `AssetCachePolicyPayload`）改为 `import type` 引用各域，消除「唯一声明」下的第二份形状；② 补 Q5 的 `unsupported-runtime` DOM 守卫断言、communityNet 出口经桥断言、shareFile 无桥降级断言（新测试 9 → 11 例）；③ 更正 Q2 初稿「从 `ElectronAPI['xxx']` 派生」为实际形态（可选字段派生需额外 `NonNullable` 且与 `patternLibrary` 的交叉类型不兼容，实现改为集中声明 + 各域 re-export）；④ 更正 Status / Comments 的记账滞后与「开工后复核补记」的预估数字。Standards 轴另提的 Middle Man（18 个 getter 转发）、Speculative Generality（`platform` / `versions` 字段）、测试文件命名等属判断题：getter 是保留各域 null/undefined 语义与既有 API 的必要形态，`platform` / `versions` 是 `preload.js` 实际暴露的形状，按 Q1「只收声明、不动消费方接口」放行。
- 2026-11-05 门禁四连（合并前两笔各跑一轮）：`npm test` **394 文件 / 4369 用例全绿**；`npm run test:types` 115 条、`npm run lint` 25 个 error（文件+规则去重）与 `git archive HEAD` 干净副本逐项比对**零新增**；`npx tsc -b` 仅 1 条 HEAD 基线 TS2322（`src/rendering/pipeline/noteLayerCache.ts:762`，215 票遗留，副本同样报错），故 `npm run build` 因基线红未全绿；`npx vite build` 全绿、`dist/` 产物正常。文档改动不进类型 / 产物，合并后门禁结果不变。
- 2026-11-05 按 Q6 拆两提交：第一提交 = adapter + 18 消费方 + 行为测试 + 5 条相交锁；第二提交 = 本票记账与 `map.md` 指针。评审产物 `architecture-review-20261104-193425.html` 按票面记「未入库」，保持未跟踪、不进提交。按 Q8 回写 `Status: resolved` 与门禁结果。（本条为合并前的落地记账；合并决定见下一条。）
- 2026-11-05 用户复核「为什么分 2 笔了，没必要吧感觉」后指示合并。判断依据：票 12 的两提交有真实中间态（先搬目录、后归位 IPC 注册入口）且中途暂停等确认；本票第二提交只有票面与 `map.md` 共 89 行文档，无独立可回滚 milestone，照搬形式无收益——开工时未据本次改动形状调整，属实施判断失误。两笔当时均未推送（本地领先 `origin` 2），故用 `git reset --soft HEAD~2`（旧 SHA `c215602` / `a8c1b4c`）把 26 个文件收回暂存区，同步把票面 Status / Q6 复核 / 原定边界 / `map.md` 指针改为单笔，重提一个提交 `chore(architecture-refactor-13): electronAPI 桥声明收拢到唯一 adapter`。代码与测试内容一字未改，门禁结果不变；评审 HTML 仍保持未跟踪、未入库。
