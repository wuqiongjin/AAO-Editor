# 196 · 框选批量删滑条中间结点 → 顺带执行「删段」（SP 段丢采样点 / 普通滑条整条消失）

Type: grilling（定案票；语义已由用户拍板）
Status: resolved（用户 2026-10-31 确认 A′；2026-11-01 实现 + 锁测）
Blocked by:
Related: [80](./80-删除工具作用于含Hidden的Slide时的取舍.md), [92](./92-删除Slide中间结点转Hidden-bestdori口径.md), [77](./77-Hidden结点占位与切割两处缺陷.md), [88](./88-单击选区内音符应作用于整片选区.md)

## 来源

用户 2026-10-31 反馈两条，均为**框选批量删中间结点**：

1. SP 滑条（曲线滑条）批量删两个锚点后曲线被拉直；逐个删同样两个则正常。
2. 普通 4 结点滑条批量删两个中间结点后**整条滑条消失**；期望是两个中间结点转 hidden、滑条保留。

## 症状

### 症状 A（SP 段丢采样点）

原始：`beat 4 → 7.25`、每 `0.0625` 拍一个结点，共 **53** 个；非 hidden 的只有 `4 / 5.25 / 6.5 / 7.25`，其余 49 个是采样点。

| 操作 | 结果 |
| --- | --- |
| 逐个删 `5.25`、`6.5` | 仍 53 结点，两枚原位转 hidden，曲线不变 ✓ |
| 框住这两个锚点后删除 | **34** 结点：`5.25 → 6.5` 之间 19 个采样点被清空，两枚锚点同时转 hidden；该段拉成直线 ✗ |

### 症状 B（普通滑条整条消失）

原始：`1.75/5 → 2.25/0 → 3/4 → 3.75/4`（无 hidden）。

| 操作 | 结果 |
| --- | --- |
| 框住 `2.25/0`、`3/4` 后删除 | **输出 0 条音符**（整条滑条消失） ✗ |
| 期望（用户给出） | 4 结点全在，中间两枚转 `hidden: true`，首尾保留 |

## 根因（同一条链，两个落点）

1. `src/rendering/hitTest/hitTest.ts:271-294` `computeItemsInBox`：框选滑条时，框内可见结点 → `slideNode`；**逻辑段（跨过 hidden，`projectedSlideSpans`）的全部结点都在框内 → 再追加一条 `slideRegion`**。两类条目互不排斥。
2. 框住一条段的两个可见端点时，该段所有结点（含 hidden 采样点）必然也在框内 ⇒ **选区恒为「结点 + 该段的 region」**。实测：症状 A 得 `[slideNode 20, slideNode 40, slideRegion 20]`；症状 B 得 `[slideNode 1, slideNode 2, slideRegion 1]`。
3. `src/chart/editing/SelectionEditing.ts:59-95` `removeSelection` 分别解释两类条目：中间可见结点 → `nodeToHidden`（issue 92）；`slideRegion` → 段内含 hidden（`sp.end - sp.start > 1`）则清段内 hidden（issue 80），否则 `splitAfter`（拆条）。
4. `SelectionEditing.ts:105-113` 两类条目**在同一次调用里叠加执行**：

| 症状 | 叠加后的落点 | 产物 |
| --- | --- | --- |
| A | 先隐藏 `5.25`/`6.5`，再把 `5.25→6.5` 段内 19 个采样点全删（`sp.end-sp.start=20>1`） | 34 结点、曲线拉直 |
| B | 先隐藏 `2.25`/`3`，再对 `2.25→3` 段下 `splitAfter`。滑条**因上一步已含 hidden** 改走 `splitSlideHiddenAware`；可见结点只剩首尾 2 个，命中 `SelectionEditing.ts:202` 的 `if (bounds.size > 0 && vis.length <= 2) return []` | 整条丢弃 |

第 4 步那个 `return []` 是 issue 77 #9 的「一段时删整条」规则 —— [issue 80](./80-删除工具作用于含Hidden的Slide时的取舍.md) 已明确**取代**它（改为"只清段内 hidden"），代码里留着的这条现在只能被"先隐藏再拆分"的顺序触发。

> 仅删掉这个 `return []` **不够**：症状 B 去掉它会变成 `Single(1.75/5) + Single(3.75/4)`（两端点被拆开、中间 hidden 被首尾收口剥掉），仍不是预期。真正的病根是条目叠加（第 1~4 步）。

## 定案（用户 2026-10-31 确认）

**A′ 规则**：删除时，若某 `slideRegion` 条目所属**逻辑段的两端结点**都作为 `slideNode` 出现在同一批条目里 → **忽略该 region 条目**（既不拆条、也不清 hidden）。

理由：框选无法只框住一条段而不同时框住它的两个端点 ⇒ 这种 region 必然是框选的副产物；用户显式点段（单击 / 右键连接带）时不会有端点结点条目同时在场。

- **生效面**：框选（指针态框选 + Delete、删除工具框选、右键框删）；`findItemAt` 单击结点、单击段各自照旧。
- **明确不保**：先点段、再 Shift 点它的两个端点后删除 —— 该组合丢掉段的部分（语义本就含糊，接受）。
- **配套**：`SelectionEditing.ts:202` 的 `if (bounds.size > 0 && vis.length <= 2) return []` 按 issue 80 已被取代，随之删除（注释同步改）。
- **已否决**：上一版方案 D（`SelectionItem` 加"点选/框选"来源字段）—— 行为上几乎等同 A′，代价却覆盖 `hitTest` / 渲染选区 / 框选预览 / 复制镜像 / `remapSelection` / 一批测试。

实测（未改源码，按 A′ 规则在脚本里预演后调用现有 `deleteSelection`）：

| 用例 | A′ 产物 | 与用户预期 |
| --- | --- | --- |
| 症状 A | 53 结点，`5.25`/`6.5` hidden，与"逐个删"结果逐字相等 | ✓ |
| 症状 B | `1.75/5 → 2.25/0(H) → 3/4(H) → 3.75/4` | ✓ 逐字相等 |

## 文档影响（ADR / CONTEXT / 既有票）

| 文档 | 是否要改 | 说明 |
| --- | --- | --- |
| `docs/adr/0001-音符覆盖与滑条规则.md` §6.2 | **要**（一句） | 补优先级：「同一次删除里，若某段的两端结点本身也被选中为结点，则该段不执行拆条 / 清 hidden」。ADR-0001 开头的变更触发要求"冲突时先更新本文并经用户确认"——用户 2026-10-31 已确认，实现时同批更新 |
| ADR-0001 §6.1（选择） | 不改 | 框选仍"框到区域→选区域"，条目集合不变，变的只是**删除时**的优先级 |
| `CONTEXT.md` | 不改 | 未引入新术语；「段」「隐藏结点」「滑条子部分」「覆盖」定义不变 |
| ADR-0009（SP 段 / hidden） | 不改 | 采样点即真相、hidden 对段透明均不动；本次只改删除的条目优先级 |
| [issue 80](./80-删除工具作用于含Hidden的Slide时的取舍.md) 定案 | **不推翻，只收窄触发条件** | 「删段含 hidden = 只清段内 hidden」对单击 / 右键点段仍然成立；仅当该段两端结点同时被选中为结点时让位。票内现有锁测（只传 region 条目）保持绿 |
| [issue 92](./92-删除Slide中间结点转Hidden-bestdori口径.md) 定案 | **不推翻，反而落实** | 其"框选批量同口径"过去无锁测、实际也不成立（本文症状 A/B），修完才真正成立 |
| 数据格式 / 导出 / 渲染 | 不改 | 产物仍是合法 Slide JSON（首尾可见、hidden 只在中间），`validateChartCode` 口径不变 |

## 实现落点

1. `src/chart/editing/SelectionEditing.ts` `removeSelection`：条目归一 —— 先建 `slideNode` 索引；`slideRegion` 分支开头判定"该逻辑段两端结点是否都在 `slideNode` 集合里"，是则跳过该 region。
2. `SelectionEditing.ts:202` 早退规则删除。
3. `docs/adr/0001-音符覆盖与滑条规则.md` §6.2 补上述优先级句。

## 锁测

1. 新增 `tests/unit/chart/editing/SlideBatchNodeDelete.test.ts`：用**真实 `computeItemsInBox`**（`ChartGeometry` + `viewport`）框住两例结点 → `deleteSelection`，断言与"只传 `slideNode` 条目"的结果逐字相等（症状 A：53 结点、5.25/6.5 hidden；症状 B：4 结点、中间两枚 hidden）。
2. 回归：单击 `slideRegion` 仍按 issue 80 清段内 hidden / 拆条（`HiddenNode.test.ts` 现有用例保持绿）。
3. 回归：整条全框删除仍整条消失（`computeItemsInBox` 全框 → 4 个 `slideNode` + 3 个 region）。

## Comments

- 2026-10-31 调查（未改代码）：两例均用 esbuild + node 直跑源码复现，条目集合由真实 `computeItemsInBox`（真实 `ChartGeometry`）取得；症状 A 的错误产物与用户附的"错误代码"逐字一致。按 A′ 预演后两例均产出用户给出的期望 JSON。
- 2026-10-31 用户反馈：上一版把 A 的代价写成"不能删段"不准确 —— 单击 / 右键点带子删段不受影响，受影响的只是"框选兼删段"这个本来含糊的组合；D 方案随之撤回。
- 2026-10-31 用户确认 A′，要求先落票、暂不动代码。
- 2026-11-01 实现：按 A′ 规则在 `SelectionEditing.ts` `removeSelection` 过滤掉两端结点均在选区内的 `slideRegion` 条目；删除 `SelectionEditing.ts` `splitSlideHiddenAware` 早退代码；ADR-0001 §6.2 补优先级；锁测新增 `SlideBatchNodeDelete.test.ts` 覆盖两例及 issue 80 回归与全框删除回归。
