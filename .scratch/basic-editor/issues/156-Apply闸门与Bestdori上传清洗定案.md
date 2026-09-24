# 156 · Apply 未知 type 硬拒与 Bestdori 上传自动清洗

Type: grilling
Status: resolved
Blocked by: —

## 来源

- [155](./155-Bestdori制谱器谱面读写口径.md)：`CommunityChartsNew` 整表 Apply 用 `sanitizeAll` **静默丢掉**未知/无 `type`；发帖不再清洗。
- 用户（2026-09-24）：目标用户为**社区玩家**；不学官网「偷偷丢」；Apply 应**报错拒绝**。上传到 Bestdori 应**自动 `sanitizeAll`**，画布能玩则不应因 `System`/`charge` 上传失败。

## 定案（用户 2026-09-24）

### Q1 · 谱面代码整表 Apply：未知 / 无 `type`

**硬拒绝整份 Apply**，报错须标明数组下标（及 `type` 若有）。不学 Bestdori 过滤进内存。

允许进入源数据的顶层 `type`（白名单）：`Single`、`Directional`、`Slide`、`Long`、`BPM`、`System`。

- `System` 仍为 opaque（§ ADR-0014），**不**因含 System 拒 Apply（官谱常带）。
- 已知五种上的多余键、`charge`：**不**拒 Apply；`charge` **不**在 Apply 删除（与 2026-09-24 grill 一致）。

### Q2 · Bestdori 社区上传

- 点击上传时客户端**自动**执行与官网等价的 `sanitizeAll`（白名单五种、`System` 丢弃、递归剥 `charge`），再 `POST`。
- **不得**因「含 System/charge」对用户弹「谱面不合法」；仅元数据/登录/网络/API 码失败时报错。
- 与 Apply / 工程保存 / 另存为 **分管道**（见 [bestdori-chart-editor-io.md](../../../docs/research/bestdori-chart-editor-io.md)）。

### Q3 · 与旧 ADR「未知 type Opaque 经 Apply 保留」

撤销：**整表谱面代码 Apply** 不再接受顶层未知 `type` 或无 `type` 对象。Opaque 仅保留给 **`System`** 及画布侧已写入的合法源（实现细节见 153）。

## 实现落点

- **ADR**：[0014](../../../docs/adr/0014-宽松谱面代码源数据与画布投影.md) §1 Apply 闸门、§4 上传（2026-09-24 修订）。
- **153**：Apply 校验增加顶层 type 白名单；错误文案与禁用 Apply。
- **Bestdori 上传票**（ADR-0011 / integration）：`sanitizeAll` 函数与 [bestdori-community-upload.md](../../../docs/research/bestdori-community-upload.md) 对齐，上传前静默调用。

## 锁测

- 153：`parseChartCodeFromJSON` / Apply 路径单测：含 `{type:"Mystery"}`、无 `type` 对象 → 硬拒；含 `System` + `charge` 的官谱切片 → 通过 Apply。
- 上传：集成或脚本断言 POST body 已清洗（可复用 `scripts/replay-bestdori-chart-editor-io.mjs` 的 `sanitizeAll`）。

## Comments

- 2026-09-24：用户确认「拒绝优于静默丢」；上传自动清洗、不上传前校验拦 System/charge。
