# 28 · 工程管理页面文案整改与去冗余

Type: chore
Status: resolved
Blocked by: —

## 来源

1. 用户 2026-10-10 反馈 #3：
   > 「新建谱面工程」中的描述「全部可不填。音频去音频页导入；封面、曲目来源在『编辑工程信息』里补。要贴谱面 JSON，建好后再『新增谱面』。」对用户没什么意义。
2. 用户 2026-10-11 拓展范围：
   > 这个 issue 内容好少，感觉可以顺带整改一下其它的文案描述……issue 28 的范围变成工程管理页面的文案整改吧。去口语化、去冗余、去 Bestdori 化。

## 症状与根因

1. **过程描述式废话**：文案通篇在描述实现流程（「去哪里补、以后怎么做」），而不是用户在当前界面的动作目标；
2. **共用 hint 逻辑破产**：新建弹窗 4 个 Tab 流程各异，单句 hint 无法覆盖且在官方选曲下甚至自相矛盾；
3. **命名误导与口语化严重**：「从本地谱面导入」实际是「复制工程」，易误导为从磁盘导入；原提示「工程信息、音频、封面、全部谱面照搬；谱面状态不带（副本全部为未完成）。」口语化且冗长；
4. **Bestdori 泄露至界面**：用户界面频繁出现 Bestdori 实现细节，而用户只需要关心「社区」和「游戏」。

## 定案（用户 2026-10-11 两轮确认）

### 1. 彻底移除的冗余 Hint（不留空行距）
- `projects.newHint`（新建工程弹窗头部的全局提示）彻底移除；
- `projects.coverHint`（编辑工程信息弹窗头部的「上传音频与封面…」提示）彻底移除，`EditInfoDialog` 移除 `hint` 传参；
- `projects.chartNameHint`（「未填谱面名称的谱面会跟着工程名称一起变…」）彻底移除；
- `projects.chartCodeHint`（「空白新建后也可以在工作台的谱面代码编辑器里贴…」）彻底移除。

### 2. 四大新建入口与 Tab 文案收敛
- **空白新建**：
  - `projects.newBlankDesc`: 「创建全新的空白谱面工程」（en: `Create a fresh blank project`）
- **复制工程**：
  - `projects.newCopy` / `projects.tabCopy`: 「复制工程」（en: `Duplicate project`）
  - `projects.newCopyDesc`: 「以已有工程为模板创建」（en: `Create from an existing project template`）
  - `projects.copyHint`: 「完整复制音频、封面及谱面；谱面状态重置为未完成。」（en: `Copy audio, cover, and charts; chart statuses are reset to incomplete.`）
- **官方谱面**：
  - `projects.newOfficialDesc`: 「从官方曲库中选曲，并同步导入音频与封面」（en: `Pick songs from the official library with audio and cover`）
  - `projects.official.searchPlaceholder`: 「搜索曲名或乐队」（en: `Search title or band`）
- **社区谱面**：
  - `projects.newCommunityDesc`: 「从游戏社区中选曲，并同步导入音频与封面」（en: `Pick songs from the community with audio and cover`）

### 3. 工程管理与谱面相关文案精炼
- `projects.empty.description`: 「从空白新建开始，创建你的第一个谱面工程。」（en: `Start with a blank project to create your first chart project.`）
- `projects.uploadsEmpty`: 「暂无上传记录。」（en: `No upload history.`）
- `projects.chartCodePlaceholder`: 「粘贴谱面 JSON，留空则创建空白谱面」（en: `Paste chart JSON, or leave blank to create an empty chart`）
- `projects.confirmDeleteUploaded`: 「其中 {{count}} 张已上传至社区，删除工程不会影响已发布的谱面。」（en: `{{count}} uploaded to community; deleting will not affect published charts.`）

### 4. 彻底去「Bestdori」化
- `projects.*` 下所有面向用户的文案中，Bestdori 出现次数归零；
- 静态测试 `tests/static/NewProjectSourceCopy.test.ts` 建立全局前缀扫检守卫，防止未来回潮。

## 验证结论

1. `npx tsc --noEmit`：类型检查 0 错误通过；
2. `npx vitest run tests/static/ tests/dom/`：87 个测试文件、554 个用例全绿通过；
3. Playwright 浏览器端视觉走查：新建弹窗各 Tab、主页 Tiles、编辑工程信息弹窗、新增谱面弹窗头部及说明均干净对齐，无空行与残留样式。
