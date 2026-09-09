# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## 记账粒度（2026-09-09 定）

票是**可回溯的最小单位**，但不要求每张票都写成长文。按性质分两类：

| 类别 | 适用 | 正文要求 | `map.md` 记账 |
| --- | --- | --- | --- |
| **定案票**（`Type: grilling` / 新能力 / 会触发 ADR 变更） | 需要用户拍板语义、要改 ADR 或 CONTEXT 的 | 写全：来源 / 症状 / 根因 / 定案 / 实现落点 / 验收 / Comments 对话存档 | 一行：票号 + 主题 + **定了什么**（语义结论） |
| **轻票**（`Type: task`，点状缺陷 / 回归修复） | 一条说得清的 bug，语义已被既有 ADR 覆盖、无需重新拍板 | 短模板：**来源 / 症状 / 根因 / 修法 / 验收**，各 1~3 行，全篇 ≤ 25 行 | 一行：票号 + 主题 + 一句"改成什么" |

- **`map.md` 只做决策索引**：一条 = 一行指针 + 结论。实现流水账、`tsc`/测试数字、改动文件清单一律留在**票内**（`## Comments` 追加）——map 是给"下一步该干什么"看的，不是实现日志。
- **同一批报上来的琐碎点 → 进一张【批次票】，不单独占号**：文件名 `NN-<日期>验收缺陷批次.md`，正文每条一个 `### #k` 小节（症状 / 根因 / 修法 + 逐条 `Status`）。只有需要重新拍板语义、或会触发 ADR 变更的，才单独开票。
- **已开出的票不合并、不改写**（保留事实存档）；本约定只对**新票**生效。
- **不得把实现口径冒充用户定案**：用户只报了症状与诉求时，票里那一节写「本轮实现口径（待验收）」；只有用户明确拍板过的内容才能标「定案（用户 YYYY-MM-DD）」。

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## `map.md` 是多写者文件

`.scratch/<effort>/map.md` 同时被 `/wayfinder` 和各个实现会话维护，编辑器的打开缓冲也会覆盖写回——**同一轮内它可能被别人重写**（实测：本会话写入的段落事后变成另一份文案）。因此：

- 细节写进票正文 `issues/NN-<slug>.md`，map 只留一行指针；map 被改写不丢信息。
- 改 map 前先 `grep` 确认要改的句子仍在；不在就按当前文案重新定位，别按记忆里的旧文案硬塞。
- 做**追加式**小改（在既有条目尾部补一句），不要整段替换别人的文案。
