# 48 src/ 目录整改：按业务域重组 + 死文件清理

- **状态**：**resolved（2026-08-29）** — 候选 1+2+3 已闭环；候选 4 评估为"不闭环"（见 Comments）
- **类型**：整改（refactor）· 纯目录搬迁，零行为变更
- **前置**：issue 45 / 46 / 47（音频域接缝收口）— 仓库已进入"按域深化"阶段，目录结构需要跟上

## 背景

承接架构评审 `/tmp/arch-review.Jl5wnJ/architecture-review-2026-08-29-1830.html`（v2）的候选 1 + 2 + 3 + 4。

### 当前问题

- `src/utils/` 已成 31 个文件的"啥都放"目录：6 个深模块 + 8 个 hook + 15 个纯变换 + 1 个 perf util，角色混乱。
- 3 个子树名实不符：
  - `src/notes/Charts.tsx`：1 个类型文件用 `.tsx` 扩展名，folder 名误导。
  - `src/pages/{AppShell,AppNav}.tsx`：是壳不是路由页，污染 `pages/` 命名空间。
  - `src/components/`：4 个原子 + 4 个功能面板 + 738-LoC 的 `FinalVirtualCanvas` 混杂。
- `src/contexts/` 5 个 Provider 没有明确的"父职责"——既不在 `app/` 下也不在工作台下，定位悬空。
- 2 个死文件在源码树里：`src/prototypes/app-page-shell-layout/index.html`（212 行未接入 Vite）、`src/assets/react.svg`（Vite 模板残留）。
- `src/renderer/noteSkinRegistry.gen.ts` 是 4419 行生成产物，混在手写代码根目录里，`git diff` 噪声大。
- 顶级 `src/visual/` 跟潜在命名 `src/chart/visual/` 撞名隐患。
- 跨域共享类型（如 `ChartPosition`）当前挤在 `src/contexts/index.ts`，位置不诚实。

### 整改目标

`src/` 顶层每个目录**只问一个问题**就能定位——按业务域划分（跟 `CONTEXT.md` 词汇表对齐），不按代码角色（hook / 工具 / 类）划分。

- `app/`：启动 + 跨域根状态（5 个 Provider + ProviderTree 装配）
- `layouts/`：ADR-0007 应用壳 / 内容壳
- `ui/`：原子组件
- `pages/`：路由层（保留"应用页面"语义，只放路由壳 + 路由表）
- `chart/`：谱面工程域（ADR-0005）
- `audio/`：音频域（issue 47）
- `playback/`：播放域（ADR-0004）
- `visual/`：视觉素材域（issue 29）
- `settings/`：设置域（ADR-0002 / 0003）
- `types/`：跨域共享类型
- `utils/`：真正的工具（本次整改后只剩 1 个文件）
- `assets/`：打包资源
- `tools/`（同级）：开发工具，与 app 分离

## 终态目录

```
src/
├── app/
│   ├── providers/
│   │   ├── AudioSessionProvider.tsx
│   │   ├── PlaybackProvider.tsx
│   │   ├── EditingProvider.tsx
│   │   ├── UIProvider.tsx
│   │   └── ConfigProvider.tsx
│   ├── ProviderTree.tsx
│   ├── main.tsx
│   ├── App.tsx
│   └── styles/
│       ├── tokens.css
│       ├── theme.ts
│       ├── App.css
│       └── index.css
├── layouts/
│   ├── AppShell.tsx + .css
│   ├── AppNav.tsx
│   ├── AppPageShell.tsx + .css
├── ui/
│   ├── IconButton.tsx
│   ├── ActionBtn.tsx
│   ├── SpriteIcon.tsx
│   └── CanvasSpriteIcon.tsx
├── pages/
│   ├── routes.tsx
│   └── WorkspacePage/
│       ├── WorkspacePage.tsx
│       └── Toolbar.tsx
├── chart/
│   ├── project/        (ChartProject + ChartProjectPersistenceMerger + useChartProjectPersistence)
│   ├── editing/        (NoteEditing + SelectionEditing + History + NoteReplacementRules + SlideEndpointManager + CodeEditorOps)
│   ├── geometry/       (ChartGeometry + BpmTimeline + TimeFormat)
│   ├── layout/         (SurfaceSizeMerger + useSurfaceSize + useLayoutPersistence)
│   ├── rendering/      (backgroundSkin + useBackgroundSkin + NoteSkinPreview)
│   ├── config/         (ShortcutConfig + useShortcutDispatch + AppSettings)
│   ├── components/
│   │   ├── canvas/     (FinalVirtualCanvas.tsx + .css)
│   │   ├── side-panel/ (NoteInfoPanel.tsx)
│   │   └── code-editor/(ChartCodeEditor.tsx)
│   ├── types.ts
│   ├── perf.ts
│   └── Editor.tsx
├── audio/
│   ├── AudioEngine.ts
│   ├── AudioSession.ts
│   ├── AudioTiming.ts
│   ├── KeySound.ts
│   ├── KeySoundMeta.ts
│   ├── useAudioBridge.ts
│   └── AudioPage.tsx
├── playback/
│   ├── PlaybackScrollModel.ts
│   ├── useScrollModel.ts
│   ├── usePlaybackCoordinator.ts
│   └── PlayBar.tsx + .css
├── visual/
│   ├── noteSkin.ts
│   ├── hitTest.ts
│   ├── coords.ts
│   ├── types.ts
│   ├── noteLayerCache.ts
│   ├── staticLayerCache.ts
│   ├── index.ts
│   ├── gen/  (noteSkinRegistry.gen.ts + .gitignore)
│   └── AssetsPage.tsx
├── settings/
│   ├── SettingsPage.tsx
│   └── ShortcutsPage.tsx
├── types/
│   ├── chart.ts
│   └── index.ts
├── utils/
│   └── perf.ts  (→ 同步删，已经迁到 chart/)
└── assets/
    └── audio/  (6 个 MP3)

tools/
└── sprite-locator/  (main.tsx + SpriteLocator.tsx + locator.ts + sprite-locator.css)
```

## 候选清单（评审报告 v2）

| # | 候选 | 推荐度 | 工作量 |
| --- | --- | --- | --- |
| 1 | `src/` 按域重组 | Strong | 半天~1 天 |
| 2 | `sprite-locator/` → `tools/` | Worth exploring | 1-2 小时 |
| 3 | 删 2 个死文件 | Strong | 5 分钟 |
| 4 | 清理 issue 45/46/47 注释残留 | Worth exploring → **closed-wontfix** | 30 分钟（实际 1.5-2h） |

**执行结果**：1 + 3 + 2 已闭环；4 评估为不闭环（见 Comments 2026-08-29 决议）。issue 整体 resolved。

## 搬迁计划

详细 step-by-step 见本 issue 末尾「搬迁计划」章节。

## 不在本次范围

- 任何接口 / 行为变更
- 重命名业务概念（`Editor.tsx` 保留原名）
- 拆 / 合深模块（深模块本身已经是 issue 45/46/47 的产物）
- 任何 ADR 的重新论证

## ADR 关联

- ADR-0003（工作台 UI / 配置系统）：本 issue 不重论证其分域定义，仅把 `ConfigContext` 迁到 `app/providers/ConfigProvider.tsx`，Provider 装配顺序照旧。
- ADR-0005（显式谱面长度与谱面工程持久化）：`ChartProject*` 三件套迁到 `chart/project/`，持久化接缝不重排。
- ADR-0007（应用页面壳）：`AppShell` / `AppPageShell` 统一进 `layouts/`，`AppPageShell` 仍按 ADR-0007 定义。
- 无 ADR 重写、无 ADR 撤销。

## 搬迁计划（候选 1 + 3 合并 PR）

### 设计原则

1. **每步独立 commit、独立 tsc 校验**：中间任何一步挂了都能回退到上一个 commit，不污染主分支。
2. **先搬"被依赖少"的，再搬"被依赖多"的**：先迁深模块（`utils/` 里被多个文件 import 的少），再迁页面（`pages/` 跟多个域耦合）。
3. **每步只动一类文件**：不要在同一步里既改目录又改 import 又删死文件，便于 code review。
4. **保留 `utils/` 目录直到最后一步**：渐进式搬迁，最后统一删空。

### PR 结构

预计一个 PR 即可（约 30-40 个文件改动）。如果 review 反馈需要切分，按以下 5 个步骤拆 5 个 commit 即可——commit 边界已经按"独立可 review"切好。

---

### Step 1 · 删死文件（候选 3）

**目标**：先清空两个不再需要的文件，避免后面搬迁时还要二次处理。

```bash
git rm src/prototypes/app-page-shell-layout/index.html
git rm src/assets/react.svg
```

**校验**：
- `grep -r "app-page-shell-layout" src/` → 0 结果
- `grep -r "react.svg" src/` → 0 结果（确认 `public/vite.svg` 仍是入口 favicon）
- `npx tsc --noEmit` 通过

**commit**：`chore: delete two orphan artifacts (issue 48 step 1)`

**风险**：0
- 双重确认 active prototype 路径：`App.tsx` 里应仍在引用 `?prototype=page-shell` 走 `PageShellPrototype.tsx` 而非 `index.html`
- `react.svg` 全文搜不到引用，删掉不影响构建

---

### Step 2 · 建新目录骨架（空目录占位）

**目标**：先在 `src/` 顶层建好目标目录结构，新目录在搬迁前是空的。

```bash
mkdir -p src/app/providers
mkdir -p src/app/styles
mkdir -p src/layouts
mkdir -p src/ui
mkdir -p src/pages/WorkspacePage
mkdir -p src/chart/{project,editing,geometry,layout,rendering,config}
mkdir -p src/chart/components/{canvas,side-panel,code-editor}
mkdir -p src/audio
mkdir -p src/playback
mkdir -p src/visual/gen
mkdir -p src/settings
mkdir -p src/types
mkdir -p tools/sprite-locator
```

**校验**：
- `git status` 应显示一堆 "Untracked folders"，无文件改动
- 不需要 tsc（空目录不参与编译）

**commit**：`chore: scaffold target directory tree (issue 48 step 2)`

**风险**：0（git 允许空目录，但有些 IDE / 工具会忽略空目录，可接受）

---

### Step 3 · 跨域共享类型（最小依赖起点）

**目标**：先把 `src/contexts/index.ts` 里暴露的 `ChartPosition` 抽到 `src/types/`，从 0 依赖开始。

```bash
# 新建
echo "// src/types/chart.ts" > src/types/chart.ts
# 把 ChartPosition interface 从 src/contexts/index.ts 搬过来
# 把 chartPosition 引用加到 src/types/index.ts
```

**操作**：
1. 在 `src/types/chart.ts` 写 `ChartPosition` interface（复制自 `src/contexts/index.ts:11-15`）
2. 在 `src/types/index.ts` re-export
3. `src/contexts/index.ts` 删掉 `ChartPosition` 定义，改为 `import type { ChartPosition } from '../types/chart'`

**影响文件**（用 grep 找全后再改）：
- `src/contexts/index.ts`（移除定义，改 import）
- `src/contexts/UIContext.tsx`（import 路径）
- `src/contexts/EditingContext.tsx`（可能）
- `src/components/FinalVirtualCanvas.tsx`（可能）
- `src/utils/ChartGeometry.ts`（可能）

**校验**：`npx tsc --noEmit` 通过

**commit**：`refactor(types): extract ChartPosition to src/types/ (issue 48 step 3)`

**风险**：低，纯 type 抽取，运行时无变化

---

### Step 4 · `ProviderTree` 装配（半步聚合 contexts）

**目标**：把 `src/contexts/index.ts` 改造成 `src/app/ProviderTree.tsx`，同时把 5 个 Context 文件迁到 `src/app/providers/`，每个文件"三合一"（Context + Provider + hook）。

**操作**：
1. 创建 `src/app/providers/ConfigProvider.tsx` ← `src/contexts/ConfigContext.tsx`
2. 创建 `src/app/providers/EditingProvider.tsx` ← `src/contexts/EditingContext.tsx`
3. 创建 `src/app/providers/UIProvider.tsx` ← `src/contexts/UIContext.tsx`
4. 创建 `src/app/providers/PlaybackProvider.tsx` ← `src/contexts/PlaybackContext.tsx`
5. 创建 `src/app/providers/AudioSessionProvider.tsx` ← `src/contexts/AudioSessionContext.tsx`
6. 创建 `src/app/ProviderTree.tsx`：按"Config → AudioSession → Playback → UI → Editing"顺序嵌套 5 个 Provider
7. 删除 `src/contexts/` 整个目录

**影响文件**：
- `src/main.tsx`（改 import + 引入 `ProviderTree`）
- `src/App.tsx`（如有 import 5 个 hook，改路径）
- `src/pages/Editor.tsx`（如使用 5 个 hook）
- `src/pages/AudioPage.tsx`（如使用 5 个 hook）
- 等等——用 `grep -r "from.*contexts" src/` 全列

**ProviderTree 装配示意**：

```tsx
// src/app/ProviderTree.tsx
export function ProviderTree({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>           {/* 最外层：主题/快捷键几乎都被依赖 */}
      <AudioSessionProvider>   {/* 音频域深模块的 React 入口 */}
        <PlaybackProvider>     {/* 依赖 AudioSession 的部分 setter */}
          <UIProvider>         {/* 依赖 Config 的部分字段 */}
            <EditingProvider>  {/* 最内层：选区/历史最终被画布消费 */}
              {children}
            </EditingProvider>
          </UIProvider>
        </PlaybackProvider>
      </AudioSessionProvider>
    </ConfigProvider>
  );
}
```

**校验**：
- `npx tsc --noEmit` 通过
- `grep -r "from.*contexts" src/` → 0 结果
- `grep -r "from.*providers" src/` → 集中在 `ProviderTree` + 消费者

**commit**：`refactor(app): migrate contexts to app/providers/ with ProviderTree (issue 48 step 4)`

**风险**：中。Provider 嵌套顺序如果搞反会引发运行时 bug（context 拿不到值）。**严格按上述顺序** Config → AudioSession → Playback → UI → Editing。

---

### Step 5 · `chart/` 内 7 个子目录搬迁

**目标**：把 `src/utils/` 里 6 个深模块 + 5 个 hook + 10 个纯变换 全部迁到 `src/chart/` 下对应子目录。

#### 5a · `chart/project/` 持久化（独立接缝，3 文件）

```bash
git mv src/utils/ChartProject.ts                    src/chart/project/ChartProject.ts
git mv src/utils/ChartProjectPersistenceMerger.ts   src/chart/project/ChartProjectPersistenceMerger.ts
git mv src/utils/useChartProjectPersistence.ts      src/chart/project/useChartProjectPersistence.ts
```

**影响 import**：
- `src/utils/Editor.ts`（如仍存在）→ 已删除（issue 46 收口）
- `src/pages/Editor.tsx`（主消费者）
- `src/App.tsx`（如使用 hook）

**commit**：`refactor(chart): move ChartProject* to chart/project/ (issue 48 step 5a)`

#### 5b · `chart/editing/` 谱面操作（6 文件）

```bash
git mv src/utils/NoteEditing.ts              src/chart/editing/NoteEditing.ts
git mv src/utils/SelectionEditing.ts         src/chart/editing/SelectionEditing.ts
git mv src/utils/History.ts                  src/chart/editing/History.ts
git mv src/utils/NoteReplacementRules.ts     src/chart/editing/NoteReplacementRules.ts
git mv src/utils/SlideEndpointManager.ts     src/chart/editing/SlideEndpointManager.ts
git mv src/utils/CodeEditorOps.ts            src/chart/editing/CodeEditorOps.ts
```

**commit**：`refactor(chart): move editing ops to chart/editing/ (issue 48 step 5b)`

#### 5c · `chart/geometry/` 纯坐标/时间（3 文件）

```bash
git mv src/utils/ChartGeometry.ts    src/chart/geometry/ChartGeometry.ts
git mv src/utils/BpmTimeline.ts      src/chart/geometry/BpmTimeline.ts
git mv src/utils/TimeFormat.ts       src/chart/geometry/TimeFormat.ts
```

**commit**：`refactor(chart): move geometry to chart/geometry/ (issue 48 step 5c)`

#### 5d · `chart/layout/` 画布尺寸 + 滚动（3 文件）

```bash
git mv src/utils/SurfaceSizeMerger.ts        src/chart/layout/SurfaceSizeMerger.ts
git mv src/utils/useSurfaceSize.ts           src/chart/layout/useSurfaceSize.ts
git mv src/utils/useLayoutPersistence.ts     src/chart/layout/useLayoutPersistence.ts
```

**commit**：`refactor(chart): move canvas layout to chart/layout/ (issue 48 step 5d)`

#### 5e · `chart/rendering/` 谱面画布视觉（2 文件 + 1 复合组件）

```bash
git mv src/utils/backgroundSkin.ts           src/chart/rendering/backgroundSkin.ts
git mv src/utils/useBackgroundSkin.ts        src/chart/rendering/useBackgroundSkin.ts
git mv src/components/NoteSkinPreview.tsx    src/chart/rendering/NoteSkinPreview.tsx
```

**commit**：`refactor(chart): move rendering layer to chart/rendering/ (issue 48 step 5e)`

#### 5f · `chart/config/` 配置侧（3 文件）

```bash
git mv src/utils/ShortcutConfig.ts           src/chart/config/ShortcutConfig.ts
git mv src/utils/useShortcutDispatch.ts      src/chart/config/useShortcutDispatch.ts
git mv src/utils/AppSettings.ts              src/chart/config/AppSettings.ts
```

**commit**：`refactor(chart): move config to chart/config/ (issue 48 step 5f)`

#### 5g · 删 `src/notes/`，迁 `Charts.tsx` → `chart/types.ts`

```bash
git mv src/notes/Charts.tsx                  src/chart/types.ts
# 顺手把 .tsx 改 .ts（移除 JSX 扩展名）
git rm src/notes/Charts.tsx                  # 旧位置
# 注：先 mv 再 rm 用两步，因为 rename + 改后缀分两个 commit
```

**影响 import**：19 个文件从 `'../notes/Charts'` 改 `'../chart/types'`

**commit**：`refactor(chart): collapse notes/ to chart/types.ts (issue 48 step 5g)`

**每步 5a-5g 之间**：建议每步 commit 完跑一次 `npx tsc --noEmit` + `npm test`，确保中间状态可编译。

---

### Step 6 · `chart/components/` 复合组件（3 个目录）

**目标**：把当前散在 `src/components/` 的功能面板迁到 `src/chart/components/` 下按"工作台 UI 位置"分组。

```bash
git mv src/components/FinalVirtualCanvas.tsx     src/chart/components/canvas/FinalVirtualCanvas.tsx
git mv src/components/FinalVirtualCanvas.css     src/chart/components/canvas/FinalVirtualCanvas.css
git mv src/components/NoteInfoPanel.tsx          src/chart/components/side-panel/NoteInfoPanel.tsx
git mv src/components/ChartCodeEditor.tsx        src/chart/components/code-editor/ChartCodeEditor.tsx
```

**commit**：`refactor(chart): move composite components to chart/components/ (issue 48 step 6)`

**风险**：高。
- `FinalVirtualCanvas.tsx`（738 LoC）是被引用最多的复合组件，import 路径变更涉及多个文件
- `ChartCodeEditor.tsx`（386 LoC）次之
- 建议搬迁前用 `grep -r "FinalVirtualCanvas" src/` 全列 import 点再批量改

---

### Step 7 · `Editor.tsx` 迁 `chart/Editor.tsx`

**目标**：把工作台实现从 `src/pages/Editor.tsx` 迁到 `src/chart/Editor.tsx`，由 `src/pages/WorkspacePage/WorkspacePage.tsx` 路由壳 lazy import。

```bash
git mv src/pages/Editor.tsx                 src/chart/Editor.tsx

# 在 src/pages/WorkspacePage/ 下新建：
# - WorkspacePage.tsx（路由壳：lazy + 装入 Editor）
# - Toolbar.tsx（从 src/components/Toolbar.tsx 迁来）
git mv src/components/Toolbar.tsx           src/pages/WorkspacePage/Toolbar.tsx
```

**WorkspacePage 路由壳示意**：

```tsx
// src/pages/WorkspacePage/WorkspacePage.tsx
import { lazy, Suspense } from 'react';
const Editor = lazy(() => import('../../chart/Editor').then(m => ({ default: m.Editor })));

export function WorkspacePage() {
  return <Suspense fallback={null}><Editor /></Suspense>;
}
```

**commit**：`refactor(pages): introduce WorkspacePage route shell, move Editor to chart/ (issue 48 step 7)`

**风险**：中。
- `Editor.tsx` 是最大消费点，所有 hook 路径改完后这一改才生效（必须 Step 5 全部完成）
- Toolbar.tsx 如果被多个文件 import，需要先 grep

---

### Step 8 · 壳 + 原子 + 路由层

#### 8a · `layouts/`（ADR-0007 壳）

```bash
git mv src/pages/AppShell.tsx                src/layouts/AppShell.tsx
git mv src/pages/AppShell.css                src/layouts/AppShell.css
git mv src/pages/AppNav.tsx                  src/layouts/AppNav.tsx
git mv src/components/layout/AppPageShell.tsx    src/layouts/AppPageShell.tsx
git mv src/components/layout/AppPageShell.css    src/layouts/AppPageShell.css
# 删 src/components/layout/ 空目录
```

**commit**：`refactor(layouts): consolidate shells under layouts/ (issue 48 step 8a)`

#### 8b · `ui/`（原子组件）

```bash
git mv src/components/ActionBtn.tsx          src/ui/ActionBtn.tsx
git mv src/components/CanvasSpriteIcon.tsx   src/ui/CanvasSpriteIcon.tsx
git mv src/components/IconButton.tsx         src/ui/IconButton.tsx
git mv src/components/SpriteIcon.tsx         src/ui/SpriteIcon.tsx
```

**commit**：`refactor(ui): extract atomic components to ui/ (issue 48 step 8b)`

#### 8c · 删 `src/components/` 空目录 + `src/utils/` 清理

`src/components/` 搬空后删目录（git 不追踪空目录但 IDE 仍可见）。
`src/utils/` 在 Step 5 全部完成后只剩 `perf.ts`，决定是搬到 `src/chart/perf.ts`（因为主要是 `playback/` 用）还是留 `src/utils/perf.ts`。

**决策**：搬 `src/utils/perf.ts` → `src/chart/perf.ts`（审计 `perf.ts` 的所有 import 点，大概率是 `PlaybackScrollModel` 周边）

```bash
git mv src/utils/perf.ts                     src/chart/perf.ts
```

**commit**：`chore: remove empty components/ and utils/ (issue 48 step 8c)`

---

### Step 9 · `audio/` 音频域（候选 2 的领域搬迁部分）

```bash
git mv src/utils/AudioEngine.ts          src/audio/AudioEngine.ts
git mv src/utils/AudioSession.ts         src/audio/AudioSession.ts
git mv src/utils/AudioTiming.ts          src/audio/AudioTiming.ts
git mv src/utils/KeySound.ts             src/audio/KeySound.ts
git mv src/utils/KeySoundMeta.ts         src/audio/KeySoundMeta.ts
git mv src/utils/useAudioBridge.ts       src/audio/useAudioBridge.ts
# AudioPage 路由页迁 audio 域（方案 A：一份文件）
git mv src/pages/AudioPage.tsx           src/audio/AudioPage.tsx
# AudioPage.css 如有
git mv src/pages/AudioPage.css           src/audio/AudioPage.css 2>/dev/null || true
```

**commit**：`refactor(audio): move audio domain to src/audio/ (issue 48 step 9)`

**风险**：中。`useAudioBridge` 跟 `audio/AudioPage.tsx` 同目录但消费点分散（`Editor.tsx` / `PlayBar.tsx`）。

---

### Step 10 · `playback/` 播放域

```bash
git mv src/utils/PlaybackScrollModel.ts       src/playback/PlaybackScrollModel.ts
git mv src/utils/useScrollModel.ts            src/playback/useScrollModel.ts
git mv src/utils/usePlaybackCoordinator.ts    src/playback/usePlaybackCoordinator.ts
git mv src/components/PlayBar.tsx             src/playback/PlayBar.tsx
git mv src/components/PlayBar.css             src/playback/PlayBar.css
```

**commit**：`refactor(playback): move playback domain to src/playback/ (issue 48 step 10)`

---

### Step 11 · `visual/` 视觉素材域 + 生成产物隔离

```bash
git mv src/renderer/noteSkin.ts               src/visual/noteSkin.ts
git mv src/renderer/hitTest.ts                src/visual/hitTest.ts
git mv src/renderer/coords.ts                 src/visual/coords.ts
git mv src/renderer/types.ts                  src/visual/types.ts
git mv src/renderer/noteLayerCache.ts         src/visual/noteLayerCache.ts
git mv src/renderer/staticLayerCache.ts       src/visual/staticLayerCache.ts
git mv src/renderer/index.ts                  src/visual/index.ts
git mv src/renderer/noteSkinRegistry.gen.ts   src/visual/gen/noteSkinRegistry.gen.ts
# 顺手建 .gitignore 防止 IDE 索引
echo "*.gen.ts\n*.gen.tsx" > src/visual/gen/.gitignore

# AssetsPage 路由页迁 visual 域
git mv src/pages/AssetsPage.tsx               src/visual/AssetsPage.tsx
git mv src/pages/AssetsPage.css               src/visual/AssetsPage.css
# 删 src/renderer/ 空目录
```

**commit**：`refactor(visual): move visual assets domain, isolate generated artifacts in gen/ (issue 48 step 11)`

---

### Step 12 · `settings/` 设置域

```bash
git mv src/pages/SettingsPage.tsx             src/settings/SettingsPage.tsx
git mv src/pages/ShortcutsPage.tsx            src/settings/ShortcutsPage.tsx
```

**commit**：`refactor(settings): move settings pages to settings/ (issue 48 step 12)`

---

### Step 13 · `pages/routes.tsx` 路由表

**目标**：新建路由表，把所有 5 个路由的 lazy import 集中到一处。

```tsx
// src/pages/routes.tsx
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

const WorkspacePage = lazy(() => import('./WorkspacePage/WorkspacePage'));
const AudioPage = lazy(() => import('../audio/AudioPage'));
const VisualAssetsPage = lazy(() => import('../visual/AssetsPage'));
const SettingsPage = lazy(() => import('../settings/SettingsPage'));
const ShortcutsPage = lazy(() => import('../settings/ShortcutsPage'));

export function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<WorkspacePage />} />
        <Route path="audio" element={<AudioPage />} />
        <Route path="visual" element={<VisualAssetsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="shortcuts" element={<ShortcutsPage />} />
      </Routes>
    </Suspense>
  );
}
```

**`App.tsx` 改为**：
```tsx
import { AppRoutes } from './pages/routes';
import { AppShell } from './layouts/AppShell';
import { ProviderTree } from './ProviderTree';

export function App() {
  return (
    <ProviderTree>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </ProviderTree>
  );
}
```

**commit**：`refactor(pages): introduce routes.tsx with lazy imports (issue 48 step 13)`

---

### Step 14 · 全局样式归 `app/styles/`

```bash
git mv src/styles/tokens.css          src/app/styles/tokens.css
git mv src/styles/theme.ts            src/app/styles/theme.ts
git mv src/App.css                    src/app/styles/App.css
git mv src/index.css                  src/app/styles/index.css
# 删 src/styles/ 空目录
```

**commit**：`refactor(styles): move global styles to app/styles/ (issue 48 step 14)`

---

### Step 15 · 收尾校验

```bash
# 1. tsc 严格模式
npx tsc --noEmit

# 2. ESLint
npm run lint

# 3. 测试
npm test

# 4. 死文件检查
find src/components src/utils src/notes src/contexts src/renderer src/styles 2>/dev/null
# 期望：全部目录不存在或为空

# 5. 孤儿 import 检查
grep -r "from.*notes/Charts" src/                  # 应 0 结果
grep -r "from.*components/" src/                    # 应 0 结果（除非新 components/ 内部）
grep -r "from.*utils/" src/ | grep -v "chart/utils" # 应 0 结果
grep -r "from.*contexts" src/                       # 应 0 结果
grep -r "from.*pages/Editor" src/                   # 应 0 结果
grep -r "from.*renderer/" src/                      # 应 0 结果
```

**commit**：`chore(issue-48): post-move verification + README touchups`

---

## 风险与回退

### 高风险步骤

- **Step 4**（ProviderTree 装配顺序）—— 装配错序 → 运行时 context 拿不到值。回退：`git revert <commit>` + 单独 fix。
- **Step 6**（`FinalVirtualCanvas` 复合组件搬迁）—— import 点最多，可能漏改。回退：拆 Step 6 为 3 个 sub-step（canvas/ side-panel/ code-editor 各自一个 commit）。
- **Step 7**（`Editor.tsx` 迁出 `pages/`）—— 跨 5+ 个文件 import 路径变更。回退：把 `WorkspacePage` 改成同步 import（非 lazy），暂时直接 re-export `Editor` 即可。

### 全部 15 步总时间估计

- 实际搬迁：2-3 小时（机械操作）
- 每步 tsc + 简单手测：15-30 分钟
- 5 个深层 commit 的 code review：取决于团队节奏
- **总工作量**：半天到 1 天

### 候选 2（`sprite-locator/` → `tools/`）—— 单独 PR

不属于本 PR 范围。计划：

```bash
mkdir -p tools/sprite-locator
git mv src/sprite-locator/* tools/sprite-locator/
# 修改 vite.config.ts 的 input 路径
# 移动根目录 sprite-locator.html 到 tools/
```

**commit**：`chore(tools): demote sprite-locator to tools/ (issue 48 sub)`

### 候选 4（issue 45/46/47 注释残留）—— 后续小 PR

不在本次 PR 范围。计划：

```bash
# 编辑以下文件，把"what changed"前导注释裁短到 1 行
src/audio/AudioSession.ts
src/audio/useAudioBridge.ts
src/app/providers/AudioSessionProvider.tsx
src/audio/AudioPage.tsx
src/chart/Editor.tsx
src/playback/useScrollModel.ts  # 同时从 public return 移除 chartEndKey
```

**commit**：`docs: trim issue 45/46/47 migration residue comments (issue 48 sub)`

---

## 执行 checklist

- [x] Step 1 删死文件
- [x] Step 2 建新目录骨架
- [x] Step 3 跨域类型抽到 `src/types/`
- [x] Step 4 `ProviderTree` 装配（5 个 Provider 顺序核对）
- [x] Step 5a-5g `chart/` 7 个子目录搬迁
- [x] Step 6 `chart/components/` 复合组件
- [x] Step 7 `Editor.tsx` 迁 `chart/` + `WorkspacePage/` 路由壳
- [x] Step 8a-8c 壳 + 原子 + 清空 `components/` `utils/`
- [x] Step 9 `audio/`
- [x] Step 10 `playback/`
- [x] Step 11 `visual/` + `gen/` 隔离
- [x] Step 12 `settings/`
- [x] Step 13 `pages/routes.tsx` 路由表
- [x] Step 14 全局样式归 `app/styles/`
- [x] Step 15 收尾校验（tsc + lint + test + grep 孤儿）
- [x] 候选 4 注释残留：closed-wontfix（见 Comments）

---

## Comments

### 2026-08-29 · 候选 2 实施

- 提交链：
  - `18c1fc0` chore(tools): demote sprite-locator to tools/ (issue 48 candidate 2)
  - `a79b456` docs(issue-48): log candidate 2 completion in issue comments
  - 后续修订（code-review 后的精简）：把 Vite 插件从 `require('node:fs')` CJS 导入改为顶层 ESM `import`、插件名从 `sprite-locator-flatten` 改为更准确的 `sprite-locator-relocate`、把空 `catch {}` 收紧为只吞 `ENOENT`、给 `dev.sh` 加了一行说明
- 搬迁范围：
  - `src/sprite-locator/{main,SpriteLocator}.tsx + locator.ts + sprite-locator.css` → `tools/sprite-locator/`
  - 根目录 `sprite-locator.html` → `tools/sprite-locator.html`
  - 同步更新 `tests/unit/SpriteLocator.test.ts` import 路径
  - `tsconfig.app.json` include 增加 `tools`
- `vite.config.ts` 增量（关键）：
  - `rollupOptions.input` 的 `sprite-locator` 源路径改为 `tools/sprite-locator.html`
  - 新增 `sprite-locator-relocate` 插件：
    - dev：`configureServer` 中间件把 `/sprite-locator.html` 重写到 `/tools/sprite-locator.html`（保持 dev.sh 公开 URL 不变）
    - build：`closeBundle` 把 Vite 产出的 `dist/tools/sprite-locator.html` 移到 `dist/sprite-locator.html`（Vite 按 input 源路径保留目录结构；产物名仍按 input key）
    - release 模式：早返回，sprite-locator 仍不进发行包
- 验证：
  - `npx tsc -b` 通过
  - `npm test` 30 文件 / 365 用例通过
  - `npx eslint tools/sprite-locator vite.config.ts` 无问题
  - `npm run build`：`dist/sprite-locator.html` 正常生成，`dist/tools/` 自动清空
  - `npm run build:release`：`dist/` 不含 sprite-locator.html
  - dev 烟测：`/` 返回主应用（title `bangdream-editor`），`/sprite-locator.html` 返回工具页（title `精灵图定位工具`，script 指向 `/tools/sprite-locator/main.tsx`）
- 风险回退：本提交无回退，所有 `git mv` 保留历史；如需回退 `git revert 18c1fc0` 即可。
- 候选 2 状态：resolved（候选 1+3 已在前序 commit 完成，候选 2 本次闭环；候选 4 注释残留留作后续 issue）

### 2026-08-29 · 候选 4 评估：关掉（不闭环）

- 决议：**不执行候选 4**。issue 48 整体仍标 resolved（4 个候选中 3 个强推/探索已闭环，1 个有明确"不做"决定 = 整体落定）。
- 核验结果：issue 描述列出的 5 个文件（`AudioSession.ts` / `useAudioBridge.ts` / `AudioSessionProvider.tsx` / `AudioPage.tsx` / `Editor.tsx`）经 `grep` 无 "issue 45/46/47" / "what changed" / "迁移" 残留——**描述与现状已不对齐**（候选 1+3 落地时已顺带清掉）。
- 真正"what changed"型注释在另一组 5 个 hook 文件（issue 46 拆钩子产物）：
  - `src/chart/project/useChartProjectPersistence.ts:3`
  - `src/chart/layout/useLayoutPersistence.ts:3`
  - `src/chart/config/useShortcutDispatch.ts:3`
  - `src/playback/usePlaybackCoordinator.ts:3`
  - `src/playback/useScrollModel.ts:3`
  - 另 1 处：`src/app/providers/AudioSessionRoot.tsx:1` 顶部 "issue 47 收口，issue 48 整改迁位" 标记。
- 不做理由：
  1. 每行"拆出 Editor.tsx 内 ~X 行"紧跟"行为保持"清单——是 issue 46 故意保留的"commit 故事"，让后来人 5 秒看懂 hook 边界。删了等于毁掉拆钩子的考古资料，未来重拆/合并时无从下手。
  2. `useScrollModel` 移除 `chartEndKey` 属于接口收紧，非"清注释"，需审计消费方 — 跟候选 4 标题不一致，独立 refactor。
  3. 真实工作量 ≈ 1.5-2h（5 hook + 1 Provider + 接口收紧 + 测试），与"30 分钟"估价不符。
- 后路：若未来要清理，建独立小 PR 改这 5 个 hook 顶部第 3 行注释（保留"行为保持"清单），`useScrollModel` 接口收紧另立 issue。
- 候选 4 状态：**closed-wontfix**


