# 02-pages统一收敛与工作台解耦

Type: chore
Status: resolved
Blocked by: 01

> **2026-09-29 复核修订**：本票 2026-09-26 开出后未开工。复核发现两处新的关键事实：① `src/pages/WorkspacePage/WorkspacePage.tsx` 已成**死文件**（无任何引用，`PageRegistry` 直接 lazy 装 `src/chart/Editor`）；② 工作台页壳与工具栏仍在 `src/pages/WorkspacePage/`，而 `Editor` 本体在 `src/chart/`，`chart → pages` 与 `pages → chart` 双向依赖原样存在。目标口径不变。

## 来源与目标

- **来源**：[ADR-0007](../../docs/adr/0007-应用页面壳与内容页壳规范.md) 与 [ADR-0003](../../docs/adr/0003-工作台UI与配置系统.md)：应用页面定义与组织离散——`AudioPage.tsx` 在 `src/audio/`、`AssetsPage.tsx` 在 `src/visual/`、`SettingsPage.tsx` / `ShortcutsPage.tsx` 在 `src/settings/`；工作台入口 `src/chart/Editor.tsx` 与 `src/pages/WorkspacePage/`（Toolbar / ChartSwitcher）互相引用。
- **目标**：
  1. `src/pages/` 作为全局唯一视图路由装配层，按路由目的地收拢为子目录；
  2. 工作台页面装配（Editor 本体 + 工具栏 / 切换器 / 面板）统一进 `src/pages/workspace/`，`src/chart/` 纯化为谱面画布组件与编辑逻辑核心库；
  3. `AudioPage` / `AssetsPage` / `SettingsPage` / `ShortcutsPage` 各自收进 `src/pages/` 对应子目录。

## 现状核对（2026-09-29）

### 双向依赖（原样存在）

- `src/chart/Editor.tsx`（**681 行**）导入：
  - `../pages/WorkspacePage/Toolbar`、`../pages/WorkspacePage/ChartSwitcher`
  - `../pages/projectUi`（01 票搬走后消除）
  - 其余为 chart / audio / playback / app / ui 域内引用
- `src/pages/WorkspacePage/ChartSwitcher.tsx` → `../../chart/project/*`、`../../chart/editing/*`、`../ChartInfoDialog`、`../projectUi`
- `src/pages/WorkspacePage/Toolbar.tsx` → `../../chart/rendering/NoteIconGlyph`、`../../visual/noteSkin`、`../../chart/components/code-editor/*`
- 即：`chart → pages` 与 `pages/WorkspacePage → chart` 同时成立。

### 死文件

- `src/pages/WorkspacePage/WorkspacePage.tsx`：路由壳，`lazy(() => import('../../chart/Editor'))`，**全仓无引用**；真实路由在 `src/pages/PageRegistry.tsx:11`（`lazy(() => import('../chart/Editor'))`）。本票直接删除，不再保留同名壳。

### `PageRegistry.tsx` 现有 lazy 路径

```ts
const ProjectsPage  = lazy(() => import('./ProjectsPage'));        // 01 票改
const Editor        = lazy(() => import('../chart/Editor'));      // 本票改
const AudioPage     = lazy(() => import('../audio/AudioPage'));   // 本票改
const AssetsPage    = lazy(() => import('../visual/AssetsPage')); // 本票改
const SettingsPage  = lazy(() => import('../settings/SettingsPage'));   // 本票改
const ShortcutsPage = lazy(() => import('../settings/ShortcutsPage')); // 本票改
```

### Editor 本体的组成（迁移范围）

`src/chart/Editor.tsx` 含 7 条会话流（渲染面测量 / 滚动模型 / 音频桥 / 播放协调 / 布局持久化 / 持久化 / 快捷键分发）与整页渲染（左工具栏列、顶栏 ChartSwitcher + BPM + 缩放、画布滚动区 + `FinalVirtualCanvas` + `PlayBar`、右信息面板）。**本票只整体搬家，不在搬家途中拆内部**——内部拆卸留给后续特性票，控制行为不变。

### 顺带修正

- `docs/adr/0007-应用页面壳与内容页壳规范.md` 表格中 AppShell 路径写的是 `src/pages/AppShell.tsx`，实际在 `src/layouts/AppShell.tsx`——纯事实修正，一行。

## 目标结构

```
src/pages/
  workspace/
    WorkspacePage.tsx        ← src/chart/Editor.tsx 整体搬入（default export 保持）
    Toolbar.tsx  Toolbar.css  ToolbarSection.tsx
    ChartSwitcher.tsx  ChartSwitcher.css
    CurveConfigPanel.tsx
  audio/AudioPage.tsx        ← src/audio/AudioPage.tsx（src/audio/ 只留引擎与时钟）
  assets/AssetsPage.tsx      ← src/visual/AssetsPage.tsx（src/visual/ 留给 03 票合并）
  settings/{SettingsPage,ShortcutsPage}.tsx
  projects/…                 ← 01 票产物
  PageRegistry.tsx           ← lazy 路径全部改 ./<子目录>/…
```

`src/pages/WorkspacePage/` 目录整体消失（内容拆到 `workspace/` 与删除死壳）。

## 重构落点

1. `git mv src/chart/Editor.tsx src/pages/workspace/WorkspacePage.tsx`，同批把 `src/pages/WorkspacePage/*` 六个文件搬入 `src/pages/workspace/`，删除死文件 `WorkspacePage/WorkspacePage.tsx`。只修 import 路径，不动内部逻辑。
2. `AudioPage.tsx` → `src/pages/audio/`；`AssetsPage.tsx` → `src/pages/assets/`；`SettingsPage.tsx` + `ShortcutsPage.tsx` → `src/pages/settings/`。检查各自相对 import（`../layouts` 之类要补一层）。
3. `PageRegistry.tsx` 六条 lazy 全部改为 `./projects/ProjectsPage`、`./workspace/WorkspacePage`、`./audio/AudioPage`、`./assets/AssetsPage`、`./settings/SettingsPage`、`./settings/ShortcutsPage`。
4. 修正 ADR-0007 的 AppShell 路径（见上）。
5. **收尾断言**：`src/chart/` 下不得再出现任何 `from '../pages/`；`src/audio/`、`src/visual/`、`src/settings/` 下不得再出现 `*Page.tsx`。

## 锁测要求

**净值网**：迁移前后 `npm test`（164 文件 / 1919 用例）与 `npx tsc -b` 全绿；除路径 / import 外无 diff。

必须同步修改的测试（2026-09-29 逐条 grep 所得）：

- **`src/chart/Editor.tsx` 字面路径类**：`tests/static/{ChartCodeDurationSync,ChartSpaceSeam,EditorAudioSessionRefactor,EscapeChain,PlaybackMarkerWiring,PlayStartChartCompile,ReadonlyGateWiring}.test.ts`、`tests/platform/browser/BrowserZoomLive.test.ts`、`tests/unit/playback/ScrollbarEchoSuppression.test.ts`、`tests/unit/chart/project/workspaceProject.test.ts`（若为 import 则改路径）。
  - `EditorAudioSessionRefactor.test.ts` 是"接线事实"总闸（7 条不变量），迁移时**只改文件路径常量**，断言语义一条不许动；若搬家让某条断言不再适用，先停下来找用户确认。
- **`src/pages/WorkspacePage/*`**：`tests/unit/chart/config/CurveConfigSettings.test.ts`（Toolbar / CurveConfigPanel）、`tests/unit/visual/skin/ToolbarNoteSkin.test.ts`（Toolbar）、`tests/dom/workspace/ChartSwitcherAudioEntry.test.tsx`（import）、`tests/static/{AudioManagementSingleSurface,NoWindowAlert}.test.ts`（字面路径）。
- **`src/audio/AudioPage.tsx`**：`tests/dom/pages/AudioPageProjectScope.test.tsx`（import）、`tests/static/{AudioManagementSingleSurface,EditorAudioSessionRefactor,ReadonlyGateWiring}.test.ts`（字面路径）。
- **`src/visual/AssetsPage.tsx`**：`tests/unit/visual/skin/NoteSkinPresetThumbnail.test.ts`（读源码文本）。
- **`src/settings/*Page.tsx`**：`tests/platform/electron/{ElectronDataRoot,WindowStateMemory}.test.ts`、`tests/unit/chart/config/ChromeTypographySettings.test.ts`、`tests/unit/settings/ShortcutIndexFilter.test.ts`（均读源码文本）。
- **路由**：`tests/unit/layouts/PageNav.test.ts`（读 `src/pages/PageRegistry.tsx` 源码，断言 `projects: ProjectsPage` 等注册项）与 `tests/dom/**` 里对 `@/src/pages/PageRegistry` 的引用；可在该测试内加一条「六个页面 key 的 lazy 路径全部从 `./` 子目录进」的静态断言防回潮。

## Comments

- 2026-09-29 落地。纯搬迁、零行为改动：
  - `src/chart/Editor.tsx`（681 行）→ `src/pages/workspace/WorkspacePage.tsx`（default export 保持，内部组件名仍为 `Editor`，只改 import 路径）；`src/pages/WorkspacePage/` 六件（Toolbar / Toolbar.css / ToolbarSection / ChartSwitcher / ChartSwitcher.css / CurveConfigPanel）→ `src/pages/workspace/`；死壳 `WorkspacePage/WorkspacePage.tsx` 删除，`src/pages/WorkspacePage/` 目录整体消失。
  - `AudioPage.tsx` → `src/pages/audio/`；`AssetsPage.tsx` → `src/pages/assets/`；`SettingsPage.tsx` + `ShortcutsPage.tsx` → `src/pages/settings/`（`shortcutIndexFilter.ts` 留在原处，消费方改指 `../../settings/shortcutIndexFilter`）。
  - `PageRegistry.tsx` 六条 lazy 全部改 `./<子目录>/…`；ADR-0007 的 AppShell 路径修正为 `src/layouts/AppShell.tsx`。
  - 收尾断言成立：`src/chart/` 下无任何指向 pages 的 `from`；`src/audio`、`src/visual`、`src/settings` 下无 `*Page.tsx`。
- 测试同步：21 个引用旧路径的测试文件全部改指新位置；`EditorAudioSessionRefactor.test.ts` 只动读源码的文件路径常量 —— 其中两条负向断言内的相对路径字面量（`../utils/AudioEngine`、`../contexts`）随新位置补一层为 `../../…`（经用户 2026-09-29 确认；断言语义与防护力不变，其余断言逐条未动）。
- 防回潮：`tests/unit/layouts/PageNav.test.ts` 加一条「六条 lazy specifier 全部从 `./` 子目录进」；新增 `tests/static/PagesConvergence.test.ts`（六页落点、workspace 七件套、`src/chart/` 不反依 pages）。
- 口径说明（三处判断，均不涉行为）：
  1. 落点锁新增独立 static 文件而非只往 `PageNav.test.ts` 塞一条（票面「可在」为可选），照 01 票 `ProjectDomainLayout.test.ts` 惯例；两条断言分别在注册表接线与文件布局两个层面。
  2. `CONTEXT.md:154` 与 ADR-0007 是同一处 AppShell 路径事实错误，经用户确认一并修正（一行，避免两份权威文档打架）。
  3. `Toolbar.css` 头注释里的旧路径字符串随文件位置更新。
- 门禁：`npm test` = **166 文件 / 1929 用例全绿**（基线 165/1925，+1 文件 +4 条新锁）；`npx tsc -b` 绿；`npm run build` 绿；`npm run lint` 无本票新增 error（既有噪声照旧，落点不在本票文件）。
