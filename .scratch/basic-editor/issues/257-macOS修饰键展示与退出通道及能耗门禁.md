# 257 · macOS 修饰键展示、⌘Q 退出通道与能耗门禁

- **Type**: grilling
- **Status**: open（定案于 2026-11-26；待实现）
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
