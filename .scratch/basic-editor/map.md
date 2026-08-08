# Map: 完善谱面编辑器基本功能

> Effort: `basic-editor` · 由 wayfinder 生成 · 2026-08-08

## Destination

走到这张地图的尽头 = **"完善谱面编辑器的基本功能"这一里程碑的路线已清晰**：编辑操作、音符替换/滑条规则、谱面代码生成与解析、谱面代码编辑器、音频播放与预览线、文件保存/导出、密集音符性能 —— 每一块都已定案（决策或原型），可由后续会话直接手写实现。

这是通往最终目标（高效便捷易用的自制谱编辑器 + 谱面预览 + 视频预览/导出 + 未来 AI 辅助采音）的**第一座里程碑**。本 effort 只做"基本功能完备、能用、好用"的编辑器本体。

## Notes

- **领域**：BanG Dream / Bestdori 自制谱编辑器。谱面代码 = Bestdori 风格 JSON 数组（见 `docs/plans/谱面代码规则文档.md`）。
- **每次会话必读**：`docs/plans/详细设计.md`（规格，含"细化功能/进阶功能"编号）、`docs/plans/TODO.md`（任务/BUG 清单）、`docs/plans/谱面代码规则文档.md`（代码格式）、`docs/plans/需求文档.md`。
- **需调用的技能**：`/grilling`、`/domain-modeling`、`/research`、`/prototype`。
- **技术栈**：Electron + React 19 + TypeScript + Vite。活跃渲染器 = `src/components/FinalVirtualCanvas.tsx`（Canvas 虚拟画布）。
- **当前代码硬事实（已核对）**：项目当前**不通过编译**；存在 App.tsx 的真实类型错误 + 大量死代码 canvas 组件（OptimizedCanvasChartCanvas / VirtualCanvasChartCanvas / SimpleVirtualCanvas / DebugCanvas / CanvasChartCanvas / ChartCanvas / CanvasChartCanvasExample）与 App.tsx 里残留的 4 个测试组件。活跃 `FinalVirtualCanvas` 中，音符替换规则（`NoteReplacementRules`/`SlideEndpointManager`）的 import 被**注释掉**（放在旧 canvas 组件里）。无测试框架配置（有 `tests/unit/*.test.ts` 但没有 runner / test script）。
- **偏好**：中文注释；遵循详细设计的编号术语；惯例见 `docs/plans/NAMING_CONVENTIONS.md`。

## 当前状态盘点（已核实的基线，非决策）

由本次会话直接调查得出，作为后续所有 ticket 的共同前提：

- 入口：`SongUploader → Editor`。Editor 左侧 Toolbar、中间 `FinalVirtualCanvas`、右侧 NoteInfoPanel + 谱面面板。
- 音符数据模型：`src/notes/Charts.tsx`（Single / LDirectional / RDirectional / Slide / Long / BPM / System）。
- 谱面代码：`ChartConverter.ts` 实现 notes↔code JSON 双向转换，与规则文档一致；skill/charge 暂不支持（文档明示"暂不支持"）。
- 编辑操作（Editor.tsx）：复制/剪切/删除可用（按选中下标）；**粘贴只追加到末尾**（不会粘贴到光标处）；**镜像为 `() => {}` 空桩**；撤销/还原可用；**无任何键盘快捷键绑定**（工具栏提示 Ctrl+C/X/V/Z/Y/Del 但没人监听）。
- 播放/暂停按钮无 onClick（惰性）；无音频播放、无预览线、无按键音。
- 无文件保存/加载/导出（Electron main/preload 待查）。
- 性能：虚拟画布存在，但 3000-5000 音符缩放大卡顿（TODO 遗留）。
- 构建：`npx tsc -b` 报真错误（App.tsx:56 `File|null`→`File`）+ 大量死代码未用变量错误。

## Decisions so far

<!-- 索引：每个已关闭 ticket 一行，gist + 链接 -->

- [01 当前代码状态盘点](./issues/01-当前代码状态盘点.md) — 现状=半成品原型；构建不过、死代码堆积；编辑操作(+镜像为空桩/粘贴非光标/无快捷键)、替换规则在 FinalVirtualCanvas 被注释、代码编辑器仅占位、无音频、无文件 IPC 均待补。
- [02 谱面代码格式对齐](./issues/02-谱面代码格式对齐.md) — 内部格式与 Bestdori 高度兼容，无需重设计；只需 Bestdori 导入/导出适配器 + 字段规范化（direction 字符串↔数字）。
- [03 音频播放与预览线架构](./issues/03-音频播放与预览线架构.md) — 用 AudioContext+AudioBufferSourceNode，渲染进程 decodeAudioData；预览线在 FinalVirtualCanvas 的 RAF 循环读 currentTime 转换；按键音提前 ~100ms 预调度；无需 Electron 主进程解码。
- [04 Electron 文件持久化与导出](./issues/04-Electron文件持久化与导出.md) — 加 IPC 通道（preload invoke → main ipcMain.handle + dialog + fs）；MVP 导出 chartCodeToJSON 的 JSON 字符串。
- [06 死代码整理与构建修复](./issues/06-死代码整理与构建修复.md) — 已执行：删除 8 个死 canvas 组件 + 4 个测试脚手架，收敛到 FinalVirtualCanvas；修复 App.tsx 类型错误与各类死变量/死函数；`tsc -b` 与 `npm run build` 全绿；配置 vitest 使 9 个单元测试通过。仓库进入干净可编译可测试基线。（同时解阻塞了 10；07 仍待 05）
- [11 坐标模型统一与渲染框架重构](./issues/11-坐标模型统一与渲染框架重构.md) — 坐标模型已定案并在坐标/命中层落地：虚拟 X 原点=轨道内容左缘 `trackBgX`、音符 X 不含 `borderTotalWidth`、`virtualToCanvas`/`canvasToVirtual` 统一减去 `trackBgX`，保证任意缩放下音符与网格对齐（修症状 2/3/4）；并清除 FinalVirtualCanvas 内 25 处 `console.log`。`tsc` 全绿。渲染框架/性能重构仍推迟（见 10）。
- [12 编辑器布局自适应](./issues/12-编辑器布局自适应.md) — 页面显示不全（需 90% 缩放）根因=固定像素布局合计约 1528px 超出窄屏；仅完成根因评估，**自适应布局未实现**（本次不实现，待规划）。
- [05 基础编辑操作范围锁定](./issues/05-基础编辑操作范围锁定.md) — 已 /grilling 定案并**实现**：多选/拖拽圈选/Shift加选/Ctrl+A(仅画布)、粘贴到鼠标锚点、镜像(左右lane+方向翻转+滑条端点同步)、快捷键(Ctrl+C/X/V/Z/Y/Delete/Backspace/Ctrl+M)+上下文分发、undo/redo 清选区；新增 `NoteEditing.ts` 纯逻辑+8单测。`tsc` 全绿、17 测试通过。07 已解锁。

## Not yet specified

可再细化的雾（推进边界后毕业）：

- **"谱面预览"的形态**：音频播放 + 预览线到底是编辑器内联播放，还是独立预览模式？待 03 音频架构 research 后再定。
- **更多音符样式 / 图标资源管理**：noteskin 资源如何组织与导入更多样式。待基本编辑完成后才可定。
- **负数 BPM 语义细节**：支持范围与网格伸缩规则。
- **撤/重做对滑条、方向键形态的完整覆盖**（Ctrl+Z 无法回退方向键形态——需一个扩展现有 history 的决策）。

## Out of scope

- **视频预览（谱面视频渲染）** —— 更大愿景，本 effort 不做。
- **预览视频导出** —— 更大愿景，本 effort 不做。
- **AI 辅助采音** —— 未来智能功能，本 effort 不做。
- **安卓 / iOS 移植** —— 需求文档仅"后续考虑"，本 effort 不做。