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
- **当前代码硬事实（已更新）**：项目**可编译可测试**（`tsc -b` / `npm run build` 全绿，vitest 95 测试通过）。死代码 canvas 组件已清理，收敛到活跃 `FinalVirtualCanvas.tsx`；音符替换规则（`NoteReplacementRules`/`SlideEndpointManager`）已重新接入；布局已自适应（见 12）；架构零风险清扫完成（见 15）；粘贴已应用覆盖规则（见 16）；**音频播放 + 预览线 + 按键音已实现**（见 14）。文件保存导出仍待实现。
- **偏好**：中文注释；遵循详细设计的编号术语；惯例见 `docs/plans/NAMING_CONVENTIONS.md`。



## 当前状态盘点（已核实的基线，非决策）

由本次会话直接调查得出，作为后续所有 ticket 的共同前提：

- 入口：`SongUploader → Editor`。Editor 左侧 Toolbar、中间 `FinalVirtualCanvas`、右侧 NoteInfoPanel + 谱面面板。
- 音符数据模型：`src/notes/Charts.tsx`（Single / LDirectional / RDirectional / Slide / Long / BPM / System）。
- 谱面代码：`ChartConverter.ts` 实现 notes↔code JSON 双向转换，与规则文档一致；skill 已支持往返映射（issue 08）。
- 编辑操作（Editor.tsx）：复制/剪切/删除可用（按选中下标）；**粘贴只追加到末尾**（不会粘贴到光标处）；**镜像为** `() => {}` **空桩**；撤销/还原可用；**无任何键盘快捷键绑定**（工具栏提示 Ctrl+C/X/V/Z/Y/Del 但没人监听）。
- 播放/暂停按钮无 onClick（惰性）；无音频播放、无预览线、无按键音。
- 无文件保存/加载/导出（Electron main/preload 待查）。
- 性能：虚拟画布存在，但 3000-5000 音符缩放大卡顿（TODO 遗留）。
- 构建：`npx tsc -b` 报真错误（App.tsx:56 `File|null`→`File`）+ 大量死代码未用变量错误。



## Decisions so far



- [01 当前代码状态盘点](./issues/01-当前代码状态盘点.md) — 现状=半成品原型；构建不过、死代码堆积；编辑操作(+镜像为空桩/粘贴非光标/无快捷键)、替换规则在 FinalVirtualCanvas 被注释、代码编辑器仅占位、无音频、无文件 IPC 均待补。
- [02 谱面代码格式对齐](./issues/02-谱面代码格式对齐.md) — 内部格式与 Bestdori 高度兼容，无需重设计；只需 Bestdori 导入/导出适配器 + 字段规范化（direction 字符串↔数字）。
- [03 音频播放与预览线架构](./issues/03-音频播放与预览线架构.md) — 用 AudioContext+AudioBufferSourceNode，渲染进程 decodeAudioData；预览线在 FinalVirtualCanvas 的 RAF 循环读 currentTime 转换；按键音提前 ~100ms 预调度；无需 Electron 主进程解码。
- [04 Electron 文件持久化与导出](./issues/04-Electron文件持久化与导出.md) — 加 IPC 通道（preload invoke → main ipcMain.handle + dialog + fs）；MVP 导出 chartCodeToJSON 的 JSON 字符串。
- [06 死代码整理与构建修复](./issues/06-死代码整理与构建修复.md) — 已执行：删除 8 个死 canvas 组件 + 4 个测试脚手架，收敛到 FinalVirtualCanvas；修复 App.tsx 类型错误与各类死变量/死函数；`tsc -b` 与 `npm run build` 全绿；配置 vitest 使 9 个单元测试通过。仓库进入干净可编译可测试基线。（同时解阻塞了 10；07 仍待 05）
- [11 坐标模型统一与渲染框架重构](./issues/11-坐标模型统一与渲染框架重构.md) — **已闭环（2026-08-16）**：坐标模型已定案并在坐标/命中层落地——虚拟 X 原点=轨道内容左缘 `trackBgX`、音符 X 不含 `borderTotalWidth`、`virtualToCanvas`/`canvasToVirtual` 统一减去 `trackBgX`，保证任意缩放下音符与网格对齐（修症状 2/3/4）；清除 FinalVirtualCanvas 内 25 处 `console.log`。原「渲染框架重构推迟」四项（rAF 全量重绘 / renderGrid 全量遍历 / getVisibleNotes 全量遍历 / beatToVirtualY 每帧重算）已由 issue 10（瓦片缓存+视口裁剪+增量重绘）+ issue 36 F2（静态层离屏缓存）覆盖实现，本 issue 无剩余待办。
- [12 编辑器布局自适应](./issues/12-编辑器布局自适应.md) — 页面显示不全（需 90% 缩放）根因=固定像素布局合计约 1528px 超出窄屏；仅完成根因评估，**自适应布局未实现**（本次不实现，待规划）。
- [05 基础编辑操作范围锁定](./issues/05-基础编辑操作范围锁定.md) — 已 /grilling 定案并**实现**：多选/拖拽圈选/Shift加选/Ctrl+A(仅画布)、粘贴到鼠标锚点、镜像(左右lane+方向翻转+滑条端点同步)、快捷键(Ctrl+C/X/V/Z/Y/Delete/Backspace/Ctrl+M)+上下文分发、undo/redo 清选区；新增 `NoteEditing.ts` 纯逻辑+8单测。`tsc` 全绿、17 测试通过。07 已解锁。
- [07 音符替换与滑条端点规则重新接入](./issues/07-音符替换与滑条端点规则重新接入.md) — 已**实现**：恢复 NoteReplacementRules import；single/flick/skill/directional 放置改走 handleNoteReplacement（重叠替换+方向键组合），新增两点击自动连接滑条（含滑条间合并）；修复 'single'→'Single' 归一化与 subBeat||0 匹配。新增 9 单测，tsc/build 全绿、28 测试通过。已知缺口：滑条端点扩展交互③、占位样式、端点撞键、组合滑条工具（记录待办）。09 已解锁。
- [音符覆盖与滑条规则](./issues/07-音符替换与滑条端点规则重新接入.md) — **grill-with-docs 定案并实现**：权威规则 `docs/adr/0001-音符覆盖与滑条规则.md` + `CONTEXT.md` 术语。已实现：滑条禁止横向；滑条结点覆盖/拆条（单键任意结点忽略、滑键仅尾部加flick、技能键两端加skill、方向键中间拆两侧/端点拆端，flick与skill可并存）；撤销深拷贝(structuredClone)使方向键与滑条逐步回退；ChartConverter 补 skill 序列化。tsc/build 全绿、35 测试通过。"删除滑条子段"= 独立 feature 待做。
- [13 快捷键系统与自定义配置](./issues/13-快捷键系统与自定义配置.md) — **grill-with-docs 定案并实现**：权威规则 `docs/adr/0002-快捷键系统与自定义配置.md` + `CONTEXT.md` 术语。注册表扁平化为**按具体功能单键**（切换/执行拆分为独立功能，一功能一键、冲突检测）；音符(含 BPM/滑条)/编辑/播放动作默认键位（废弃旧 Ctrl 键位）；工具键 + 执行键双交互（编辑工具态 = Model A 点击即执行）；预览（放置/粘贴幽灵 + 镜像悬停单键与框选含连接区域，真实图标）；设置面板 UI（搜索 + 独立记录弹窗改键 + **屏蔽** + 导出/导入 JSON + 恢复默认）+ localStorage 持久化；Toolbar tooltip 动态化；仅画布作用域。已实现。
- [12 编辑器布局自适应](./issues/12-编辑器布局自适应.md) — **grill-with-docs 定案并实现**：废弃固定像素总宽（1528px 溢出根因），三栏自适应 + 可折叠（左/右面板随视口取 `min(px, vw)` 上限 + `min-width:0` 防溢出 + 画布由固定 750px 改为随视口等比例收缩，缓冲像素不变、事件坐标经 `cssToCanvas` 按显示比例换算）。1280px 窄屏 100% 缩放即可看全；左右面板可各折叠/展开（分隔条悬浮钮）。`tsc -b`/build 全绿、74 测试通过。折叠状态持久化/布局预设（ADR-0003 L2）待配置系统落地。
- [15 架构整洁清扫（C1+C2+C5）](./issues/15-架构整洁清扫-C1C2C5.md) — **improve-codebase-architecture 评审的零风险清扫已执行**：C1 死代码（删除 StatusBar/dragging/externalScrollY 死通道/debugPrint/Toolbar 静态卡/无 onClick 占位「组」「应」/console.log×5；播放按钮 disabled 注明待实现）；C2 坐标几何收敛（`TRACK_CHROME_TOTAL` 常量替代 12 处魔法数 + `trackGeometry` 唯一实现替代 7 处内联居中公式，坐标语义不变）；C5 镜像 lane 修复真实 bug（NoteInfoPanel 4-lane → 统一 `mirrorLane`/`mirrorNote`）。tsc/build 全绿、74 测试通过。C3/C4/C6 留待后续。
- [16 粘贴应用覆盖规则](./issues/16-粘贴应用覆盖规则.md) — **bug 修复**：粘贴不再直接 concat（修复同坐标重叠音符），新增 `pasteChartNotes` 使每个粘贴音符按 ADR-0001 覆盖规则处理（空位原样保留标记/length；普通覆盖替换/方向键 length+1；滑条结点 单键忽略/滑键尾端+flick/技能键两端+skill/方向键拆条；滑条清理重叠后独立加入不组合）。Editor 两处粘贴入口统一接入，新增 10 单测。tsc/build 全绿、84 测试通过。
- [14 音频播放与预览线实现](./issues/14-音频播放与预览线实现.md) — **已实现**：按 ticket 03 架构落地 —— 新增 `AudioTiming.ts`（BPM 事件/时间↔beat 换算/按键音事件，纯逻辑 11 单测）与 `AudioEngine.ts`（AudioContext+AudioBufferSourceNode 精确播放/暂停/seek，渲染进程 decodeAudioData，RAF 提前 100ms 预调度按键音 + 振荡器对象池）；`FinalVirtualCanvas` 播放 RAF 读秒画预览线（秒→beat→y，虚线+时间标签）；Toolbar 播放/暂停按钮接通；`play` 快捷键接通 togglePlay；Editor 消费 `song` 解码 + "跳过（无歌曲模式）"直接进编辑器（顶栏"换歌"）。tsc/build 全绿、95 测试通过。（**交互模型已被 ADR-0004 取代**，见下一条）
- [播放预览交互（ADR-0004 定案）](./issues/17-播放预览交互重做.md) — **grill-with-docs 定案**（docs/adr/0004-播放预览交互.md）：首版"静止谱面+移动线"改为"**判定线固定画布底部 + 谱面随播放上移**"；无音频用**合成时间线**照常播谱；播放时长=音频长度/谱面末端+1小节余量/空谱默认30s（可改）；**临时起点标记**（左沟槽双击设/删 + Ctrl+空格回跳并播放，新 FunctionId 默认 ctrl+space，入 ADR-0002 体系）；**素材包 KeySoundSet**（tap/flick/skill/slide 四类，切换+持久化进 settings，占位默认）；**底部播放条**承载播放类控件；布局 tab 化只定方向（交 ADR-0003 正式 layout）。**待实现（issue 17 为载体）。**
- [真实键音音效加载（issue 18）](./issues/18-真实键音WAV加载.md) — **已实现**：方向键从 flick 拆出，键种扩为 `{tap,flick,skill,slide,directional}`；方向键按组合长度 length(1..3) 分 3 档音效——tap+slide→`perfect.mp3`、flick→`flick.mp3`、skill→`SE_RHYTHM_TAP_SKILL.mp3`、方向键→`directional_fl/_2/_3.mp3`；`AudioEngine` 用 `decodeAudioData` 解码、`AudioBufferSourceNode` 播放，采样缺失时振荡器兜底。默认激活官方素材包（持久化 `audio.keySet`），占位包可切换回。**issue 20 修订：音频内联为 Vite** `?inline` **data-URI（**`src/assets/audio/`**，零媒体网络请求，规避 IDM 等下载插件劫持）**。ADR-0004 §7 已修订。tsc/build 全绿、101 单测通过。
- [键音无声与 IDM 下载劫持（issue 20）](./issues/20-键音无声与IDM下载劫持.md) — **已修复**：issue 18 用 `fetch('.mp3')` 请求音频，被浏览器下载插件（IDM）劫持 → 无声 + 频弹下载（干净浏览器验证代码本身正常）。改为 Vite `?inline` 把 6 个 MP3 内联为 base64 data-URI，**运行时零媒体请求**，插件无从劫持；web/Electron 构建后并入 JS bundle。
- [08 谱面代码编辑器完善](./issues/08-谱面代码编辑器完善.md) — **grill-with-docs 定案**：代码编辑器保留内嵌 textarea；新增强制「应用时校验 beat0 必有 BPM」；文本用真实撤销/重做栈（Ctrl+Z/Y 仅作用代码文本、不碰谱面，再次应用才生效）；双向同步=代码草稿/应用生效，dirty+canvas 变动标过期不覆盖 + 覆盖风险黄条 + 「用画布刷新代码」；一并补全 convertChartCodeToNotes/convertNotesToChartCode 的 skill 往返映射（ADR-0001 对齐，当前 skill 往返丢失）。待实现。
- [21 架构整改·谱面核心与上下文分域](./issues/21-架构整改-谱面核心与上下文分域.md) — **improve-codebase-architecture 评审的候选 A/B/C/D 已落地（4 个 Phase，每笔提交 tsc+vitest 全绿、133 测试）**：Phase1 候选 B+C 统一 BPM 换算（`BpmTimeline` 单一遍历器 + 段缓存，消除 AudioTiming 与 ChartGeometry 两套平行累加）；Phase2 候选 A 上下文分域（Editing/UI/Config/Playback 四 Context，Editor 收为组装层、子组件经 hooks 直读，消除 13 透传 props）；Phase3 候选 B 收尾（FinalVirtualCanvas 1600+ 行拆薄，渲染/命中/坐标收敛 `src/renderer/` 纯模块，依赖注入 RenderCtx，新增 10 单测）；Phase4 候选 D 历史轻量化（`History.ts` 纯模块 + **结构共享快照**替代每次全量 structuredClone，击键 O(n)→O(1)，**正面回应 issue 10 第三问**；notes 以历史栈为单一真相源，修复 impure updater）。候选 E（统一 Settings）/F（tokens）留待 ADR-0003 正式 issue，勿返工。
- [显式谱面长度与谱面工程持久化（ADR-0005 定案）](./issues/23-显式谱面长度与谱面工程持久化.md) — **grill-with-docs 定案**（`docs/adr/0005-显式谱面长度与谱面工程持久化.md` + CONTEXT.md 术语）：谱面长度改**显式、秒域、与音符解耦**（有音频=音频时长/无音频默认30s 可改），取代 ADR-0004 §3"谱面末端=最大音符beat+1拍尾量"的推算语义，修复 bug 9/10/11；引入**谱面工程 Chart project** = { 代码 + 谱面时长 + 音频 Blob }，IndexedDB 键值表持久化（预留多谱面 id），编辑自动防抖保存；超出谱面长度放置=禁止；打开画布定位 beat 0。**待实现（issue 23 为载体）。**
- [导入谱面代码后滚动条定位错误（issue 24）](./issues/24-导入谱面代码后滚动条定位错误.md) — bug：导入/应用谱面代码后滚动条跳到结尾，期望按秒数保持原位置。独立跟踪。
- [存储后端 Electron 改造（issue 25）](./issues/25-存储后端Electron改造.md) — 未来跟踪：谱面工程持久化本期用 IndexedDB（接口抽象化），未来切 Electron `userData` 后端（接 issue 04 IPC）。待后续 grill/实现。
- [多谱面工作区（issue 26）](./issues/26-多谱面工作区.md) — 未来跟踪：多谱面工程列表/切换/隔离；基于 ADR-0005 已预留的"id→工程"键值表，不改存储结构。待后续单独 grill。
- [取消前置上传页与独立音频面板（issue 27）](./issues/27-取消前置上传页与独立音频面板.md) — **grill-with-docs 定案并实现**（修订 ADR-0003 §2 + CONTEXT 术语）：删 `SongUploader` 前置页 + `inEditor`/`onBack` 状态机，`App → Editor` 直达工作台；新增独立音频面板页面（`AudioPanel.tsx`，顶栏"音频"进入，承载导入/换/清除 + 无音频时长编辑）；`page: 'workspace' | 'audio'` 最简页面切换底层为 issue 28 铺路。时长语义沿 ADR-0005 §4 单一字段（清除音频→回无音频态可编辑；重载→音频时长覆盖）。tsc/build 全绿、137 测试通过、浏览器验证入口直达 + 面板切换 + 时长持久化一致。
- [多页面管理/页面 Tab 架构（issue 28）](./issues/28-多页面管理-页面Tab架构.md) — 未来跟踪：完整页面 Tab 架构（工作台/音频/设置/快捷键/多工作区 等页面切换，避免单页堆砌）；基于 issue 27 的最简 Tab 底层扩展，与 issue 22（布局整改）、26（多谱面工作区）协同。待后续单独 grill。
- [10 密集音符性能优化](./issues/10-密集音符性能优化.md) — **已实现并实测达标**：①视口裁剪——`ChartGeometry` 排序索引 + 二分 `visibleNotes`（O(n)→O(log n+可见数)），`renderGrid` 只遍历 `visibleBeatRange`；②缩放离屏瓦片缓存——新增 `src/renderer/noteLayerCache.ts`，手势期（240ms 窗口）只按比例 blit 旧瓦片、settle 250ms 后高清重渲，超大量级回退直渲；③history 轻量化已由 issue 21 候选 D 落地。测试：`RendererPerf.test.ts` 二分结果与旧 O(n) 扫描全对齐，全套 161 测试通过；浏览器 `?perf=1` 实测 5000 音符 40 帧连续缩放 **avg≈0.49ms / max≈2.8ms**（60fps 预算 16.7ms），`layerMode='tiles'`。
- [35 密集音符放置与操作卡顿](./issues/35-密集音符放置与操作卡顿.md) — **已实现并实测达标**：放置/点选/框选卡顿根因=每次编辑全量重建可见瓦片（选中态在缓存键里 + `geometry` 引用不稳定）+ 代码编辑器每次全量重建 100KB+ 文本 + 两处在位变异破坏 History 结构共享。修复：F1 选中高亮移出瓦片改主画布叠加层 `renderSelectionOverlay`（选择变化 0 瓦片重建）；F2 geometry 身份稳定（BPM/谱长/表面不变则复用实例）；F3 notes 前缀/后缀引用 diff 按变化拍区间增量失效瓦片（放置 4-5 块→0-2 块）；F5 画布→代码同步 250ms 防抖；F6 修 `NoteReplacementRules` 两处在位变异（结构共享下撤销不回退 bug，亦为 F3 前提）。新增 `InteractionPerf.test.ts`（14 例），全套 175 测试通过。浏览器实测 3000 音符：放置点击 107ms→11.6-15.9ms（-90%/-70%）、选择 render 本体 0.3ms/0 重建、框选 mouseup 68→22-31ms（单 RAF 口径；双 RAF 口径有 ~2 帧 vsync 地板 ≈28-33ms，见 issue 口径修订）；F1 视觉 A/B 像素 diff 99.8% 一致（仅高亮 z-order 预期变化）。
- [37 谱面代码编辑器改按需弹窗](./issues/37-谱面代码编辑器改按需弹窗.md) — **已实现**：`ChartCodeEditor` 由常驻内嵌右面板改为**按需弹窗**（issue 36 RC-A 的完整形态，F1 收尾）——入口按钮移入左工具栏「编辑」分组，弹窗 `createPortal` 按需挂载；打开才构建/渲染 textarea，关闭即卸载（成本归零）；单向同步「打开画布→代码一次 / 应用代码→画布」+ 关闭即丢草稿；保留撤销栈/校验/应用覆盖确认/复制/重置/用画布刷新/过期提示（issue 08 语义）；点击遮罩关闭（含未应用草稿确认）。tsc 全绿、180 测试通过。密集谱画布编辑路径代码同步成本归零。
- [29 素材页面：键音素材包与音符皮肤](./issues/29-素材页面-键音素材包与皮肤.md) — **open（2026-08-27 拆分收口，背景皮肤剥离至 issue 43）**：独立 tab「素材」(导航第 3 项 `⇧⌘3`)。**键音整包 + SE 音量已迁音频页**，AssetsPage 收窄为视觉素材页。**音符皮肤全量落地**：7 普通 + 5 方向扩容已验证；整包预设/条目覆盖/同号同名约定 + 6 列 2 行 + 副标「整包应用/已自定义」形态整改切片 1–4。未做：素材包导入（格式与校验待 grill）。PlayBar 素材下拉已自然消解。**谱面背景皮肤独立为 [issue 43](./issues/43-背景皮肤及其裁剪编辑器.md)**。
- [43 背景皮肤及其裁剪编辑器](./issues/43-背景皮肤及其裁剪编辑器.md) — **open（2026-08-27 拆分自 issue 29）**：4 配置（启用/不透明度/填充方式/显示范围）已落地（IndexedDB `bangdream.assets` 存图 + settings 四字段 + 静态层失效五要素 + 激活补帧 + Playwright 矩阵实测全过）。**问题1根因教训入册**：缓存加新失效维度必须同步扩命中比较链。**待开工**：自由裁剪编辑器（grill 已拍板：原图坐标系 / 画完即持久 / IDB 写裁后副本；交互复用 sprite-locator；含「恢复原图」撤销按钮）。**仍登记未做**：预设比例、锁定矩形、批量管理、图片库/预设包（与 issue 29 末项"素材包导入"格式相关联）。
- [39 设置页整改·应用与功能两组结构](./issues/39-设置页整改-应用与功能两组结构.md) — **open（grill 行为轮定案 + 主体实现 2026-08-18）**：两组结构（应用设置=外观/布局/配置数据；功能设置=画布显示/播放）+ 7 参数逐项以 bestdori 实测定案（节奏图示大小 10–200/10、长压线不透明度 10–100/10、同时点击线开关、色觉辅助开关、纵向比例 50–200/10、图像品质三档默认标准、节奏图示SE音量 0–100/5）。**已实现：结构 + 6 项**（schema/context/设置页 UI/画布渲染挂钩/瓦片失效/SE 独立 seGain），tsc 0、187 测试、build 全绿。**色觉辅助 #4 整体顺延**（虚拍图标坐标依赖 Issue-41 取样，连同「半拍整数倍→虚拍」判断逻辑一起落位）。**追加问题收尾（2026-08-19）**：图像品质改 select 下拉（弃分段按钮）、Slide 连接带宽度 × noteSize 四处同步（修"调大小连接线不变"）、恢复默认由配置数据整组改画布显示/播放分组各行。
- [40 精灵图坐标规范化重构与渲染质量](./issues/40-精灵图坐标规范化重构与渲染质量.md) — **open（2026-08-18 立）**：`CanvasSpriteIcon` 负百分比偏移坐标系规范化成像素矩形 + 三张注册表整理 + 虚拍接入点预留 + 渲染质量（smoothing/瓦片DPR）提升。源自 issue 39 grill Q8（用户拍板 B→C 拆独立 issue）。
- [41 精灵图可视化定位工具](./issues/41-精灵图可视化定位工具.md) — **resolved（2026-08-22 独立入口）**：同一仓库独立页 `/sprite-locator.html`（`src/sprite-locator/`），不占主导航、不进主 bundle、`build:release` 不打包。加载 skin 图，滚轮缩放/空格平移/拖拽框选，选区可手柄/键盘/数值微调，输出 BaseSpriteIcons 条目（{x,y,w,h}+可选 inkLeft/inkRight）。解阻塞 issue 39 #4（tapVirtual 坐标待用户用本工具量取后填入）。
- [25 存储后端 Electron 改造](./issues/25-存储后端Electron改造.md) — **resolved（2026-08-27 实现+验证）**：谱面工程持久化按环境自动选后端——Electron 走 `userData/projects/<id>/{project.json,audio.bin}` 文件后端（ipcMain + 原子写 + id 白名单），浏览器照旧 IndexedDB；grill 定案无设置项。音频按 Blob 实例身份判重，未变声明 `keep` 不重传字节（防抖保存不再重写大音频）；首启静默迁移 IndexedDB→文件后端（幂等、原数据保留备份）。`ChartProjectStore` API 兼容、Editor 零改动。tsc 0 / 277 测试全过 / build 绿；Electron 手工验收清单见 issue。
- [45 判定线滚动模型深模块](./issues/45-判定线滚动模型深模块.md) — **resolved（2026-08-29，架构深化评审候选 1 收口）**：把「判定线此刻对应第几秒」的 秒↔scrollY↔滚动条 映射 + 按秒重锚状态机 + 有效缩放钳制，从 2 组件 + 2 纯模块 + ref 协议 收敛为单一深模块 `src/utils/PlaybackScrollModel.ts`（纯逻辑、node 可单测）。Editor 只应用 DOM scrollTop / 驱动画布，FinalVirtualCanvas 的 imperative handle 收窄到 `setScrollY`+起点标记（删除 6 个 秒↔scrollY 数学方法，ref 协议 seam 消除）。issue 24 重锚 + issue 38 缩放钳制的实现归位。新增 15 单测；tsc 0 / 315 测试全过 / build 绿 / lint 无新增错误；浏览器实测 issue 24 不变量（谱面拉长后判定线处秒数稳定不跳尾）成立。候选 2（播放协调模块）的地基。
- [46 Editor 回归只组装·会话流拆钩子](./issues/46-Editor回归只组装-会话流拆钩子.md) — **resolved（2026-08-29，架构深化评审候选 2 收口）**：把 Editor 6 种无关联会话流全部拆到聚焦 hook（`src/utils/use*.ts`）——`useSurfaceSize` 渲染面测量 / `useScrollModel` 滚动模型 / `useAudioBridge` 音频桥接 / `usePlaybackCoordinator` 播放编排 / `useChartProjectPersistence` 持久化 / `useLayoutPersistence` 布局回写 / `useShortcutDispatch` 快捷键分发。复用候选 1 的 `PlaybackScrollModel` 与既有 `ChartProjectStore` / `AudioEngine` 深模块。Editor.tsx 837 → 507 行（-40%），仅剩 4 域消费 + 7 hook 串联 + 布局 JSX。新增 2 个纯逻辑类 + 14 单测（SurfaceSizeMerger 9 + ChartProjectPersistenceMerger 6）。tsc 0 / 330 测试全过 / build 绿 / lint 无新增错误；浏览器实测播放/折叠/切页/时长同步行为一致。ADR-0003 §7「Editor 只组装」形式化收口。
- [47 音频域单一接缝·深模块](./issues/47-音频域单一接缝深模块.md) — **resolved（2026-08-29，架构深化评审候选 3 收口）**：建音频会话深模块 `src/utils/AudioSession.ts`（320 行），拥有 引擎 + 文件 + 时长 + keySet + seVolume + 持久化钩子 + 订阅接口；引擎通过 factory 注入（local-substitutable）。`AudioPageContext` 桥接删除，音频页与工作台都通过 `useAudioSession()` 拿同一深模块。`useAudioBridge` 改为薄壳（订阅 session、单向写回 PlaybackContext），Editor 删除 `new AudioEngine()` / `audioMetaRef` / `persistRef` ref 环（持久化 saveNow 一次性注入到 session）。inFlightToken 防 import 竞态；NaN/Inf 拒绝；chartDuration clamp 到 MAX。tsc 0 / 365 测试全过（基线 330 + 新增 35：22 AudioSession + 13 回归）/ build 绿 / lint 无新增错误。ADR-0003 §12.2 字段位置不动（仍归 ConfigContext 段），仅动"桥与归属的呈现"。
- [50 画布贴合回归与判定线视觉冗余清理](./issues/50-画布贴合回归与判定线视觉冗余清理.md) — **resolved（2026-09-06，commit b67a793 收口）**：画布 CSS 100% 贴满 chartArea（放弃 min 维度 letterbox 算法，轨道居中/黑底移到绘制层）、判定线 DOM+绘制全删（音符越过 chartArea 底边即判）、PlayBar borderTop 删、`DEFAULT_SURFACE`/`CANVAS_WIDTH`/`CANVAS_HEIGHT` 删除且 `surface` 改 required、`SurfaceSize` nullable + min 200×240 钳制、StrictMode 下 merger 不 destroy 只断 RO。tsc 0 / 430 测试全绿 / 用户目检通过。
- [55 工具交互机制（ADR-0008 定案）](./issues/55-工具栏工具交互机制整改与重构.md) — **grill 三轮定案（2026-09-07），权威 = [ADR-0008](../../docs/adr/0008-工具交互机制.md)**：两轴 = **持工具态（单轴互斥、全工具驻留）× 选区（常驻、与工具解耦）**，"执行"为瞬时动作非态；任意态可框选，框选/点击语义按工具族矩阵（键型框选=批量替换、动作类框选=批量执行、滑条框选=组合、BPM/粘贴框选无效果、批量后选区保留）；**Slide 混合制** = 两击直放（禁止横向仅约束此路径，ADR-0001 §2 修订）+ 框选组合（beat+subBeat 升序、同拍 lane 升序；形态归一表：flick 起点剥标/末尾保留、skill 两端保留、方向键降普通、中间结点统一化、音符消耗为结点、端点重合仍走 §3 接合——**表格逐行单测锁**）；Ctrl+E 双档（有选区组合/无选区放锚点共用 slideBuffer）；**BPM prompt() 废除→就地编辑**（默认沿用上一次值、沟槽数字自动进编辑态、Enter 应用、随时可改，模式推广到未来结点缓动参数）；**拖拽移动**引入（仅指针态：音符上拖=移动、空白拖=框选，吸附放置栅格；滑条端点延伸/结点整形，hidden 结点留 09+56）；**Esc 四档链**（弹窗→滑条锚点→清选区→落指针），侧栏折叠改绑 `Ctrl+B` toggle 进注册表。修订 ADR-0002 §3/§2.1、ADR-0001 §2；CONTEXT 新增 持工具态/选区/框选组合/就地编辑 词条。**已实现（2026-09-07）+ 二轮验收修复（#1 测试去票号命名；tsc+536 测全绿）。三轮验收修复（2026-09-07）：#2 滑条吸入改**结点级+宿主拆条**、两击接合**级联**修复、组合完成后**清空选区**（一次性动作）、#4 拖拽提交恒回弹 bug 修复+**Shift+音符任意态拖拽**+grabbing 光标、#5/#6 方案 A 落地（Toolbar 删除/镜像 arm 按钮）；ADR-0008 §2/§4/§6 三轮修订；tsc+541 测全绿。遗留：右键删除扩展待用户确认**；SP 绿条（09）与音符选中视觉（56）的交互槽位由此票供模型。 **→ 2026-09-08 收口 resolved**：四~九轮验收（Slide 连接/组合改「触碰即整条入链 + K 路保序归并」、拖拽落点覆盖与 §3 接合、BPM 数字命中盒收窄到文字盒、粘贴持工具态转正与复制/剪切退出工具轴、单击画布即清选区含轨道外）+ subagent 评审 P0 修复（执行键回归矩阵、粘贴选区下标、subBeat 单位、归一表锁表回生产路径）；ADR-0008 §2.1/§4/§6 与 ADR-0002 键位表同步；570 测全绿。遗留转出见票末清单（SP 绿条与 hidden 结点拖拽→09、选中视觉→56-a、拖拽可发现性→56-c、右键删除待拍板）。



- **61~65（issue 55/56 验收遗留，2026-09-09 用户复报 → 同日实现）** —— 五张**轻票**，根因/修法/锁测各写在本票：[61 拖拽落点吸附相位](./issues/61-拖拽落点吸附相位修复.md)｜[62 方向滑键整组命中与拖拽](./issues/62-方向滑键整组命中与拖拽.md)｜[63 框选拖拽越出画布不再取消](./issues/63-框选拖拽越出画布不再取消.md)｜[64 谱面工程自动落盘失效](./issues/64-谱面工程自动落盘失效.md)｜[65 Slide 临时锚点与幽灵 hover](./issues/65-Slide临时锚点与幽灵hover.md)。**待用户在页面验收**（63 的"该不该改"按推荐方案实现、用户可否决）。
- **66~69（issue 55/56 验收后复报，2026-09-09 → 同日实现；原"批次票"按用户要求拆成四张具体票）** —— [66 方向滑键组尾溢出轨道外的拖动](./issues/66-方向滑键组尾溢出轨道外的拖动.md)（根轨在界内即合法，组尾溢出不再回弹；4a 修拖拽起手 snapPos 越界 lane）｜[67 框选按住时矩形内音符实时高亮](./issues/67-框选按住时矩形内音符实时高亮.md)（**新特性，独立票，open 未实现**；⚠️ 含"必须改 noteLayerCache 门卫否则无效果"的踩坑记录）｜[68 选中态暗底遮罩遮挡相邻音符](./issues/68-选中态暗底遮罩遮挡相邻音符.md)（单键/方向键改走 compact，与 Slide 统一）｜[69 谱面代码弹窗面包屑需在完整代码视图也显示](./issues/69-谱面代码弹窗面包屑需在完整代码视图也显示.md)（三视图永远显示，不加返回按钮）。66/68/69 待你在页面验收。
- [70 画布操作交互内核·光标视口单一真相](./issues/70-画布操作交互内核与光标视口单一真相.md) — **claimed（2026-09-10 立，架构深化评审候选 1+3 收口；interface 形状待 grill 定案）**：把画布操作的**编排层**（手势状态机、4px 阈值仲裁、单击/框选/拖拽分派、Slide 锚点生命周期，现全部内联在 `FinalVirtualCanvas.tsx` 1048 行内）抽成可无 DOM 单测的深模块，组件退化为 adapter；同时把光标/视口/起点标记的**三份双向同步 state**（`hoverPos`↔`mousePosition`、`viewport.scale`↔`ui.scale`、`markerBeat`↔Playback）归一为单向派生。**动机 = 用户即将大改画布操作逻辑，而编排层当前零测试覆盖**（`ToolActionMatrix`/`NoteReplacementRules` 的规则核心有锁表，编排层一行没测）。**不改任何操作语义**——票内 17 条不变量逐条锁（单击/框选矩阵、ADR-0008 §6 落点裁决、Esc 四档链、右键删除与粘贴两入口合并后等价）。候选 2/4/5 不在本票范围。


## Not yet specified

可再细化的雾（推进边界后毕业）：

- **工作台 UI 与配置系统（已定案，待实现）**：设计已由 **ADR-0003** 锁定——取消上传页直达工作台（加载音频为**独立音频面板/页面**，非顶栏按钮，见 issue 27 修订）；样式改 CSS design tokens、内置亮/暗主题（谱面画布固定深色）；布局 L1 折叠 + L2 命名预设、目标桌面三平台 + 浏览器、1280px 窄屏不溢出；统一 versioned `settings` JSON（主题+布局+快捷键）导入导出；状态管理改 `Editing/UI/Config` 三个 Context 分域。尚未排期实现，待后续 issue。**其中"面板折叠 UI"为 issue 12 的过渡形态，随工作台改造正式重做（样式随主题 token、折叠/宽度/预设纳入 settings JSON），勿在过渡形态上返工。**
- ~~**"谱面预览"的形态~~（已定案 ADR-0004）**：编辑器**内联播放**（非独立预览模式）：判定线固定底部 + 谱面随播放上移；无音频合成时间线照常播；临时起点标记回跳；底部播放条。实现载体 = issue 17。
- ~~**更多音符样式 / 图标资源管理~~（已归位，2026-08-17 grill）**：即 issue 29 素材 tab 的「音符皮肤 / 谱面背景皮肤」类别；皮肤包数据模型、资源来源（用户侧找资源）、皮肤与音符类型映射留待在该 issue 内深入 grill。
- **ADR-0003 文档结构整理（低优）**：用户指出 ADR-0003「工作台 UI 与配置系统」中配置系统章节与 UI 章节混装、位置不合适。低优跟踪：未来评估拆分或归并（配置系统 → 与 ADR-0002 合并/独立成文）。本轮信息架构定案（素材 tab 范围、设置页两组结构）**不写入** ADR-0003，分别落 issue 29 / 39 定案记录。
- **负数 BPM 语义细节**：支持范围与网格伸缩规则。
- **谱面预览 Auto 自动打歌（远期）**：未来谱面预览环节做 Auto 演示时需判定结果显示，素材用 `docs/resource/bestdori/<server>/reference-only/judgeskin/` 归档（2026-08-24 grill 登记：非可选皮肤、不接音符渲染器，但保留此用途，防止误判为永久排除）。
- ~~**撤/重做对滑条、方向键形态的完整覆盖~~（已解决）**：issue 21 结构共享 History + issue 35 F6 修复 `NoteReplacementRules` 两处在位变异后，方向键长度与滑条组合均可正确回退。



## Out of scope

- **视频预览（谱面视频渲染）** —— 更大愿景，本 effort 不做。
- **预览视频导出** —— 更大愿景，本 effort 不做。
- **AI 辅助采音** —— 未来智能功能，本 effort 不做。
- **安卓 / iOS 移植** —— 需求文档仅"后续考虑"，本 effort 不做。

