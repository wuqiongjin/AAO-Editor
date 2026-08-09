# Map: 完善谱面编辑器基本功能

> Effort: `basic-editor` · 由 wayfinder 生成 · 2026-08-08

## Destination

走到这张地图的尽头 = **"完善谱面编辑器的基本功能"这一里程碑的路线已清晰**：编辑操作、音符替换/滑条规则、谱面代码生成与解析、谱面代码编辑器、音频播放与预览线、文件保存/导出、密集音符性能 —— 每一块都已定案（决策或原型），可由后续会话直接手写实现。

这是通往最终目标（高效便捷易用的自制谱编辑器 + 谱面预览 + 视频预览/导出 + 未来 AI 辅助采音）的**第一座里程碑**。本 effort 只做"基本功能完备、能用、好用"的编辑器本体。

## Notes

- **领域**：BanG Dream / Bestdori 自制谱编辑器。谱面代码 = Bestdori 风格 JSON 数组（见 `docs/plans/谱面代码规则文档.md`）。
- **每次会话必读**：`docs/adr/`（决策，权威）+ `CONTEXT.md`（术语，权威）。`docs/plans/` 下的详细设计/TODO/规则文档为基础期产物、可能过时且**不纳入 git**，仅作历史参考；冲突时以 ADR + CONTEXT 为准。
- **需调用的技能**：`/grilling`、`/domain-modeling`、`/research`、`/prototype`。
- **技术栈**：Electron + React 19 + TypeScript + Vite。活跃渲染器 = `src/components/FinalVirtualCanvas.tsx`（Canvas 虚拟画布）。
- **当前代码硬事实（已更新）**：项目**可编译可测试**（`tsc -b` / `npm run build` 全绿，vitest 84 测试通过）。死代码 canvas 组件已清理，收敛到活跃 `FinalVirtualCanvas.tsx`；音符替换规则（`NoteReplacementRules`/`SlideEndpointManager`）已重新接入；布局已自适应（见 12）；架构零风险清扫完成（见 15）；粘贴已应用覆盖规则（见 16）。音频播放/预览线、文件保存导出仍待实现。
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
- [07 音符替换与滑条端点规则重新接入](./issues/07-音符替换与滑条端点规则重新接入.md) — 已**实现**：恢复 NoteReplacementRules import；single/flick/skill/directional 放置改走 handleNoteReplacement（重叠替换+方向键组合），新增两点击自动连接滑条（含滑条间合并）；修复 'single'→'Single' 归一化与 subBeat||0 匹配。新增 9 单测，tsc/build 全绿、28 测试通过。已知缺口：滑条端点扩展交互③、占位样式、端点撞键、组合滑条工具（记录待办）。09 已解锁。
- [音符覆盖与滑条规则](./issues/07-音符替换与滑条端点规则重新接入.md) — **grill-with-docs 定案并实现**：权威规则 **`docs/adr/0001-音符覆盖与滑条规则.md`** + `CONTEXT.md` 术语。已实现：滑条禁止横向；滑条结点覆盖/拆条（单键任意结点忽略、滑键仅尾部加flick、技能键两端加skill、方向键中间拆两侧/端点拆端，flick与skill可并存）；撤销深拷贝(structuredClone)使方向键与滑条逐步回退；ChartConverter 补 skill 序列化。tsc/build 全绿、35 测试通过。"删除滑条子段"= 独立 feature 待做。
- [13 快捷键系统与自定义配置](./issues/13-快捷键系统与自定义配置.md) — **grill-with-docs 定案并实现**：权威规则 **`docs/adr/0002-快捷键系统与自定义配置.md`** + `CONTEXT.md` 术语。注册表扁平化为**按具体功能单键**（切换/执行拆分为独立功能，一功能一键、冲突检测）；音符(含 BPM/滑条)/编辑/播放动作默认键位（废弃旧 Ctrl 键位）；工具键 + 执行键双交互（编辑工具态 = Model A 点击即执行）；预览（放置/粘贴幽灵 + 镜像悬停单键与框选含连接区域，真实图标）；设置面板 UI（搜索 + 独立记录弹窗改键 + **屏蔽** + 导出/导入 JSON + 恢复默认）+ localStorage 持久化；Toolbar tooltip 动态化；仅画布作用域。已实现。
- [12 编辑器布局自适应](./issues/12-编辑器布局自适应.md) — **grill-with-docs 定案并实现**：废弃固定像素总宽（1528px 溢出根因），三栏自适应 + 可折叠（左/右面板随视口取 `min(px, vw)` 上限 + `min-width:0` 防溢出 + 画布由固定 750px 改为随视口等比例收缩，缓冲像素不变、事件坐标经 `cssToCanvas` 按显示比例换算）。1280px 窄屏 100% 缩放即可看全；左右面板可各折叠/展开（分隔条悬浮钮）。`tsc -b`/build 全绿、74 测试通过。折叠状态持久化/布局预设（ADR-0003 L2）待配置系统落地。
- [15 架构整洁清扫（C1+C2+C5）](./issues/15-架构整洁清扫-C1C2C5.md) — **improve-codebase-architecture 评审的零风险清扫已执行**：C1 死代码（删除 StatusBar/dragging/externalScrollY 死通道/debugPrint/Toolbar 静态卡/无 onClick 占位「组」「应」/console.log×5；播放按钮 disabled 注明待实现）；C2 坐标几何收敛（`TRACK_CHROME_TOTAL` 常量替代 12 处魔法数 + `trackGeometry` 唯一实现替代 7 处内联居中公式，坐标语义不变）；C5 镜像 lane 修复真实 bug（NoteInfoPanel 4-lane → 统一 `mirrorLane`/`mirrorNote`）。tsc/build 全绿、74 测试通过。C3/C4/C6 留待后续。
- [16 粘贴应用覆盖规则](./issues/16-粘贴应用覆盖规则.md) — **bug 修复**：粘贴不再直接 concat（修复同坐标重叠音符），新增 `pasteChartNotes` 使每个粘贴音符按 ADR-0001 覆盖规则处理（空位原样保留标记/length；普通覆盖替换/方向键 length+1；滑条结点 单键忽略/滑键尾端+flick/技能键两端+skill/方向键拆条；滑条清理重叠后独立加入不组合）。Editor 两处粘贴入口统一接入，新增 10 单测。tsc/build 全绿、84 测试通过。

## Not yet specified

可再细化的雾（推进边界后毕业）：

- **工作台 UI 与配置系统（已定案，待实现）**：设计已由 **ADR-0003** 锁定——取消上传页直达工作台（加载音频为顶栏按钮）；样式改 CSS design tokens、内置亮/暗主题（谱面画布固定深色）；布局 L1 折叠 + L2 命名预设、目标桌面三平台 + 浏览器、1280px 窄屏不溢出；统一 versioned `settings` JSON（主题+布局+快捷键）导入导出；状态管理改 `Editing/UI/Config` 三个 Context 分域。尚未排期实现，待后续 issue。**其中"面板折叠 UI"为 issue 12 的过渡形态，随工作台改造正式重做（样式随主题 token、折叠/宽度/预设纳入 settings JSON），勿在过渡形态上返工。**
- **"谱面预览"的形态**：音频播放 + 预览线到底是编辑器内联播放，还是独立预览模式？待 03 音频架构 research 后再定。
- **更多音符样式 / 图标资源管理**：noteskin 资源如何组织与导入更多样式。待基本编辑完成后才可定。
- **负数 BPM 语义细节**：支持范围与网格伸缩规则。
- **撤/重做对滑条、方向键形态的完整覆盖**（Ctrl+Z 无法回退方向键形态——需一个扩展现有 history 的决策）。

## Out of scope

- **视频预览（谱面视频渲染）** —— 更大愿景，本 effort 不做。
- **预览视频导出** —— 更大愿景，本 effort 不做。
- **AI 辅助采音** —— 未来智能功能，本 effort 不做。
- **安卓 / iOS 移植** —— 需求文档仅"后续考虑"，本 effort 不做。