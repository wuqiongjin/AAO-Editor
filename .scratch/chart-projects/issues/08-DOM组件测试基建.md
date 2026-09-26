# 08 · DOM 组件测试基建（RTL + jsdom）

Type: chore
Status: open
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
- `tests/static/VitestConfig.test.ts`：静态源码断言——include 含 `tests/dom`、默认 environment 仍为 `node`。
- 增量保持在 ±3s 内（`npx vitest run` 跑一次记数写进本票 Comments）。
