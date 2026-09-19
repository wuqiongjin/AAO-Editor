# 129 · tests 目录：按领域与类型分层

Type: chore
Status: resolved

## 来源

为「未来适配更多模块、甚至是更多平台」做测试体系整改。整改前 `tests/unit/` 是 69 个文件的单层平铺，
加模块只能继续往同一个文件夹里堆，加平台无处安放。并发发现 `npm run lint` 全量失败（124 error），一并收口。

## 根因

测试目录是**按"被测对象名"平铺**长出来的，缺第二个分类维度。由此：
- 「平台」只能靠文件名后缀硬凑（且没凑全）；
- 「静态源码断言」这类**性质完全不同**的测试无处可去，只能混进 `unit/`；
- 共享替身没有家，于是每个文件各写一份。

## 定案（用户 2026-09-19）

| # | 口径 |
| --- | --- |
| 1 | 分两维：**领域**（镜像 `src/`）+ **测试类型**（`unit` / `platform` / `perf` / `static`）。 |
| 2 | 平台归属靠**目录**（`platform/electron`、`platform/browser`），**不再用 `.electron.test.ts` 后缀**；未来新增平台整目录加，不往 `unit/` 塞。 |
| 3 | 文件名 **PascalCase**，描述**被测的行为/领域**（一个文件可跨多模块）；**不用 issue 号当文件名或目录名**——issue 会关，领域不会。`describe` 里的 `issue NN ·` 前缀保留。 |
| 4 | 引用被测代码一律走仓库根别名 `@/src/...` / `@/electron/...` / `@/tests/support/...`，**禁用相对路径**。 |
| 5 | 共享替身收进 `tests/support/`（不参与收集）。 |
| 6 | 新增大类目录必须在 `vitest.config.ts` 的 `test.include` 显式登记——**有意**不让慢测试悄悄混进日常全量跑。 |
| 7 | `environment: 'node'` 不变，不引 jsdom；要真 DOM 渲染测试时单独配 environment。 |
| 8 | lint：`tests/**` 放开 `no-explicit-any`（测试替身天然靠结构性 any）；`react-refresh/only-export-components` 降为 warn（本仓 Provider 文件同时导出组件与 `useXxx` hook 是 ADR-0003 §7 的既定约定，属 DX 损失，不该阻断构建；用户 2026-09-19 认可）。 |

## 实现落点

- `tests/` → `support/` + `unit/{audio,chart/{code,config,editing,geometry,layout,project},layouts,playback,settings,tools,ui,visual/{render,hitTest,skin,cache}}` + `platform/{electron,browser}` + `perf/` + `static/`。
- `tests/support/{canvas,source,storage,fs}.ts`：收编 4 类高频重复替身，分别被 **10 / 24 / 4 / 2** 个文件复用。
  `canvas.ts` 提供 5 种：记录型 `makeRecordingCtx`（可覆写单个方法）、计数型 `makeCountingCtx`、
  总次数型 `makeTallyingCtx`、空实现 `makeNoopCtx`、瓦片变换记录型 `makeTransformRecordingTile`。
- `vitest.config.ts`：`resolve.alias['@']` = 仓库根；`test.include` = `tests/{unit,platform,static,perf}/**/*.test.ts`。
- `tsconfig.test.json`（新）：`@/*` paths + vitest/node 类型；**未**加入根 `tsconfig.json` 的 references。
  `tests/tsconfig.json`（新）：仅用于让编辑器解析 `@/`（tsserver 只认最近祖先的 `tsconfig.json`，根那份是 `files: []` 不收 tests），**不是**门禁配置。
- `eslint.config.js`：tests 目录级豁免 + react-refresh 降级。
- `tests/README.md`：重写为目录约定（职责 / 四类测试取舍 / 命名 / 别名 / 环境 / 欠账）。
- src 侧无行为变化的类型修复：`BpmEvent` 空接口→类型别名、`ChartConverter` Directional 用具名类型替代 `as any`、静态层 bitmap 去 any、`no-case-declarations` 加块作用域。canvas 工厂注入点保留 `any` 并加逐行豁免注释。
- 改名：`contentShellGeometry`→`ContentShellGeometry`、`shortcutIndexFilter`→`ShortcutIndexFilter`、`ChartProject.electron`→`ChartProject`。
- 旧路径同步：`docs/adr/0003`、`docs/adr/0009`、`src/chart/editing/{SlideCombination,ToolActionMatrix}`、`src/visual/{coords,slideBandGeometry}`、`tests/perf/RendererPerf.test.ts` 里的运行命令。

## 锁测

- **用例数守恒**：迁移前后均为 1273，无用例被路径变更静默丢弃。
- **全量**：`npm test` = 69 文件 / 1273 用例全绿；`--sequence.shuffle` 与 `--pool=forks` 同样全绿（迁移未引入顺序依赖）。
- **门禁**：`npm run lint` 由 124 error → 0 error / 22 warning；`npx tsc -b` 通过。
- **路径收敛**：tests 内 `__dirname` 归零、相对 `../../src` 归零；仓库内（docs / src）无指向旧路径的失效引用。
- **替身收敛**：tests 内自造的 `new Proxy` 假 2d ctx **归零**（原 5 种写法 9 处，全部走 `support/canvas.ts`）。

## 欠账：tests 不做类型门禁（用户 2026-09-20 定案：有意不做）

`npm run test:types` 剩 **28 条**类型错误（原 70）。

- **为什么不做**：这 28 条**不影响任何测试通过**（vitest 只做运行时检查，`tests/` 也不在 `tsc -b` 里）。
  其中约 23 条改起来有**改变测试行为**的风险——见下。
- **配套**：`tsconfig.test.json` **不接**根 `tsconfig.json` 的 references，也**不进 CI**。
  口径与触发条件已写进 `tests/README.md`。
- **触发条件**：要把 tests 纳入类型门禁（`tsc -b` 或 CI required check）时再回来清。在那之前属"已知、接受"。

### 剩余 28 条的构成

| 情形 | 条数 | 能否批量 |
| --- | --- | --- |
| 纯机械：强转缺 `as unknown as` | 4 | 能 |
| 字面量拓宽（`{ type: string }` 赋给 `ChartNote`） | 3 | 能 |
| **要判断意图** | ~21 | **不能** |

第三类为什么不能批量：`CanvasGesture` / `CurveTool`（14 条）是测试**故意**只传关心的字段
（`{}`、`{armedTool:'single'}`），`cx`/`cy` 运行时是 `undefined`。为过类型检查补 `cx: 0, cy: 0`
会把 `undefined` 变成 `0`——**这是行为改动**，可能让断言从此不再验证它本来要验证的东西，
而测试自己发现不了（它还是绿的）。

## 派生待办（未做，与门禁无关）

`applyNoteCode(notes, target, code: ChartCodeNote[])` 的公开签名声明收 `ChartCodeNote[]`，
但内部 `code[0] as ChartCodeNodeProjection` 按投影形态读 `hidden`
（`NoteCodeOps.ts:43`：`ChartCodeNodeProjection = ChartCodeSingle & { hidden?: boolean }`）。

- **不是 bug**：`ChartCodeSingle` 不含 `hidden` 是**有意设计**；运行时经 `coerceNoteViewCode`
  的 `JSON.parse` 能把 `hidden` 带进来，功能正常。
- **是什么**：公开签名没表达运行时确实接受的形态，调用方想合法传投影形态会过不了类型检查，只能 cast。
- **处置**：属 note-code API 的签名问题，**建议单开票**；既然不做类型门禁，优先级低。

## Comments
