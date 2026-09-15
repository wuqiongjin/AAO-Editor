Type: bug
Status: **已实现（定案 2026-09-16；commit `d62f0d6` + 评审修正；`tsc` 0 / 全量 1108 测绿）**；**待页面验收**。注：本票 Type=bug 但**锁测里的 Playwright 实测无法执行**——仓内无 e2e 基建（playwright 未安装、`scripts/verify-*.mjs` 已不存在），全部改为手工验收清单

## 来源

issue 09 验收收口后追加需求 #3（2026-09-15 用户提出）："shift 按住进行拖拽音符时，此时无法滚动上下滚轮，这个需要支持吗？"

## 症状

1. **Shift+拖拽时滚轮毫无反应**（用户实测；代码上 `handleWheel` 并未拦拖拽，故真因不是"拖拽禁用滚轮"）。
2. 拖拽中一旦滚动/缩放，**幽灵与光标脱节**：幽灵停在旧拍位，松手却按新 `scrollY` 结算 → 所见≠所得。

## 根因

1. **Shift+滚轮被浏览器映射为横向滚动** → 容器 `overflowX:'hidden'`（`Editor.tsx:458`）吃掉 → 全局无效（拖拽与否都一样）。`handleWheel`（`FinalVirtualCanvas.tsx:941-964`）只有 `ctrlKey` 分支，无 `shiftKey` 分支。
2. **拖拽是缓存的派生值，不随视口重算**：`FinalVirtualCanvas.tsx:543-554` 的"视口变化时重算"effect 显式跳过拖拽（`|| dragRef.current`，框选才走）；`dragGhost` 只在 mousemove 时写入，而**滚动不产生 mousemove**。锚点（`rawPressBeat` / `pressLane`）是谱面坐标，本身滚动安全——不安全的是"当前落点"。

## 修法（用户 2026-09-16 拍板 Q11=甲 / Q12=甲 / C1=甲 / C2=甲）

1. **允许拖拽中滚动与缩放，并修正确性**：把上述 effect 扩展到拖拽——视口（`scrollY` / `scale`）变化时用当前光标 + 同一 `dragDelta` 重算幽灵与落点，保证所见即所得。
2. **越界冻结**：滚动导致光标出谱面末端 → 走 `freezeGestureCursor` 同口径（手势进行中有锚点 → 冻结最后合法落点并保持可见），`dragFrozenRef` 已有机制，松手提交冻结值。
3. **Shift+滚轮全局按纵向处理**：`handleWheel` 里 `shiftKey` 时取 `|deltaX|` 与 `|deltaY|` 的较大者作为纵向滚动量；**全局生效**（不只在拖拽中），保持行为一致。
4. 不做边缘 auto-scroll（成本最高，本期不做）。

## 锁测

- **单测**：本项可单测面很薄（wheel 与视口重算均在组件层），按仓库惯例以页面实测 + 手工验收为主；`dragDeltaBeat` / `freezeGestureCursor` 既有用例不得回归。
- **Playwright 实测（`scripts/` 脚手架，读 IndexedDB 真值）**：
  1. 拖起音符 → 滚轮滚动 → 幽灵仍与光标对齐（绿像素中心 y 与光标 y 偏差 < 阈值），松手落点 **= 幽灵拍位**（不再是滚动前/后两套值）；
  2. 拖拽中 `Ctrl+滚轮` 缩放 → 同上，落点 = 幽灵拍位；
  3. **Shift+滚轮**（无拖拽）→ 画布纵向滚动生效（修复前无反应）；
  4. 拖拽中滚到谱面末端外 → 幽灵冻结在最后合法落点、松手提交该值、`pageerror=0`。
- **手工验收**：普通滚轮 / Shift+滚轮 / Ctrl+滚轮三种在拖拽中与空闲态下行为一致且无卡顿。

### 实现与评审记录（2026-09-16）

- **已实现**（commit `d62f0d6`，2 文件 +40/−8）：视口重算 effect 从"仅框选"扩展到拖拽（新增 `dragCursorRef` 记录最后一次 mousemove 的画布坐标）；滚动容器 `onWheel` 处理 Shift+滚轮。
- **实现位置与票「修法 3」的偏差（确认更优）**：票写"在 `handleWheel` 里取 `|deltaX|` 与 `|deltaY|` 的较大者"，实现改到**容器** `onWheel`，判据为「**仅当横向分量占优**才转纵向」——① 画布拿不到容器引用，而吃掉横向的正是容器那层 `overflowX:hidden`；② 若按"较大者"无条件处理，在**未做横向映射**的平台（deltaY 仍占优）会与原生纵向滚动叠加成**双倍滚动**。画布 `handleWheel` 注释已同步指向容器（避免两处口径分叉，`issue 108` 落点 5 的同款教训）。
- **越界冻结**：沿用既有 `dragFrozenRef`（九轮机制），effect 在 `dragDelta` 为 null 时保持已冻结帧 —— 与 `freezeGestureCursor` **同口径**，未另调该函数。
- **`/code-review` 已知未修**：`deltaMode`（Firefox 行模式）未折算（与既有 wheel 处理一致）；`el.scrollTop +=` 绕过 `setScrollY` 的边界钳制（容器自身会 clamp，行为等价）。
- 验证：`tsc` 0 / **1108 测全绿**；**无 e2e 基建**（playwright 未安装、`scripts/verify-*.mjs` 已不存在）→ 全部改为手工验收清单。
