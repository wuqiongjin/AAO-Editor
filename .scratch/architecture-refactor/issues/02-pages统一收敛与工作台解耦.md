# 02-pages统一收敛与工作台解耦

Type: chore
Status: open
Blocked by: 01

## 来源与目标

- **来源**：根据 [ADR-0007](../../docs/adr/0007-应用页面壳与内容页壳规范.md) 与 [ADR-0003](../../docs/adr/0003-工作台UI与配置系统.md)，目前应用页面定义与组织非常离散：`AudioPage.tsx` 在 `src/audio/`、`AssetsPage.tsx` 在 `src/visual/`、`SettingsPage.tsx` 在 `src/settings/`，而工作台的核心入口 `src/chart/Editor.tsx` 与 `src/pages/WorkspacePage/`（Toolbar, ChartSwitcher）之间形成了双向反向依赖。
- **目标**：
  1. 确立 `src/pages/` 作为全局唯一视图路由装配层，按路由目的地收拢为子目录。
  2. 解耦 `src/chart/Editor.tsx`：将“工作台页面级装配与工具栏/面板框架”统一收纳进 `src/pages/workspace/`，而 `src/chart/` 纯化为专注于谱面画布组件与编辑逻辑的核心库。
  3. 将 `AudioPage`、`AssetsPage`、`SettingsPage`、`ShortcutsPage` 分别收纳到 `src/pages/` 对应的子目录中，消除各底层领域混入视图页面的问题。

## 现状与重构落点

1. **工作台页面重组**：
   - 将工作台相关的页面装配整合进 `src/pages/workspace/`：
     - `src/pages/workspace/WorkspacePage.tsx`（接管原来 Editor 的工作台页面组装职责）
     - `src/pages/workspace/Toolbar.tsx` 及 `ToolbarSection.tsx`
     - `src/pages/workspace/ChartSwitcher.tsx`
     - `src/pages/workspace/CurveConfigPanel.tsx`
   - `src/chart/` 只保留核心画布组件（如 `FinalVirtualCanvas.tsx`、`NoteInfoPanel.tsx`、`ChartCodeEditor`）。
2. **页面收敛**：
   - `src/audio/AudioPage.tsx` -> `src/pages/audio/AudioPage.tsx`（`src/audio/` 仅保留音频核心引擎与时钟）
   - `src/visual/AssetsPage.tsx` -> `src/pages/assets/AssetsPage.tsx`（`src/visual/` 仅保留视觉绘制纯逻辑）
   - `src/settings/SettingsPage.tsx` 与 `ShortcutsPage.tsx` -> `src/pages/settings/`
3. **更新路由注册表**：
   - 调整 `src/pages/PageRegistry.tsx` 的 lazy 导入路径为统一的 `src/pages/*`。

## 锁测要求

- 页面切换、快捷键导航（`tests/unit/layouts/PageNav.test.ts`）完全通过。
- 页面装配与 Editor 测试（`tests/static/EditorAudioSessionRefactor.test.ts` 等）保持通过。

## Comments
