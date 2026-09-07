# 57 · 编辑交互四缺陷修复（选中残留 / 滑条临时锚点 / Esc 分级 / 重复放置污染历史）

Type: task
Status: resolved（2026-09-07 用户报障，同日修复落地工作区；55/56 的 grilling 重构仍为长期载体）
Blocked by:

## Question

用户报障四个编辑交互缺陷，均为可立即修复的点状问题（不依赖 55/56 的状态模型重构）：

1. 鼠标工具选中音符后切换到其它工具，选中高亮不消失。
2. Slide 两击成条：第一击放置的"临时端点"（青色锚点预览）之后，若下一次左键点到画布外或非法放置位置，该锚点是否应删除？
3. 谱面代码编辑器弹窗打开时按 Esc，会穿透折叠左右侧栏，而不是关闭编辑器。
4. 同位置重复放置相同音符时数据层正确忽略，但每次点击都照常写入历史栈，Ctrl+Z 要按同样多次才退得掉第一次的真实改动。

## 定案

**1 · 选中态随工具切换清除**：选中高亮是鼠标工具的操作反馈，切走后已无对应交互上下文。
在 `FinalVirtualCanvas` 增加 effect：`selectedTool` 切离 `mouse` 瞬间清空 `selectedItems`，并同步清起点标记的选中态（标记本体保留）。镜像/复制等工具在自己手势内写入的选中不受影响（effect 只在切换瞬间触发）。

**2 · 滑条临时锚点的取消边界**：先澄清——第一击并未写入谱面数据，青色锚点只是 `slideBuffer` 预览叠加层，取消不需要撤销。分三种点击场景定案：

- **画布内非法放置位置**（轨道左右/沟槽外、beat<0、超出谱面末端）→ **取消锚点**。该点击仍是"在谱面上放置"的意图，落空即回到未放置的干净状态，避免下一次有效点击从不慎遗忘的旧锚点连线。
- **画布外点击**（滚动条/工具栏/播放条）→ **不取消**。放置长滑条时先拉滚动条/缩放去够远处的第二点是正常工作流，画布外一律取消会杀死该工作流。工具栏点其它工具 = 工具切换，本就有 effect 清锚点。
- **Esc** → **显式取消锚点**。并入 Esc 优先级链：代码编辑器弹窗（第 3 项）＞ 待连接滑条锚点 ＞ 折叠左右侧栏。
- 两击同位互取消（原有行为）、切离 slide 工具清锚点（原有行为）保持不变。

**3 · 代码编辑器接管 Esc**：弹窗打开期间在 `ChartCodeEditor` 内用 **window 捕获阶段** 监听 Escape，`stopPropagation` 截断 `useShortcutDispatch` 的折叠侧栏链路，走 `requestClose()`（dirty 时照常弹丢弃确认）。捕获阶段与焦点落点无关：textarea 内全局分发本就放行，但焦点在弹窗按钮等其它位置时会漏给侧栏折叠，统一在此拦截。

**4 · 历史去重**：`History.pushHistoryIfChanged(state, item, equals)`——与当前快照判等则原样返回（不占栈位、**也不截断 redo 分支**）；`EditingProvider.addToHistory/setNotes` 以 `NotesEqual.notesEqual` 判等。语义口径：boolean 标记缺省≡false、subBeat 缺省≡0、滑条结点逐下标比（顺序是连接语义、Slide≠Long）。真实改动（方向键 length+1、flick→skill 等）不受影响。守卫放在压栈收口点而非各编辑函数内，粘贴/镜像等所有链路一并受益。

## 实现落点

- `src/chart/components/canvas/FinalVirtualCanvas.tsx`：工具切换清选中 effect；`handleClick` 非法位置取消 `slideBuffer`；句柄新增 `cancelPendingSlide()`。
- `src/chart/Editor.tsx`：`onEscape` 优先级链（滑条锚点 → 折叠侧栏）。
- `src/chart/components/code-editor/ChartCodeEditor.tsx`：弹窗打开期间捕获阶段 Esc 监听 → `requestClose`。
- `src/chart/editing/NotesEqual.ts`（新）：音符快照语义相等。
- `src/chart/editing/History.ts`：`pushHistoryIfChanged`。
- `src/app/providers/EditingProvider.tsx`：`addToHistory/setNotes` 换用条件压栈。
- 测试：`tests/unit/NotesEqual.test.ts`（判等口径 + redo 分支保留 + 三连击重复放置仅占 1 栈位、一次 undo 即退掉）。

## Comments

- 2026-09-07 立案并修复（用户报障 4 项；定案见上）。与 55（工具交互模型重构）、56（选中状态整改）的关系：本票只修点状缺陷，不改状态模型；55 的"Esc/右键退出手感"议题届时可直接站在本票的取消边界之上细化。
