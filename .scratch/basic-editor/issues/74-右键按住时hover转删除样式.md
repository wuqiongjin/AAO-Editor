# 74 · 右键按住（未松手）时，光标下的音符改用删除 hover（危险红）

Type: feature
Status: resolved（2026-09-10 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源（用户 2026-09-10 重新澄清）

> 当你要进行右键删除时，右键时一定是光标已经在一个音符上了。此时在非删除工具的"持工具态"时，
> 这个光标引起的 hover 效果一定是正常的（黄色圆角矩阵的）。我希望在此时**右键按下去的时候（不松手）**，
> 这个 hover 效果变为删除工具的那个 hover 效果。

即在**任意工具态**（包括指针态）下，右键按下未松手期间，光标下对象的 hover 从"正常黄"切换为"删除红（danger）"，
作为"松手就要删掉它"的预览。

## 现状（为什么现在没有）

- 危险红的唯一开关是 `dangerTool = rc.armedTool === 'delete'`（`src/visual/render.ts:244`），与"是否按下右键"无关；
  色值 `SELECTION_COLORS.danger = '#FF5A5A'`（`src/visual/selectionStyle.ts:15`）。
- 右键路径（`FinalVirtualCanvas.handleContextMenu`:622-639）**完全不读写 hover**；
  `handleMouseDown`:467 `if (e.button !== 0) return`（右键不进手势）；
  hover 由 `handlePointerMove`:513 持续更新 `hoverPos` → 右键按住期间 hover 对象本身是对的，只是配色不对。

## 实现口径（本轮实现口径，待验收）

1. 画布侧维护「右键按住」标志：`mousedown button===2` 置 true；`mouseup` / `contextmenu` 后清 false，
   `blur` 兜底清理（防卡死）。以新字段（如 `rightButtonHeld`）进 `RenderCtx`（`src/visual/types.ts`）。
2. `collectSelectionOutlines`（`render.ts:235+`）的 danger 判据改为 `dangerTool || rc.rightButtonHeld`；
   BPM 线分支同步 —— 它不参与**鼠标** hover，但右键能删它。
3. 删除动作**保持在 `contextmenu`**（不改现有删除时机）。
   实现时先实测一次 `contextmenu` 的触发时机：若在本环境是**按下即触发**（macOS / Linux GTK 的差异），
   则删除会瞬间完成、红色 hover 只剩一瞬，此时再把删除延后到 `mouseup`（届时按实测决定，不再单开票）。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/components/canvas/FinalVirtualCanvas.tsx` | 右键按住状态 + 进 `RenderCtx`（含 blur 清理） |
| `src/visual/types.ts` | `RenderCtx` 新字段 |
| `src/visual/render.ts` | danger 判据并入右键（含 BPM 分支） |

## 锁测

- `tests/unit/SelectionVisual.test.ts`：右键按住 → 单键 / 滑条结点 / 滑条段 / BPM 均出 `danger`；
  松开 → 回落 hover；非右键态不受影响。
- 视觉类补 Playwright 像素实测（照 issue 67 口径）：右键按住时红像素 > 0 且黄像素 = 0。
  单测只能断言描边模式，不能证明"画出来了"。

## Comments

- 2026-09-10 用户澄清诉求后重写（原稿中"平台触发时机"的提问已改为实现时的自测项）。
- 2026-09-10 实现：
  - `RenderCtx` 新增 `rightButtonHeld?: boolean`；`FinalVirtualCanvas` 在 `mousedown button===2` 置位，
    用 window 的 `mouseup` / `blur` 兜底清理（松手在画布外也不会卡住红色）。
  - `collectSelectionOutlines` 的 danger 开关改为 `rc.armedTool === 'delete' || rc.rightButtonHeld === true`
    —— 与删除持工具态合并成一个开关，任意工具态（含指针态）右键按住即生效。
  - BPM 分支单开一条：只认**右键按住**这一源（`rc.rightButtonHeld && hv !== null` 才画）。
    删除工具态下 BPM 的**鼠标** hover 不画是既有定案（issue 56 C5），本票不动它 —— 因此这里没有
    直接用合并后的 `dangerTool`（否则会顺带改掉 C5，既有锁测会红）。
  - 删除动作仍留在 `contextmenu`，未改时机。
- 锁测：`SelectionVisual.test.ts` 新增 5 例：指针态右键按住 → danger / 四种持工具态同样生效 /
  滑条结点 + 段 / BPM 转红 / 未按右键仍浅黄回归。tsc 0 / 810 测试全绿。
- 待你在页面确认：按住右键时是否**真的**有预览窗口 —— 若本环境 `contextmenu` 在 mousedown 即触发，
  删除会在按下瞬间完成，那时需要把删除延后到 `mouseup`（实现时实测，不再单开票）。
- **2026-09-10 二轮（跨平台收口，不再等实测）**：用户确认本机 Windows 效果 OK，但产品要发
  Linux/macOS —— 而这些平台的 `contextmenu` 在 **mousedown** 即触发，按住期间没有预览窗口。
  故删除动作**从 `contextmenu` 移到 `mouseup`**（`rightClickDelete`）：
  - `onContextMenu` 只剩 `preventDefault()`（屏蔽原生菜单）；
  - window `mouseup`（button===2）→ 清标志 + 在渲染面内才删除（画布外松手 = 取消）；`blur` 只清标志不动谱面；
  - 对 Windows 而言与原来**等价**（原本 contextmenu 就在松手时触发，取的也是松手位置）。
  锁测不变（`SelectionVisual` 仍锁渲染侧）；接线部分属 DOM 时序，单测盖不到 → 需三平台各验一次：
  ① 右键按住不松手 → 光标下对象转红；② 松手 → 删除该对象；③ 移到画布外松手 → 不删。
- 2026-09-25：点删 + 按住预览仍有效；**拖过 8px 的右键框删**另开 [issue 158](./158-右键框选后立即删除.md)，不改本票已实现的点删通路。
