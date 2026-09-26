# 08 · DOM 组件测试基建（RTL + jsdom）

Type: chore
Status: resolved
Blocked by: —

**来源**：用户 2026-09-27 Q8（「引入 @testing-library/react + jsdom…加依赖有什么坏处」）。

**症状**：`bug`/`feature` 票强制锁测（tracker 约定），但本仓页面组件零覆盖——`vitest.config.ts` 全局 `environment: 'node'`、include 只收 `tests/{unit,platform,static,perf}/**/*.test.ts`（无 `.tsx`），现状只能靠 `tests/static/` 源码文本断言（README L55 自承是过渡手段）。本批 09~15 全是页面行为，没有 DOM 基建就写不出真锁测。

**根因**：历史上刻意不为小小 UI 改造加依赖，欠账累积到这次集中爆发。

**修法**：
- devDeps 加 `@testing-library/react`、`@testing-library/dom`（v16 peer）、`@testing-library/jest-dom`、`jsdom`。**全部 devDependency，不进产品包**。
- `vitest.config.ts` include 增加 `tests/dom/**/*.test.{ts,tsx}`；**全局 environment 保持 `node`**，组件测试文件头加 `// @vitest-environment jsdom` docblock（README L86-87 既有约定），避免拖慢其余 116 个文件。
- 新增 `tests/dom/`（目录镜像 src 领域）+ `tests/support/` 下必要的 Provider 替身（当前工程 / 音频会话默认上下文）。更新 `tests/README.md` 的目录结构与环境章节。
- 约定：只按 role / text 查询、断言**行为**不断言实现细节；jsdom 无布局引擎，**视觉类结论不得用 DOM 测试兜底**（仍走截图/人工门票）。

**锁测**（chore 的行为等价性）：
- `npm test` 全绿（既有 unit/static/perf/platform 不受影响——反证 environment 没被全局改坏）。
- `tests/dom/Smoke.test.tsx`：渲染一个最小组件并用 `getByRole` 断言，证明基建真的可用。
- `tests/static/TestRunnerWiring.test.ts`：静态源码断言——include 含 `tests/dom`、默认 environment 仍为 `node`。
  （票初稿写作 `VitestConfig.test.ts`，按 `tests/README.md` 命名约定「描述被测的行为 / 领域，不是被测文件名」
  改名——用户 2026-09-27 拍板。）
- 增量保持在 ±3s 内（`npx vitest run` 跑一次记数写进本票 Comments）。

## Comments

**2026-09-27 实现落地**

改动文件：
- `package.json` / `package-lock.json`：devDeps 加 `@testing-library/react@16.3.3`、`@testing-library/dom@10.4.2`（RTL16 peer）、`@testing-library/jest-dom@7.0.1`、`jsdom@30.1.1`。**全部 devDependency，`dependencies` 未动**（不进产品包）。
- `vitest.config.ts`：`include` 追加 `tests/dom/**/*.test.{ts,tsx}`；`environment: 'node'` 未动。
- `tests/support/providers.tsx`（新）：Provider 替身。两个 Provider 本身就有注入点（store / session），
  所以只补注入物——`makeMemoryProjectBackend`（内存 `ChartProjectBackend`，暴露 `disk`）、
  `FakeAudioEngine` + `makeTestAudioSession`（`createAudioSession` + 假引擎，不建 AudioContext）、
  `TestProviders` / `renderWithProviders`。未接 Config/UI/Editing——业务 Provider 由各测试按需自己套。
- `tests/dom/Smoke.test.tsx`（新）：文件头 `// @vitest-environment jsdom`，3 条——真实 `src/ui/ActionBtn`
  按 `getByRole` 查询 + 点击回调触发；默认替身下读 `useCurrentProject`/`useAudioSession`（未打开工程 / 时长 30）；
  注入 session 后读到 120（证明注入生效）。
- `tests/static/TestRunnerWiring.test.ts`（新）：静态锁 include 含 `tests/dom`、默认 environment 仍 `node`。
  README 命名约定要求文件名描述行为/领域而非被测文件名（`vitest.config.ts`），故未取 `VitestConfig`。
- `tests/README.md`：目录结构补 `dom/` + `support/providers.tsx`，取舍表补 `dom/` 行，环境章节改写
  （docblock 开 jsdom 的写法 + 三条 dom 测试约定：只按 role/text、用替身、视觉结论不用 DOM 兜底）。
- `tests/tsconfig.json`：`include` 补 `**/*.tsx`（编辑器要解析 JSX）。
- `eslint.config.js`：测试豁免块 `tests/**/*.ts` → `tests/**/*.{ts,tsx}`。

**计时（`npx vitest run`，同机）**

| | Test Files | Tests | vitest Duration | wall |
| --- | --- | --- | --- | --- |
| 改前 | 115 | 1615 | 4.21s | 4.49s |
| 改后 | 117 | 1620 | 4.49s | 4.87s |

增量 **+0.28s（vitest 口径）/ +0.38s（wall）**，在 ±3s 内。既有 unit/static/perf/platform 全绿，
反证 environment 没被全局改坏。

**待办 / 未做**
- `tests/dom/` 目前只有平铺的 `Smoke.test.tsx`，领域子目录（镜像 `src/`）等 09~15 落地时按域建。

**命名定案（用户 2026-09-27）**：静态锁测文件取 `tests/static/TestRunnerWiring.test.ts`，
不取 `VitestConfig.test.ts`——命名看"被测的行为 / 领域"（测试运行器接线），不看被测文件名。
