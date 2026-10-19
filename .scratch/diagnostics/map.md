# Map: 可观测性（日志 / 轨迹 / 兜底 / 诊断包）

> Effort: `diagnostics` · 2026-10-13 · 开于用户发布前评估（"没有成体系的日志系统，用户遇到问题无法定位"）

## Destination

本 effort 是**可观测性**的家：日志落盘、操作轨迹、崩溃兜底、诊断包导出（ADR-0019）。应用功能不归。

**边界**（建议，用户可调）：日志 / 轨迹 / 兜底 / 诊断包的实现归这里；Bestdori 网络失败路径的**埋点核查**归本 effort（ADR-0019 §2），网络实现本身归 bestdori-integration。

## Notes

- 排序（2026-10-13 用户拍板）：全部实现票等 `feature/bestdori-integration` 合并后落稳定 main——合并是最大变量，基建不踩合并中的代码。
- **2026-10-19**：Bestdori 已合入当前线，上述等待取消。开工顺序：01 → 05 与 04（04 不再等 02）→ 03 → 02 最后。票内 10-13 快照以各票 2026-10-19 Comments 为准。
- 票内的 pre-merge 快照事实（console 计数、文件清单、路由清单）以合并后实测为准；05 不再以「`src/` 零 console」为权威判据。
- 范围分阶段（ADR-0019 §2）：第一阶段 = 静默故障 + 数据损坏（白屏 / 崩溃、导出失败、工程保存 / 加载失败；bestdori 合并后的网络 / 登录 / 上传失败路径同属本阶段）；第二阶段 = 难复现问题由操作轨迹兜底。
- **无远程遥测**（ADR-0011 §1）：不得引入任何错误上报 SDK；主进程合并后虽获得受控网络能力，不因此重开遥测议题（ADR-0019 §1）。

## Decisions so far

- [2026-10-13 用户拍板] 可观测性形态与范围 = [ADR-0019 本地日志与诊断包](../../docs/adr/0019-本地日志与诊断包.md) 全文：纯本地（Q2=A）；第一阶段先静默故障 + 数据损坏、第二阶段难复现由轨迹兜底（Q1=D）；双轨落盘 + 按天 / 5MB / 7 天 / 50MB 轮转（Q6=A）；轨迹粗粒度 + ring buffer 500（Q7=A）；诊断包含脱敏默认全量 + 谱面数据默认不附（Q8=A）；三层 boundary + 全局 handler（Q9=A）。
- 术语（诊断包 / 操作轨迹）已入 `CONTEXT.md` § 诊断与日志。
- [2026-10-19 复核] 代码仍无 logger / 落盘 / ErrorBoundary / 诊断包 UI。实现口径收窄写进各票：05 不追求清零 console；04 不挡在 02 后；02 仍是第二阶段。ADR-0019 正文未改。
- [2026-10-19] [01 日志模块与主进程落盘](./issues/01-日志模块与主进程落盘.md) 已落地：`userData/logs/` 双轨 + `log:write`/`log:trail`；`trail.append` 立刻写盘（票 02 的 ring 是调用方）。
- [2026-10-19] [05 第一阶段失败路径落盘](./issues/05-旧console迁移与第一阶段覆盖面收口.md) 已落地：表内失败走 logger / `projectStore` sink；不追求 src 零 console。
- [2026-10-19] [04 诊断包导出](./issues/04-诊断包导出.md) 已落地：设置页关于段导出脱敏 zip（主进程 jszip + 保存对话框）；谱面 JSON 默认不附。
- [2026-10-19] [03 崩溃兜底三层边界](./issues/03-崩溃兜底三层边界.md) 已落地：App / 七页 PageSlot / 画布三层错误态 + 全局 `error`/`unhandledrejection` 记日志；崩溃态接导出诊断包。
- [2026-10-19] [02 操作轨迹埋点](./issues/02-操作轨迹埋点.md) 已落地：ring 500，崩溃/诊断包 flush；模块级动作进 jsonl。

## Frontier

- [01 日志模块与主进程落盘](./issues/01-日志模块与主进程落盘.md) — resolved（`registerAppLogIpc` + `userData/logs/`）
- [05 第一阶段失败路径落盘](./issues/05-旧console迁移与第一阶段覆盖面收口.md) — resolved（表内失败走 logger；不要求 src 零 console）
- [04 诊断包导出](./issues/04-诊断包导出.md) — resolved（设置页关于段导出 zip；谱面默认不附）
- [03 崩溃兜底三层边界](./issues/03-崩溃兜底三层边界.md) — resolved（App/PageSlot/canvas 三层 + `[uncaught]` handler；错误态接诊断包）
- [02 操作轨迹埋点](./issues/02-操作轨迹埋点.md) — resolved（ring 500 + 崩溃/诊断包 flush；模块级埋点）
