# 211 · macOS应用生命周期与关闭退出处理

Type: bug
Status: resolved

## 来源

用户在 macOS 环境反馈：
AAO Editor 点击红叉关闭后，它仍然会在后台常驻运行，无法通过界面或快捷键退出，必须打开活动监视器强制退出，且后台运行时能耗依然有 2000+。

## 症状与根因

1. **全局菜单被清除导致 macOS 顶栏菜单与快捷键丢失**：
   - **症状**：在 macOS 上应用没有标准的顶级应用菜单栏，按 `Cmd+Q` 无法退出，Dock 图标右键退出也可能因缺乏响应被阻断。
   - **根因**：
     - 在 [electron/main.cjs](file:///d:/Company/WorkSpace/MocaCoffee/bangdream-editor/electron/main.cjs#L60) 中，执行了 `Menu.setApplicationMenu(null)`。
     - 在 Windows/Linux 上，这是为了隐藏丑陋的默认系统菜单栏，实现沉浸式窗口；但在 macOS（Darwin）上，这会直接**抹掉操作系统的顶部全局菜单栏（包括「关于」、「退出 (Cmd+Q)」等）**。
2. **窗口关闭事件缺少退出收敛**：
   - **症状**：点击窗口红色关闭按钮后，窗口消失，但在 Dock 栏仍带有点，后台进程继续运行。
   - **根因**：
     - 主进程中监听了 `window-all-closed`：
       ```javascript
       app.on('window-all-closed', () => {
         if (process.platform !== 'darwin') app.quit();
       });
       ```
     - 这一行为遵循了传统 macOS 多文档软件习惯（关闭窗口不退出），但本项目目前为单窗口桌面工具，且没有常驻托盘或点击 Dock 重新激活主窗口（`app.on('activate')` 重建窗口）的逻辑，且窗口关闭时未清理渲染进程音频保活循环，导致它直接沦为消耗数千能耗的僵尸进程。

## 修法

1. **macOS 平台保留原生应用退出菜单**：
   - 在 `electron/main.cjs` 中按平台分流：
     - Windows / Linux：继续保持 `Menu.setApplicationMenu(null)` 沉浸式风格；
     - macOS (`process.platform === 'darwin'`)：构建轻量级基础应用菜单（包含 `App Name` -> `关于`、`隐藏 (Cmd+H)`、`退出 (Cmd+Q)`、`编辑`（撤销/重做/剪切/复制/全选，确保输入框原生键正常）），不显示多余的 View/Window 菜单。
2. **单窗口关闭行为收敛与资源销毁**：
   - 针对当前单窗口工具定位，可配置 macOS 在主窗口关闭时安全退出 `app.quit()`，或在 `activate` 事件中优雅重建窗口；
   - 窗口关闭前派发销毁信号，断开所有音频与定时器资源。

## 锁测与不变量保护

1. **既有功能不变量**：
   - Windows 与 Linux 的无边框/原生沉浸式窗口样式绝对保持不变；
   - 各平台文件关联打开与窗口初始尺寸记忆保持一致。
2. **锁测**：
   - `tests/static/ElectronMenuPlatform.test.ts`：静态断言 `electron/main.cjs` 在 `darwin` 平台下不执行抹除退出菜单的逻辑；
   - `tests/unit/electronLifecycle.test.ts`：验证 macOS 窗口全部关闭时的退出/保活逻辑符合预期。

## Answer

2026-11-02 实现：
- 经过对齐，采用方案 B（遵循 macOS 规范，窗口关闭后保留主进程，支持 Dock 点击重建窗口，Cmd+Q 显式退出）。
- 新增 `electron/applicationMenu.cjs`：按平台分流菜单配置。macOS (`darwin`) 安装原生极简应用菜单（包含应用主菜单 `About`、`Services`、`Hide`、`HideOthers`、`Unhide`、`Quit Cmd+Q`，以及编辑菜单 `Undo`、`Redo`、`Cut`、`Copy`、`Paste`、`SelectAll`）；Windows / Linux 继续保持 `Menu.setApplicationMenu(null)` 沉浸式风格。
- 新增 `electron/lifecycle.cjs` 与主进程集成：提取平台收敛纯逻辑，在 Windows / Linux 上窗口全关触发 `app.quit()`；在 macOS 上保持后台进程，点击 Dock 图标时通过 `handleActivate` 优雅恢复或重建主窗口。窗口关闭时清空 `mainWindow` 引用并连带销毁 Chromium WebContents 渲染进程及音频资源。
- 锁测：新增 `tests/static/ElectronMenuPlatform.test.ts`（静态锁）与 `tests/unit/electronLifecycle.test.ts`（单测）；全量 385 个测试文件（4302 测试用例）及 `npm run build` 全部通过。

## Comments
