# 176 · 谱面切换器当前钮：色块带等级，去掉重复的 Easy

Type: feature
Status: resolved
Blocked by: 175

**来源**：用户 2026-10-25 附图 —— `[EZ] Easy · 标题 1`：EZ 已代表 Easy，等级却在标题末。Grill Q1=等级进色块；Q2=文案只留谱面名；Q3=预览页同一套。

**定案（用户 2026-10-25）**：`[EZ 1] 谱面名`。下拉列表行不改。
**验收修订（用户 2026-10-25）**：空名 / 与工程同名**仍要显示**谱面显示名（回落工程名），不得只出色块。与锁定无关——官方谱大多没单独谱面名，藏掉后看起来就像「非锁定都不显示名字」。

**修法**：`diffPillLabel`；`chartSwitchLabel` 只返回独立谱面名；工作台 / 预览当前钮用色块+可选标题；`.pp-pill__diff` nowrap。

**锁测**：`projectCatalog.test.ts` 改 chartSwitchLabel + 新 diffPillLabel；静态工作台/预览触发钮走新拼法；DOM 预览 `EZ 3` + `Second Beat`。

## Comments

- 2026-10-25 实现：工作台 / 预览当前钮同一套；下拉行仍 EZ + 全称元信息。相关测试 43 例绿。待用户验收。
- 2026-10-25 验收回修：`chartSwitchLabel` 改回始终 `chartEffectiveTitle`（空名回落工程名）；DOM 加「title:null → 仍显示 Wonder Night Land」。
