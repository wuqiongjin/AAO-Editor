# 155 · Bestdori 制谱器谱面读写口径

Type: research
Status: resolved
Blocked by: —

## 来源

实现 [153](./153-宽松谱面代码兼容与画布投影.md) 后，手测官网制谱器仍无法钉死「谱面代码 Apply / 关开后再打开」的口径。已确认：

- 已知 `type` + 多余键：Bestdori 下次打开仍在。
- `{ "type": "Mystery", … }` 与无 `type` 对象：写入后下次打开消失。
- 发帖 `sanitizeAll`（只留 `Single/Directional/Slide/Long/BPM`、丢 `System`、剥 `charge`）已写在 [bestdori-community-upload.md](../../../docs/research/bestdori-community-upload.md)，**不是**本票范围。
- [154](./154-官方与社区谱面兼容性压力测试.md) 的 794 张语料里没有未知 `type` / 无 `type`，不能回答这个问题。

153 保持 `done`。本票只调研，不改 Apply、不改 ADR-0014。若结论与「未知 type 当 Opaque 保留」冲突，另开 `grilling`。

## 研究问题

1. 官网制谱器把 JSON 读进内存、写出谱面代码、写入持久化（关页再开）各走哪段前端？和 `sanitizeAll` 是否同一函数？
2. 未知 `type`、缺 `type`、已知 `type` 上的多余键、connection 上的多余键，分别是 Apply 当下丢掉，还是持久化后再丢掉？
3. 画布上看不到，是否仍可能留在 Copy 出的数组里？
4. 官方 `/api/charts/{id}/{diff}.json` 贴进制谱器再 Copy，相对 API 原样丢掉什么？（对照用，不改 153 的「官方 API 保真」产品口径。）

## 测试范围

- 从 `https://bestdori.com` 当前制谱器页抽出 `CommunityChartsNew.*.js` 与 `app.*.js`，**钉死 hash**；hash 变了必须重抽。
- 在 Node 里对同一套 fixture 重放反序列化 / 持久化 / Copy，不把手工点一次 UI 当规格。
- fixture 至少覆盖：已知 type + 顶层多余键、connection 多余键、未知 type、无 type、数组中夹未知对象、官方 SPECIAL 含 `System`/`charge`/`Long` 的最小切片。
- 每条 fixture 记三截：Apply 后立刻 Copy、关开后再 Copy、画布能否点到。
- 不把社区帖 JSON 当未知 type 证据；不在本票跑我们编辑器的 Apply 实现。

## 产物

- 报告：`docs/research/bestdori-chart-editor-io.md`（bundle hash、函数名/调用链、fixture 表、与 `sanitizeAll` 的差异）。
- 可复算的抽取/重放脚本（若值得进仓库：`scripts/`；否则步骤写进报告）。
- 给后续的建议：维持 ADR-0014 Opaque，或另开 grilling 对齐 Bestdori 丢弃。

## 验收

- 报告能单独回答「Mystery / 无 type 何时消失、多余键何时保留」，并指出对应源码位置。
- 明确区分：制谱器读写、画布、发帖清洗三条管道。
- 本票不修改 `src/`、不修订 ADR。

## Answer

- 报告：[bestdori-chart-editor-io.md](../../../docs/research/bestdori-chart-editor-io.md)
- 重放：`node scripts/replay-bestdori-chart-editor-io.mjs`（`--official-413` 对照官方谱）
- 结论：未知 `type`/无 `type` 在 **Apply `sanitizeAll`** 时丢弃；持久化不二次丢；已知 type 多余键保留；`charge` 仅 Apply 剥；发帖不自动 `sanitizeAll`。建议维持 ADR-0014 Opaque，对齐 Bestdori 丢弃需另开 grilling。

## Comments

- 2026-09-24：用户认可对象视图不能新增对象（新增只走完整谱面代码）；要求把「更准确测 Bestdori」从 153 拆出单独 research 票。
- 2026-09-24：完成 bundle 锚点调研与 Node 重放，产出 `docs/research/bestdori-chart-editor-io.md`。
