# 257 · macOS 修饰键展示、⌘Q 退出通道与能耗门禁

- **Type**: grilling
- **Status**: resolved（定案于 2026-11-26；2026-11-27 GitHub `macos-latest` 冒烟绿）
- **关联**: [ADR-0002](../../../docs/adr/0002-快捷键系统与自定义配置.md) · 前置 [210](./210-macOS能耗异常与音频硬件及应用壳保活优化.md) · [211](./211-macOS应用生命周期与关闭退出处理.md)
- **相关（本票不改）**: [19](../../release-pipeline/issues/19-macOS未签名与Apple-Silicon提示已损坏.md)（签名 / Gatekeeper，已 resolved）

---

## 来源

同一批用户（macOS 26 / Apple Silicon M4 / 16GB，Mac Mini + MacBook）在 210 / 211 落地后再次反馈。2026-11-23～26 经 Q1–Q14′ grilling 拍板。本票承载语义定案与实现落点，**不另开**。

## 症状

1. 不确定 Mac 端操作要不要改成 Command，而不是 Ctrl（快捷键页仍写 Ctrl）。
2. 发热比 210 之前好点，能耗仍高（尤其 MacBook）。
3. 退出软件必须用活动监视器强制退出（「正常关闭无法退出」）。本轮**未**坐实用户把红叉当成退出。

## 根因（已核实 vs 未测）

**已核实（仓库）**

1. `normalizeKeyEvent` 把 `ctrlKey || metaKey` 都写成内部 `ctrl`：⌘ 已经当 Ctrl 用，缺的是展示。
2. `formatKey` 无平台分支，界面一律 `Ctrl+F`。
3. 镜像出厂 `ctrl+q`。工作台 `useShortcutDispatch` 对命中键 `preventDefault` 再跑 `execMirror`。⌘Q 与系统退出是同一和弦。
4. 211 方案 B：darwin 关最后一个窗口不 `app.quit()`。没有可用的 ⌘Q 时，只剩菜单 / Dock / 强制退出。
5. 210 已拆音频死循环保活。`backgroundThrottling: false` 只影响后台页，**解释不了前台使用中能耗**。

**未在真机测过（不得写成已证实）**

- `preventDefault` 在 macOS 26 上是否真挡住菜单 ⌘Q（可能：退不出 / 先镜像再退 / 菜单仍退）。本票仍按「⌘Q 不进产品分发」做，不依赖这项测量。
- 使用中能耗的主因（电源锁 vs GPU）。交给 GitHub Mac 冒烟看 `PreventUserIdleSystemSleep`，不先猜着改画布。

---

## 定案（Q1–Q14′ 全量汇总，用户 2026-11-26 拍板）

1. **Q1 关窗**：维持 211 方案 B。红叉只关窗口，进程留在 Dock。不把红叉改成退出。⌘H 隐藏照旧。
2. **Q2 / Q5 / Q6 修饰键**：Mac 上 ⌘ 就是表里的 Ctrl。界面把 `ctrl` 显示为 `⌘`（Windows / Linux 仍写 `Ctrl`）。物理 Control 仍是同义词。
3. **Q7 / Q10 / Q13 ⌘Q**：Mac 上 **⌘Q 只退出，不再镜像**。绑定串仍是 `ctrl+q`（Win/Linux 出厂键不动）。行为拆开：
   - **⌘Q** → 不派发产品功能、不拦截，交给系统退出；
   - **Control+Q** → 仍执行镜像；
   - 快捷键页这一条在 Mac 写 **⌃Q**，避免写成 ⌘Q 像退出；
   - 改键不能绑成 ⌘Q；
   - **⌘A / ⌘S 这轮不动**（仍是技能键 / 左滑）。
4. **Q3 / Q8 / Q9 能耗与后台播放**：不回退 Retina 2x / 120Hz；不改 `backgroundThrottling`；播放中切后台不强制暂停。
5. **Q4 架构**：优化对象是 Apple Silicon 原生 arm64。不为 Intel / Rosetta 开专项；darwin 修复仍惠及 Intel Mac。
6. **Q12 / Q14 / Q14′ 验收门槛**：
   - 能单测锁死的先锁（展示、⌘Q 不进产品分发、红叉仍不 `quit`）；
   - **不在本机装黑苹果 / macOS 虚拟机**；
   - GitHub `macos-latest`（现有打包 job）无界面冒烟：启动应用 → 空闲后读 `pmset` 看是否还占「防止睡眠」→ 发退出 → 断言进程消失。**验收以进程和电源锁为准**，不要求看到活动监视器 / Dock；
   - 冒烟挂在现有 macOS 打包 job 上，**不给每次 PR 加一台 Mac**；该 job **顺带跑现有单测**（Q12）；
   - **电源锁还在，再改音频空闲挂起**；锁不在就不动画布 / 节流 / 空闲时长。

事件层怎么认「这是 ⌘Q 而不是 Control+Q」写在实现落点，不定成用户语义。

---

## 实现落点（待动手）

1. **展示（Q5 / Q10）**：`formatKey`（快捷键页拆段、tooltip、导航提示同源）按平台：`ctrl` → Mac 上 `⌘`；**仅**保留键 `ctrl+q` 在 Mac 显示 `⌃Q`。内部绑定串不改。文档站「表上写 Ctrl，Mac 上就是 ⌘」在实现后改成与界面一致（否则会反着）。
2. **⌘Q 通道（Q7 / Q10 / Q13）**：darwin 上「Command+Q、不是物理 Control+Q」不走 `resolveAction` 命中 `execMirror`，分发层不 `preventDefault`。物理 Control+Q 仍镜像。改键捕获拒绝 ⌘Q。推荐认键：`metaKey && !ctrlKey` 且主键 `q`（实现细节，可被单测锁；真机若和弦不同再收）。
3. **ADR-0002**：头部修订 Mac 展示与 ⌘Q 保留；§2.2 镜像执行键在 Mac 上的语义；§5 tooltip 展示随平台。CONTEXT 只在术语表出现「Ctrl」且会误导 Mac 展示时补一句，不另开新术语。
4. **能耗门禁（无提前改产品逻辑）**：现有 macOS 打包 job（`build-artifacts.yml` 的 `build-macos`；发版矩阵同机可复用）加冒烟，并顺带 `npm test`。空闲等待 **≥ 210 的 30s**（`AudioEngine.IDLE_SUSPEND_DELAY_MS`）再读 `pmset`。发退出优先向渲染进程注入 ⌘Q（与用户按键同路）；不得只用 AppleScript `quit` / `app.quit()` 冒充 ⌘Q 已通。若电源锁仍在，**本票内**再改 `AudioEngine` 空闲挂起；锁不在则能耗侧只交冒烟绿。
5. **不改**：`handleWindowAllClosed` darwin 不 quit；`backgroundThrottling`；TILE_DPR / 120Hz；播放中切后台自动暂停；execMirror 出厂串（仍 `ctrl+q`）；⌘A / ⌘S。

---

## 锁测

1. **`tests/unit/settings/ShortcutConfig.test.ts`**（及 dispatch）：
   - `formatKey('ctrl+f')` 在 Mac 为 `⌘F`，在 Windows / Linux 为 `Ctrl+F`；
   - `formatKey('ctrl+q')` 在 Mac 为 `⌃Q`；
   - `metaKey`、无 `ctrlKey`、主键 q 在 darwin **不** `resolveAction` 到 `execMirror`；
   - 物理 `ctrlKey`+q 仍是 `execMirror`；
   - 改键捕获拒绝 ⌘Q。
2. **`tests/unit/electronLifecycle.test.ts` / `tests/static/ElectronMenuPlatform.test.ts`**：darwin 关窗仍不 `quit`；菜单仍有 `role: 'quit'`（防回归 211）。
3. **CI 冒烟（单测覆盖不到的进程级）**：`macos-latest` 现有打包 job：跑现有单测 → 启动 Electron → 空闲 ≥30s → `pmset -g assertions` 不含本应用 `PreventUserIdleSystemSleep` → **注入 ⌘Q** 后进程退出。无界面。电源锁失败则按定案改音频，不动画布。AppleScript 退出只能当辅证，不能单独算 ⌘Q 通。
4. **手工清单**（给反馈用户，**不阻塞合入**）：⌘Q 能否退出；红叉后天鹅还在；Dock 右键退出；活动监视器「防止睡眠」是否为「是」。

---

## Comments

- **2026-11-26 grilling 定案归档**（用户拍板；完整问答在会话内）：
  - Round 1：Q2 ⌘ 就是 Ctrl、Q3 不回退 Retina/120Hz、Q4 以 arm64 为对象均 OK。Q1 初稿误把「正常关闭」读成红叉，改为维持 211。
  - Round 2：Q5 界面写 ⌘、Q6 Control 同义、Q7 ⌘Q 只退出、Q9 播放中切后台不停，均 OK。Q8 查明 `backgroundThrottling` 与前台能耗无关，定不改。Q10 否决全局改成 Shift+Q。
  - Round 3：Q10 改为 Win/Linux 出厂不动、只剜 Mac ⌘Q。Q12 验收门槛 OK。否决本机黑苹果。
  - Round 4：Q13 只拆 ⌘Q、不动 ⌘A/⌘S。Q14 / Q14′ GitHub 真 Mac 冒烟验进程退出 + 电源锁，OK。
  - 行业对照：Apple HIG Command-Q = Quit；VS Code / Figma / Electron 均保留；Bestdori 网页在 Mac 上 ⌘Q 本就不会进页面。
- **2026-11-26 自检**：对照定案修订本票——补症状/根因（分开已核实与未测）；19 从前置降为相关；Q9 写入「不改」；冒烟钉死 ≥30s 与注入 ⌘Q，禁止用 AppleScript quit 冒充；补 Q12「打包 job 顺带跑现有单测」。
- **2026-11-26 开工确认**（用户答复，补强实现口径，不改 Q1–Q14′ 定案）：
  - 用户**没有可用真机**，手工清单无法执行 → 不靠手工兜底；用 GitHub `macos-latest`（本身就是真 Mac）跑 CI 冒烟，⌘Q 退出断言放在 CI。先探 runner 上 `System Events` / `CGEvent` 辅助功能权限；若做不到，把实测结论回报用户再定，不用 AppleScript `quit` / `app.quit()` 冒充。
  - 冒烟对象选**源码模式 `electron .`**（与 dmg 分发包的差异记录在案）。
  - 若 CI 显示电源锁仍在，**先回报测量值给用户拍板**，不自选阈值改 `AudioEngine`。
  - 冒烟失败让 `build-macos` job 红、阻断 artifact 上传；`ci.yml gate` 的 `npm test` 不变（macOS job 顺带再跑一遍按定案保留）。
  - 改键捕获拒绝 ⌘Q 复用现有冲突提示通道（弹窗不关、就地提示、草稿保留可重按），文案「⌘Q 保留给系统退出」。
- **2026-11-26 实现记录**：
  - **展示**：`src/settings/ShortcutConfig.ts` 新增 `shortcutPlatform()`（渲染进程先走 `navigator.userAgentData/platform`，Node / 主进程回落 `process.platform`，测试可显式传或桩 `navigator.platform`）；`formatKey(key, platform)` Mac 按 Apple 惯例连写字形（`⌘F` / `⌘⇧Q` / `⌘Space`），仅保留串 `ctrl+q` 显示 `⌃Q`；`categoryShortcuts` 透传平台，快捷键页 / tooltip / 导航提示同源。Win/Linux 展示与绑定串均不变。
  - **⌘Q 通道**：新增 `isReservedSystemQuit(e, platform)`（`darwin && metaKey && !ctrlKey && q`），`resolveAction` 在命中前直接返回 null ⇒ `useShortcutDispatch` 不 `preventDefault` 不派发，交给系统菜单；物理 Control+Q 仍镜像，⌘A / ⌘S 不动。改键录制弹窗复用冲突提示拒绝 ⌘Q，i18n 中英各加一条。
  - **文档**：ADR-0002 头部 + §2.2 / §5 / §6，CONTEXT 术语表「执行」，文档站中英 features 同步。
  - **CI**：`.github/workflows/build-artifacts.yml` 的 `build-macos` 加 `npm test` + `bash scripts/ci/macos-smoke.sh`（在 `electron:dist` 之后、上传 artifact 之前）；新脚本用源码模式 `electron .`，空闲 40s（≥ 30s）后解析 `pmset -g assertions` 的 `PreventUserIdleSystemSleep` 汇总与进程级断言，再用 `osascript` 的 `System Events` 发系统级 ⌘Q 并断言进程消失（僵尸态按已退出处理），失败信息直接指向本票口径。静态锁测在 `tests/static/ReleasePipeline.test.ts`。
  - **验证**：新增 7 条 257 红测先红后绿；`npm test` 全量 **474 文件 / 5410 用例通过**；改动文件 `eslint` 无报错；`tsc -p tsconfig.test.json` 在本票改动文件中无错误（仓库现存 `ShortcutIndexFilter.test.ts` 的 copy/paste/cut 类型错误属 issue 256 遗留，本票未动）。`bash -n` 校验冒烟脚本通过。
  - **未验证 / 下一步**：本机 Linux，**CI 冒烟脚本未在真 Mac 上跑过**。需手动 dispatch `build-artifacts.yml`（platform=macos）首次实跑：若 `osascript` 辅助功能权限不足 → 按开工确认回报用户，不改口径；若电源锁仍为 1 → 先回报测量值，再由用户拍板是否改 `AudioEngine` 空闲挂起。两者都绿再把状态改 `resolved`。未改 `AudioEngine` / `backgroundThrottling` / TILE_DPR / 120Hz / 生命周期 / 出厂串。
- **2026-11-26 双轴 code-review 后修订**：
  - **已改 6 项**：① 删掉 `tests/static/ReleasePipeline.test.ts` 里断言冒烟脚本源码文本的 2 条用例（违反 `tests/README.md` §各类型的取舍：static 只留接线事实），只保留 workflow 接线锁；脚本内电源锁 / ⌘Q 契约交真机首跑验。② `scripts/README.md` CI 脚本表补 `ci/macos-smoke.sh` 一行。③ 冒烟脚本抽 `dump_log()` 去掉四段重复日志打印。④ `formatKey` 用局部 `mac` 收敛重复平台分支。⑤ 去掉无调用方的 `IDLE_SECONDS` 环境覆盖，固定 40s。⑥ 冒烟脚本把「电源锁结论」与「⌘Q 退出断言」拆开：先 `::warning::` 记录锁测量值，仍跑完 ⌘Q 注入与退出断言，最后再按锁结论 fail——锁没清也能拿到退出通道结论（评审指出原实现在锁失败时提前 return，恰好漏掉用户最关心的 ⌘Q 验证）。
  - **补 2 个 DOM 锁测**（评审指出原锁测只测纯函数）：`tests/dom/settings/ReservedQuitDispatch.test.tsx` 锁住 darwin ⌘Q 不派发 / 不 `preventDefault`、Control+Q 仍派发 `execMirror`；`tests/dom/pages/ShortcutsPageReservedQuit.test.tsx` 锁住录制弹窗按 ⌘Q 后不关窗、草稿不写入、Control+Q 可继续录制。两者桩 `navigator.platform='MacIntel'` 锁 darwin 分支。
  - **未改 2 项及理由**：跨文件文档同步（ADR / CONTEXT / 文档站 / i18n）是本票实现落点明确要求，不是 Shotgun Surgery；Mac 连写与 `⇧`/`⌥` 字形是 `formatKey('ctrl+f') → ⌘F` 锁测 + Apple HIG 的自然延伸，已写进本票实现记录，不回退成 `⌘+Shift+Q`。
  - **复验**：`npm test` 全量 **476 文件 / 5411 用例通过**（新增 3 条 DOM、删去 2 条越界 static）；改动文件 `eslint` 无报错；`bash -n` 通过。CI 冒烟仍待真 Mac 首跑，状态维持 `claimed`。
- **2026-11-27 CI 冒烟定位并修掉 quit 不退出的根因**：
  - **现场**：`build-macos` 连续红在「系统级 ⌘Q 后进程仍在」。真机时间线显示 `before-quit → window close → wc destroyed → will-quit → quit` 全部 200ms 内跑完，但进程一直活着；菜单 Quit 同样不退；同机最小 Electron 应用 ⌘Q 正常退出。电源锁侧本应用不持有 `PreventUserIdleSystemSleep`。
  - **根因（V8 CPU profile 坐实）**：54s profile 里 **10,271/12,311 个 JS 采样落在 `syncAllWindowsChrome → applyNativeThemeSource`**。`nativeTheme.on('updated')` 回调在 `system` 主题下无条件 `syncAllWindowsChrome`，而 `applyNativeThemeSource` 无条件写 `nativeTheme.themeSource = 'system'`；Electron 对 **同值赋值也会再发 `updated`**，于是形成 `updated → sync → themeSource=system → updated` 永动循环。主消息循环因此永不 idle，`app.quit()` 的 `QuitWhenIdleClosure` 永远等不到 → 进程退不掉；同一循环也是主进程持续耗 CPU 的来源（能耗症状）。
  - **修法**：`applyNativeThemeSource` 同值跳过（`nativeTheme.themeSource !== source` 才写），切断自激；OS 深浅变化时仍由 `applyBrowserWindowChrome` 读新的 `shouldUseDarkColors` 更新窗体背景，issue 126 语义不变。锁测 `tests/platform/electron/ElectronWindowChrome.test.ts`「同值跳过、不同值才写」。
  - **清理**：删除冒烟排查用的主进程 `AAO_SMOKE_DIAG` 临时诊断（心跳 / 句柄探针 / CPU profiler）与冒烟脚本里的最小 Electron 对照、AX 菜单、截图、sample、分发包对照；冒烟回到「空闲 40s → `pmset` → 系统级 ⌘Q → 进程消失」。
  - **验证**：本地 `npm test` 全量 **476 文件 / 5434 用例通过**，改动文件 `eslint` 无报错；GitHub `build-artifacts` run #16 的 `build-macos` 绿：`pmset` 无本应用 `PreventUserIdleSystemSleep`，⌘Q 注入后约 2s 内进程消失，artifact 正常上传。方向键/修饰键展示与 ⌘Q 保留逻辑均未回退。
