# 84 · 音符计数口径：BPM 线不该计入 + Slide 应按结点计

Type: bug
Status: resolved（2026-09-10 实现 + 锁测，待你在页面验收）
Blocked by:

## 来源

用户 2026-09-10 复报（第 4 条 + 同日追加）：

> 4. bpm 线不应该被纳入音符计数当中。

> 追加：音符数量统计问题，我额外追加一条 —— Slide 的统计也存在问题。当前 Slide 只会被算作 1 个音符。
> 假设 Slide 为 `A→B`，此时应该是 2 个音符；`A→B→C` 应该是 3 个；`A→H→C`（H = Hidden 节点）应该是 2 个。

## 事实基线（两处计数，口径不一致）

| 计数 | 位置 | 消费点 | 修复前口径 |
| --- | --- | --- | --- |
| **音符总数** `countChartNotes` | `src/chart/editing/NoteEditing.ts:11` | `src/chart/Editor.tsx:83` → 右侧「音符」面板徽标 | Slide 按**非 hidden 结点数**计（✅ 已符合追加要求），但 **BPM/System 也 +1**（❌） |
| **已过判定线音符数** `countNotesUpToBeat` | `src/chart/editing/NoteEditing.ts:37` | 播放 HUD 右下角 `♪ N`、实时显示线右沟槽读数 | BPM/System 不计（✅），但 **Slide 整条算 1**（❌ 用户复报的就是这个） |

即用户看到的「Slide 只算 1 个」来自**第二处**（`countNotesUpToBeat`）；两处口径本应同源。

## 定案口径（用户 2026-09-10）

1. **BPM / System 不是音符** → 任何音符计数都不计入；
2. **Slide / Long 按「可击打的结点」逐个计** —— `A→B` = 2、`A→B→C` = 3、`A→H→C` = 2（H = hidden，不可击打）；
3. 两处计数（总数 / 已过线数）**同口径**：所有结点全部过线时二者相等。

## 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/chart/editing/NoteEditing.ts` | `countChartNotes`：`else if (n.type !== "BPM" && n.type !== "System")` 排除 BPM/System；`countNotesUpToBeat`：Slide/Long 改**逐非 hidden 结点**判过线（`hittableConnections` 抽出共用判据），取代「按首结点算 1」 |
| 注释 | 两处均补「hidden 不可击打不计入」与「与另一处同口径」说明 |

> 行为变化：`countNotesUpToBeat` 对**空滑条（无结点）**由「保守计 1」改为 0（无结点 = 无可击打音符）。
> 已有单测 `空滑条（无结点）保守计为已过线` 随口径更新。

## Comments

- 2026-09-10 实现：`countChartNotes` 的 `else` 收窄为 `else if (n.type !== "BPM" && n.type !== "System")`；
  `countNotesUpToBeat` 的 Slide/Long 分支改为遍历 `hittableConnections(n)`（抽出的共用判据：
  非 hidden 结点）逐个判过线，取代「按首结点算 1」。两函数注释均写明「与另一处同口径」。
- 行为变化：空滑条（无结点）的已过线计数 1 → 0（无结点 = 无可击打音符），原用例随口径更新。
- 锁测：`tests/unit/NotePlayheadStats.test.ts` 共 13 例全绿（见下）。

## 锁测

`tests/unit/NotePlayheadStats.test.ts`：

- `countNotesUpToBeat`：playhead 2.5 → 5（修复前 4）／全覆盖 → 6（修复前 5）／playhead 2.0 → 3（滑条按结点各自判过线）／空滑条 → 0；
- `countChartNotes`（新增 describe）：`[BPM, Single×3]` → 3（修复前 4）／纯 BPM+System → 0／
  Slide `A→B` = 2、`A→B→C` = 3、`A→H→C` = 2／混排谱面（BPM + 4 结点含 1 hidden + 2 单键 + 方向键）= 6／
  **总数 == 全部过线时的已过数**（两处同口径护栏）。
