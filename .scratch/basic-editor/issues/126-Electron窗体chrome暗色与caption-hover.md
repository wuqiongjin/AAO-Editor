# 126 · Electron 窗体 chrome：暗色标题栏与 caption hover 粘滞

Type: bug
Status: resolved
Blocked by: —

## 来源

用户 2026-09-19：① 外观暗色时 **OS 标题栏仍白**（图 1，不是页面头）。② 光标划过右上角缩小/最大化/关闭后，有概率 **hover 高亮粘住**（图 2），光标已离开仍像悬停。

## 症状

- 应用 `data-theme=dark` 时，Windows 默认标题栏底仍浅、标题字深。
- 原生 caption 按钮偶发停在 hover 底色。

## 根因

`electron/main.cjs` 使用 `titleBarStyle: 'default'`，**无** `nativeTheme` / `titleBarOverlay` / `backgroundColor` 与渲染进程主题同步。三颗按钮是 OS 绘制，仓库里没有自绘标题栏、也没有 `-webkit-app-region`。Hover 粘滞是 Win 上 Chromium 标题栏命中/leave 类问题，不是页面 CSS `:hover`。

## 修法（定案：用户 2026-09-19 Q3=A、Q4=A）

- **继续系统标题栏**，不自绘 min/max/close。
- 暗色：主进程跟应用主题（`nativeTheme` 和/或 Windows overlay 颜色对齐 chrome token）。
- Hover：只在 **Windows** 上按 Electron/Chromium 已有路径试修（overlay、背景色、leave 行为）。修不掉则票内记为已知限制，**升级自绘标题栏须另开 grilling**。
- **跨平台**：要跟 OS 差（Win caption vs macOS 红绿灯 vs Linux 装饰器），不要为了视觉一致画假 Windows 按钮。macOS/Linux 只跟 `nativeTheme`，不把 Win hover 补丁抄过去。

## 锁测

- 单测盖不住 OS chrome。静态：主题变化有主进程入口（禁止只改 CSS 假装修了标题栏）。
- 手工 Win：暗色标题栏底/字对比；反复划过三键再移开，高亮应消失。macOS/Linux：暗色时系统栏不刺眼即可，不验收 Win 式三键。

## Answer

- `electron/windowChrome.cjs`：`nativeTheme.themeSource` + `BrowserWindow.backgroundColor`（`#f6f7f9` / `#15181d` 对齐 tokens `--bg`）；Win 上 `blur`/`focus` 同色 `setBackgroundColor` 试缓解 caption hover 粘滞。
- `windowChrome:sync` IPC + `preload` + `useApplyTheme` 推送 `settings.theme`（含 `system`）；`nativeTheme.on('updated')` 在 system 模式下跟 OS。
- 仍 `titleBarStyle: 'default'`，无 overlay / 自绘。Win caption hover 若仍偶发粘住 → **已知限制**（需另开 grilling 才自绘）。

## Comments

- 2026-09-19 实现：`tests/unit/ElectronWindowChrome.test.ts`；全量 vitest 3 失败为既有 SlideFlick / RendererPerf 阈值，与本票无关。
