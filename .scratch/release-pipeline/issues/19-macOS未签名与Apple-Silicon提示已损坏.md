# 19-macOS未签名与Apple-Silicon提示已损坏

Type: bug
Status: resolved
Blocked by: —

**来源**：用户反馈 macOS（Apple Silicon / M 芯片机型）下载 v0.1.2 arm64 安装包后打开直接弹窗拦截：“AAO Editor.app”已损坏，无法打开。你应该将它移到废纸篓。重下亦然；同版本 Intel（i 芯片）机型可启动。

## 症状

1. **用户侧拦截**：在 Apple Silicon（M1/M2/M3 等）Mac（尤其是 macOS 14 Sonoma / macOS 15 Sequoia 及更新系统）上，从 GitHub / 浏览器下载 DMG 安装后，双击打开触发系统黄标警告：“AAO Editor.app”已损坏，无法打开。你应该将它移到废纸篓。第二行明确标出由浏览器（Chrome/Safari）下载。
2. **重下无效**：重新下载依然被浏览器追加隔离属性，持续被 Gatekeeper 拦截。
3. **架构表现分化**：Intel（i 芯片，x86_64）机型未报损坏或可通过常规方式启动，而 M 芯片机型无法启动。

## 根因分析

1. **Gatekeeper 的隔离属性拦截机制**：
   - 从浏览器下载的文件会自动被打上 `com.apple.quarantine` 扩展属性。
   - macOS Gatekeeper 检查发现应用无商业 Developer ID 签名与苹果公证（Notarization）。
   - 在较新的 macOS 系统版本中，对带有隔离标记且未公证的第三方开源应用，Gatekeeper 采取严格的拦截姿态，直接报“已损坏，建议移到废纸篓”，而非早期版本的未知开发者提示。
2. **Apple Silicon（ARM64）硬性代码签名要求**：
   - Intel x86_64 历史包袱深，macOS 允许运行无签名（unsigned）代码。
   - Apple Silicon 架构从 CPU 指令集到内核（AMFI 机制）层面**强制要求所有 ARM64 原生 Mach-O 二进制文件必须拥有合法的代码签名结构**。
   - 当前 `package.json` 的 `build.mac` 未显式配置签名身份：在 GitHub Actions CI 无商业证书的环境下，`electron-builder 24` 默认直接跳过代码签名（`identity: null`），输出完全未签名的纯 unsigned arm64 二进制，导致 M 芯片系统在内核级判定其结构异常。
3. **最新 macOS（macOS 15 Sequoia 及以上）安全通道收紧**：
   - 苹果已彻底废弃按住 Control/右键点「打开」绕过门禁的快捷通道；带 quarantine 属性且无公证的应用在 UI 层无法直接放行。

## 修法与方案（非商业开源分发适配）

对齐 ADR-0022 §6 既定分发口径（非营利开源社区软件，本期不引入商业付费代码签名），以开源社区标准实践解决多平台体验：

1. **构建配置修补（`package.json`）**：
   在 `build.mac` 中显式指定：
   - `"identity": "-"`：强制 electron-builder 在打包时执行本地 Ad-hoc 代码签名（`codesign -s -`），为 arm64 二进制打上合法的 Mach-O 签名结构，满足 Apple Silicon 底层硬性要求。
   - `"hardenedRuntime": false`：关闭仅商业公证才需要的加固运行时，防止非公证应用因权限冲突崩溃。
   - `"gatekeeperAssess": false`：跳过 CI 构建机本地的 Gatekeeper 评估。
2. **用户端指引更新**：
   - 彻底废除已失效的旧指引（“右键点打开”）。
   - 提供标准的终端解除浏览器隔离标记指引：
     ```bash
     sudo xattr -rd com.apple.quarantine "/Applications/AAO Editor.app"
     ```
   - 在 `README.md`、`README.en.md` 与 `RELEASE_NOTES.md` 中同步更新说明。
3. **CI 流水线确认**：
   - `.github/workflows/release.yml` 维持 ADR-0022 既定拓扑，无需调整。
4. **多平台分发口径收敛**：
   - **Linux**：遵循开源分发规范，维持 AppImage 原生可执行分发。
   - **Windows**：维持 SmartScreen 默认安全机制提示（引导点击「更多信息」→「仍要运行」）。
   - **macOS**：通过 Ad-hoc 规范签名 + 用户端清除隔离属性（`com.apple.quarantine`），打通非商业分发闭环。

## 锁测

1. 静态配置锁测（`tests/static/ProductIdentityWiring.test.ts`）：新增断言检查 `package.json` 中的 `build.mac.identity === '-'` 与 `build.mac.hardenedRuntime === false`，防止后续构建配置回退或丢失 ad-hoc 签名。
2. 文档同步锁测：校验 `README.md` 与 `README.en.md`、`RELEASE_NOTES.md` 中的 macOS 提示文案已包含 `quarantine` / `xattr` 解除隔离引导，不出现失效的“右键选打开”。

## Comments

### 2026-11-01 开票存档
- 用户反馈 v0.1.2 版本在 macOS M 芯片报“已损坏”，i 芯片可跑。
- 经分析确认非文件传输损坏，系 macOS Gatekeeper 门禁策略 + electron-builder 默认缺少 arm64 ad-hoc 签名导致。
- 确认遵循开源非商业分发口径，本票用于跟踪配置修复与文档对齐。

### 2026-11-02 落地完成
- `package.json` 的 `build.mac` 补齐 `"identity": "-"`、`"hardenedRuntime": false`、`"gatekeeperAssess": false`。
- `README.md`、`README.en.md`、`RELEASE_NOTES.md` 及文档站安装指引废除失效的右键打开引导，统一更新为 `sudo xattr -rd com.apple.quarantine "/Applications/AAO Editor.app"`。
- `tests/static/ProductIdentityWiring.test.ts` 补齐配置与全套文档锁测，通过全量测试。

