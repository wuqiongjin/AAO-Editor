# 89 · 删除工具态下，已有选区应立即以删除 hover 效果呈现

Type: feature
Status: resolved（2026-09-11 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-11：非删除工具下框选一堆音符后切到删除工具，这些音符的选中态效果应**立刻变成删除工具的 hover 效果**；
切回非删除工具则恢复正常的选中态 hover 效果。

## 症状

切到删除工具后选区仍画浅黄"选中"描边，只有鼠标真正悬停上去才转红；
与"接下来点它就会删"的预告不一致。

## 根因

`src/visual/render.ts collectSelectionOutlines`：
- `:261` `dangerTool = armedTool === 'delete' || rightButtonHeld === true`；
- `:272` `danger = dangerTool && hv !== null`（**必须有 hover**）；
- `:290-291` `dangerMode = danger || (dangerTool && inPreviewBox)` → 未 hover、也未落在框选矩形内的已选中项
  落到 `push('selected')`。

即"删除持工具态 × 选中态"这一组合从未被覆盖（现有锁测只锁了"选中 + 删除态 hover"，Q51）。

## 修法

- 「删除持工具态」这一**状态**本身就把 `inSel` 的 mode 从 `selected` 顶成 `danger`
  （形态即删除 hover 款：危险红 + `hoverLineWidth` + `hoverAlpha`；`:511` / `:524-525` 已按 mode 分派，绘制层无需改）。
- **只认 `armedTool === 'delete'`**：`rightButtonHeld`（issue 74 右键按住）**不整片转红** ——
  右键只删光标下那一个对象，整片转红是误导（本轮口径，用户 2026-09-11 未否）。
- 切回非删除工具 → 条件不成立 → 自动回落 `selected`，无需额外状态。

## 锁测

`tests/unit/SelectionVisual.test.ts`（照现有 `outlinesOf` 辅助）：

1. 删除态 + 有选区 + **无 hover** → 全部 `mode === 'danger'`（修复前为 `selected`）—— **本票核心锁**；
2. 删除态 + 选区含滑条（结点 + 段）→ 全部 `danger`；
3. 非删除工具态（指针 / 键型 / 镜像 / 滑条…）+ 有选区 + 无 hover → 仍 `selected`（回归）；
4. 右键按住 + 有选区 + 无 hover → 仍 `selected`（只 hover 项转 danger，回归 issue 74）。

现有 `:257`（已选中 + 删除态 hover → danger）与 `:318` 应保持绿（形态与 mode 判定未变）。
视觉类可补 Playwright 像素实测（照 issue 67 口径：红像素 > 0 且黄像素 = 0）。

## Comments

- 2026-09-11 实现 + 锁测（tsc 0 / 879 测试全绿 / build 通过 / 触及文件 eslint 零告警）：
  - `src/visual/render.ts collectSelectionOutlines`：新增 `deleteToolArmed = rc.armedTool === 'delete'`；
    `emit` 的 `dangerMode` 增 `|| (deleteToolArmed && inSel)` → 删除持工具态下**选区本身**即走 `danger`
    （形态 = 删除 hover 款：危险红 + `hoverLineWidth` + `hoverAlpha`；绘制层本就按 mode 分派，未改动）。
    BPM 行同步改为 `whole && !deleteToolArmed ? 'selected' : …`（已入选的整条线在删除态同样走 danger）。
  - **只认 `armedTool`**：`rightButtonHeld`（issue 74 右键按住）不整片转红 —— 右键只删光标下那一个对象。
  - 切回非删除工具 → 条件不成立 → 自动回落 `selected`，无需额外状态。
  - 锁测：`tests/unit/SelectionVisual.test.ts` 新增 `describe('删除持工具态下选区整体转 danger（issue 89）')` 4 例 ——
    ① 删除态 + 选区 + 无 hover → 全 `danger`（修复前 `selected`，**核心锁**）；
    ② 删除态 + 选区含滑条（结点 + 段）→ 5 条全 `danger`；
    ③ 非删除工具态（null/single/mirror/slide/bpm/paste）→ 仍 `selected`（回归）；
    ④ 右键按住 + 选区 + 无 hover → 仍 `selected`（回归 issue 74）。该文件 51 例全绿。
  - 待验收：非删除工具下框选 → 切删除工具，选区应**立即**变红；切回键型/镜像应立刻变回浅黄。
